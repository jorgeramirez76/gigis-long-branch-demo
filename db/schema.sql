-- VIP Club schema — Gigi's NY Style Pizza, Long Branch NJ
-- Run once against the provisioned Postgres instance (Vercel Postgres / Neon).

CREATE TABLE IF NOT EXISTS vip_members (
  id            BIGSERIAL PRIMARY KEY,
  business      TEXT NOT NULL CHECK (business IN ('gigis_long_branch')),
  name          TEXT NOT NULL,
  phone         TEXT,                 -- E.164, e.g. +17325551234 — nullable: email-only signups allowed
  email         TEXT,                 -- nullable: SMS-only signups allowed
  sms_consent   BOOLEAN NOT NULL DEFAULT FALSE,
  email_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_text  TEXT NOT NULL,        -- exact disclosure text shown at signup, stored for compliance record-keeping
  source        TEXT NOT NULL DEFAULT 'website',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT at_least_one_contact CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS vip_members_business_phone_uq
  ON vip_members (business, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vip_members_business_email_uq
  ON vip_members (business, email) WHERE email IS NOT NULL;

-- === Free-pie anti-abuse (2026-07-24) ===
-- Capture the signup address so the welcome pie can't be re-claimed from the
-- same household. New addr_key values include normalized street, unit, city,
-- state, and ZIP (see api/lib/address.ts); legacy rows may retain street+unit keys.
ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS address  TEXT;
ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS apt      TEXT;
ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS addr_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vip_members_business_addr_uq
  ON vip_members (business, addr_key) WHERE addr_key IS NOT NULL AND addr_key <> '';

CREATE TABLE IF NOT EXISTS vip_promo_codes (
  id            BIGSERIAL PRIMARY KEY,
  business      TEXT NOT NULL CHECK (business IN ('gigis_long_branch')),
  code          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL,        -- e.g. "10% off welcome offer"
  member_id     BIGINT REFERENCES vip_members(id),  -- null = a broadcast code shared by all members
  redeemed_at   TIMESTAMPTZ,
  reservation_key TEXT,
  reserved_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vip_sends (
  id            BIGSERIAL PRIMARY KEY,
  business      TEXT NOT NULL CHECK (business IN ('gigis_long_branch')),
  channel       TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  member_id     BIGINT NOT NULL REFERENCES vip_members(id),
  promo_code_id BIGINT REFERENCES vip_promo_codes(id),
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  provider_id   TEXT,                 -- Twilio SID / email provider message ID
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === CRM additions (2026-07-11) ===
-- Broadcast campaigns: one row per promo blast composed in the admin dashboard.
CREATE TABLE IF NOT EXISTS broadcasts (
  id            BIGSERIAL PRIMARY KEY,
  business      TEXT NOT NULL CHECK (business IN ('gigis_long_branch')),
  subject       TEXT,                 -- email subject; null for SMS-only blasts
  message       TEXT NOT NULL,
  channels      TEXT NOT NULL,        -- 'sms' | 'email' | 'sms,email'
  promo_code_id BIGINT REFERENCES vip_promo_codes(id),
  sms_total     INT NOT NULL DEFAULT 0,
  email_total   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vip_sends ADD COLUMN IF NOT EXISTS broadcast_id BIGINT REFERENCES broadcasts(id);

-- Opt-out audit trail (consent flags on vip_members stay the source of truth;
-- this records when/why they changed, for TCPA record-keeping).
CREATE TABLE IF NOT EXISTS consent_events (
  id         BIGSERIAL PRIMARY KEY,
  member_id  BIGINT NOT NULL REFERENCES vip_members(id),
  channel    TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  action     TEXT NOT NULL CHECK (action IN ('opt_in', 'opt_out')),
  source     TEXT NOT NULL,           -- 'sms_stop' | 'sms_start' | 'email_unsubscribe' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === Nightly Clover menu reconciliation (2026-07-31) ===
-- The menu after removals are applied, written by api/cron/refresh-menu and
-- served by /api/menu. The static menuGenerated.ts is the build-time fallback.
CREATE TABLE IF NOT EXISTS menu_snapshot (
  business    TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  item_count  INT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === Email suppression (2026-07-31) ===
-- Every address that has opted out, member or not. The VIP consent flags stay the
-- source of truth for members; this also covers people emailed as past customers,
-- whose opt-out has no member row to flip.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email      TEXT PRIMARY KEY,
  source     TEXT NOT NULL,           -- 'unsubscribe_link' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per address per one-off outreach campaign, so a re-run can't email
-- anyone twice.
CREATE TABLE IF NOT EXISTS outreach_sends (
  campaign    TEXT NOT NULL,
  email       TEXT NOT NULL,
  provider_id TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign, email)
);

-- Email-verification gate for the PUBLIC VIP signup (added 2026-08-06; switched from a typed
-- 6-digit code to a one-click "Verify" LINK on 2026-08-07). A signup parks here first; the member
-- row + free-pie code are created only when the emailed link is opened, proving control of the
-- address. `secret_hash` is the sha256 of a 32-byte URL-safe token (never stored in the clear).
-- `poll_id` is a public, opaque id the waiting browser tab polls so it can update itself when the
-- link is opened on another device. Verified rows keep `issued_code` briefly so a second click (or
-- the waiting tab) can be shown the same code; rows are swept after they expire.
CREATE TABLE IF NOT EXISTS vip_email_verifications (
  id          BIGSERIAL PRIMARY KEY,
  business    TEXT NOT NULL,
  email       TEXT NOT NULL,            -- normalized lowercase
  secret_hash TEXT NOT NULL,            -- sha256 hex of the verification link token
  payload     JSONB NOT NULL,           -- the fully-validated signup, replayed on verify
  attempts    INT NOT NULL DEFAULT 0,   -- legacy from the typed-code flow; unused by links
  poll_id     TEXT,                     -- opaque id for the waiting tab's status poll
  verified_at TIMESTAMPTZ,              -- set when the link was opened and the member created
  issued_code TEXT,                     -- the PIE-XXXXXX handed out, for idempotent re-clicks
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Migration guards: CREATE TABLE IF NOT EXISTS is a NO-OP on a database that already has an older
-- shape of this table, so it would silently leave the columns below missing (the typed-code era
-- called secret_hash "code_hash" and had none of poll_id / verified_at / issued_code). Applying
-- these explicitly is what makes this file safe to run against an existing database.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vip_email_verifications' AND column_name = 'code_hash')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vip_email_verifications' AND column_name = 'secret_hash') THEN
    ALTER TABLE vip_email_verifications RENAME COLUMN code_hash TO secret_hash;
  END IF;
END $$;
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS poll_id     TEXT;
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS issued_code TEXT;
-- 009: the rewards-account signup riding on this verification, so ONE link confirms the email,
-- issues the free-pie code and hands the person into choosing a password.
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS account_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS vip_email_verifications_uq
  ON vip_email_verifications (business, email);
CREATE UNIQUE INDEX IF NOT EXISTS vip_email_verifications_secret_uq
  ON vip_email_verifications (secret_hash);
CREATE UNIQUE INDEX IF NOT EXISTS vip_email_verifications_poll_uq
  ON vip_email_verifications (poll_id) WHERE poll_id IS NOT NULL;

ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS sms_requested BOOLEAN NOT NULL DEFAULT FALSE;

-- Numbered migration baseline: keep fresh installs and upgrades equivalent.

-- 001_identity.sql
-- Refuses to silently merge two households; inspect duplicate email rows before retrying.
ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS sms_requested BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS vip_members_business_email_lower_uq
 ON vip_members (business, LOWER(email)) WHERE email IS NOT NULL;
UPDATE vip_members SET email = LOWER(TRIM(email)) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS rate_counters (
 bucket TEXT NOT NULL, window_start BIGINT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (bucket, window_start)
);

-- 002_order_ledger.sql
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

-- 003_accounts.sql
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

-- 004_enrollment_recovery.sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enrollment_payload JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS saved_addresses_default_uq ON saved_addresses(account_id) WHERE is_default;

-- 005_single_welcome.sql
CREATE UNIQUE INDEX IF NOT EXISTS vip_promo_member_once_uq ON vip_promo_codes(business,member_id) WHERE member_id IS NOT NULL;

-- 006_optional_marketing.sql
-- Consent can be withdrawn on both channels without deleting membership.
ALTER TABLE vip_members DROP CONSTRAINT IF EXISTS at_least_one_consent;

-- 007_broadcast_reservations.sql
-- Reserve each operator action before contacting a provider. Uncertain deliveries
-- keep their content reservation until staff reconcile the provider records.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS content_key TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_request_id_uidx ON broadcasts(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_active_content_uidx ON broadcasts(content_key) WHERE completed_at IS NULL;

-- === Campaign promo codes (2026-09-19) ===
-- Staff-run offers advertised by a blast (GAMEDAY: buy one pizza, get one free). Unlike the
-- per-member PIE-XXXXXX welcome pie in vip_promo_codes, ONE row serves every customer and is
-- never burned; each use appends to campaign_redemptions. api/lib/campaignPromo.ts also
-- creates these lazily, so a fresh database never 500s for want of them.
CREATE TABLE IF NOT EXISTS campaign_promos (
  id          BIGSERIAL PRIMARY KEY,
  business    TEXT NOT NULL,
  code        TEXT NOT NULL,                 -- staff-chosen word, A-Z 0-9 hyphen, never PIE*
  kind        TEXT NOT NULL,                 -- 'bogo_pizza'
  description TEXT NOT NULL,
  pickup_only BOOLEAN NOT NULL DEFAULT TRUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE, -- flip false to end an offer early
  starts_at   TIMESTAMPTZ,                   -- null = already open
  expires_at  TIMESTAMPTZ,                   -- null = never closes
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_promos_business_code_uq ON campaign_promos (business, code);

CREATE TABLE IF NOT EXISTS campaign_redemptions (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaign_promos(id),
  idempotency_key TEXT NOT NULL,             -- the order attempt; makes recording idempotent
  order_ref       TEXT,
  customer_phone  TEXT,
  discount_cents  INT NOT NULL DEFAULT 0,
  free_count      INT NOT NULL DEFAULT 0,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_redemptions_key_uq ON campaign_redemptions (campaign_id, idempotency_key);

-- === Scheduled broadcasts (2026-09-19) ===
-- A blast queued for a later moment. api/cron/send-scheduled.ts (every 5 min) claims due rows
-- one at a time and sends each through api/lib/broadcastRun.ts — the same core as the admin
-- dashboard's button, so every guard and audit row applies. request_id is the send core's
-- dedupe key; started_at/finished_at/result record what happened.
CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
  id          BIGSERIAL PRIMARY KEY,
  business    TEXT NOT NULL,
  subject     TEXT,
  message     TEXT NOT NULL,
  want_sms    BOOLEAN NOT NULL DEFAULT FALSE,
  want_email  BOOLEAN NOT NULL DEFAULT FALSE,
  send_at     TIMESTAMPTZ NOT NULL,
  request_id  UUID NOT NULL UNIQUE,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
