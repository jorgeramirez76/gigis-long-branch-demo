-- Apply to each location database; safe to repeat. No existing rows are changed.
--
-- Until now these three tables existed only in db/schema.sql and in the runtime's lazy DDL
-- (api/lib/campaignPromo.ts ensureCampaignTables, api/cron/send-scheduled.ts
-- ensureScheduledTable), so a database built from the numbered migrations alone lacked them.
-- This file brings them into the migration history exactly as the runtime creates them,
-- including the columns added later. The runtime DDL stays in place: it is guarded to run once
-- per warm instance and keeps a fresh database from failing for want of a table.

-- Staff-run offers advertised by a blast (GAMEDAY: buy one pizza, get one free; STORM25: percent
-- off every pizza). One row serves every customer and is never burned.
CREATE TABLE IF NOT EXISTS campaign_promos (
  id          BIGSERIAL PRIMARY KEY,
  business    TEXT NOT NULL,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  description TEXT NOT NULL,
  pickup_only BOOLEAN NOT NULL DEFAULT TRUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at   TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_promos_business_code_uq ON campaign_promos (business, code);
ALTER TABLE campaign_promos ADD COLUMN IF NOT EXISTS percent_off INT NOT NULL DEFAULT 0;

-- One row per use; the unique key makes recording a use idempotent per order attempt.
CREATE TABLE IF NOT EXISTS campaign_redemptions (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaign_promos(id),
  idempotency_key TEXT NOT NULL,
  order_ref       TEXT,
  customer_phone  TEXT,
  discount_cents  INT NOT NULL DEFAULT 0,
  free_count      INT NOT NULL DEFAULT 0,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_redemptions_key_uq ON campaign_redemptions (campaign_id, idempotency_key);

-- A blast queued for a later moment, sent by api/cron/send-scheduled.ts through the same core
-- as the admin dashboard (api/lib/broadcastRun.ts). request_id is that core's dedupe key.
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
ALTER TABLE scheduled_broadcasts ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE scheduled_broadcasts ADD COLUMN IF NOT EXISTS promo_description TEXT;
ALTER TABLE scheduled_broadcasts ADD COLUMN IF NOT EXISTS promo_expires_at TIMESTAMPTZ;
ALTER TABLE scheduled_broadcasts ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE scheduled_broadcasts ADD COLUMN IF NOT EXISTS image_alt TEXT;
