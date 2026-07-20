import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";
import { smsConfigured, emailConfigured } from "../lib/notify.js";

/** GET /api/admin/stats?business=gigis_long_branch — dashboard headline numbers.
 * Also serves as the login check for the admin UI. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const business = req.query.business;
  if (!isVipBusiness(business)) {
    res.status(400).json({ error: "invalid_business" });
    return;
  }

  try {
    const members = await sql`
      SELECT
        COUNT(*)::int                                   AS total,
        COUNT(*) FILTER (WHERE sms_consent)::int        AS sms_ok,
        COUNT(*) FILTER (WHERE email_consent)::int      AS email_ok,
        COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d
      FROM vip_members WHERE business = ${business}
    `;
    const sends = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent')::int    AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int  AS failed
      FROM vip_sends WHERE business = ${business}
    `;
    const broadcasts = await sql`
      SELECT COUNT(*)::int AS total FROM broadcasts WHERE business = ${business}
    `;
    res.status(200).json({
      members: members.rows[0],
      sends: sends.rows[0],
      broadcasts: broadcasts.rows[0],
      channels: { sms: smsConfigured(), email: emailConfigured() },
      // Env sanity for ops (admin-gated): the base URL baked into email unsub links,
      // and whether staff lost-order alerts are armed.
      config: {
        publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
        staffAlertPhone: !!process.env.STAFF_ALERT_PHONE,
      },
    });
  } catch (err) {
    console.error("[admin/stats] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
