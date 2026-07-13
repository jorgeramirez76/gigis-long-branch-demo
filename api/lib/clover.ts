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
 * Everything is env-gated: with no CLOVER_API_TOKEN the endpoint degrades to a
 * clear "call the store" message instead of throwing on cold start.
 */

const ECOMMERCE_BASE = "https://scl.clover.com";
const REST_BASE = "https://api.clover.com";

/** NJ Sales Tax — mirrors the merchant's Clover tax config (6.625%). */
export const TAX_RATE = 0.06625;
export const CURRENCY = "usd";

/** Clover order-type element IDs on this merchant (verified via /v3 order_types). */
export const ORDER_TYPES = {
  pickup: "R8FK9C8AD11P4", // "In-store Pickup"
  delivery: "H3TYJ5NC01662", // "Delivery"
} as const;

export type Fulfillment = keyof typeof ORDER_TYPES;

export type CartOptionInput = { group: string; name: string; delta: number };
export type CartLineInput = {
  itemName: string;
  basePrice: number; // cents
  options: CartOptionInput[];
  quantity: number;
  notes?: string;
};

function token(): string | null {
  return process.env.CLOVER_API_TOKEN || null;
}
function merchantId(): string | null {
  return process.env.CLOVER_MERCHANT_ID || null;
}

/** Order-to-POS is possible (kitchen ticket). */
export function cloverConfigured(): boolean {
  return !!token() && !!merchantId();
}

/** Unit price (base + option deltas), cents. Mirrors the client's lineUnitPrice. */
export function unitPrice(line: Pick<CartLineInput, "basePrice" | "options">): number {
  return line.basePrice + line.options.reduce((s, o) => s + (o.delta || 0), 0);
}

export type Totals = { subtotal: number; tax: number; tip: number; total: number };

/** Authoritative server-side totals — never trust a client-sent total. */
export function computeTotals(lines: CartLineInput[], tipCents: number): Totals {
  const subtotal = lines.reduce((s, l) => s + unitPrice(l) * l.quantity, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const tip = Math.max(0, Math.round(tipCents || 0));
  return { subtotal, tax, tip, total: subtotal + tax + tip };
}

export class CloverError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

/**
 * Charge a tokenized card via the Ecommerce API. `amount` is the full amount to
 * capture in cents (subtotal + tax + tip); `taxAmount` is the informational tax
 * portion. Returns the charge id for reconciliation.
 */
export async function createCharge(opts: {
  amount: number;
  source: string;
  taxAmount: number;
  clientIp?: string;
  description?: string;
  email?: string;
}): Promise<{ id: string; amount: number }> {
  const t = token();
  if (!t) throw new CloverError("clover_not_configured", 503);

  const res = await fetch(`${ECOMMERCE_BASE}/v1/charges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
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
    throw new CloverError(
      (data as any)?.message || `Clover REST ${res.status}`,
      res.status,
      data,
    );
  }
  return data;
}

/**
 * Create an itemized order in the merchant's POS so the kitchen can make it.
 *
 * Custom line items (name + price) are used rather than inventory-item refs so
 * option deltas price correctly regardless of Clover modifier setup. A full
 * human-readable ticket (customer, fulfillment, per-line options, special
 * instructions, payment status) is written to the order note so nothing is lost
 * even if custom-line notes don't print on a given kitchen device.
 */
export async function createPosOrder(opts: {
  lines: CartLineInput[];
  fulfillment: Fulfillment;
  note: string;
  paid: boolean;
}): Promise<{ id: string; href: string }> {
  const mid = merchantId()!;

  // 1) Create the order shell with type + note, fired to the POS (state "open").
  const order = await rest(`/orders`, {
    method: "POST",
    body: JSON.stringify({
      orderType: { id: ORDER_TYPES[opts.fulfillment] },
      state: "open",
      title: "Online order — website",
      note: opts.note.slice(0, 490), // Clover note cap is ~500 chars
    }),
  });
  const orderId = order.id as string;

  // 2) Add each line item (one POST per unit so the kitchen sees each pie).
  for (const line of opts.lines) {
    const price = unitPrice(line);
    const optionSummary = line.options.map((o) => o.name).join(", ");
    const name = line.itemName.slice(0, 120);
    const lineNote = [optionSummary, line.notes].filter(Boolean).join(" · ").slice(0, 200);
    const qty = Math.min(Math.max(1, line.quantity), 50);
    for (let i = 0; i < qty; i++) {
      await rest(`/orders/${orderId}/line_items`, {
        method: "POST",
        body: JSON.stringify({ name, price, ...(lineNote ? { note: lineNote } : {}) }),
      });
    }
  }

  // 3) Flag payment state. Card orders are captured via the ecommerce charge;
  //    the charge id lives in the note for reconciliation.
  if (opts.paid) {
    await rest(`/orders/${orderId}`, {
      method: "POST",
      body: JSON.stringify({ paymentState: "PAID" }),
    }).catch(() => {
      /* non-fatal: order still lands in POS, note records it as paid */
    });
  }

  return { id: orderId, href: `https://www.clover.com/v3/merchants/${mid}/orders/${orderId}` };
}

/** Build the human-readable kitchen ticket note. */
export function buildOrderNote(opts: {
  fulfillment: Fulfillment;
  customer: { name: string; phone: string; email?: string; address?: string };
  lines: CartLineInput[];
  totals: Totals;
  payment: "card" | "pickup";
  chargeId?: string;
  orderNote?: string;
}): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const head =
    opts.fulfillment === "delivery"
      ? `DELIVERY → ${opts.customer.address ?? "(no address)"}`
      : "PICKUP";
  const pay =
    opts.payment === "card"
      ? `PAID ONLINE${opts.chargeId ? ` (Clover ${opts.chargeId})` : ""}`
      : "PAY ON PICKUP/DELIVERY";
  const items = opts.lines
    .map((l) => {
      const opt = l.options.map((o) => o.name).join(", ");
      return `${l.quantity}x ${l.itemName}${opt ? ` [${opt}]` : ""}${l.notes ? ` (${l.notes})` : ""}`;
    })
    .join("; ");
  const parts = [
    `WEB ORDER · ${head} · ${pay}`,
    `${opts.customer.name} ${opts.customer.phone}`,
    items,
    `Sub ${money(opts.totals.subtotal)} Tax ${money(opts.totals.tax)}${opts.totals.tip ? ` Tip ${money(opts.totals.tip)}` : ""} = ${money(opts.totals.total)}`,
    opts.orderNote ? `Note: ${opts.orderNote}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}
