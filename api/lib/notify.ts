import { claimWindow, releaseWindow } from "./rateLimit.js";
/**
 * VIP Club send pipeline — SMS via Twilio REST, email via Resend REST.
 *
 * Both channels are env-gated: missing config = logged no-op rather than a
 * thrown error, so signups still persist before the channels are armed.
 *
 * Twilio auth accepts either the account auth token (TWILIO_AUTH_TOKEN) or a
 * scoped API key pair (TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET) — whichever
 * Jorge drops into the Vercel env works without a code change.
 */

import { emailHtml } from "./emailTemplate.js";
import { unsubscribeUrl } from "./unsub.js";

export type SendResult = { sent: boolean; providerId?: string; error?: string };

function twilioAuth(): { user: string; pass: string; accountSid: string } | null {
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
  } = process.env;
  if (!TWILIO_ACCOUNT_SID) return null;
  if (TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET) {
    return { user: TWILIO_API_KEY_SID, pass: TWILIO_API_KEY_SECRET, accountSid: TWILIO_ACCOUNT_SID };
  }
  if (TWILIO_AUTH_TOKEN) {
    return { user: TWILIO_ACCOUNT_SID, pass: TWILIO_AUTH_TOKEN, accountSid: TWILIO_ACCOUNT_SID };
  }
  return null;
}

export function smsConfigured(): boolean {
  return twilioAuth() !== null && !!process.env.TWILIO_FROM_NUMBER;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/** Every promotional SMS must carry an opt-out notice. Appends one when missing.
 * Matches an actual opt-out instruction ("reply/text/txt STOP"), not the bare
 * word "stop" — "Stop by for a slice!" must still get the notice. */
export function withStopNotice(message: string): string {
  return /\b(?:reply|text|txt)\s+stop\b/i.test(message) ? message : `${message} Txt STOP to opt out.`;
}

export async function sendSms(toE164: string, message: string): Promise<SendResult> {
  const auth = twilioAuth();
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!auth || !from) {
    console.log(`[vip-club] SMS not sent (Twilio not configured) — recipient •••${toE164.slice(-4)}`);
    return { sent: false, error: "twilio_not_configured" };
  }

  const basic = Buffer.from(`${auth.user}:${auth.pass}`).toString("base64");
  // Prefer the registered Messaging Service so service-level A2P features
  // (advanced opt-out, sticky sender) govern every send; From is the fallback.
  const mss = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const params: Record<string, string> = mss
    ? { To: toE164, MessagingServiceSid: mss, Body: message }
    : { To: toE164, From: from, Body: message };
  // Same contract as sendEmail: NEVER throws. A DNS failure or socket reset here used to
  // propagate — killing a broadcast pool mid-blast and failing VIP signups whose member row
  // was already committed. Transport loss becomes {sent:false} like any other failure.
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      return { sent: false, error: errorText.slice(0, 500) };
    }
    const data = (await res.json()) as { sid: string };
    return { sent: true, providerId: data.sid };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

export async function sendEmail(
  toEmail: string,
  subject: string,
  bodyText: string,
  opts?: { promoCode?: string; promoDescription?: string; promoHowTo?: string; ctaText?: string; ctaUrl?: string },
): Promise<SendResult> {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.log(`[vip-club] Email not sent (Resend not configured) — recipient ${toEmail.replace(/(.).*(@.*)/, "$1•••$2")}`);
    return { sent: false, error: "email_not_configured" };
  }

  let unsubUrl: string;
  try {
    unsubUrl = unsubscribeUrl(toEmail);
  } catch (e) {
    // A missing UNSUB_SECRET must fail THIS send gracefully, not throw through the
    // signup handler (which already inserted the member + sent the welcome SMS).
    console.error("[vip-club] cannot build unsubscribe URL — email skipped", e);
    return { sent: false, error: "unsub_not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [toEmail],
        subject,
        html: emailHtml({ bodyText, unsubUrl, promoCode: opts?.promoCode, promoDescription: opts?.promoDescription, promoHowTo: opts?.promoHowTo, ctaText: opts?.ctaText, ctaUrl: opts?.ctaUrl }),
        text: `${bodyText}\n\nUnsubscribe: ${unsubUrl}`,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { sent: false, error: errorText.slice(0, 500) };
    }
    const data = (await res.json()) as { id: string };
    return { sent: true, providerId: data.id };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

/**
 * Transactional order-confirmation email (receipt). No unsubscribe link —
 * CAN-SPAM exempts transactional mail — so this works even if UNSUB_SECRET is
 * unset. Env-gated like everything else; never throws.
 */
export async function sendReceiptEmail(toEmail: string, subject: string, html: string, text?: string, fromOverride?: string): Promise<SendResult> {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    return { sent: false, error: "email_not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      // A text/plain part alongside the HTML: spam filters score HTML-only mail worse, and a
      // verification code the customer can't read is a dead signup. Callers that don't pass one
      // still send HTML-only (unchanged for receipts).
      body: JSON.stringify({ from: fromOverride || EMAIL_FROM, to: [toEmail], subject, html, ...(text ? { text } : {}) }),
    });
    if (!res.ok) return { sent: false, error: (await res.text()).slice(0, 500) };
    const data = (await res.json()) as { id: string };
    return { sent: true, providerId: data.id };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

/**
 * Fire-and-forget internal alert to store staff. Used when a paid order fails to
 * reach the POS so a human can recover it before the customer shows up.
 *
 * Sends on EVERY configured channel — SMS (STAFF_ALERT_PHONE) and email
 * (STAFF_ALERT_EMAIL, comma-separated). It was SMS-only, and with STAFF_ALERT_PHONE
 * unset in production every "paid but not fired" alert went to the Vercel log and
 * nowhere else — the alerts that exist precisely so a human catches a charged order
 * the kitchen never saw. Never throws.
 */
export async function alertStaff(message: string): Promise<boolean> {
  const phone = process.env.STAFF_ALERT_PHONE;
  if (phone) {
    const sent = await sendSms(phone, message.slice(0, 320));
    if (sent.sent) return true;
    console.error("[alertStaff] SMS failed", sent.error);
  }
  let delivered = false;
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const email of (process.env.STAFF_ALERT_EMAIL || "").split(",").map(s => s.trim()).filter(Boolean)) {
    const result = await sendReceiptEmail(email, "Gigi's website needs attention", `<p>${safe}</p>`, message);
    delivered = result.sent || delivered;
  }
  if (!delivered) console.error("[alertStaff] no channel delivered", message);
  return delivered;
}

/** One staff page per problem per this window. 30 minutes: long enough that a customer
 *  re-tapping a stranded order doesn't page per tap, short enough that a page lost in a
 *  busy kitchen gets a reminder while the customer is still waiting. */
export const STAFF_PAGE_COOLDOWN_SEC = 30 * 60;

/** What became of a cooldown-guarded page. Callers that need to know whether the
 *  problem was actually reported (the print sweep) branch on this; fire-and-forget
 *  callers just ignore it. */
export type StaffPageOutcome = "sent" | "suppressed" | "failed";

/**
 * Staff page with a cooldown: at most one SMS per `key` per `cooldownSec`.
 *
 * On 2026-08-17 Kenny got two texts about the same $31.05 order, and the replay
 * ladder in order/create pages on EVERY retry of a stranded key — our own abort
 * copy tells the customer to tap again, so one incident could page him once per
 * tap. Alerts about the same underlying problem share a key (`order:<idem key>`,
 * `print:<clover order id>`); repeats inside the window are logged, never sent.
 *
 * The claim is an atomic presence row (claimWindow), NOT a counter: suppressed
 * attempts leave no trace, so a failed send releases the claim and the very next
 * occurrence retries — a counter here let one interleaved retry during a Twilio
 * brownout silence the key for the whole window with nothing ever sent. Claims
 * fail OPEN on a DB error (duplicate page over lost page, always). Windows are
 * epoch-aligned, so two pages straddling a boundary can land close together;
 * the worst case is 2 texts, never N.
 */
export async function alertStaffOnce(
  key: string,
  message: string,
  cooldownSec: number = STAFF_PAGE_COOLDOWN_SEC,
): Promise<StaffPageOutcome> {
  if (!(await claimWindow(`staff-page:${key}`, cooldownSec))) {
    console.log(`[alertStaff] page suppressed (cooldown ${key}) —`, message);
    return "suppressed";
  }
  if (await alertStaff(message)) return "sent";
  // The SMS never went out (Twilio error, or SMS not armed yet) — hand the claim
  // back so the next occurrence retries instead of the ONLY page being silenced
  // for the whole window. The console.error inside alertStaff still fired.
  await releaseWindow(`staff-page:${key}`, cooldownSec);
  return "failed";
}

// Back-compat names used by vip-signup.ts
export const sendWelcomeSms = sendSms;
export const sendWelcomeEmail = sendEmail;

/** Transactional sends (receipts, verification codes) share one implementation —
 *  no unsubscribe machinery, works even if UNSUB_SECRET is unset. */
export const sendTransactionalEmail = sendReceiptEmail;
