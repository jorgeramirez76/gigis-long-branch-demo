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

/** The merchant's NJ Sales Tax rate (verified via /v3 tax_rates — isDefault).
 * Attached to every website line item so Clover computes tax ON TOP of the
 * price; rate is in Clover's 1e-7 units (662500 = 6.625%), matching TAX_RATE. */
const NJ_TAX_RATE = { id: "GJFQ1TP7F648J", name: "NJ Sales Tax", rate: 662500 } as const;

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
 * Header printed at the top of the kitchen ticket. Always carries all three
 * facts the kitchen and register need at a glance — where it came from, how it
 * leaves the store, and whether money was already taken:
 *   WEBSITE ORDER • CUSTOMER PICKUP • NOT PAID
 *   WEBSITE ORDER • CUSTOMER PICKUP • PAID w/ CC
 *   WEBSITE ORDER • FOR DELIVERY • PAID w/ CC
 * `paid` is omitted while the order is still a draft (payment not yet taken).
 */
export function ticketTitle(fulfillment: Fulfillment, paid?: boolean): string {
  const kind = fulfillment === "delivery" ? "FOR DELIVERY" : "CUSTOMER PICKUP";
  const pay = paid === undefined ? "" : paid ? " • PAID w/ CC" : " • NOT PAID";
  return `WEBSITE ORDER • ${kind}${pay}`;
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
  const title = ticketTitle(opts.fulfillment);

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
    // Build every unit as a line item.
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
    // Line items are created ONE BY ONE (small parallel chunks), not via
    // bulk_line_items: only the single POST accepts inline taxRates, and the
    // attached NJ rate is what makes Clover compute tax ON TOP of the price.
    // Without it, custom items read "Taxes (included)" — the order totals to
    // the pre-tax figure, /v1/orders/{id}/pay would undercharge, and website
    // orders under-report sales tax in the merchant's Clover reports.
    const CHUNK = 6;
    for (let i = 0; i < items.length; i += CHUNK) {
      await Promise.all(
        items.slice(i, i + CHUNK).map((it) =>
          rest(`/orders/${orderId}/line_items`, {
            method: "POST",
            body: JSON.stringify({ ...it, taxRates: [NJ_TAX_RATE] }),
          }),
        ),
      );
    }

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
  opts: { paid: boolean; note?: string; title?: string },
): Promise<void> {
  await rest(`/orders/${orderId}`, {
    method: "POST",
    body: JSON.stringify({
      state: "open",
      ...(opts.paid ? { paymentState: "PAID" } : {}),
      ...(opts.note ? { note: opts.note.slice(0, 490) } : {}),
      // Re-titled at fire time so the printed header carries the final payment
      // state (a draft is created before the card is charged).
      ...(opts.title ? { title: opts.title } : {}),
    }),
  });
}

/** Delete a draft order (rollback path — never call on a fired/paid order). */
export async function deleteDraftOrder(orderId: string): Promise<void> {
  await rest(`/orders/${orderId}`, { method: "DELETE" });
}

/**
 * Push an order to the merchant's order printer (the kitchen ticket).
 *
 * Firing an order (state → "open") makes it appear in the POS but does NOT
 * guarantee paper: auto-print is a device-side setting. This explicit
 * print_event is what actually drives the printer, so the kitchen sees a ticket
 * the moment an order lands. Clover routes the job to the firing device's order
 * printer (the "Kitchen" printer here) or its onboard printer — the API gives no
 * way to target a printer by id.
 *
 * Print jobs are short-lived and are discarded once printed, so a failure must
 * be retried promptly (see printOrderTicket) — it cannot be replayed later.
 */
async function requestPrint(orderId: string): Promise<{ id?: string; state?: string; device?: string }> {
  const data = await rest(`/print_event`, {
    method: "POST",
    body: JSON.stringify({ orderRef: { id: orderId } }),
  });
  return { id: data?.id, state: data?.state, device: data?.deviceRef?.id };
}

/** Read a print job's state ("CREATED" | "PRINTING" | "PRINTED" | "FAILED"). */
export async function getPrintEventState(eventId: string): Promise<string | undefined> {
  const data = await rest(`/print_event/${eventId}`, { method: "GET" });
  return data?.state;
}

/**
 * Print the kitchen ticket, with one retry (a device can be briefly offline or
 * busy). NEVER throws: a printer problem must not fail an order that is already
 * paid and fired — it's logged loudly instead so it can be recovered.
 */
export async function printOrderTicket(orderId: string): Promise<{ printed: boolean; eventId?: string; state?: string; error?: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ev = await requestPrint(orderId);
      if (ev.state && ev.state.toUpperCase() === "FAILED") {
        if (attempt === 2) return { printed: false, eventId: ev.id, state: ev.state, error: "printer reported FAILED" };
      } else {
        console.log(`[print] kitchen ticket queued for order ${orderId} — event ${ev.id} state ${ev.state} device ${ev.device ?? "default"}`);
        return { printed: true, eventId: ev.id, state: ev.state };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "print request failed";
      if (attempt === 2) {
        console.error(`[print] FAILED to print kitchen ticket for order ${orderId}: ${msg}`);
        return { printed: false, error: msg };
      }
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  return { printed: false, error: "unreachable" };
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
    await fireOrder(draft.id, { paid: opts.paid, title: ticketTitle(opts.fulfillment, opts.paid) });
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
    // There is NO top-level amount on this endpoint (learned the hard way — the
    // old `data.amount` read threw on every order and silently forced the
    // two-order fallback). The order is a list of items; with NJ_TAX_RATE on
    // each line item Clover adds a `{type:"tax", amount}` entry, so the sum of
    // item amounts IS the charge total (items + tax).
    const data = (await res.json().catch(() => ({}))) as {
      items?: { amount?: number }[];
      message?: string;
    };
    if (res.ok && Array.isArray(data.items) && data.items.length > 0) {
      return data.items.reduce((s, it) => s + (typeof it.amount === "number" ? it.amount : 0), 0);
    }
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
  /** Gratuity in cents, charged ON TOP of the order amount (items + tax).
   * Clover: "tips are not adjustable and can only be included in the initial
   * request" — this is what keeps a tipped order on ONE Clover order. */
  tipAmount?: number;
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
      ecomind: "ecom", // customer-entered card (not merchant/MOTO)
      ...(opts.tipAmount ? { tip_amount: opts.tipAmount } : {}),
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
  const kind = opts.fulfillment === "delivery" ? "FOR DELIVERY (in-house driver)" : "CUSTOMER PICKUP";
  // Who collects, and how much — the driver (delivery) or the counter (pickup).
  const collector = opts.fulfillment === "delivery" ? "DRIVER COLLECTS" : "COLLECT AT COUNTER";
  const pay =
    opts.payment === "card"
      ? `** PAID w/ CC ${money(opts.totals.total)} **${opts.chargeId ? ` (Clover ${opts.chargeId})` : ""}`
      : opts.payment === "cash"
        ? opts.fulfillment === "delivery"
          ? `** NOT PAID — DRIVER COLLECTS CASH ${money(opts.totals.total)} ** (3.99% cash discount applied)`
          : `** NOT PAID — COLLECT CASH AT COUNTER ${money(opts.totals.total)} ** (3.99% cash discount applied)`
        : `** NOT PAID — ${collector} ${money(opts.totals.total)} **`;
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
