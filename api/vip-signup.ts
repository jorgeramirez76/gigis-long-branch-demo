import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "./lib/db.js";
import { issueWelcomePie } from "./lib/promo.js";
import { addressDedupeKey } from "./lib/address.js";
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

  const { business, name, phone, email, address, apt, smsConsent, emailConsent, consentText, turnstileToken } = req.body ?? {};

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

  // Free-pie signup requires all three abuse-control vectors (phone, email,
  // address) so one person can't cycle any single field to re-claim the pie.
  // Consent checkboxes still control which channels we actually SEND to.
  const normalizedPhone = typeof phone === "string" ? normalizePhone(phone) : null;
  if (!normalizedPhone) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();

  const streetRaw = typeof address === "string" ? address.trim().slice(0, 160) : "";
  const aptRaw = typeof apt === "string" ? apt.trim().slice(0, 40) : "";
  if (streetRaw.length < 4) {
    res.status(400).json({ error: "address_required" });
    return;
  }
  const addrKey = addressDedupeKey(streetRaw, aptRaw);
  if (!addrKey) {
    res.status(400).json({ error: "address_required" });
    return;
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
    // ON CONFLICT DO NOTHING covers ALL three unique indexes (phone, email,
    // address+apt): a match on ANY one means this person/household already
    // claimed the welcome pie, so no row is inserted and no new pie is issued.
    const inserted = await sql`
      INSERT INTO vip_members (business, name, phone, email, address, apt, addr_key, sms_consent, email_consent, consent_text, source)
      VALUES (${business}, ${name.trim()}, ${normalizedPhone}, ${normalizedEmail}, ${streetRaw}, ${aptRaw || null}, ${addrKey}, ${!!smsConsent}, ${!!emailConsent}, ${CANONICAL_CONSENT_TEXT}, 'website')
      ON CONFLICT DO NOTHING
      RETURNING id
    `;

    if (inserted.rowCount === 0) {
      // Existing member / phone / email / address — the free pie is one per new
      // member, so we don't issue another. Generic message (no field echoed) to
      // avoid leaking which detail is already on file.
      res.status(200).json({
        ok: true,
        alreadyMember: true,
        message: "You're already in the VIP Club — the free welcome pie is one per new member. Watch for our deals!",
      });
      return;
    }

    const memberId = inserted.rows[0].id as number;
    const { id: promoCodeId, code, description } = await issueWelcomePie(business, memberId);
    // Registered as the campaign's OptInMessage — keep the shape in sync with
    // the A2P filing if this wording changes.
    const welcomeMessage = `Gigi's NY Style Pizza VIP Club: you're in! Code ${code} gets you ${description}. Up to 4 msgs/mo. Msg&data rates may apply. Reply HELP for help, STOP to opt out.`;

    // Send ONLY to the channels the member consented to (both fields are stored
    // for dedup regardless). On-screen code (below) is the fallback if a channel
    // isn't armed yet.
    if (smsConsent) {
      const sms = await sendWelcomeSms(normalizedPhone, welcomeMessage);
      await sql`
        INSERT INTO vip_sends (business, channel, member_id, promo_code_id, status, provider_id, error)
        VALUES (${business}, 'sms', ${memberId}, ${promoCodeId}, ${sms.sent ? "sent" : "failed"}, ${sms.providerId ?? null}, ${sms.error ?? null})
      `;
    }
    if (emailConsent) {
      const mail = await sendWelcomeEmail(normalizedEmail, "Welcome to the Gigi's VIP Club 🍕", welcomeMessage, {
        promoCode: code,
        promoDescription: description,
      });
      await sql`
        INSERT INTO vip_sends (business, channel, member_id, promo_code_id, status, provider_id, error)
        VALUES (${business}, 'email', ${memberId}, ${promoCodeId}, ${mail.sent ? "sent" : "failed"}, ${mail.providerId ?? null}, ${mail.error ?? null})
      `;
    }

    // Return the code so the success screen can show it immediately — robust
    // even before SMS is armed. Never echo provider send results (leaks detail).
    res.status(200).json({ ok: true, code, description });
  } catch (err) {
    console.error("[vip-signup] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
