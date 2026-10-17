-- Behavior smoke test for 005_financial_integrity.sql.
-- Run only against a disposable/test database. All fixture writes are rolled back.
DO $cloudie_test$
DECLARE
  v_user_id TEXT := 'ledger-test-user-' || gen_random_uuid()::text;
  v_tenant_id TEXT := 'ledger-test-tenant-' || gen_random_uuid()::text;
  v_good_group_id TEXT := 'ledger-test-balanced-' || gen_random_uuid()::text;
  v_bad_group_id TEXT := 'ledger-test-unbalanced-' || gen_random_uuid()::text;
  v_failed BOOLEAN := FALSE;
BEGIN
  INSERT INTO app_users (id, name, email, role)
  VALUES (v_user_id, 'Ledger Integrity Test', v_user_id || '@example.invalid', 'user');

  INSERT INTO tenant_sites (id, owner_user_id, site_name, subdomain, site_type, currency)
  VALUES (v_tenant_id, v_user_id, 'Ledger Integrity Test', v_tenant_id, 'bank', 'USD');

  INSERT INTO banking_ledger_groups
    (id, tenant_id, reference, description, currency, status)
  VALUES (v_good_group_id, v_tenant_id, v_good_group_id, 'balanced test', 'USD', 'draft');

  INSERT INTO banking_ledger_entries
    (ledger_group_id, tenant_id, ledger_account_code, direction, amount_minor, currency)
  VALUES
    (v_good_group_id, v_tenant_id, 'cash', 'debit', 1000, 'USD'),
    (v_good_group_id, v_tenant_id, 'customer-liability', 'credit', 1000, 'USD');

  UPDATE banking_ledger_groups SET status = 'posted', posted_at = NOW()
  WHERE id = v_good_group_id;
  SET CONSTRAINTS ALL IMMEDIATE;

  INSERT INTO banking_ledger_groups
    (id, tenant_id, reference, description, currency, status)
  VALUES (v_bad_group_id, v_tenant_id, v_bad_group_id, 'unbalanced test', 'USD', 'draft');

  INSERT INTO banking_ledger_entries
    (ledger_group_id, tenant_id, ledger_account_code, direction, amount_minor, currency)
  VALUES (v_bad_group_id, v_tenant_id, 'cash', 'debit', 1000, 'USD');

  v_failed := FALSE;
  BEGIN
    UPDATE banking_ledger_groups SET status = 'posted', posted_at = NOW()
    WHERE id = v_bad_group_id;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'TEST FAILED: unbalanced ledger group was posted';
  END IF;

  v_failed := FALSE;
  BEGIN
    UPDATE banking_ledger_entries SET amount_minor = 2000
    WHERE ledger_group_id = v_good_group_id;
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'TEST FAILED: posted ledger entry was mutable';
  END IF;

  RAISE EXCEPTION 'CLOUDIE_TEST_ROLLBACK';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'CLOUDIE_TEST_ROLLBACK' THEN
    RAISE NOTICE 'PASS: balanced posting, unbalanced rejection, and posted-entry immutability checks completed; fixtures rolled back';
  ELSE
    RAISE;
  END IF;
END;
$cloudie_test$;
