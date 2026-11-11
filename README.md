# Cloudie Operations Platform

A unified multi-workspace enterprise portal built from the Cloudie platform architecture
specification. Customers sign in once and move between five workspaces — all drawing on one
verified points ledger.

**Stack:** React 19 · Vite · TypeScript · Tailwind CSS v4 · shadcn/ui · React Router · Framer Motion.

## Workspaces

| Workspace | Capabilities |
| --- | --- |
| **Personal** | Points balance, filterable transaction ledger, crypto top-up packs, vendor marketplace, order live chat, referral dashboard |
| **Shipments** | Three-step shipment wizard, live parcel tracker, status pushes, public tracking link |
| **Ticketing** | Flight and hotel booking managers, invoice composer, native PDF rendering, shareable document links |
| **Business Suite** | Tenant portal deployment, plan tiers, KYC configuration, product switches, portal user management, recurring renewal billing |
| **Services** | Template email composer priced per recipient, send log, graphics rendering studio with SVG export |

## Quick start

```bash
bun install
bun run dev        # http://localhost:3000
bunx tsc -b --noEmit
```

Demo account: **demo@cloudie.africa** / **cloudie123** — seeded with a live shipment, a rendered
itinerary, a deployed portal and a sent campaign.

New accounts start with 1,000 points; referring another account credits 250 points to the referrer.

## Architecture

```
src/
├── main.tsx              # routes: landing, auth, /app shell, public tracking & documents
├── app/                  # workspace screens + application shell
│   ├── AppShell.tsx      # session gate, workspace switcher, sidebar, notifications
│   ├── Personal.tsx      # balance, ledger, marketplace, chat, referrals
│   ├── Shipments.tsx     # wizard, tracker, public link, status updates
│   ├── Ticketing.tsx     # flight / hotel / invoice composers
│   ├── DocumentSheet.tsx # print sheet + PDF download (src/lib/pdf.ts engine)
│   ├── Business.tsx      # tenant portals, KYC, portal users, renewals
│   ├── Services.tsx      # campaigns, send log, studio
│   └── Public*.tsx       # unauthenticated tracking and document pages
├── platform/
│   ├── model.ts          # domain types, workspace registry, pricing content
│   ├── store.ts          # versioned durable snapshot + BroadcastChannel realtime bus
│   ├── engine.ts         # points ledger, sessions, ownership ACL, workspace operations
│   ├── Provider.tsx      # session/theme/realtime React context
│   ├── format.ts         # points, currency, date helpers
│   └── ui.tsx            # motion + layout primitives
├── components/ui/        # shadcn primitives
└── lib/pdf.ts            # first-party PDF writer (standard-14 fonts, no dependencies)
```

### Ledger rule

Every billable action calls `charge()` in `platform/engine.ts` **before** its record is written:

- shipment registration — `120 + weight × 8`, scaled by service level
- document render — fixed per document type (25–75 pts)
- email dispatch — 2 pts per deduplicated recipient
- portal deployment / renewal — 1,200–4,800 setup, 900–3,600 per 30-day cycle

If the balance is insufficient the transaction throws `INSUFFICIENT_POINTS` and nothing is written.
Every charge is posted by the server as a balanced double-entry group; a rejected charge writes nothing.

### Session & access control

Authentication is server-side: scrypt password digests in `app_users`, a short-lived HS256 JWT bound to a
revocable `api_sessions` row, HttpOnly `SameSite=Lax` cookies, and a double-submit CSRF token plus Origin
checks on cookie-authenticated writes. Registration, login, logout, password reset and admin RBAC live in
`backend/src/server.ts`; authorisation runs on the server for every privileged route.

Every shipment, document, portal, order and notification read is scoped to the authenticated owner in SQL.
Tenant routes also accept portal membership and answer 404 for foreign tenants. Public pages
(`/track/:token`, `/d/:token`) resolve only through opaque public tokens and never expose contact details.

---

# Phase 2 — Turso backend integration

The five workspaces now run against a real, persistent Turso (libSQL) database. The browser no longer owns
financial state: `src/platform/store.ts` is a cache of the last snapshot returned by
`GET /api/platform/bootstrap`, and `src/platform/engine.ts` calls the API for every mutation before
re-hydrating. LocalStorage keeps only the UI theme.

## Layout

| Piece | Path |
| --- | --- |
| API (Hono + libSQL) | `backend/src/server.ts`, `backend/src/platform.ts`, `backend/src/db.ts` |
| Vercel Node function | `api/[...path].ts` (`/api/*`, `/health`, `/ready`) |
| Migrations | `migrations/turso/001`–`008`, applied by `backend/scripts/migrate-turso.mjs` |
| Frontend client | `src/platform/api.ts` |
| UI cache + commands | `src/platform/store.ts`, `src/platform/engine.ts` |
| End-to-end check | `backend/src/platform.check.ts` |

## Persistence

Migration `008_platform_rebuild.sql` is additive and non-destructive: legacy tables are left untouched and
no production data is dropped. It adds `platform_shipments`, `platform_shipment_events`,
`platform_documents`, `platform_listings`, `platform_orders`, `platform_order_messages`,
`platform_campaigns`, `platform_notifications`, `platform_deposits`, `platform_point_packs`,
`tenant_portal_users`, `password_reset_tokens`, the points ledger tables, and the rebuilt tenant-portal
columns. Users, sessions, wallet ledger, shipments, documents, orders, tenants, campaigns, notifications and
audit logs all persist in Turso.

## Points ledger rules

- One business action = one `points_ledger_groups` row plus signed `points_ledger_entries` that must sum to
  zero. A SQLite trigger refuses to post an unbalanced group or a group with fewer than two entries.
- Balance is computed from **posted** entries inside the same write transaction before a debit is allowed;
  `app_users.points_balance` is only a cache refreshed from the ledger.
- `idempotency_key` is unique per group: a retried request is answered `409` instead of charging twice.
- Posted groups and entries are immutable (triggers block UPDATE/DELETE). Refunds create a new reversing
  group; history is never edited.
- Prices are computed on the server (shipments by weight/service, documents by type, campaigns per
  recipient, portal setup/renewal by plan, marketplace from the seeded listing table).

## API surface

| Area | Routes |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/logout`, `/password-reset/request`, `/password-reset/confirm`, `GET /api/auth/csrf`, `GET /api/me` |
| Platform read | `GET /api/platform/bootstrap`, `GET /api/platform/points/ledger` |
| Points | `POST /api/platform/points/deposit`, `POST /api/platform/admin/deposits/:id/settle`, `POST /api/platform/admin/refund` |
| Shipments | `POST /api/platform/shipments`, `PATCH /api/platform/shipments/:id/advance`, `GET /api/platform/track/:token` (public) |
| Documents | `POST /api/platform/documents`, `GET /api/platform/documents/:token` (public) |
| Marketplace | `POST /api/platform/orders`, `POST /api/platform/orders/:id/messages` |
| Campaigns | `POST /api/platform/campaigns` |
| Tenants | `POST /api/platform/tenants`, `PATCH /api/platform/tenants/:id`, `/renew`, `/users`, `DELETE /api/platform/tenants/:id/users/:userId` |
| Notifications / profile | `POST /api/platform/notifications/read-all`, `PATCH /api/platform/notifications/:id/read`, `PATCH /api/platform/profile` |

Every write route validates input with Zod, rate-limits per IP, checks ownership in SQL, and returns
`401`/`403`/`404`/`409` rather than leaking another account's data.

## Running locally

```bash
bun install
bun run dev            # Vite + the Hono/Turso API mounted in-process
```

With no `TURSO_DATABASE_URL`, the dev server creates `.data/cloudie.db` and applies the same migrations the
hosted database uses. Point it at Turso instead by exporting `TURSO_DATABASE_URL` (and `TURSO_AUTH_TOKEN`),
then run `bun run migrate:turso` once.

## Environment variables (server only)

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://…` URL of the Turso database |
| `TURSO_AUTH_TOKEN` | Turso database token |
| `JWT_SECRET` | Signing key for session JWTs (≥ 32 bytes, required) |
| `FRONTEND_URL` | Canonical production origin, added to the CORS allowlist |
| `CORS_ORIGINS` | Comma-separated additional allowed origins |
| `PASSWORD_RESET_WEBHOOK_URL` | Optional mail/webhook transport for reset tokens |

None of these are prefixed with `VITE_`, so none reach the browser bundle. In development a fixed local
JWT key and a file database are used automatically.

## Deploying to Vercel

1. Set the five variables above in **Project → Settings → Environment Variables** (Production and Preview).
2. Apply migrations once from a trusted machine:
   ```bash
   TURSO_DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" bun run migrate:turso
   ```
3. Deploy. `vercel.json` builds the Vite SPA to `dist/` and keeps `/api/*` on the Node function
   `api/[...path].ts`; the SPA fallback rewrite excludes `/api`. `api/turso-health.js` reports whether the
   database is reachable and the required schema is present.

## Verification performed

```bash
bun run typecheck:api     # backend tsc — passes
bunx tsc -b --noEmit      # frontend tsc — passes
bun run build             # Vite production build — passes
bun run test:platform     # 35 checks — passes
```

`test:platform` runs the real Hono app against a real libSQL database with all eight migrations and verifies:
registration and session bootstrap, the 1,000-point welcome credit, server-priced shipment charge,
idempotent retry rejection, insufficient-balance rejection with no balance movement, status updates, public
tracking without a session (and without contact details), document rendering and public document links,
campaign per-recipient pricing, marketplace pricing, pending (uncredited) top-ups, admin settlement,
portal deployment and invitations, cross-account isolation on shipments/tenants/orders, admin refunds,
ledger immutability at the SQL layer, and password reset (old password rejected, new one accepted).

A separate HTTP smoke test through `bun run dev` confirmed the built SPA, `/api/public-config`, registration,
bootstrap (1,000 points, one ledger entry) and shipment creation over the real Vite dev server.

## Known limitations

- A top-up is recorded as a `pending` deposit and credited only when an operator settles it — there is no
  payment processor wired to these packs, so nothing is auto-credited or faked.
- Campaigns are persisted as `queued`; no email transport is configured, so nothing claims they were sent.
- Password reset issues hashed, expiring tokens; delivery requires `PASSWORD_RESET_WEBHOOK_URL` (the API
  answers `503` in production when it is unset rather than pretending to send mail).
- There is no dedicated password-reset or admin screen in the UI yet; those routes are API-only.
- No production Turso credentials were available here, so no existing deployment or data was touched. The
  Vercel project was prepared but not deployed.

## Notes

The legacy Convex sources in `src/convex/` remain for reference and are not used by the running
application. `backend/` and `migrations/` are now the live backend.
