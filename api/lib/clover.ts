/**
 * Clover integration for in-house online ordering.
 *
 * Two Clover systems are used together:
 *  1. Ecommerce API (scl.clover.com/v1) — charges a tokenized card. Card data
 *     never touches this server; the browser tokenizes it with clover.js using
 *     the public PAKMS key, and we only ever see a `clv_…` source token.
 *  2. REST Orders API (api.clover.com/v3) — drops an itemized order into the
 *     merchant's POS / kitchen so staff can make it.
 *
 * Prices are NEVER taken from the client — callers pass lines already re-priced
 * against the server catalog (see menuCatalog.ts). Everything is env-gated: with
 * no CLOVER_API_TOKEN the endpoint degrades to a clear "call the store" message.
 */

const ECOMMERCE_BASE = "https://scl.clover.com";
const REST_BASE = "https://api.clover.com";

/** NJ Sales Tax — mirrors the merchant's Clover tax config (6.625%). */
export const TAX_RATE = 0.06625;
export const CURRENCY = "usd";

/** Hard cap on total units per order (abuse + upstream-amplification guard). */
export const MAX_UNITS = 100;

/** Clover order-type element IDs on this merchant (verified via /v3 order_types). */
export const ORDER_TYPES = {
  pickup: "R8FK9C8AD11P4", // "In-store Pickup"
  delivery: "H3TYJ5NC01662", // "Delivery"
} as const;

export type Fulfillment = keyof typeof ORDER_TYPES;

export type CartOptionInput = { group: string; name: string; delta: number };
export type CartLineInput = {
  itemName: string;
  basePrice: number; // authoritative cents (from menuCatalog)
  options: CartOptionInput[];
  quantity: number;
  notes?: string;
};

function token(): string | null {
  return process.env.CLOVER_API_TOKEN || null;
}
/** Ecommerce charges use the dedicated private token from the merchant's
 * "Clover eComm Iframe" API token pair; falls back to the merchant token. */
function ecommToken(): string | null {
  return process.env.CLOVER_ECOMM_PRIVATE_TOKEN || token();
}
function merchantId(): string | null {
  return process.env.CLOVER_MERCHANT_ID || null;
}

/** Order-to-POS is possible (kitchen ticket). */
export function cloverConfigured(): boolean {
  return !!token() && !!merchantId();
}

/** Unit price (base + option deltas), whole cents. */
export function unitPrice(line: Pick<CartLineInput, "basePrice" | "options">): number {
  return Math.round(line.basePrice + line.options.reduce((s, o) => s + Math.round(o.delta || 0), 0));
}

export type Totals = { subtotal: number; discount: number; tax: number; tip: number; total: number };

/** Cash orders get the store's dual-pricing discount: listed prices are card
 * prices, so paying cash takes 3.99% off the item subtotal (tax on the
 * discounted amount — same math the register uses). */
export const CASH_DISCOUNT_RATE = 0.0399;

/** Authoritative server-side totals. Lines must already be catalog-priced.
 * Tip is clamped to [0, max($20, subtotal)] so a client bug (dollars-vs-cents)
 * or tampering can't drive the captured charge to an absurd amount. */
export function computeTotals(lines: CartLineInput[], tipCents: number, cashDiscount = false): Totals {
  const subtotal = lines.reduce((s, l) => s + unitPrice(l) * l.quantity, 0);
  const discount = cashDiscount ? Math.round(subtotal * CASH_DISCOUNT_RATE) : 0;
  const taxable = subtotal - discount;
  const tax = Math.round(taxable * TAX_RATE);
  const tip = Math.min(Math.max(0, Math.round(tipCents || 0)), Math.max(2000, taxable));
  return { subtotal, discount, tax, tip, total: taxable + tax + tip };
}

export class CloverError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

/**
 * Charge a tokenized card via the Ecommerce API. `amount` is the full amount to
 * capture in cents (subtotal + tax + tip). `idempotencyKey` (a UUID) makes a
 * retry after a lost response return the SAME charge instead of double-charging.
 * `clientIp` must be the platform-derived real IP (never a caller-supplied header).
 */
export async function createCharge(opts: {
  amount: number;
  source: string;
  taxAmount: number;
  idempotencyKey: string;
  clientIp?: string;
  description?: string;
  email?: string;
}): Promise<{ id: string; amount: number }> {
  const t = ecommToken();
  if (!t) throw new CloverError("clover_not_configured", 503);

  const res = await fetch(`${ECOMMERCE_BASE}/v1/charges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      "idempotency-key": opts.idempotencyKey,
      // Trusted (platform-derived) client IP for Clover's fraud/velocity scoring.
      ...(opts.clientIp ? { "X-Forwarded-For": opts.clientIp } : {}),
    },
    body: JSON.stringify({
      amount: opts.amount,
      currency: CURRENCY,
      source: opts.source,
      tax_amount: opts.taxAmount,
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.email ? { receipt_email: opts.email } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    amount?: number;
    error?: { message?: string };
    message?: string;
  };
  if (!res.ok || !data.id) {
    const msg = data.error?.message || data.message || "Card was declined";
    throw new CloverError(msg, res.status, data);
  }
  return { id: data.id, amount: data.amount ?? opts.amount };
}

async function rest(path: string, init: RequestInit): Promise<any> {
  const t = token();
  const mid = merchantId();
  if (!t || !mid) throw new CloverError("clover_not_configured", 503);
  const res = await fetch(`${REST_BASE}/v3/merchants/${mid}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new CloverError((data as any)?.message || `Clover REST ${res.status}`, res.status, data);
  }
  return data;
}

/**
 * Create a DRAFT itemized order in the merchant's POS (no state → does not fire
 * to the kitchen). Custom line items (name+price) price correctly regardless of
 * Clover modifier config; a full human-readable ticket (safety notes
 * front-loaded) is written to the order note. If item/discount attachment
 * fails, the partial draft is deleted so a half-built ticket can never fire.
 */
export async function createDraftOrder(opts: {
  lines: CartLineInput[];
  fulfillment: Fulfillment;
  note: string;
  /** Cash orders: exact cents taken off at the register (order-level Clover
   * discount), so the POS total equals what the driver collects. */
  discountCents?: number;
}): Promise<{ id: string; href: string }> {
  const mid = merchantId()!;
  const title = `WEBSITE • ${opts.fulfillment === "delivery" ? "DELIVERY" : "PICKUP"}`;

  const order = await rest(`/orders`, {
    method: "POST",
    body: JSON.stringify({
      orderType: { id: ORDER_TYPES[opts.fulfillment] },
      title,
      note: opts.note.slice(0, 490), // Clover note cap ~500 chars; safety fields are front-loaded
    }),
  });
  const orderId = order.id as string;

  try {
    // Build every unit as a line item, then add them all in ONE bulk call.
    const items: { name: string; price: number; note?: string }[] = [];
    for (const line of opts.lines) {
      const price = unitPrice(line);
      const optionSummary = line.options.map((o) => o.name).join(", ");
      const name = line.itemName.slice(0, 120);
      // "WEB • " prefix makes each kitchen chit self-identifying regardless of print profile.
      const lineNote = ("WEB • " + [optionSummary, line.notes].filter(Boolean).join(" · ")).slice(0, 220);
      const qty = Math.min(Math.max(1, Math.floor(line.quantity)), MAX_UNITS);
      for (let i = 0; i < qty && items.length < MAX_UNITS; i++) {
        items.push({ name, price, note: lineNote });
      }
    }
    await rest(`/orders/${orderId}/bulk_line_items`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });

    // Cash orders: attach the exact-cents cash discount so the register
    // total matches the collected amount (staff must not re-apply it manually).
    if (opts.discountCents && opts.discountCents > 0) {
      await rest(`/orders/${orderId}/discounts`, {
        method: "POST",
        body: JSON.stringify({ name: "Cash discount 3.99% (website)", amount: -opts.discountCents }),
      });
    }
  } catch (err) {
    await rest(`/orders/${orderId}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }

  return { id: orderId, href: `https://www.clover.com/v3/merchants/${mid}/orders/${orderId}` };
}

/** Fire a draft order to the kitchen (flip to "open"), optionally marking it
 * paid and refreshing the ticket note (e.g. to add the charge id). */
export async function fireOrder(
  orderId: string,
  opts: { paid: boolean; note?: string },
): Promise<void> {
  await rest(`/orders/${orderId}`, {
    method: "POST",
    body: JSON.stringify({
      state: "open",
      ...(opts.paid ? { paymentState: "PAID" } : {}),
      ...(opts.note ? { note: opts.note.slice(0, 490) } : {}),
    }),
  });
}

/** Delete a draft order (rollback path — never call on a fired/paid order). */
export async function deleteDraftOrder(orderId: string): Promise<void> {
  await rest(`/orders/${orderId}`, { method: "DELETE" });
}

/**
 * Create an itemized order in the merchant's POS and fire it, atomically.
 * (Cash/pickup path — card orders use createDraftOrder → payForOrder →
 * fireOrder so the payment lands on the itemized order itself.)
 */
export async function createPosOrder(opts: {
  lines: CartLineInput[];
  fulfillment: Fulfillment;
  note: string;
  paid: boolean;
  discountCents?: number;
}): Promise<{ id: string; href: string }> {
  const draft = await createDraftOrder(opts);
  try {
    await fireOrder(draft.id, { paid: opts.paid });
  } catch (err) {
    await deleteDraftOrder(draft.id).catch(() => {});
    throw err;
  }
  return draft;
}

/** Ecommerce view of a POS order — returns Clover's computed charge amount
 * (line items + tax) so we can verify it equals our own total BEFORE charging.
 * A just-created v3 order takes a beat to appear on the ecommerce side
 * (separate systems, eventual consistency), so 404s are retried briefly. */
export async function getEcommOrderAmount(orderId: string): Promise<number> {
  const t = ecommToken();
  if (!t) throw new CloverError("clover_not_configured", 503);
  const delays = [0, 400, 900, 1600]; // ~3s worst case — invisible next to card auth time
  let last: CloverError | null = null;
  for (const ms of delays) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    const res = await fetch(`${ECOMMERCE_BASE}/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    const data = (await res.json().catch(() => ({}))) as { amount?: number; message?: string };
    if (res.ok && typeof data.amount === "number") return data.amount;
    last = new CloverError(data.message || "ecomm order lookup failed", res.status, data);
    if (res.status !== 404 && res.status < 500) break; // real error — don't spin on it
  }
  throw last ?? new CloverError("ecomm order lookup failed", 500);
}

/**
 * Charge a card FOR an existing POS order (single-order flow: the payment
 * attaches to the itemized order itself — no separate "Item 1" ghost order).
 * Amount is derived by Clover from the order's line items + tax.
 */
export async function payForOrder(opts: {
  orderId: string;
  source: string;
  idempotencyKey: string;
  clientIp?: string;
  email?: string;
}): Promise<{ id: string; amount: number }> {
  const t = ecommToken();
  if (!t) throw new CloverError("clover_not_configured", 503);

  const res = await fetch(`${ECOMMERCE_BASE}/v1/orders/${opts.orderId}/pay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      "idempotency-key": opts.idempotencyKey,
      ...(opts.clientIp ? { "X-Forwarded-For": opts.clientIp } : {}),
    },
    body: JSON.stringify({
      source: opts.source,
      ...(opts.email ? { email: opts.email } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    amount?: number;
    error?: { message?: string };
    message?: string;
  };
  if (!res.ok || !data.id) {
    const msg = data.error?.message || data.message || "Card was declined";
    throw new CloverError(msg, res.status, data);
  }
  return { id: data.id, amount: data.amount ?? 0 };
}

/**
 * Build the human-readable kitchen ticket note. Safety-critical fields (payment
 * status, delivery address, customer allergy/special note) are FRONT-loaded so
 * the 490-char cap can only ever truncate the tail (the itemized list), never
 * the allergy warning or the address.
 */
export function buildOrderNote(opts: {
  fulfillment: Fulfillment;
  customer: { name: string; phone: string; email?: string; address?: string };
  lines: CartLineInput[];
  totals: Totals;
  payment: "card" | "pickup" | "cash";
  chargeId?: string;
  orderNote?: string;
}): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const kind = opts.fulfillment === "delivery" ? "DELIVERY (in-house driver)" : "PICKUP";
  const pay =
    opts.payment === "card"
      ? `PAID ONLINE ${money(opts.totals.total)}${opts.chargeId ? ` (Clover ${opts.chargeId})` : ""}`
      : opts.payment === "cash"
        ? `** COLLECT CASH ${money(opts.totals.total)} ** (3.99% cash discount applied)`
        : "PAY ON PICKUP/DELIVERY";
  const addr = opts.fulfillment === "delivery" ? ` → ${opts.customer.address ?? "(no address)"}` : "";
  const items = opts.lines
    .map((l) => {
      const opt = l.options.map((o) => o.name).join(", ");
      return `${l.quantity}x ${l.itemName}${opt ? ` [${opt}]` : ""}${l.notes ? ` (${l.notes})` : ""}`;
    })
    .join("; ");
  // Front-loaded so the 490-char cap can only ever drop the item/total TAIL:
  //   header → ⚠ allergy note → customer + address → items → totals.
  // (create.ts caps: name ≤80, orderNote ≤130, address ≤120 — worst case ends at
  //  ~455 chars, inside the 490 slice, so the allergy note + address always survive.)
  const parts = [
    `WEBSITE ORDER · ${kind} · ${pay}`,
    opts.orderNote ? `⚠ NOTE: ${opts.orderNote}` : "",
    `${opts.customer.name} ${opts.customer.phone}${addr}`,
    items,
    `Sub ${money(opts.totals.subtotal)}${opts.totals.discount ? ` Cash disc -${money(opts.totals.discount)}` : ""} Tax ${money(opts.totals.tax)}${opts.totals.tip ? ` Tip ${money(opts.totals.tip)}` : ""} = ${money(opts.totals.total)}`,
  ].filter(Boolean);
  return parts.join(" | ");
}
