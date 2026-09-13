CREATE UNIQUE INDEX IF NOT EXISTS vip_promo_member_once_uq ON vip_promo_codes(business,member_id) WHERE member_id IS NOT NULL;
