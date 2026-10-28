> **Deployment / migration status (verified from repository):** The frontend is still Convex-dependent. The Neon API under `api/` is a migration scaffold, not yet a complete replacement for Convex data, payments, VTU providers, and wallet writes. Do not remove the remaining Convex runtime or switch customer traffic solely because the Neon API health endpoint responds; complete feature parity, test against a staging database, and plan credential/data migration first. The free-hosting build artifact is produced by `.github/workflows/infinityfree-build.yml`; it does not automatically upload files to InfinityFree `htdocs`. See `migrations/STATUS.md` and `api/README.md` before changing production routing.

# Cloudie Operations Platform

Production-ready multi-service operations platform powered by **React + Vite + TypeScript** on the frontend, **Hono + Node.js** in `api/`, and a prepared **Turso/libSQL** persistence layer. The existing Convex runtime and PostgreSQL API remain in the repository until feature-parity cutover validation is complete.

---

## Architecture Overview

| Layer | Technology / Hosting | Location |
| --- | --- | --- |
| **Frontend SPA** | React 19, Vite, TypeScript, Tailwind CSS (InfinityFree `htdocs`) | `src/`, `public/` |
| **Backend API** | Node.js 20+, Hono, Zod, JWT + Session Cookies + CSRF | `api/src/server.ts` |
| **Database** | Turso/libSQL migration layer; legacy PostgreSQL migrations retained for rollback/reference | `migrations/turso/`, `migrations/001_*.sql` |

---

## 1. Database Setup & Migrations (Turso/libSQL)

Turso credentials are server-only. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to Vercel Preview and Production environments, then run the migration runner from a trusted environment. No remote migration is claimed until it has been run against the actual database.

```bash
# List Turso migrations without connecting
npm run migrate:turso:dry-run

# Apply Turso migrations
TURSO_DATABASE_URL="libsql://your-database-your-org.turso.io" TURSO_AUTH_TOKEN="<token>" npm run migrate:turso
```

`migrations/turso/` currently contains the foundational auth/session, settings, and wallet tables. The full Convex schema and API parity migration is still required before switching production traffic; do not remove Convex or the PostgreSQL migration path yet.

### Legacy PostgreSQL migrations


Ordered SQL migrations live in [`migrations/`](./migrations/) and are managed by [`api/scripts/migrate.mjs`](./api/scripts/migrate.mjs), which acquires a PostgreSQL advisory lock and verifies SHA-256 checksums in `schema_migrations`.

```bash
# Preview ordered migrations and checksums without touching a database
npm run migrate:dry-run

# Apply migrations to Neon PostgreSQL
DATABASE_URL="postgresql://<user>:<password>@<neon-host>/<dbname>?sslmode=require" npm run migrate

# Verify table counts and relational integrity
DATABASE_URL="postgresql://<user>:<password>@<neon-host>/<dbname>?sslmode=require" npm --prefix api run reconcile
```

---

## 2. Backend API (Render: `cloudie-operations-api-stage`)

The backend service is defined in [`render.yaml`](./render.yaml) with `rootDir: api`.

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run start`
- **Health check endpoint:** `/healthz` (database readiness at `/readyz`)

### Required Render Environment Variables

| Variable | Description |
| --- | --- |
| `NODE_ENV` | `production` |
| `TURSO_DATABASE_URL` | Turso/libSQL URL, server-side only |
| `TURSO_AUTH_TOKEN` | Turso auth token, server-side only |
| `DATABASE_URL` | Legacy PostgreSQL connection string during rollback/cutover |
| `JWT_SECRET` | Random 32+ byte secret used to sign session tokens |
| `CORS_ORIGINS` | `https://cloudie.wuaze.com,http://localhost:5173,http://localhost:3000` |

### Local API Verification

```bash
npm --prefix api run typecheck
npm --prefix api test
```

---

## 3. Frontend Build & InfinityFree Deployment (`https://cloudie.wuaze.com`)

InfinityFree serves the compiled static SPA from `htdocs/` while all API requests go to Render (`VITE_NEON_API_URL`).

### Build Command

```bash
VITE_NEON_API_URL=https://cloudie-operations-api-stage.onrender.com npm run build
```

### InfinityFree Upload Checklist

1. Run the build command above to generate `dist/`.
2. Upload the **contents** of `dist/` directly into your InfinityFree `htdocs/` directory:
   - `index.html`
   - `404.html` (handles deep-link recovery when static 404s occur)
   - `.htaccess` (rewrites SPA routes to `index.html`)
   - `assets/*`, `manifest.webmanifest`, `sw.js`, and icons
3. Never place `DATABASE_URL`, `JWT_SECRET`, or provider secret keys inside `VITE_*` variables.

---

## 4. Verification & Test Suite

```bash
# Frontend TypeScript check
bunx tsc -b --noEmit

# Frontend & domain unit tests (Vitest / Bun test runner)
bun test

# Backend API TypeScript check & security/smoke test suite
npm --prefix api run typecheck
npm --prefix api test

# Live deployment smoke check against cloudie.wuaze.com & Render API
npm run smoke:live
```


---

## 5. Vercel + Turso migration checkpoint (October 2026)

The repository now includes a read-only Vercel function at `/api/turso-health`. It checks that `TURSO_DATABASE_URL` is configured and can execute `SELECT 1`; it never runs migrations or writes business data. A successful response proves connectivity only, **not** that the full Cloudie API has been migrated.

### Vercel setup

1. Import/reuse this existing Git repository in Vercel; do not create a duplicate project if one already exists.
2. Keep the root directory at the repository root. The existing Vite SPA build remains `npm run build`, output directory `dist`.
3. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as server-side Vercel environment variables for Preview and Production. Never prefix either with `VITE_`.
4. Set a random `JWT_SECRET` of at least 32 bytes for the current API runtime, and configure exact allowed origins in `CORS_ORIGINS`.
5. Deploy a preview first and request `/api/turso-health`. Expected success is HTTP 200 with `{"ok":true,"database":"turso",...}`; HTTP 503 means the database is not configured or unreachable. The endpoint intentionally does not expose provider error details.

### Important cutover gate

This checkpoint is **not** a completed production database migration. The current `api/src/server.ts` still imports `pg` and requires `DATABASE_URL`; its full route set is PostgreSQL-oriented. The frontend still has Convex dependencies and the existing README/migration inventory documents functionality not yet covered by the replacement API. The Turso schema under `migrations/turso/` is only foundational and is not equivalent to the full PostgreSQL schema or the Convex application data model.

Therefore:
- Do not switch production traffic or remove Convex/Neon credentials yet.
- Do not run a production data migration until a verified backup, complete SQLite-compatible schema, conversion of all PostgreSQL SQL/transaction behavior, and a row-by-row reconciliation plan are ready.
- Keep the existing PostgreSQL/Convex services intact as the rollback path.
- A Vercel static SPA deployment alone does not route the existing remote API calls to the new Turso backend. API parity and frontend endpoint cutover remain required.

### Migration commands

```bash
npm run migrate:turso:dry-run
# Only after TURSO_DATABASE_URL/TURSO_AUTH_TOKEN point to a non-production test database:
npm run migrate:turso
npm --prefix api run typecheck
npm --prefix api test
npm run build
```

The commands above have not been run against the user's remote Turso/Vercel resources in this session. Do not treat documentation or the health probe as proof that schema migration, data transfer, feature parity, or deployment has completed.
