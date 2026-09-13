-- Reserve each operator action before contacting a provider. Uncertain deliveries
-- keep their content reservation until staff reconcile the provider records.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS content_key TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_request_id_uidx ON broadcasts(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_active_content_uidx ON broadcasts(content_key) WHERE completed_at IS NULL;
