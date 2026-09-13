-- Consent can be withdrawn on both channels without deleting membership.
ALTER TABLE vip_members DROP CONSTRAINT IF EXISTS at_least_one_consent;
