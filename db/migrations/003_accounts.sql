CREATE TABLE IF NOT EXISTS accounts (
 id BIGSERIAL PRIMARY KEY, business TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
 password_hash TEXT NOT NULL, name TEXT NOT NULL, email_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 member_id BIGINT REFERENCES vip_members(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ,
 deleted_at TIMESTAMPTZ, UNIQUE (business,email)
);
CREATE TABLE IF NOT EXISTS account_sessions (
 id TEXT PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_tokens (
 token_hash TEXT PRIMARY KEY, business TEXT NOT NULL, email TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK (purpose IN ('signup','reset','claim')), payload JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saved_addresses (
 id BIGSERIAL PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 street TEXT, apt TEXT, city TEXT, state TEXT, zip TEXT, is_default BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES accounts(id);
ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_email_lower TEXT;
CREATE INDEX IF NOT EXISTS web_orders_account ON web_orders(account_id,created_at DESC);
CREATE TABLE IF NOT EXISTS order_lines (
 id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES web_orders(id),
 account_id BIGINT REFERENCES accounts(id), line_index INTEGER NOT NULL,
 clover_item_id TEXT, item_name TEXT NOT NULL, category_id TEXT, qty INTEGER NOT NULL,
 unit_cents INTEGER NOT NULL, modifiers JSONB NOT NULL DEFAULT '[]',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(order_id,line_index)
);
CREATE INDEX IF NOT EXISTS order_lines_account_item ON order_lines(account_id,clover_item_id);
CREATE TABLE IF NOT EXISTS upsell_impressions (
 id BIGSERIAL PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES accounts(id),
 item TEXT NOT NULL, shown_at TIMESTAMPTZ NOT NULL DEFAULT now(), added BOOLEAN NOT NULL DEFAULT false
);
-- Capture priced line history in the same transaction that records the payment outcome.
CREATE OR REPLACE FUNCTION capture_reward_order_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.customer_email_lower := LOWER(NEW.customer_email);
 IF NEW.status IN ('charged','paid','paid_unrouted','refire_pending','paid_print_queued','paid_print_failed') AND jsonb_typeof(NEW.items)='array' THEN
  INSERT INTO order_lines(order_id,account_id,line_index,clover_item_id,item_name,category_id,qty,unit_cents,modifiers,created_at)
  SELECT NEW.id,NEW.account_id,(ordinality-1)::int,item->>'cloverItemId',item->>'itemName',item->>'categoryId',
   (item->>'quantity')::int,(item->>'basePrice')::int + COALESCE((SELECT SUM((opt->>'delta')::int) FROM jsonb_array_elements(COALESCE(item->'options','[]')) opt),0),
   COALESCE(item->'options','[]'),NEW.created_at
  FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS lines(item,ordinality)
  ON CONFLICT(order_id,line_index) DO UPDATE SET account_id=EXCLUDED.account_id;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER reward_order_history AFTER INSERT OR UPDATE OF status,account_id ON web_orders
 FOR EACH ROW EXECUTE FUNCTION capture_reward_order_lines();
ALTER TABLE vip_promo_codes ADD COLUMN IF NOT EXISTS reservation_key TEXT;
ALTER TABLE vip_promo_codes ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 0;
