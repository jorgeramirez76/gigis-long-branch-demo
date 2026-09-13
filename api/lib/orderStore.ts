import { sql } from "./db.js";

/**
 * Durable log of every website order. Doubles as (a) the owner's order history,
 * (b) idempotency (one row per idempotency key — a retry can't double-fire or
 * double-charge), and (c) recovery for a paid order whose kitchen ticket failed
 * to post ("paid_unrouted") — so a captured card is never silently lost.
 *
 * The chargeId is written the moment the card is captured (before the POS step),
 * so even a mid-flight function kill leaves a durable, recoverable record.
 */
let ensured = false;

async function ensure() {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS web_orders (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key TEXT UNIQUE,
    business TEXT NOT NULL DEFAULT 'gigis_long_branch',
    fulfillment TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    address TEXT,
    items JSONB,
    subtotal INTEGER,
    tax INTEGER,
    tip INTEGER,
    total INTEGER,
    payment_method TEXT,
    charge_id TEXT,
    clover_order_id TEXT,
    status TEXT NOT NULL,
    note TEXT
  )`;
  // Belt-and-suspenders: guarantees the idempotency uniqueness even if the table
  // somehow pre-existed without the inline UNIQUE (keeps reserveOrder atomic).
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS web_orders_idem_key ON web_orders (idempotency_key)`;
  // 2026-09-06: menu prices became cash prices and the 4% moved to its own line, so the row
  // keeps it — subtotal + tax + tip no longer reconciles to total without it.
  await sql`ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS card_pricing INTEGER`;
  await sql`ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS fee_cents INTEGER,
    ADD COLUMN IF NOT EXISTS discount_cents INTEGER, ADD COLUMN IF NOT EXISTS town TEXT,
    ADD COLUMN IF NOT EXISTS promo_code TEXT, ADD COLUMN IF NOT EXISTS member_id BIGINT`;
  ensured = true;
}

export type OrderStatus = "refire_pending" | "pending" | "charged" | "placed" | "paid" | "paid_unrouted" | "paid_print_queued" | "paid_print_failed" | "capture_uncertain" | "routing_uncertain" | "failed";

export type OrderRecord = {
  idempotencyKey: string;
  fulfillment: string;
  customer: { name: string; phone: string; email?: string; address?: string };
  items: unknown;
  subtotal: number;
  /** The "Card pricing (4%)" line, cents (see api/lib/cardPricing.mjs). */
  cardPricing?: number;
  tax: number;
  tip: number;
  total: number;
  paymentMethod: string;
  accountId?: number;
  fee?: number; discount?: number; town?: string; promoCode?: string; memberId?: number;
  note?: string;
};

export type Existing = {
  id: number;
  status: OrderStatus;
  chargeId: string | null;
  cloverOrderId: string | null;
  ageSec: number;
};

export type Reservation =
  | { reserved: true; id: number }
  | { reserved: false; existing: Existing }
  | { reserved: null }; // DB unavailable — caller MUST stop before contacting Clover

/**
 * Atomically claim the idempotency key with a `pending` row. If the key already
 * exists, returns the existing row so the caller can replay/short-circuit
 * instead of charging or firing a second ticket.
 */
export async function reserveOrder(o: OrderRecord): Promise<Reservation> {
  try {
    await ensure();
    const ins = await sql`
      INSERT INTO web_orders
        (idempotency_key, fulfillment, customer_name, customer_phone, customer_email, address,
         items, subtotal, card_pricing, tax, tip, total, payment_method, status, note, fee_cents, discount_cents, town, promo_code, member_id, account_id, customer_email_lower)
      VALUES
        (${o.idempotencyKey}, ${o.fulfillment}, ${o.customer.name}, ${o.customer.phone}, ${o.customer.email?.trim().toLowerCase() ?? null}, ${o.customer.address ?? null},
         ${JSON.stringify(o.items)}, ${o.subtotal}, ${o.cardPricing ?? 0}, ${o.tax}, ${o.tip}, ${o.total}, ${o.paymentMethod}, 'pending', ${o.note ?? null}, ${o.fee ?? 0}, ${o.discount ?? 0}, ${o.town ?? null}, ${o.promoCode ?? null}, ${o.memberId ?? null}, ${o.accountId ?? null}, ${o.customer.email?.trim().toLowerCase() ?? null})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (ins.rows[0]?.id != null) return { reserved: true, id: ins.rows[0].id as number };

    const ex = await sql`
      SELECT id, status, charge_id, clover_order_id, EXTRACT(EPOCH FROM (now() - created_at))::int AS age
      FROM web_orders WHERE idempotency_key = ${o.idempotencyKey}
    `;
    const row = ex.rows[0];
    if (!row) return { reserved: null };
    return {
      reserved: false,
      existing: {
        id: row.id as number,
        status: row.status as OrderStatus,
        chargeId: (row.charge_id as string) ?? null,
        cloverOrderId: (row.clover_order_id as string) ?? null,
        ageSec: (row.age as number) ?? 0,
      },
    };
  } catch (e) {
    console.error("[orderStore] reserveOrder failed", e);
    return { reserved: null };
  }
}

/** Read-only lookup by idempotency key (for replaying an already-placed order
 * before consuming rate-limit budget). DB errors throw so prepaid ordering fails closed. */
export async function peekOrder(key: string): Promise<Existing | null> {
  await ensure();
  const ex = await sql`
    SELECT id, status, charge_id, clover_order_id, EXTRACT(EPOCH FROM (now() - created_at))::int AS age
    FROM web_orders WHERE idempotency_key = ${key}
  `;
  const row = ex.rows[0];
  if (!row) return null;
  return {
    id: row.id as number,
    status: row.status as OrderStatus,
    chargeId: (row.charge_id as string) ?? null,
    cloverOrderId: (row.clover_order_id as string) ?? null,
    ageSec: (row.age as number) ?? 0,
  };
}

/**
 * Give the idempotency key back after an attempt that moved no money.
 *
 * The reservation is what stops a retry from double-charging, but it is claimed
 * before the card is. A decline therefore leaves a row that no later attempt can
 * re-reserve (ON CONFLICT DO NOTHING), so the customer's second try is answered
 * with "call the store to check before re-ordering" for an order that never
 * existed — and staff are paged about it. Only ever called when nothing was
 * captured; Clover keeps its own record of the decline.
 */
export async function releaseOrder(id: number, opts?: { draftDiscarded?: boolean }): Promise<void> {
  try {
    await ensure();
    // clover_order_id is now written BEFORE the card is charged, so a function killed inside
    // /pay still leaves a pointer to the order that may hold the capture. On a definite decline
    // the caller has already deleted that draft, so the pointer is stale and must not veto the
    // release — otherwise the customer we just told to "try a different card" cannot retry.
    if (opts?.draftDiscarded) {
      await sql`DELETE FROM web_orders WHERE id = ${id} AND charge_id IS NULL`;
      return;
    }
    await sql`DELETE FROM web_orders WHERE id = ${id} AND charge_id IS NULL AND clover_order_id IS NULL`;
  } catch (e) {
    console.error("[orderStore] releaseOrder failed", id, e);
  }
}

/** Patch a reserved order (best-effort). Never throws. */
export async function updateOrder(
  id: number,
  patch: { status?: OrderStatus; chargeId?: string; cloverOrderId?: string; note?: string },
): Promise<boolean> {
  try {
    await ensure();
    const result = await sql`
      UPDATE web_orders SET
        status = COALESCE(${patch.status ?? null}, status),
        charge_id = COALESCE(${patch.chargeId ?? null}, charge_id),
        clover_order_id = COALESCE(${patch.cloverOrderId ?? null}, clover_order_id),
        note = COALESCE(${patch.note ?? null}, note),
        updated_at = now()
      WHERE id = ${id}
    `;
    return result.rowCount > 0;
  } catch (e) {
    console.error("[orderStore] updateOrder failed", id, e);
    return false;
  }
}

/** Flip a queued-print row to its outcome ONLY while it is still queued. Every order POST
 *  triggers a sweep, so two concurrent sweeps can read the same row — the conditional update
 *  makes exactly one of them the owner of the page/log that follows. Returns false when the
 *  row was already decided (or on a storage error, in which case the row stays queued and the
 *  next sweep retries). */
export async function claimQueuedPrint(id: number, status: "paid" | "paid_print_failed"): Promise<boolean> {
  try {
    await ensure();
    const r = await sql`
      UPDATE web_orders SET status = ${status}, updated_at = now()
      WHERE id = ${id} AND status = 'paid_print_queued'
      RETURNING id
    `;
    return r.rowCount === 1;
  } catch (e) {
    console.error("[orderStore] claimQueuedPrint failed", id, e);
    return false;
  }
}

/** Safety-critical patch used immediately before/after capture. Storage failure propagates. */
export async function updateOrderStrict(
  id: number,
  patch: { status?: OrderStatus; chargeId?: string; cloverOrderId?: string; note?: string },
): Promise<void> {
  await ensure();
  const r = await sql`
    UPDATE web_orders SET
      status = COALESCE(${patch.status ?? null}, status),
      charge_id = COALESCE(${patch.chargeId ?? null}, charge_id),
      clover_order_id = COALESCE(${patch.cloverOrderId ?? null}, clover_order_id),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  if (r.rowCount !== 1) throw new Error("order reservation disappeared");
}

/**
 * Paid orders whose kitchen ticket was still moving through Clover's print queue when the
 * request had to answer the customer. This store's queue has been measured taking ~16 minutes
 * to reach the printer, so "still queued" is not evidence of failure — but it is not evidence
 * of paper either, and something has to come back and look. See api/lib/printSweep.ts.
 */
/** Our ledger's view of one Clover ticket — the discriminator the worklist reconciles with.
 *  A ticket with a charge here was paid ONLINE (never ring it up); one without is owed money. */
export async function getCaptureByCloverId(cloverOrderId: string): Promise<
  { id: number; status: string; chargeId: string | null; total: number; tip: number; paymentMethod: string | null; customerName: string } | null
> {
  try {
    const r = await sql`
      SELECT id, status, charge_id, total, tip, payment_method, customer_name
      FROM web_orders WHERE clover_order_id = ${cloverOrderId}
      ORDER BY created_at DESC LIMIT 1
    `;
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id as number,
      status: String(row.status),
      chargeId: (row.charge_id as string) || null,
      total: Number(row.total ?? 0),
      tip: Number(row.tip ?? 0),
      paymentMethod: (row.payment_method as string) ?? null,
      customerName: (row.customer_name as string) ?? "",
    };
  } catch (e) {
    // THROW, never null: to the worklist, null means "no record — this ticket is owed money,
    // collect it". A database blip answering null for every row would relabel already-paid
    // tickets as owed and send staff to double-charge customers.
    console.error("[orderStore] getCaptureByCloverId failed", cloverOrderId, e);
    throw e;
  }
}

/** Open-ticket candidates from OUR ledger — the worklist's second net. The Clover scan is a
 *  window over EVERY order the shop rang up, and Brandon Casella's 7/26 stranded split sat
 *  outside an 800-order window by late August; rows here are checked individually against
 *  Clover regardless of scan depth. */
export async function listWorklistCandidates(days = 90): Promise<{ cloverOrderId: string }[]> {
  try {
    const r = await sql`
      SELECT DISTINCT clover_order_id
      FROM web_orders
      WHERE clover_order_id IS NOT NULL AND clover_order_id != ''
        AND created_at > now() - make_interval(days => ${days})
        AND status IN ('placed', 'charged', 'paid', 'paid_unrouted', 'paid_print_queued', 'capture_uncertain', 'refire_pending')
    `;
    return r.rows.map((row) => ({ cloverOrderId: String(row.clover_order_id) }));
  } catch (e) {
    console.error("[orderStore] listWorklistCandidates failed", e);
    return [];
  }
}

export async function listQueuedPrints(minAgeSec: number, limit = 20): Promise<Array<{ id: number; cloverOrderId: string; customerName: string; phone: string; total: number }>> {
  try {
    await ensure();
    const r = await sql`
      SELECT id, clover_order_id, customer_name, customer_phone, total
      FROM web_orders
      WHERE status = 'paid_print_queued'
        AND clover_order_id IS NOT NULL
        AND created_at < now() - make_interval(secs => ${minAgeSec})
      ORDER BY id
      LIMIT ${limit}
    `;
    return r.rows.map((row) => ({
      id: row.id as number,
      cloverOrderId: row.clover_order_id as string,
      customerName: (row.customer_name as string) ?? "",
      phone: (row.customer_phone as string) ?? "",
      total: (row.total as number) ?? 0,
    }));
  } catch (e) {
    console.error("[orderStore] listQueuedPrints failed", e);
    return [];
  }
}

export async function listUnresolvedStrands(business = "gigis_long_branch"): Promise<
  { id: number; status: OrderStatus; chargeId: string | null; cloverOrderId: string | null; customerName: string; total: number }[]
> {
  try {
    await ensure();
    const r = await sql`
      SELECT id, status, charge_id, clover_order_id, customer_name, total
      FROM web_orders
      WHERE business = ${business}
        AND status IN ('paid_unrouted', 'charged', 'capture_uncertain', 'refire_pending')
        AND updated_at < now() - interval '35 minutes'
        AND created_at > now() - interval '24 hours'
      ORDER BY created_at ASC LIMIT 25
    `;
    return r.rows.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      status: row.status as OrderStatus,
      chargeId: (row.charge_id as string) ?? null,
      cloverOrderId: (row.clover_order_id as string) ?? null,
      customerName: (row.customer_name as string) ?? "",
      total: Number(row.total ?? 0),
    }));
  } catch (err) {
    console.error("[orderStore] listUnresolvedStrands failed", err);
    return [];
  }
}

export const settleQueuedPrint = claimQueuedPrint;

export async function getOrderForRefire(id: number): Promise<{
  id: number;
  status: OrderStatus;
  chargeId: string | null;
  cloverOrderId: string | null;
  fulfillment: "pickup" | "delivery";
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string | null;
  items: unknown;
  subtotal: number;
  /** The "Card pricing (4%)" line, cents. 0 on rows written before 2026-09-06. */
  cardPricing: number;
  tax: number;
  tip: number;
  total: number;
  note: string | null;
  business: string;
  fee: number | null; discount: number; town: string | null; promoCode: string | null;
} | null> {
  try {
    await ensure();
    const r = await sql`
      SELECT id, status, charge_id, clover_order_id, fulfillment, customer_name, customer_phone,
             customer_email, address, items, subtotal, card_pricing, tax, tip, total, note, business, fee_cents, discount_cents, town, promo_code
      FROM web_orders WHERE id = ${id}
    `;
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id as number,
      status: row.status as OrderStatus,
      chargeId: (row.charge_id as string) ?? null,
      cloverOrderId: (row.clover_order_id as string) ?? null,
      fulfillment: row.fulfillment as "pickup" | "delivery",
      customerName: (row.customer_name as string) ?? "",
      customerPhone: (row.customer_phone as string) ?? "",
      customerEmail: (row.customer_email as string) ?? null,
      address: (row.address as string) ?? null,
      items: typeof row.items === "string" ? JSON.parse(row.items as string) : row.items,
      subtotal: Number(row.subtotal ?? 0),
      cardPricing: Number(row.card_pricing ?? 0),
      tax: Number(row.tax ?? 0),
      tip: Number(row.tip ?? 0),
      total: Number(row.total ?? 0),
      note: (row.note as string) ?? null,
      business: (row.business as string) ?? "",
      fee: row.fee_cents == null ? null : Number(row.fee_cents), discount: Number(row.discount_cents ?? 0),
      town: row.town as string | null, promoCode: row.promo_code as string | null,
    };
  } catch (e) {
    console.error("[orderStore] getOrderForRefire failed", id, e);
    return null;
  }
}


export async function listStrandedOrders(business: string): Promise<
  { id: number; status: OrderStatus; chargeId: string | null; total: number; customerName: string; createdAt: string }[]
> {
  try {
    await ensure();
    const r = await sql`
      SELECT id, status, charge_id, total, customer_name, created_at
      FROM web_orders
      WHERE business = ${business}
        AND status IN ('paid_unrouted', 'charged', 'refire_pending')
        AND charge_id IS NOT NULL
        AND clover_order_id IS NULL
      ORDER BY created_at DESC LIMIT 50
    `;
    return r.rows.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      status: row.status as OrderStatus,
      chargeId: (row.charge_id as string) ?? null,
      total: Number(row.total ?? 0),
      customerName: (row.customer_name as string) ?? "",
      createdAt: String(row.created_at),
    }));
  } catch (e) {
    console.error("[orderStore] listStrandedOrders failed", e);
    return [];
  }
}


/** Durable single-use claim: expiration of a rate-limit bucket cannot authorize a second ticket.
 * Any interruption after this claim requires staff reconciliation before another recovery. */
export async function claimRefireOrder(id: number, business: string): Promise<boolean> {
  try {
    await ensure();
    const result = await sql`UPDATE web_orders SET status = 'refire_pending', updated_at = now()
      WHERE id = ${id} AND business = ${business}
        AND status IN ('paid_unrouted', 'charged')
        AND charge_id IS NOT NULL AND clover_order_id IS NULL RETURNING id`;
    return result.rowCount === 1;
  } catch (error) {
    console.error('[orderStore] refire claim unavailable', error);
    return false;
  }
}
