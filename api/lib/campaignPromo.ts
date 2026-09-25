import { sql, type VipBusiness } from "./db.js";
import type { CartLineInput } from "./clover.js";
import { planBogoPizza, type BogoLine } from "../../src/lib/bogoPromo.js";
import { planPizzaPercent } from "../../src/lib/pizzaPercent.js";
import { checkPromoCode, normalizePromoCode } from "./promo.js";

/**
 * Campaign promo codes — the staff-run offers a blast advertises (GAMEDAY), as opposed to
 * the per-member PIE-XXXXXX welcome pie in api/lib/promo.ts.
 *
 * The two are deliberately different animals and share no storage:
 *
 *   welcome pie   one row per member, single use, reserved then burned (redeemed_at)
 *   campaign      one row for the whole offer, used by EVERY customer, never burned;
 *                 each use is appended to campaign_redemptions instead
 *
 * That difference is the whole point. A campaign code lives in vip_promo_codes in no form:
 * that table has one redeemed_at per row, so putting a shared code there would let the first
 * customer through and lock out everyone else — which is exactly what happened when a
 * broadcast code was first advertised (checkPromoCode also requires member_id IS NOT NULL,
 * so it never resolved at all).
 *
 * A campaign has a validity window and is pickup-only; the order endpoint enforces both.
 */

/** bogo_pizza: buy one pizza, get the cheaper one free (GAMEDAY).
 *  pct_pizza:  a percentage off every pizza, toppings included (STORM25 = 25). */
export type CampaignKind = "bogo_pizza" | "pct_pizza";

export type CampaignRow = {
  id: number;
  code: string;
  kind: CampaignKind;
  description: string;
  pickupOnly: boolean;
  /** Whole percent for pct_pizza; 0 otherwise. */
  percentOff: number;
};

export type CampaignCheck =
  | ({ ok: true } & CampaignRow)
  | { ok: false; reason: "not_found" | "not_started" | "expired" | "inactive"; message: string };

let tablesEnsured = false;
/** Lazy DDL, matching orderStore/broadcast: a fresh database must not 500 for want of a table. */
export async function ensureCampaignTables() {
  if (tablesEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS campaign_promos (
    id          BIGSERIAL PRIMARY KEY,
    business    TEXT NOT NULL,
    code        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    description TEXT NOT NULL,
    pickup_only BOOLEAN NOT NULL DEFAULT TRUE,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at   TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS campaign_promos_business_code_uq
    ON campaign_promos (business, code)`;
  // pct_pizza campaigns (2026-09-25) carry their percentage on the row.
  await sql`ALTER TABLE campaign_promos ADD COLUMN IF NOT EXISTS percent_off INT NOT NULL DEFAULT 0`;
  // One row per use. The UNIQUE below is what makes redemption idempotent: the order
  // endpoint can call record twice for the same attempt (retry, replay) and the offer is
  // still counted once, without any burn semantics that could lock the next customer out.
  await sql`CREATE TABLE IF NOT EXISTS campaign_redemptions (
    id              BIGSERIAL PRIMARY KEY,
    campaign_id     BIGINT NOT NULL REFERENCES campaign_promos(id),
    idempotency_key TEXT NOT NULL,
    order_ref       TEXT,
    customer_phone  TEXT,
    discount_cents  INT NOT NULL DEFAULT 0,
    free_count      INT NOT NULL DEFAULT 0,
    redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS campaign_redemptions_key_uq
    ON campaign_redemptions (campaign_id, idempotency_key)`;
  tablesEnsured = true;
}

/** Campaign codes are staff-chosen words, not generated ones: 4–20 of A–Z, 0–9 and hyphen.
 *  "PIE" is reserved for the welcome benefit so the two namespaces can never collide. */
export function normalizeCampaignCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code)) return null;
  if (code.startsWith("PIE")) return null;
  return code;
}

export async function checkCampaignCode(business: VipBusiness, code: string): Promise<CampaignCheck> {
  await ensureCampaignTables();
  const r = await sql`
    SELECT id, code, kind, description, pickup_only, active, starts_at, expires_at, percent_off
    FROM campaign_promos
    WHERE business = ${business} AND code = ${code}
  `;
  const row = r.rows[0] as
    | {
        id: number; code: string; kind: string; description: string;
        pickup_only: boolean; active: boolean; starts_at: string | null; expires_at: string | null;
        percent_off: number | null;
      }
    | undefined;
  if (!row) return { ok: false, reason: "not_found", message: "We don't recognise that code." };
  if (!row.active) return { ok: false, reason: "inactive", message: "That offer has ended." };
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) {
    return { ok: false, reason: "not_started", message: "That offer hasn't started yet." };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
    return { ok: false, reason: "expired", message: "That offer has ended." };
  }
  if (row.kind !== "bogo_pizza" && row.kind !== "pct_pizza") {
    return { ok: false, reason: "inactive", message: "That offer has ended." };
  }
  const percentOff = row.kind === "pct_pizza" ? Math.min(100, Math.max(0, Math.round(Number(row.percent_off) || 0))) : 0;
  if (row.kind === "pct_pizza" && percentOff < 1) {
    return { ok: false, reason: "inactive", message: "That offer has ended." };
  }
  return {
    ok: true,
    id: Number(row.id),
    code: row.code,
    kind: row.kind,
    description: row.description,
    pickupOnly: row.pickup_only !== false,
    percentOff,
  };
}

/**
 * Zero-price the free pizza units on a priced cart, the same way the welcome pie does and
 * for the same reason: Clover rejects negative line prices and recomputes tax on order-level
 * discounts unpredictably, while a $0.00 line keeps Clover's total, the tax, the POS screen
 * and the printed ticket in agreement with ours — which is what lets the payment flow's
 * amount-verification gate stay switched on.
 *
 * Returns null when the cart holds fewer than two pizzas: it's a free PIZZA, not money off.
 */
export function applyBogoPizza(
  lines: CartLineInput[],
  code: string,
): { lines: CartLineInput[]; discountCents: number; freeCount: number } | null {
  const plan = planBogoPizza(lines as unknown as BogoLine[]);
  if (plan.freeCount < 1) return null;

  const out: CartLineInput[] = [];
  lines.forEach((line, index) => {
    const free = plan.freeByIndex[index] ?? 0;
    if (free < 1) {
      out.push(line);
      return;
    }
    // Front-loaded so the kitchen chit reads FREE before anything else on the line.
    out.push({
      ...line,
      basePrice: 0,
      quantity: free,
      notes: [`FREE — BOGO ${code}`, line.notes].filter(Boolean).join(" · "),
    });
    const paid = line.quantity - free;
    if (paid > 0) out.push({ ...line, quantity: paid });
  });
  return { lines: out, discountCents: plan.discountCents, freeCount: plan.freeCount };
}

/**
 * Take a percentage off every pizza unit — base price AND toppings — by lowering the line's
 * base price by the per-unit discount. Options stay on the line unchanged, so the kitchen chit
 * still lists every topping while Clover's line total, the tax and ours all agree, for the same
 * reason applyBogoPizza zero-prices rather than adding an order-level discount.
 *
 * Returns null when the cart holds no pizza: it is money off PIZZA, not off the order.
 */
export function applyPizzaPercent(
  lines: CartLineInput[],
  code: string,
  percentOff: number,
): { lines: CartLineInput[]; discountCents: number; pizzaUnits: number } | null {
  const plan = planPizzaPercent(lines as unknown as BogoLine[], percentOff);
  if (plan.pizzaUnits < 1 || plan.discountCents < 1) return null;
  const out = lines.map((line, index) => {
    const off = plan.perUnitByIndex[index] ?? 0;
    if (off < 1) return line;
    return {
      ...line,
      basePrice: line.basePrice - off,
      notes: [`${Math.round(percentOff)}% OFF — ${code}`, line.notes].filter(Boolean).join(" · "),
    };
  });
  return { lines: out, discountCents: plan.discountCents, pizzaUnits: plan.pizzaUnits };
}

/** Append one use. Idempotent per order attempt, and NEVER throws — a bookkeeping hiccup
 *  must not fail an order that has already been made and paid for. */
export async function recordCampaignRedemption(
  campaignId: number,
  idempotencyKey: string,
  detail: { orderRef?: string; phone?: string; discountCents: number; freeCount: number },
): Promise<void> {
  try {
    await ensureCampaignTables();
    await sql`
      INSERT INTO campaign_redemptions
        (campaign_id, idempotency_key, order_ref, customer_phone, discount_cents, free_count)
      VALUES (${campaignId}, ${idempotencyKey}, ${detail.orderRef ?? null}, ${detail.phone ?? null},
              ${Math.round(detail.discountCents)}, ${Math.round(detail.freeCount)})
      ON CONFLICT (campaign_id, idempotency_key) DO NOTHING
    `;
  } catch (err) {
    console.error("[campaignPromo] could not record redemption", err);
  }
}

export type ResolvedPromo =
  | { ok: true; kind: "welcome"; id: number; code: string; description: string }
  | { ok: true; kind: CampaignKind; id: number; code: string; description: string; pickupOnly: boolean; percentOff: number }
  | { ok: false; message: string };

const BAD_FORMAT = "That code doesn't look right — check it and try again.";

/**
 * One entry point for both code families, so the checkout preview and the order endpoint
 * can never disagree about what a typed string means.
 *
 * Campaign first, then the welcome pie. A welcome code typed without its prefix ("A2B3C4")
 * is shaped like a campaign code, so it is looked up as one, misses, and falls through to
 * the PIE- normalisation that has always accepted it — the tolerance customers rely on when
 * reading a code off a phone at the counter survives unchanged.
 */
export async function resolvePromo(business: VipBusiness, raw: unknown): Promise<ResolvedPromo> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: BAD_FORMAT };

  const campaignCode = normalizeCampaignCode(raw);
  if (campaignCode) {
    const hit = await checkCampaignCode(business, campaignCode);
    if (hit.ok) {
      return { ok: true, kind: hit.kind, id: hit.id, code: hit.code, description: hit.description, pickupOnly: hit.pickupOnly, percentOff: hit.percentOff };
    }
    // A code that exists but is over or not yet open must say so, rather than being
    // retried as a welcome code and coming back "we don't recognise that".
    if (hit.reason !== "not_found") return { ok: false, message: hit.message };
  }

  const welcomeCode = normalizePromoCode(raw);
  if (!welcomeCode) return { ok: false, message: BAD_FORMAT };
  const welcome = await checkPromoCode(business, welcomeCode);
  if (!welcome.ok) return { ok: false, message: welcome.message };
  return { ok: true, kind: "welcome", id: welcome.id, code: welcome.code, description: welcome.description };
}
