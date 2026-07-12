import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "./lib/db.js";
import { ensureWelcomeCode } from "./lib/promo.js";
import { sendWelcomeSms, sendWelcomeEmail } from "./lib/notify.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts loose US 10-digit input; normalizes to E.164 (+1XXXXXXXXXX).
const US_PHONE_RE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;

function normalizePhone(input: string): string | null {
  const match = input.trim().match(US_PHONE_RE);
  if (!match) return null;
  return `+1${match[1]}${match[2]}${match[3]}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { business, name, phone, email, smsConsent, emailConsent, consentText } = req.body ?? {};

  if (!isVipBusiness(business)) {
    res.status(400).json({ error: "invalid_business" });
    return;
  }
  if (typeof name !== "string" || name.trim().length < 1) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  if (!smsConsent && !emailConsent) {
    res.status(400).json({ error: "consent_required" });
    return;
  }
  if (typeof consentText !== "string" || consentText.trim().length < 1) {
    res.status(400).json({ error: "consent_text_required" });
    return;
  }

  let normalizedPhone: string | null = null;
  if (smsConsent) {
    if (typeof phone !== "string") {
      res.status(400).json({ error: "phone_required_for_sms_consent" });
      return;
    }
    normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      res.status(400).json({ error: "invalid_phone" });
      return;
    }
  }

  let normalizedEmail: string | null = null;
  if (emailConsent) {
    if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    normalizedEmail = email.trim().toLowerCase();
  }

  try {
    const inserted = await sql`
      INSERT INTO vip_members (business, name, phone, email, sms_consent, email_consent, consent_text, source)
      VALUES (${business}, ${name.trim()}, ${normalizedPhone}, ${normalizedEmail}, ${!!smsConsent}, ${!!emailConsent}, ${consentText}, 'website')
      ON CONFLICT DO NOTHING
      RETURNING id
    `;

    if (inserted.rowCount === 0) {
      // Already a member (unique phone/email per business) — treat as idempotent success.
      res.status(200).json({ ok: true, alreadyMember: true });
      return;
    }

    const memberId = inserted.rows[0].id as number;
    const { id: promoCodeId, code, description } = await ensureWelcomeCode(business);
    const welcomeMessage = `Welcome to the VIP Club! Your code ${code} gets you ${description}. Reply STOP to opt out.`;

    const results: Record<string, unknown> = {};
    if (normalizedPhone) {
      const sms = await sendWelcomeSms(normalizedPhone, welcomeMessage);
      await sql`
        INSERT INTO vip_sends (business, channel, member_id, promo_code_id, status, provider_id, error)
        VALUES (${business}, 'sms', ${memberId}, ${promoCodeId}, ${sms.sent ? "sent" : "failed"}, ${sms.providerId ?? null}, ${sms.error ?? null})
      `;
      results.sms = sms;
    }
    if (normalizedEmail) {
      const mail = await sendWelcomeEmail(normalizedEmail, "Welcome to the Gigi's VIP Club", welcomeMessage, {
        promoCode: code,
        promoDescription: description,
      });
      await sql`
        INSERT INTO vip_sends (business, channel, member_id, promo_code_id, status, provider_id, error)
        VALUES (${business}, 'email', ${memberId}, ${promoCodeId}, ${mail.sent ? "sent" : "failed"}, ${mail.providerId ?? null}, ${mail.error ?? null})
      `;
      results.email = mail;
    }

    res.status(200).json({ ok: true, code, sendResults: results });
  } catch (err) {
    console.error("[vip-signup] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
