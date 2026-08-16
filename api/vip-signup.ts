import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isVipBusiness } from "./lib/db.js";
import { addressDedupeKey, legacyAddressDedupeKey } from "./lib/address.js";
import { validateVipConsentAndLocality } from "./lib/vipValidation.js";
import { sendTransactionalEmail } from "./lib/notify.js";
import { verificationHtml } from "./lib/emailTemplate.js";
import { rateLimitAll } from "./lib/rateLimit.js";
import { verifyTurnstile } from "./lib/turnstile.js";
import {
  ALREADY_MEMBER_MESSAGE,
  CANONICAL_CONSENT_TEXT,
  generatePollId,
  generateVerifyToken,
  hashSecret,
  memberExists,
  storePendingSignup,
  sweepExpiredPending,
  VERIFY_TTL_HOURS,
  type ValidatedSignup,
} from "./lib/vipSignupShared.js";

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

  const { business, name, phone, email, address, apt, city, state, zip, smsConsent, emailConsent, consentText, turnstileToken, source } = req.body ?? {};

  // Where the signup came from, so the club's growth can be attributed to the
  // thing that caused it. Allowlisted: it is written to the members table, and a
  // free-text field from the browser would be both spoofable and unqueryable.
  const SIGNUP_SOURCES = ["website", "checkout", "receipt", "menu-qr", "winback"] as const;
  const signupSource = SIGNUP_SOURCES.includes(source) ? (source as string) : "website";

  if (!isVipBusiness(business)) {
    res.status(400).json({ error: "invalid_business" });
    return;
  }
  if (typeof name !== "string" || name.trim().length < 1) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  const consentAndLocality = validateVipConsentAndLocality(smsConsent, emailConsent, city, state, zip);
  if (!consentAndLocality.ok) {
    res.status(400).json({ error: consentAndLocality.error });
    return;
  }
  if (typeof consentText !== "string" || consentText.trim().length < 1) {
    res.status(400).json({ error: "consent_text_required" });
    return;
  }
  // The submitted wording must be the canonical, A2P-registered language byte for byte. Until now
  // this was only asserted in comments, so a surface could drift and still write the registered text
  // into vip_members.consent_text — producing consent records claiming people saw text they never
  // saw. This turns the invariant into an actual tripwire (the Sea Bright build already had it).
  if (consentText.trim() !== CANONICAL_CONSENT_TEXT) {
    console.error("[vip-signup] consent text mismatch — a signup surface has drifted from the canonical wording");
    res.status(400).json({
      error: "consent_text_mismatch",
      message: "Please reload the page and try again.",
    });
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
  // Stored whole ("140 Brighton Ave, Long Branch, NJ 07740") because a street line
  // on its own isn't an address — it can't be mailed to and two towns share street
  // names. The current key includes locality so same-number streets in different towns do not
  // collide; a legacy street+apt key is also checked against members created before this change.
  const cityRaw = consentAndLocality.city;
  const stateRaw = consentAndLocality.state;
  const zipRaw = consentAndLocality.zip;
  const fullAddress = [streetRaw, cityRaw, [stateRaw, zipRaw].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const addrKey = addressDedupeKey(streetRaw, aptRaw, cityRaw, stateRaw, zipRaw);
  const legacyAddrKey = legacyAddressDedupeKey(streetRaw, aptRaw);
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
  const allowed = await rateLimitAll([
    ...(ip
      ? [
          { bucket: `signup:ip:${ip}:h`, max: 4, windowSec: 3600 },
          { bucket: `signup:ip:${ip}:d`, max: 20, windowSec: 86400 },
        ]
      : []),
    // Keyed on the PHONE (was the only per-target key). 4/day.
    { bucket: `signup:contact:${normalizedPhone}`, max: 4, windowSec: 86400 },
    // Keyed on the EMAIL — the address a verification code is actually sent to. This is
    // the fix for the email-bomb the verification gate would otherwise open: a submit now
    // only PARKS a pending row and emails a code, so without a per-email cap an attacker
    // rotating the (unauthenticated, format-only) phone could email one victim's inbox
    // over and over from Gigi's sending domain. 3/hour + 5/day bounds any single address
    // to a few messages regardless of phone/IP rotation, while still allowing a couple of
    // legitimate resends. Sits on top of Turnstile (enabled in prod), not instead of it.
    { bucket: `signup:email:${normalizedEmail}:h`, max: 3, windowSec: 3600 },
    { bucket: `signup:email:${normalizedEmail}:d`, max: 5, windowSec: 86400 },
  ]);
  if (!allowed) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  const validated: ValidatedSignup = {
    name: name.trim(),
    phone: normalizedPhone,
    email: normalizedEmail,
    fullAddress,
    apt: aptRaw || null,
    addrKey,
    legacyAddrKey,
    smsConsent: consentAndLocality.smsConsent,
    emailConsent: consentAndLocality.emailConsent,
    source: signupSource,
  };

  try {
    // Existing members get the friendly answer NOW — no verification email is sent
    // for an address that can't produce a new membership anyway. (Advisory check;
    // the INSERT's ON CONFLICT at verify time remains the authority.)
    if (await memberExists(business, validated)) {
      res.status(200).json({ ok: true, alreadyMember: true, message: ALREADY_MEMBER_MESSAGE });
      return;
    }

    // ---- email-verification gate ----
    // Nothing is created yet. Stops typo'd emails (a member who'd never get her code)
    // and throwaway addresses farming free pies.
    await sweepExpiredPending(business); // keep abandoned PII rows from accumulating

    // ---- one-click verification link ----
    // The emailed button carries a 32-byte token; the member + free-pie code are created only when
    // it is opened (see api/vip-verify.ts). The link points at a STATIC page which then POSTs the
    // token, so an email security scanner pre-fetching the URL can't activate anybody — only a real
    // browser running the page's script does.
    const token = generateVerifyToken();
    const pollId = generatePollId();
    await storePendingSignup(business, validated, hashSecret(token), pollId);

    const base = process.env.PUBLIC_BASE_URL || "https://gigislongbranch.com";
    // The token rides as a BARE query string — no `t=`. Deliberate: `=` is quoted-printable's
    // escape character, and the email pipeline was observed (2026-08-13, ~1 in 5 messages)
    // garbling the `=` in `?t=` into U+FFFD and eating two token characters — a dead link for
    // that customer. base64url has no `=`, so with the key dropped the URL contains none at all
    // and there is nothing left for a QP encoder/decoder pair to disagree about.
    const verifyUrl = `${base}/vip-verify/?${token}`;

    const mail = await sendTransactionalEmail(
      normalizedEmail,
      "Tap to confirm your email — Gigi's VIP Club 🍕",
      verificationHtml({ url: verifyUrl, email: normalizedEmail, hours: VERIFY_TTL_HOURS }),
      `Welcome to the Gigi's NY Style Pizza VIP Club!\n\nConfirm your email to unlock your free plain cheese pie code:\n${verifyUrl}\n\nThis link works for ${VERIFY_TTL_HOURS} hours and confirms ${normalizedEmail}.\nDidn't sign up at Gigi's? You can ignore this email — nothing was created.`,
    );
    if (!mail.sent) {
      // Without the email there is nothing the person can do — fail loudly rather
      // than strand them waiting for a link that never comes.
      console.error("[vip-signup] verification email failed:", mail.error);
      res.status(502).json({
        error: "code_send_failed",
        message: "We couldn't send the verification email just now — please try again in a minute.",
      });
      return;
    }

    res.status(200).json({
      ok: true,
      verifyRequired: true,
      verifyMethod: "link",
      email: normalizedEmail,
      pollId,
      ttlHours: VERIFY_TTL_HOURS,
    });
  } catch (err) {
    console.error("[vip-signup] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
