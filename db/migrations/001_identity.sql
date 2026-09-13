-- Refuses to silently merge two households; inspect duplicate email rows before retrying.
ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS sms_requested BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS vip_members_business_email_lower_uq
 ON vip_members (business, LOWER(email)) WHERE email IS NOT NULL;
UPDATE vip_members SET email = LOWER(TRIM(email)) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS rate_counters (
 bucket TEXT NOT NULL, window_start BIGINT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (bucket, window_start)
);
