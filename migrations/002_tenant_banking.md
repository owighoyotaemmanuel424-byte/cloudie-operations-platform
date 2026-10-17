# Migration 002 — tenant banking

Adds tenant membership, tenant accounts, beneficiaries, deposits, withdrawals, transfers, and double-entry ledger groups/entries.

## Financial invariants to enforce in server code
- Use integer minor units for account balances and banking operations; never floating-point currency math.
- Every posted ledger group must balance: total debit equals total credit per currency, with at least two entries.
- Enforce account ownership and tenant membership on every operation.
- Use unique idempotency keys for retry-safe writes; process balance changes and ledger posting atomically in one database transaction.
- Do not mark a deposit/withdrawal/transfer completed before its corresponding ledger group is posted and reconciled.
- Do not trust client-supplied roles, account IDs, balances, or transaction status.
- Use a provider/webhook signature check and replay protection before accepting external payment confirmations.

This migration is additive and has not been applied to Neon. Test it on a temporary Neon branch first.