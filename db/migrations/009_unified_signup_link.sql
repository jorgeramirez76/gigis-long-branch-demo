-- One order, one email, one link: a rewards-account signup rides on the VIP verification link
-- this email is already holding instead of triggering a second "Finish your account" email.
ALTER TABLE vip_email_verifications ADD COLUMN IF NOT EXISTS account_payload JSONB;
