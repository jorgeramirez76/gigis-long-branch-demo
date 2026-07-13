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
  ensured = true;
}

export type OrderStatus = "pending" | "charged" | "placed" | "paid" | "paid_unrouted" | "failed";

export type OrderRecord = {
  idempotencyKey: string;
  fulfillment: string;
  customer: { name: string; phone: string; email?: string; address?: string };
  items: unknown;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  paymentMethod: string;
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
  | { reserved: null }; // DB unavailable — caller proceeds without idempotency

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
         items, subtotal, tax, tip, total, payment_method, status, note)
      VALUES
        (${o.idempotencyKey}, ${o.fulfillment}, ${o.customer.name}, ${o.customer.phone}, ${o.customer.email ?? null}, ${o.customer.address ?? null},
         ${JSON.stringify(o.items)}, ${o.subtotal}, ${o.tax}, ${o.tip}, ${o.total}, ${o.paymentMethod}, 'pending', ${o.note ?? null})
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
 * before consuming rate-limit budget). Returns null if unseen or DB unavailable. */
export async function peekOrder(key: string): Promise<Existing | null> {
  try {
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
  } catch (e) {
    console.error("[orderStore] peekOrder failed", e);
    return null;
  }
}

/** Patch a reserved order (best-effort). Never throws. */
export async function updateOrder(
  id: number,
  patch: { status?: OrderStatus; chargeId?: string; cloverOrderId?: string; note?: string },
): Promise<void> {
  try {
    await ensure();
    await sql`
      UPDATE web_orders SET
        status = COALESCE(${patch.status ?? null}, status),
        charge_id = COALESCE(${patch.chargeId ?? null}, charge_id),
        clover_order_id = COALESCE(${patch.cloverOrderId ?? null}, clover_order_id),
        note = COALESCE(${patch.note ?? null}, note),
        updated_at = now()
      WHERE id = ${id}
    `;
  } catch (e) {
    console.error("[orderStore] updateOrder failed", id, e);
  }
}
