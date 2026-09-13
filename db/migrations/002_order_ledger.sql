CREATE TABLE IF NOT EXISTS web_orders (
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
  );
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS card_pricing INTEGER;
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS fee_cents INTEGER,
 ADD COLUMN IF NOT EXISTS discount_cents INTEGER, ADD COLUMN IF NOT EXISTS town TEXT,
 ADD COLUMN IF NOT EXISTS promo_code TEXT, ADD COLUMN IF NOT EXISTS member_id BIGINT;
