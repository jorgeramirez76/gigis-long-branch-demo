import { sql, type VipBusiness } from "./db.js";
import { sendReceiptEmail, sendSms } from "./notify.js";
import { staffNewMemberHtml } from "./emailTemplate.js";
import type { ValidatedSignup } from "./vipSignupShared.js";

/**
 * Tell the shop when a VIP signup is verified and a member goes live.
 *
 * The channel is a TEXT to the store — VIP_SIGNUP_ALERT_PHONE, Tommy's cell, set in the Vercel
 * env on 2026-09-09 per Jorge. The free-pie code is redeemed at the register, so the person who
 * needs to hear about a new member is the one standing at it, not an inbox. (STAFF_ALERT_PHONE
 * is honoured as a stand-in if the dedicated number is ever unset; it stays the lost-order line.)
 *
 * The email to STAFF_ALERT_EMAIL that used to be the primary channel is now the FALLBACK only:
 * it goes out when no alert phone is configured or the text could not be sent, flagged as such,
 * so a signup is never silently unreported. Entirely best-effort — a notification problem must
 * never fail a signup that has already created the member and issued their pie.
 */
export async function notifyStaffNewMember(
  business: VipBusiness,
  p: ValidatedSignup,
  code: string,
): Promise<void> {
  try {
    const channels = [p.smsConsent ? "texts" : null, p.emailConsent ? "email" : null]
      .filter(Boolean)
      .join(" + ") || "neither";

    // Club size is a nice-to-have; never let a count failure stop the notification.
    let total: number | undefined;
    try {
      const r = await sql`SELECT count(*)::int AS n FROM vip_members WHERE business = ${business}`;
      total = r.rows[0]?.n as number | undefined;
    } catch {
      total = undefined;
    }

    const alertPhone = process.env.VIP_SIGNUP_ALERT_PHONE || process.env.STAFF_ALERT_PHONE;
    if (alertPhone) {
      // Everything the register needs in one message: who, how to reach them, the code to
      // redeem. Plain ASCII on purpose — one curly quote or dash flips Twilio to 70-character
      // segments. Internal to staff, so no opt-out notice (this is not a promotional send).
      const body =
        `Gigi's VIP: new member ${p.name}, ${displayPhone(p.phone)}, ${p.email}. ` +
        `Free-pie code ${code}. Wants ${channels}.${total ? ` Club now ${total}.` : ""}`;
      try {
        const r = await sendSms(alertPhone, body);
        if (r.sent) return;
        console.error(`[vip] new-member text to •••${alertPhone.slice(-4)} failed:`, r.error);
      } catch (e) {
        console.error("[vip] new-member text threw:", e);
      }
    }

    // ---- fallback: email STAFF_ALERT_EMAIL, flagged so it is clear the text did not go out ----
    const to = (process.env.STAFF_ALERT_EMAIL || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (to.length === 0) {
      // Masked: with nothing configured this log line is the only record, but logs are not the
      // place for a customer's full name and address.
      const maskedEmail = p.email.replace(/^(.).*(@.*)$/, "$1•••$2");
      console.log(`[vip] new verified member ${maskedEmail} code ${code} — set VIP_SIGNUP_ALERT_PHONE (text) or STAFF_ALERT_EMAIL (email) to get these`);
      return;
    }
    const why = alertPhone
      ? `the text to •••${alertPhone.slice(-4)} could not be sent`
      : "no VIP_SIGNUP_ALERT_PHONE is configured, so nobody was texted";
    const html = staffNewMemberHtml({
      name: p.name,
      phone: p.phone,
      email: p.email,
      address: p.fullAddress,
      code,
      channels,
      source: p.source,
      totalMembers: total,
    });
    const text = `New VIP member verified — sent by email because ${why}.\n\nName: ${p.name}\nPhone: ${p.phone}\nEmail: ${p.email}\nAddress: ${p.fullAddress}\nFree-pie code: ${code}\nOpted into: ${channels}\nSigned up via: ${p.source}${total ? `\nClub size now: ${total} members` : ""}\n\nThey confirmed their email by tapping the verification link.`;
    for (const addr of to) {
      const r = await sendReceiptEmail(addr, `✅ New VIP member verified — ${p.name} (text not sent)`, html, text);
      if (!r.sent && r.error !== "email_not_configured") {
        console.error(`[vip] fallback email to ${addr} failed:`, r.error);
      }
    }
  } catch (err) {
    console.error("[vip] staff notification failed (non-fatal)", err);
  }
}

/** "+17325551234" → "(732) 555-1234" for a human reading a text; anything else passes through. */
function displayPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
