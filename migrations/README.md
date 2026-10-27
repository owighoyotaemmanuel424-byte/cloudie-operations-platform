# Neon migration — phase 1 foundation

This folder starts an additive PostgreSQL foundation for users, tenant sites, wallet ledger entries, platform settings, and migration bookkeeping.

## Safety boundaries
- This is not a complete migration. The frontend and existing business logic still use Convex.
- Never put a Neon connection string in a `VITE_*` variable or browser bundle.
- Apply only to a temporary Neon development branch first; do not run against production until schema mapping, data import, and rollback are reviewed.
- IDs are text so a controlled import can preserve existing Convex IDs.
- Reconcile wallet balances against ledger history before cutover. Never derive balances from incomplete history.
- InfinityFree can serve the static Vite build, but cannot run the Node API needed for secure Neon access. A separate server-side runtime is required.

## Workflow
1. Create a temporary Neon branch.
2. Review and apply `001_foundation.sql` there.
3. Inspect tables, constraints, and indexes; add automated integration tests.
4. Complete auth/roles, tenant membership, banking accounts and double-entry ledger, deposits/withdrawals/transfers, and remaining service domains.
5. Prove import counts, financial reconciliation, and feature parity before any production cutover.

**Unverified historical claim:** a prior version stated that migrations 001–007 had been applied and recorded in `schema_migrations`. A current read-only inventory of production branch `br-winter-snow-b5spd77h` and test branch `br-nameless-morning-b5o1qitn` returned zero application tables; no migration file has yet been executed against the test branch in the current diagnostic workflow. Do not treat any migration as applied. See `STATUS.md` and run `scripts/neon-diagnose.sh` on the disposable test branch before updating migration state.