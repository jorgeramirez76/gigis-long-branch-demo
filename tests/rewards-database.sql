DO $$
DECLARE m bigint; a bigint; o bigint; p bigint; n integer;
BEGIN
 BEGIN
  INSERT INTO vip_members(business,name,email,phone,address,addr_key,sms_consent,email_consent,consent_text,source)
    VALUES('gigis_long_branch','Rewards Test','test@example.invalid','+12025550123','Test address','test-rewards',false,false,'test','test') RETURNING id INTO m;
  INSERT INTO accounts(business,email,name,password_hash,member_id) VALUES('gigis_long_branch','test@example.invalid','Test','hash',m) RETURNING id INTO a;
  INSERT INTO vip_promo_codes(business,code,description,member_id) VALUES('gigis_long_branch','PIE-TESTQA','test',m) RETURNING id INTO p;
  INSERT INTO vip_promo_codes(business,code,description,member_id) VALUES('gigis_long_branch','PIE-TESTQB','test',m) ON CONFLICT(business,member_id) WHERE member_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'duplicate welcome code issued'; END IF;
  UPDATE vip_promo_codes SET reservation_key='first' WHERE id=p AND redeemed_at IS NULL AND reservation_key IS NULL;
  UPDATE vip_promo_codes SET reservation_key='second' WHERE id=p AND redeemed_at IS NULL AND reservation_key IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'reservation stolen'; END IF;
  UPDATE vip_promo_codes SET redeemed_at=now(),reservation_key=NULL WHERE id=p AND reservation_key='first';
  UPDATE vip_promo_codes SET reservation_key='third' WHERE id=p AND redeemed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'used pie reused'; END IF;
  INSERT INTO web_orders(business,account_id,status,items,customer_email,total)
    VALUES('gigis_long_branch',a,'paid','[{"itemName":"Test Pizza","categoryId":"pizza","quantity":2,"basePrice":2200,"options":[{"name":"Cheese","delta":100}]}]','test@example.invalid',4600) RETURNING id INTO o;
  IF (SELECT COUNT(*) FROM order_lines WHERE order_id=o)<>1 OR (SELECT unit_cents FROM order_lines WHERE order_id=o)<>2300 THEN RAISE EXCEPTION 'order capture incorrect'; END IF;
  UPDATE web_orders SET status='paid_print_queued' WHERE id=o;
  IF (SELECT COUNT(*) FROM order_lines WHERE order_id=o)<>1 THEN RAISE EXCEPTION 'history duplicated'; END IF;
  INSERT INTO account_sessions(id,account_id,expires_at,credential_version) VALUES('test-session',a,now()+interval '1 day',0);
  UPDATE accounts SET credential_version=credential_version+1 WHERE id=a;
  IF EXISTS(SELECT 1 FROM account_sessions s JOIN accounts ac ON ac.id=s.account_id WHERE ac.id=a AND s.credential_version=ac.credential_version) THEN RAISE EXCEPTION 'old credential session accepted'; END IF;
  RAISE SQLSTATE 'ZX001' USING MESSAGE='checks passed; rollback test fixtures';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
END $$
