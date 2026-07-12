import { sql, type VipBusiness } from "./db.js";

const WELCOME_CODES: Record<VipBusiness, { code: string; description: string }> = {
  gigis_long_branch: { code: "GIGIVIP10", description: "10% off welcome offer — Gigi's NY Style Pizza, Long Branch" },
};

/** Ensures the shared welcome promo code exists for a business, returns it.
 * A single shared code per business (not per-member) — simplest thing that
 * works for redemption at Clover checkout; can move to per-member codes
 * later without a schema change (vip_promo_codes.member_id already supports it). */
export async function ensureWelcomeCode(business: VipBusiness) {
  const { code, description } = WELCOME_CODES[business];
  await sql`
    INSERT INTO vip_promo_codes (business, code, description)
    VALUES (${business}, ${code}, ${description})
    ON CONFLICT (code) DO NOTHING
  `;
  const existing = await sql`SELECT id FROM vip_promo_codes WHERE code = ${code}`;
  return { id: existing.rows[0].id as number, code, description };
}
