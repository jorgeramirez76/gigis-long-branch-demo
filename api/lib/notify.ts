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
}

export async function sendEmail(
  toEmail: string,
  subject: string,
  bodyText: string,
  opts?: { promoCode?: string; promoDescription?: string },
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
        html: emailHtml({ bodyText, unsubUrl, promoCode: opts?.promoCode, promoDescription: opts?.promoDescription }),
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
export async function sendReceiptEmail(toEmail: string, subject: string, html: string): Promise<SendResult> {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    return { sent: false, error: "email_not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [toEmail], subject, html }),
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
 * reach the POS so a human can recover it before the customer shows up. Env-gated
 * on STAFF_ALERT_PHONE — a no-op (loud log only) until that's set. Never throws.
 */
export async function alertStaff(message: string): Promise<void> {
  const phone = process.env.STAFF_ALERT_PHONE;
  try {
    if (phone) {
      const result = await sendSms(phone, message.slice(0, 320));
      if (!result.sent) console.error("[alertStaff] SMS failed:", result.error, "—", message);
    } else console.error("[alertStaff] (set STAFF_ALERT_PHONE to receive these) —", message);
  } catch (e) {
    console.error("[alertStaff] failed", e, "—", message);
  }
}

// Back-compat names used by vip-signup.ts
export const sendWelcomeSms = sendSms;
export const sendWelcomeEmail = sendEmail;
