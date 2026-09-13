import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";

/** GET /api/admin/members?business=gigis_long_branch&q=&consent=sms|email */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const business = req.query.business;
  if (!isVipBusiness(business)) {
    res.status(400).json({ error: "invalid_business" });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const consent = req.query.consent;
  // Phones are stored E.164 (+17325551234); searching "(732) 555-1234" must still hit.

  try {
    const rows = await sql`
      SELECT m.id,m.name,m.phone,m.email,m.sms_requested,m.sms_consent,m.email_consent,m.source,m.created_at,
        a.id AS account_id,
        (SELECT COUNT(*)::int FROM web_orders w WHERE w.account_id=a.id AND w.business=m.business AND w.status IN ('paid','charged','paid_unrouted','refire_pending','paid_print_queued','paid_print_failed')) AS lifetime_orders,
        (SELECT MAX(w.created_at) FROM web_orders w WHERE w.account_id=a.id AND w.business=m.business AND w.status IN ('paid','charged','paid_unrouted','refire_pending','paid_print_queued','paid_print_failed')) AS last_order,
        (SELECT string_agg(f.item_name, ', ') FROM (SELECT l.item_name FROM order_lines l WHERE l.account_id=a.id GROUP BY l.item_name ORDER BY COUNT(DISTINCT l.order_id) DESC LIMIT 3) f) AS favorites
      FROM vip_members m LEFT JOIN accounts a ON a.member_id=m.id AND a.business=m.business AND a.deleted_at IS NULL
      WHERE m.business = ${business}
        AND (${q} = '' OR m.name ILIKE ${"%"+q+"%"} OR m.email ILIKE ${"%"+q+"%"}
          OR (${q.replace(/\D/g, "")} <> '' AND regexp_replace(COALESCE(m.phone,''),'[^0-9]','','g') LIKE ${"%"+q.replace(/\D/g, "")+"%"}))
        AND (${consent === "sms"} = FALSE OR m.sms_consent)
        AND (${consent === "email"} = FALSE OR m.email_consent)
      ORDER BY m.created_at DESC
      LIMIT 1000
    `;
    res.status(200).json({ members: rows.rows });
  } catch (err) {
    console.error("[admin/members] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
