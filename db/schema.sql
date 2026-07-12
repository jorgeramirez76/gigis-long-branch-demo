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

CREATE TABLE IF NOT EXISTS vip_promo_codes (
  id            BIGSERIAL PRIMARY KEY,
  business      TEXT NOT NULL CHECK (business IN ('gigis_long_branch')),
  code          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL,        -- e.g. "10% off welcome offer"
  member_id     BIGINT REFERENCES vip_members(id),  -- null = a broadcast code shared by all members
  redeemed_at   TIMESTAMPTZ,
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
