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
  CONSTRAINT at_least_one_contact CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT at_least_one_consent CHECK (sms_consent OR email_consent)
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
CREATE UNIQUE INDEX IF NOT EXISTS vip_email_verifications_uq
  ON vip_email_verifications (business, email);
CREATE UNIQUE INDEX IF NOT EXISTS vip_email_verifications_secret_uq
  ON vip_email_verifications (secret_hash);
CREATE UNIQUE INDEX IF NOT EXISTS vip_email_verifications_poll_uq
  ON vip_email_verifications (poll_id) WHERE poll_id IS NOT NULL;

-- Migration guards: CREATE TABLE IF NOT EXISTS is a NO-OP on a database that already has an older
-- shape of this table, so it would silently leave the columns below missing (the typed-code era
-- called secret_hash "code_hash" and had none of poll_id / verified_at / issued_code). Applying
-- these explicitly is what makes this file safe to run against an existing database.
ALTER TABLE vip_email_verifications RENAME COLUMN code_hash TO secret_hash;
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS poll_id     TEXT;
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS issued_code TEXT;
-- NOTE the RENAME above has no IF EXISTS in Postgres: on an already-migrated database it errors
-- with "column code_hash does not exist", which is harmless when this file is applied statement by
-- statement (the intended way) but will abort a single-transaction run. Skip that one line if you
-- are re-applying to a database that is already on the link-token shape.
