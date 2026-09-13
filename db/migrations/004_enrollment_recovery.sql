ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enrollment_payload JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS saved_addresses_default_uq ON saved_addresses(account_id) WHERE is_default;
