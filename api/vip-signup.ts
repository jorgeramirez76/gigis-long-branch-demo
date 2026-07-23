import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "./lib/db.js";
import { ensureWelcomeCode } from "./lib/promo.js";
import { sendWelcomeSms, sendWelcomeEmail } from "./lib/notify.js";
import { rateLimitAll } from "./lib/rateLimit.js";
import { verifyTurnstile } from "./lib/turnstile.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts loose US 10-digit input; normalizes to E.164 (+1XXXXXXXXXX).
const US_PHONE_RE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;

function normalizePhone(input: string): string | null {
  const match = input.trim().match(US_PHONE_RE);
  if (!match) return null;
  return `+1${match[1]}${match[2]}${match[3]}`;
}

function clientIp(req: VercelRequest): string | undefined {
  // Vercel-set trusted IP only — no x-forwarded-for fallback (its leftmost hop is
  // client-spoofable off-platform, which would let one IP evade the signup limit).
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { business, name, phone, email, smsConsent, emailConsent, consentText, turnstileToken } = req.body ?? {};

  // Canonical consent language — MUST stay in sync with CONSENT_TEXT in
  // src/components/VipClub.tsx and the registered A2P campaign message_flow.
  // Stored server-side so the audit trail can't be forged by a crafted POST.
  const CANONICAL_CONSENT_TEXT =
    "By checking \"Text me deals,\" I agree to receive recurring promotional texts (weekly specials and promo codes) from Gigi's NY Style Pizza, 140 Brighton Ave, Long Branch, NJ, sent by automated technology to the number I provided. Consent is not a condition of any purchase. Message frequency varies, typically up to 4 per month. Message & data rates may apply. Reply STOP to opt out, HELP for help. By checking \"Email me deals,\" I agree to receive promotional emails; unsubscribe anytime via the link in any email.";

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

  // Rate limit BEFORE any DB write or (costly, spammable) SMS/email send. Guards
  // against an attacker looping victim numbers to send unsolicited texts on the
  // store's dime. Keyed by IP (primary) plus the target contact.
  const ip = clientIp(req);
  if (!(await verifyTurnstile(typeof turnstileToken === "string" ? turnstileToken : undefined, ip))) {
    res.status(403).json({ error: "verification_failed" });
    return;
  }
  const contactKey = normalizedPhone || normalizedEmail || "unknown";
  const allowed = await rateLimitAll([
    ...(ip
      ? [
          { bucket: `signup:ip:${ip}:h`, max: 4, windowSec: 3600 },
          { bucket: `signup:ip:${ip}:d`, max: 20, windowSec: 86400 },
        ]
      : []),
    { bucket: `signup:contact:${contactKey}`, max: 2, windowSec: 86400 },
  ]);
  if (!allowed) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  try {
    const inserted = await sql`
      INSERT INTO vip_members (business, name, phone, email, sms_consent, email_consent, consent_text, source)
      VALUES (${business}, ${name.trim()}, ${normalizedPhone}, ${normalizedEmail}, ${!!smsConsent}, ${!!emailConsent}, ${CANONICAL_CONSENT_TEXT}, 'website')
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
    // Registered as the campaign's OptInMessage — keep the shape in sync with
    // the A2P filing if this wording changes.
    const welcomeMessage = `Gigi's NY Style Pizza VIP Club: you're in! Code ${code} gets you ${description}. Up to 4 msgs/mo. Msg&data rates may apply. Reply HELP for help, STOP to opt out.`;

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

    // Do NOT echo provider send results to the public caller — that leaks
    // Twilio/Resend error detail. Delivery status is recorded in vip_sends.
    void results;
    res.status(200).json({ ok: true, code });
  } catch (err) {
    console.error("[vip-signup] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
