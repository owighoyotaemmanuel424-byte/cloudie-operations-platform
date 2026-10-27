> **Deployment / migration status (verified from repository):** The frontend is still Convex-dependent. The Neon API under `api/` is a migration scaffold, not yet a complete replacement for Convex data, payments, VTU providers, and wallet writes. Do not remove the remaining Convex runtime or switch customer traffic solely because the Neon API health endpoint responds; complete feature parity, test against a staging database, and plan credential/data migration first. The free-hosting build artifact is produced by `.github/workflows/infinityfree-build.yml`; it does not automatically upload files to InfinityFree `htdocs`. See `migrations/STATUS.md` and `api/README.md` before changing production routing.

# Cloudie Operations Platform

Production-ready multi-service operations platform powered by **React + Vite + TypeScript** on the frontend, **Hono + Node.js** on Render (`api/`), and **Neon PostgreSQL** (`migrations/`).

---

## Architecture Overview

| Layer | Technology / Hosting | Location |
| --- | --- | --- |
| **Frontend SPA** | React 19, Vite, TypeScript, Tailwind CSS (InfinityFree `htdocs`) | `src/`, `public/` |
| **Backend API** | Node.js 20+, Hono, Zod, `pg`, JWT + Session Cookies + CSRF (Render) | `api/src/server.ts`, `render.yaml` |
| **Database** | Neon PostgreSQL with ordered SHA-256 verified migrations | `migrations/001_*.sql` – `006_*.sql` |

---

## 1. Database Setup & Migrations (Neon PostgreSQL)

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

## 2. Backend API (Render: `cloudie-glaa`)

The backend service is defined in [`render.yaml`](./render.yaml) with `rootDir: api`.

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start`
- **Liveness endpoint:** `/health` (process only; never touches PostgreSQL)
- **Readiness endpoint:** `/ready` (real `SELECT 1` against Neon; `503` when the database is unreachable)

### Required Render Environment Variables

| Variable | Description |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon PostgreSQL connection string (`sslmode=require`) |
| `JWT_SECRET` | Random 32+ byte secret used to sign session tokens (32 bytes minimum) |
| `CORS_ORIGINS` | `https://cloudie.wuaze.com` |
| `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` | Optional, one-time. Random 32+ byte secret that enables `POST /api/auth/bootstrap-admin` while no administrator exists. Remove it after the first administrator is created. |

### First administrator (one-time bootstrap)

No administrator is created automatically and no default password exists. The full operator procedure, safety properties and failure handling are in [`docs/neon-first-admin-setup.md`](./docs/neon-first-admin-setup.md).

1. Set `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` to a fresh secret (`openssl rand -hex 32`) in the API host. Never commit it or expose it as a `VITE_*` variable.
2. `POST /api/auth/bootstrap-admin` once with `name`, `email`, `password` (12+ characters) and `token`. It creates the administrator together with its session and audit row in a single transaction, refused once any administrator exists.
3. Expect `201`; `401` means a wrong token, `409` means an administrator (or that email) already exists, and `503` means the token is absent or shorter than 32 bytes.
4. Delete `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` from the API host and redeploy. The endpoint then returns `503` permanently.

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
# Optional: the default already targets the production API.
VITE_NEON_API_URL=https://cloudie-glaa.onrender.com npm run build
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

## 4. Verification

Run the four local typecheck and unit-test commands in order with the repository script:

```bash
bash scripts/verify.sh
```

The script runs:

```bash
bunx tsc -b --noEmit
bun test
npm --prefix api run typecheck
npm --prefix api test
```

The frontend uses Bun's built-in test runner; no Vitest or Jest runner is configured. To invoke the script directly after checkout, run `chmod +x scripts/verify.sh` once, then `./scripts/verify.sh`.

The script reports success only if all four commands exit zero. It does **not** prove live Convex purchase behavior. Separately verify a real buy → escrow → credited cycle and an insufficient-wallet rejection against a deployed Convex environment. A live deployment smoke check can also be run with `npm run smoke:live`.

**Live backend verification** (manual only; not run in CI):
1. Deploy a Convex dev environment and prepare a buyer test account with sufficient NGN wallet balance and a separate approved vendor test account that owns the selected package. The buyer and vendor must be different accounts because only the approved vendor can fulfill the order.
2. Set `CONVEX_URL`, `BUYER_AUTH_TOKEN`, `VENDOR_AUTH_TOKEN`, and `TEST_PACKAGE_ID` in your environment. The buyer token must belong to the buyer test user; the vendor token must belong to the approved vendor who owns the package. The script resolves `TEST_PACKAGE_ID` against the typed package query instead of casting the environment string to a Convex ID.
3. Run `bun run verify:convex`. The script uses the buyer client for `createOrder` and the vendor client for `fulfillOrder`; both clients verify the same order's escrow and credited states.
4. When prompted for the insufficient-funds check, lower the buyer's wallet below the package price using the approved test setup/admin workflow, then press Enter. The script expects the error message `Insufficient NGN wallet balance`.

This script requires credentials and mutable test data and is intentionally not run in CI.
