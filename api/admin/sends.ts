import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";

/** GET /api/admin/sends?business= — recent broadcasts with delivery tallies. */
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
    const broadcasts = await sql`
      SELECT b.id, b.subject, b.message, b.channels, b.sms_total, b.email_total, b.created_at,
             p.code AS promo_code,
             COUNT(s.id) FILTER (WHERE s.status = 'sent')::int   AS sent,
             COUNT(s.id) FILTER (WHERE s.status = 'failed')::int AS failed
      FROM broadcasts b
      LEFT JOIN vip_promo_codes p ON p.id = b.promo_code_id
      LEFT JOIN vip_sends s ON s.broadcast_id = b.id
      WHERE b.business = ${business}
      GROUP BY b.id, p.code
      ORDER BY b.created_at DESC
      LIMIT 50
    `;
    res.status(200).json({ broadcasts: broadcasts.rows });
  } catch (err) {
    console.error("[admin/sends] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
