import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";

/**
 * Counter tool for the free-pie welcome codes.
 *
 *   GET  /api/admin/promo?business=…&code=PIE-XXXXXX  → look the code up
 *   POST /api/admin/promo  { business, code }         → mark it redeemed
 *
 * The redeem is a CONDITIONAL update (`WHERE redeemed_at IS NULL`), so two
 * simultaneous redeems can't both succeed — the second gets already_redeemed.
 */

/** Codes are printed/spoken — accept any case and tolerate a missing "PIE-". */
function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  const withPrefix = /^PIE-/.test(c) ? c : `PIE-${c.replace(/^PIE/, "")}`;
  return /^PIE-[A-Z0-9]{4,10}$/.test(withPrefix) ? withPrefix : null;
}

type Row = {
  id: number;
  code: string;
  description: string;
  member_id: number | null;
  redeemed_at: string | null;
  expires_at: string | null;
  member_name: string | null;
  member_phone: string | null;
  member_email: string | null;
};

async function lookup(business: string, code: string): Promise<Row | null> {
  const r = await sql`
    SELECT p.id, p.code, p.description, p.member_id, p.redeemed_at, p.expires_at,
           m.name AS member_name, m.phone AS member_phone, m.email AS member_email
    FROM vip_promo_codes p
    LEFT JOIN vip_members m ON m.id = p.member_id
    WHERE p.business = ${business} AND p.code = ${code}
  `;
  return (r.rows[0] as Row | undefined) ?? null;
}

function describe(row: Row) {
  const expired = !!row.expires_at && new Date(row.expires_at).getTime() < Date.now();
  const redeemed = !!row.redeemed_at;
  return {
    code: row.code,
    description: row.description,
    member: row.member_name
      ? { name: row.member_name, phone: row.member_phone, email: row.member_email }
      : null,
    redeemed,
    redeemedAt: row.redeemed_at,
    expired,
    expiresAt: row.expires_at,
    /** The only field the counter really needs. */
    valid: !redeemed && !expired,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;

  const business = req.method === "GET" ? req.query.business : (req.body ?? {})?.business;
  if (!isVipBusiness(business)) {
    res.status(400).json({ error: "invalid_business" });
    return;
  }

  const code = normalizeCode(req.method === "GET" ? req.query.code : (req.body ?? {})?.code);
  if (!code) {
    res.status(400).json({ error: "invalid_code", message: "Enter a code like PIE-ABC123." });
    return;
  }

  try {
    if (req.method === "GET") {
      const row = await lookup(business, code);
      if (!row) {
        res.status(404).json({ error: "not_found", message: `No such code: ${code}` });
        return;
      }
      res.status(200).json({ ok: true, ...describe(row) });
      return;
    }

    if (req.method === "POST") {
      const row = await lookup(business, code);
      if (!row) {
        res.status(404).json({ error: "not_found", message: `No such code: ${code}` });
        return;
      }
      const info = describe(row);
      if (info.redeemed) {
        res.status(409).json({ error: "already_redeemed", message: `Already redeemed ${new Date(row.redeemed_at!).toLocaleString("en-US")}.`, ...info });
        return;
      }
      if (info.expired) {
        res.status(409).json({ error: "expired", message: "This code has expired.", ...info });
        return;
      }
      // Conditional: only the first redeem wins.
      const upd = await sql`
        UPDATE vip_promo_codes SET redeemed_at = now()
        WHERE id = ${row.id} AND redeemed_at IS NULL
        RETURNING redeemed_at
      `;
      if (upd.rowCount === 0) {
        res.status(409).json({ error: "already_redeemed", message: "Someone just redeemed this code.", ...info, redeemed: true });
        return;
      }
      res.status(200).json({ ok: true, ...info, redeemed: true, redeemedAt: upd.rows[0].redeemed_at, justRedeemed: true });
      return;
    }

    res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("[admin/promo] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
