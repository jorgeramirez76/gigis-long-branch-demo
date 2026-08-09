import { randomInt } from "node:crypto";
import { sql, type VipBusiness } from "./db.js";
import type { CartLineInput } from "./clover.js";

// Interpolated into the A2P-registered welcome SMS ("Code X gets you …") — keep
// any rewording in the same shape as the campaign's OptInMessage sample.
const PIE_DESCRIPTION: Record<VipBusiness, string> = {
  gigis_long_branch: "a FREE plain cheese pie (new members only, pickup orders only)",
};

// No ambiguous 0/O/1/I so the code is easy to read off a phone at the counter.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Issue the welcome free-pie promo to a brand-new member. A UNIQUE per-member
 * code (not one shared code) so it can't be screenshot-shared for unlimited
 * free pies, and so redemption can be tracked per member later. Called ONLY
 * after a successful insert, so it can never be handed to an existing member.
 */
export async function issueWelcomePie(business: VipBusiness, memberId: number) {
  const description = PIE_DESCRIPTION[business];
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `PIE-${randomCode(6)}`;
    try {
      const r = await sql`
        INSERT INTO vip_promo_codes (business, code, description, member_id, expires_at)
        VALUES (${business}, ${code}, ${description}, ${memberId}, now() + interval '90 days')
        RETURNING id
      `;
      return { id: r.rows[0].id as number, code, description };
    } catch (err) {
      // Astronomically rare code collision (UNIQUE(code)) — retry with a new one.
      if (attempt === 5) throw err;
    }
  }
  throw new Error("could not generate a unique promo code");
}

// ---------------------------------------------------------------------------
// Customer-facing redemption (the promo field in checkout)
// ---------------------------------------------------------------------------

/** The welcome offer is a free PLAIN CHEESE PIE — not a dollar amount off anything.
 *  The cart must actually contain this item, and the discount is exactly its catalog
 *  base price, so a topped pie still only comes off at the plain price. */
export const FREE_PIE_ITEM = "Plain Pie";

/**
 * Apply the free pie to a priced cart by ZERO-PRICING one Plain Pie unit, rather than posting a
 * Clover order-level discount: Clover rejects negative line prices and recomputes tax on order
 * discounts unpredictably, while a $0.00 line keeps Clover's own computed total, the tax, the POS
 * screen and the printed ticket all in agreement with our totals — so the single-order flow's
 * amount-verification gate keeps working unchanged.
 *
 * Prefers an untopped Plain Pie (the whole line goes free); otherwise any Plain Pie, whose
 * toppings stay charged (basePrice → 0, option deltas remain). Returns null if the cart holds no
 * Plain Pie — it's a free PIE, not a dollar amount off anything.
 */
export function applyFreePie(
  lines: CartLineInput[],
  code: string,
): { lines: CartLineInput[]; discountCents: number } | null {
  let idx = lines.findIndex((l) => l.itemName === FREE_PIE_ITEM && l.options.length === 0);
  if (idx < 0) idx = lines.findIndex((l) => l.itemName === FREE_PIE_ITEM);
  if (idx < 0) return null;
  const target = lines[idx];
  const free: CartLineInput = {
    ...target,
    basePrice: 0,
    quantity: 1,
    // Front-loaded so the kitchen chit reads "FREE" before anything else on the line.
    notes: [`FREE — VIP welcome pie ${code}`, target.notes].filter(Boolean).join(" · "),
  };
  const out = lines.slice();
  if (target.quantity === 1) {
    out[idx] = free;
  } else {
    out[idx] = { ...target, quantity: target.quantity - 1 };
    out.splice(idx, 0, free);
  }
  return { lines: out, discountCents: target.basePrice };
}

export type PromoCheck =
  | { ok: true; id: number; code: string; description: string }
  | { ok: false; reason: "not_found" | "already_redeemed" | "expired"; message: string };

/** Codes are read off a phone screen — accept any case, tolerate a missing "PIE-". */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  const withPrefix = /^PIE-/.test(c) ? c : `PIE-${c.replace(/^PIE/, "")}`;
  return /^PIE-[A-Z0-9]{4,10}$/.test(withPrefix) ? withPrefix : null;
}

/** Read-only validity check. Never mutates — redemption happens only after the order succeeds. */
export async function checkPromoCode(business: VipBusiness, code: string): Promise<PromoCheck> {
  const r = await sql`
    SELECT id, code, description, redeemed_at, expires_at
    FROM vip_promo_codes WHERE business = ${business} AND code = ${code}
  `;
  const row = r.rows[0] as
    | { id: number; code: string; description: string; redeemed_at: string | null; expires_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "not_found", message: "We don't recognise that code." };
  if (row.redeemed_at) {
    return { ok: false, reason: "already_redeemed", message: "That code has already been used." };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired", message: "That code has expired." };
  }
  return { ok: true, id: row.id, code: row.code, description: row.description };
}

/**
 * Mark a code redeemed. CONDITIONAL on it still being unredeemed, so two orders racing the same
 * code cannot both win — the loser gets false and its order simply charges full price rather than
 * failing (the food is already made by then).
 *
 * Called ONLY after the order has succeeded. Redeeming earlier would burn the customer's code on
 * an order that then failed payment.
 */
export async function redeemPromoCode(id: number): Promise<boolean> {
  const r = await sql`
    UPDATE vip_promo_codes SET redeemed_at = now()
    WHERE id = ${id} AND redeemed_at IS NULL
    RETURNING id
  `;
  return r.rowCount === 1;
}
