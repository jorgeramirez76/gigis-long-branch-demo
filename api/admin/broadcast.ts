import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isVipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";
import { runBroadcast } from "../lib/broadcastRun.js";
import { normalizeBroadcastPromoCode } from "../lib/broadcastPromo.js";

export const config = { maxDuration: 300 };

/**
 * POST /api/admin/broadcast
 * body: { business, message, subject?, channels: { sms, email },
 *         promoCode?, promoDescription?, expiresAt?, dryRun? }
 *
 * dryRun returns audience counts + rendered SMS without sending anything.
 * A real run creates the broadcasts row (+ optional promo code), sends to every
 * consenting member on the selected channels, and logs each send in vip_sends.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { business, message, subject, channels, promoCode, promoDescription, expiresAt, dryRun, requestId } =
    req.body ?? {};

  if (!isVipBusiness(business)) return void res.status(400).json({ error: "invalid_business" });
  if (typeof message !== "string" || message.trim().length < 1)
    return void res.status(400).json({ error: "message_required" });
  const wantSms = channels?.sms === true;
  const wantEmail = channels?.email === true;
  if (!wantSms && !wantEmail) return void res.status(400).json({ error: "channel_required" });
  if (wantEmail && (typeof subject !== "string" || subject.trim().length < 1))
    return void res.status(400).json({ error: "subject_required_for_email" });
  if (wantSms && message.length > 1200)
    return void res.status(400).json({ error: "sms_too_long" });

  if (!dryRun && (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)))
    return void res.status(400).json({ error: "request_id_required" });

  const codeRequested = typeof promoCode === "string" && promoCode.trim().length > 0;
  const code = codeRequested ? normalizeBroadcastPromoCode(promoCode) : null;
  if (codeRequested && !code) {
    return void res.status(400).json({
      error: "invalid_promo_code",
      message: "Use 4–20 letters, numbers, or hyphens. PIE codes are reserved for welcome offers.",
    });
  }
  const codeDesc = typeof promoDescription === "string" ? promoDescription.trim() : "";
  if (code && !codeDesc) return void res.status(400).json({ error: "promo_description_required" });
  const expiry = expiresAt == null || expiresAt === "" ? null : typeof expiresAt === "string" ? new Date(expiresAt) : null;
  if (expiresAt != null && expiresAt !== "" && (!expiry || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) {
    return void res.status(400).json({ error: "invalid_expiration" });
  }
  try {
    const out = await runBroadcast({
      business, message, subject, wantSms, wantEmail, code, codeDesc, expiry, dryRun: dryRun === true, requestId,
    });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("[admin/broadcast] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
