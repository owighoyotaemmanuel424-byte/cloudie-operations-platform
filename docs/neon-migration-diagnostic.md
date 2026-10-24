# Neon migration diagnostic — static findings

**Status: static analysis only; no `psql`, `neonctl`, or live migration run was executed from this environment.** This report must not be read as a successful application test.

## 1. Migration files and dependency order

The repository contains exactly these seven numbered SQL files, in unique lexical/numeric order:

1. `migrations/001_foundation.sql` — creates `app_users`, `tenant_sites`, `wallet_ledger`, `platform_settings`, and `schema_migrations`.
2. `migrations/002_tenant_banking.sql` — references `app_users` and `tenant_sites`; creates tenant banking and ledger groups/entries.
3. `migrations/003_core_services.sql` — references the foundation and tenant tables; creates services, shipments/events, documents, KYC, storage, catalog/orders, and notifications.
4. `migrations/004_auth_fields.sql` — alters `app_users` and adds `api_sessions`.
5. `migrations/005_financial_integrity.sql` — alters banking ledger behavior and installs functions/triggers, so it depends on migration 002.
6. `migrations/006_operations_complete.sql` — adds RBAC and operations/service/payment tables.
7. `migrations/007_admin_audit_logs.sql` — adds the audit-log table.

No duplicate numeric prefixes or order ambiguity were found. The dependency order supported by the foreign keys and migration contents is **001 → 002 → 003 → 004 → 005 → 006 → 007**. This is a static dependency assessment, not proof that the database accepts the sequence.

## 2. Static syntax scan

The following categories were inspected in all seven SQL files. Findings use the requested `file:line — category — snippet` format.

### Unescaped apostrophes in SQL string literals
- **No likely unescaped apostrophe finding identified.** The lexical scan found no unterminated single-quoted string. Ordinary single-quoted literals and PL/pgSQL exception messages appear syntactically balanced.
- This cannot substitute for PostgreSQL parsing; if the server identifies a file and line, re-check that exact context first.

### Dollar-quoted blocks
- No mismatched dollar-quote delimiter found.
- `migrations/005_financial_integrity.sql:11 — dollar-quoted function body — `AS $$` (closed at line 73 with `$$;`).`
- `migrations/005_financial_integrity.sql:78 — dollar-quoted function body — `AS $$` (closed at line 90 with `$$;`).`
- `migrations/005_financial_integrity.sql:95 — dollar-quoted function body — `AS $$` (closed at line 104 with `$$;`).`
- `migrations/005_financial_integrity.sql:121 — dollar-quoted function body — `AS $$` (closed at line 147 with `$$;`).`
- `migrations/005_financial_integrity.sql:157 — dollar-quoted function body — `AS $$` (closed at line 166 with `$$;`).`
- No other numbered migration contains dollar-quoted blocks.

### Reserved-word collisions in identifiers
- **No finding** for unquoted table, column, or constraint identifiers named `apply`, `user`, `order`, `group`, `limit`, or `offset` was identified in the DDL declarations.
- The words `apply` and `user` appear in comments, string values, or application function names; these are not unquoted SQL identifier declarations.

### Requested finding format
There are no positive findings to report in the form `file:line — category — snippet` for an unescaped apostrophe, mismatched dollar quote, or named reserved-word collision. The five dollar-quote pairs above are correctly matched and are listed as inspected blocks, not defects.

## 3. Migration runner and the reported token `apply`

- Runner: `api/scripts/migrate.mjs`.
- Root scripts in `package.json`: `migrate` → `node api/scripts/migrate.mjs`; `migrate:dry-run` → `node api/scripts/migrate.mjs --dry-run`.
- `api/scripts/migrate.mjs:125` only logs `[migrate] Applying ${migration.filename}...`.
- `api/scripts/migrate.mjs:126` checks whether the file begins with an explicit `BEGIN;`.
- `api/scripts/migrate.mjs:132` executes the file text using `await client.query(migration.sql)`.
- `api/scripts/migrate.mjs:139` commits only when the runner itself opened the transaction.

The runner does **not** wrap the SQL in an `apply(...)` call. The word `apply` found in the numbered migration files appears in comments, not executable SQL. Therefore the static evidence does not explain a PostgreSQL parser error reported near `apply`. The previous preparation-tool error is not a PostgreSQL filename/line diagnosis. Do not patch a migration until the direct `psql` diagnostic captures the exact file, line, and server message.

## 4. Status document versus database inventory

The previous version of `migrations/STATUS.md` claimed all seven files were applied to `neondb` on 2026-10-19, that `schema_migrations` held checksums, and that migration behavior/API end-to-end tests passed. The repository contains all seven corresponding SQL files.

A separate read-only Neon table inventory returned an empty list of application tables. These statements conflict unless they refer to different Neon branches/endpoints, a different database/schema, or stale records. The empty inventory does not identify which explanation is correct.

The status document has now been revised to say:

> The migrations in this directory have not been confirmed to apply cleanly against the live Neon database. Run `scripts/neon-diagnose.sh` to establish the actual state before treating this file as a record of applied migrations.

The original seven-item inventory and historical route inventory remain visible but are labeled unverified.

## 5. Diagnostic script committed

`scripts/neon-diagnose.sh` is committed. It requires `TEST_DATABASE_URL`, `NEON_TEST_BRANCH_NAME=test-migrations`, and `NEON_TEST_BRANCH_ID`; refuses the known production branch ID `br-winter-snow-b5spd77h`; rejects common pooled-connection indicators; requires database name `neondb`; runs each of the seven SQL files individually with `psql -X -v ON_ERROR_STOP=1 -f`; repeats the entire sequence to test idempotency; and inspects `schema_migrations` and public base tables if present.

**Important limitation:** branch name/ID are operator-supplied values; a connection URL cannot be cryptographically bound to that ID by this shell script alone. Verify the test branch and endpoint in Neon Console before execution. The script is a file-by-file diagnostic, not the checksum-aware migration runner, and it does not record successful application in the runner's checksum format by itself.

## 6. Human verification required

Run only against a disposable Neon branch, using its direct (non-pooled) endpoint. Follow the exact required environment values described at the top of `scripts/neon-diagnose.sh`. Capture the complete terminal output from the first failing file; do not continue to guess or patch.

After both direct passes succeed, separately run the checksum-aware runner and its tests against that same test branch. Do not treat the direct `psql` rerun as proof that the runner's `schema_migrations` checksum logic or the API E2E path is correct.

## 7. Proposed SQL patch

**None proposed.** Static analysis has not identified a likely syntax defect. A patch before a filename/line-level failure is captured would be speculation.
