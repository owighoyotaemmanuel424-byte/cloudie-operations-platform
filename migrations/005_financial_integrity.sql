-- Cloudie Neon migration phase 5: enforce balanced, immutable posted ledger groups.
-- Apply to a disposable/test branch first. Financial writes remain disabled in the API.
-- New ledger groups must start as drafts; entries are added before posting.
BEGIN;

ALTER TABLE banking_ledger_groups ALTER COLUMN status SET DEFAULT 'draft';

CREATE OR REPLACE FUNCTION cloudie_assert_ledger_group_balanced(p_group_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_entry_count BIGINT;
  v_bad_currency_count BIGINT;
  v_bad_tenant_count BIGINT;
  v_bad_group_currency_count BIGINT;
BEGIN
  SELECT status INTO v_status
  FROM banking_ledger_groups
  WHERE id = p_group_id;

  IF NOT FOUND OR v_status <> 'posted' THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_entry_count
  FROM banking_ledger_entries
  WHERE ledger_group_id = p_group_id;

  IF v_entry_count < 2 THEN
    RAISE EXCEPTION 'Posted ledger group % must contain at least two entries', p_group_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO v_bad_currency_count
  FROM (
    SELECT currency
    FROM banking_ledger_entries
    WHERE ledger_group_id = p_group_id
    GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)
        <> SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)
  ) unbalanced;

  IF v_bad_currency_count > 0 THEN
    RAISE EXCEPTION 'Posted ledger group % is not balanced per currency', p_group_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO v_bad_group_currency_count
  FROM banking_ledger_entries e
  JOIN banking_ledger_groups g ON g.id = e.ledger_group_id
  WHERE e.ledger_group_id = p_group_id
    AND e.currency <> g.currency;

  IF v_bad_group_currency_count > 0 THEN
    RAISE EXCEPTION 'Ledger entries in group % must match the group currency', p_group_id
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO v_bad_tenant_count
  FROM banking_ledger_entries e
  JOIN banking_ledger_groups g ON g.id = e.ledger_group_id
  WHERE e.ledger_group_id = p_group_id
    AND e.tenant_id <> g.tenant_id;

  IF v_bad_tenant_count > 0 THEN
    RAISE EXCEPTION 'Ledger entries in group % must belong to the same tenant', p_group_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION cloudie_check_ledger_group_from_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM cloudie_assert_ledger_group_balanced(OLD.ledger_group_id);
  ELSE
    PERFORM cloudie_assert_ledger_group_balanced(NEW.ledger_group_id);
    IF TG_OP = 'UPDATE' AND OLD.ledger_group_id <> NEW.ledger_group_id THEN
      PERFORM cloudie_assert_ledger_group_balanced(OLD.ledger_group_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION cloudie_check_ledger_group_from_header()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM cloudie_assert_ledger_group_balanced(OLD.id);
  ELSE
    PERFORM cloudie_assert_ledger_group_balanced(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS banking_ledger_entries_balanced_deferred ON banking_ledger_entries;
CREATE CONSTRAINT TRIGGER banking_ledger_entries_balanced_deferred
AFTER INSERT OR UPDATE OR DELETE ON banking_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cloudie_check_ledger_group_from_entry();

DROP TRIGGER IF EXISTS banking_ledger_groups_balanced_deferred ON banking_ledger_groups;
CREATE CONSTRAINT TRIGGER banking_ledger_groups_balanced_deferred
AFTER INSERT OR UPDATE ON banking_ledger_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cloudie_check_ledger_group_from_header();

CREATE OR REPLACE FUNCTION cloudie_prevent_posted_ledger_entry_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_id TEXT;
  v_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_group_id := OLD.ledger_group_id;
    SELECT status INTO v_status FROM banking_ledger_groups WHERE id = v_group_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'Entries in posted ledger group % are immutable; post a compensating reversal instead', v_group_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_group_id := NEW.ledger_group_id;
    SELECT status INTO v_status FROM banking_ledger_groups WHERE id = v_group_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'Entries in posted ledger group % are immutable; post a compensating reversal instead', v_group_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS banking_ledger_entries_immutable_posted ON banking_ledger_entries;
CREATE TRIGGER banking_ledger_entries_immutable_posted
BEFORE INSERT OR UPDATE OR DELETE ON banking_ledger_entries
FOR EACH ROW EXECUTE FUNCTION cloudie_prevent_posted_ledger_entry_mutation();

CREATE OR REPLACE FUNCTION cloudie_prevent_posted_ledger_group_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted ledger group % is immutable; create a compensating reversal group instead', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS banking_ledger_groups_immutable_posted ON banking_ledger_groups;
CREATE TRIGGER banking_ledger_groups_immutable_posted
BEFORE UPDATE OR DELETE ON banking_ledger_groups
FOR EACH ROW EXECUTE FUNCTION cloudie_prevent_posted_ledger_group_mutation();

COMMIT;
