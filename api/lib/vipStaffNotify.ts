import { sql, type VipBusiness } from "./db.js";
import { sendReceiptEmail, alertStaff } from "./notify.js";
import { staffNewMemberHtml } from "./emailTemplate.js";
import type { ValidatedSignup } from "./vipSignupShared.js";

/**
 * Tell the owner when a VIP signup is verified and a member goes live.
 *
 * Email is the primary channel because Resend is armed for this business; SMS rides along only if
 * STAFF_ALERT_PHONE is configured (alertStaff is a no-op-with-loud-log otherwise). Recipients come
 * from STAFF_ALERT_EMAIL (comma-separated, so the owner can be added alongside Jorge without a code
 * change). Entirely best-effort: a notification problem must never fail a signup that has already
 * created the member and issued their pie.
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

    // Club size is a nice-to-have in the email; never let a count failure stop the notification.
    let total: number | undefined;
    try {
      const r = await sql`SELECT count(*)::int AS n FROM vip_members WHERE business = ${business}`;
      total = r.rows[0]?.n as number | undefined;
    } catch {
      total = undefined;
    }

    const to = (process.env.STAFF_ALERT_EMAIL || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (to.length === 0) {
      // Masked: with no recipient configured this is the only record, but logs are not the place
      // for a customer's full name and address.
      const maskedEmail = p.email.replace(/^(.).*(@.*)$/, "$1•••$2");
      console.log(`[vip] new verified member ${maskedEmail} code ${code} — set STAFF_ALERT_EMAIL to get these by email`);
    } else {
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
      const text = `New VIP member verified\n\nName: ${p.name}\nPhone: ${p.phone}\nEmail: ${p.email}\nAddress: ${p.fullAddress}\nFree-pie code: ${code}\nOpted into: ${channels}\nSigned up via: ${p.source}${total ? `\nClub size now: ${total} members` : ""}\n\nThey confirmed their email by tapping the verification link.`;
      for (const addr of to) {
        const r = await sendReceiptEmail(addr, `✅ New VIP member verified — ${p.name}`, html, text);
        if (!r.sent && r.error !== "email_not_configured") {
          console.error(`[vip] staff notification to ${addr} failed:`, r.error);
        }
      }
    }

    // Optional SMS heads-up; no-op unless STAFF_ALERT_PHONE is set.
    if (process.env.STAFF_ALERT_PHONE) {
      await alertStaff(`NEW VIP MEMBER (email verified) — ${p.name} ${p.phone} — code ${code}${total ? ` — club now ${total}` : ""}`);
    }
  } catch (err) {
    console.error("[vip] staff notification failed (non-fatal)", err);
  }
}
