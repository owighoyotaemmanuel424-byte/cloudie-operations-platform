# Cloudie architecture and implementation decisions

## Boundaries
- `apps/web`: Next.js App Router, session boundary, UI, server-rendered pages and thin same-origin routes.
- `apps/api`: Fastify business API, OpenAPI, Socket.IO, Redis adapter, queue workers and integrations.
- `packages/db`: Prisma/PostgreSQL schema and the only points balance mutation service.
- `packages/config`: workspace registry, action costs and validated environment parsing.
- `packages/ui`: shared shadcn-compatible UI components.
- PostgreSQL is authoritative for ledger and business records. Redis is pub/sub/cache/queue infrastructure, never the ledger of record. Private S3-compatible storage holds documents and assets.

## Ledger invariants
1. All point changes use `applyLedgerEntry()` in `packages/db/src/ledger.ts`.
2. A PostgreSQL row lock, balance check, balance update and immutable ledger insert share one serializable transaction.
3. Idempotency keys are mandatory and unique; conflicting reuse is rejected.
4. Refunds link to the original entry. A unique reversal relation prevents duplicate reversal.
5. Events publish after commit. Add a transactional outbox before claiming guaranteed delivery or enabling production top-ups; a Redis outage must never roll back a committed charge.
6. Never mutate `User.pointsBalance` outside the ledger engine. Admin overrides must combine ledger and mandatory-reason audit log in one transaction in the admin service.

## Security decisions
- The API never trusts client-supplied user IDs for Socket.IO rooms. Wire a shared verified session/JWT guard before enabling private rooms or SSE.
- Payment processing is disabled by default. Signed provider webhooks must confirm deposits idempotently through the ledger.
- The requested seed login `admin@cloudie.dev / password` is development-only; production seed rejects the default password.
- Private S3 objects use short-lived signed URLs; public bucket access remains disabled.
- Every admin mutation requires a non-empty reason and an audit row in the same database transaction.
- Tenant lockdown must be enforced server-side, not only displayed in UI.

## Deployment strategy
This foundation lives under `cloudie/` on `feat/cloudie-modular-saas-foundation` so the existing Cloudie app and current production integration remain untouched until staging verification. Do not cut over or direct production financial writes into an unverified schema.

## Point schedule
| Action | Points | Workspace |
|---|---:|---|
| Shipment create | 10 | SHIPMENTS |
| Shipment tracking update | 2 | SHIPMENTS |
| PDF generation | 15 | TICKETING |
| Email send | 1 | SERVICES |
| Image render | 3 | SERVICES |
| Tenant monthly renewal | 200 | BUSINESS |

No fixed user subscriptions are introduced; tenant monthly renewal is the only scheduled workspace charge.
