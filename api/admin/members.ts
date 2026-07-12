import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";

/** GET /api/admin/members?business=gigis_long_branch&q=&consent=sms|email */
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
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const consent = req.query.consent;

  try {
    const rows = await sql`
      SELECT id, name, phone, email, sms_consent, email_consent, source, created_at
      FROM vip_members
      WHERE business = ${business}
        AND (${q} = '' OR name ILIKE ${"%" + q + "%"} OR phone ILIKE ${"%" + q + "%"} OR email ILIKE ${"%" + q + "%"})
        AND (${consent === "sms"} = FALSE OR sms_consent)
        AND (${consent === "email"} = FALSE OR email_consent)
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    res.status(200).json({ members: rows.rows });
  } catch (err) {
    console.error("[admin/members] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
