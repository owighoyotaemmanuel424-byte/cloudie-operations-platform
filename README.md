# Cloudie Operations Platform

## Freebuff production deployment

This repository is a Vite + React application with Convex as its backend.

### Freebuff build command

Use:

```bash
npm run build:freebuff
```

Equivalent command:

```bash
npx convex deploy --cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL
```

Convex deploys the production backend, regenerates generated types, pushes the schema/functions/indexes, and runs the Vite production build.

### Required Freebuff/CI secret

Set:

```text
CONVEX_DEPLOY_KEY=<Convex production deploy key>
```

Generate this from the Convex production deployment settings. Do not expose it as a Vite/public variable.

### Required Convex production secrets

Set these in the **Convex production deployment**, not in browser/public environment variables:

```text
LOGSPANEL_API_KEY=<Logspanel API key>
```

Also configure any existing Convex authentication/payment/provider secrets required by the application.

### Public frontend variable

If Freebuff runs the combined Convex deployment command above, the production `VITE_CONVEX_URL` is injected automatically for the frontend build.

Do not put `CONVEX_DEPLOY_KEY` or `LOGSPANEL_API_KEY` into `VITE_*` variables.

### SPA hosting

The generated Vite output is `dist/`. Freebuff should serve `dist/` as an SPA so
direct routes such as `/dashboard`, `/marketplace`, and `/admin` fall back to
`index.html`.

If a host answers unknown paths with a static 404 instead (no rewrite support),
the build's `dist/404.html` still recovers: it parks the requested path in
`sessionStorage`, sends the browser to `/`, and `src/main.tsx` replays it before
the router mounts. Deep links therefore keep working with or without rewrites.

## Custom domain: cloudieexpress.duckdns.org

The domain is served from a VPS (nginx + Let's Encrypt) while Convex remains the
backend — the same production deployment the frontend already talks to.

Setup, verification, updates and rollback are documented in
[`deploy/README.md`](./deploy/README.md). In short, on the VPS:

```bash
sudo EMAIL=you@example.com ./deploy/bootstrap.sh   # nginx + certificate
sudo nano /etc/cloudieexpress/cloudieexpress.env   # set VITE_CONVEX_URL
sudo ./deploy/release.sh                           # build + publish + verify
```

The nginx site (`deploy/nginx/`) serves `index.html` and `sw.js` uncached, caches
`/assets/*` immutably, and falls back to the app shell for deep routes.

### Post-deployment smoke test

Check:

1. Landing page
2. Authentication
3. Dashboard
4. Marketplace
5. Admin login
6. Admin Marketplace
7. Logspanel catalog sync
8. Logspanel test purchase with a non-production/test product
9. Pending-order refresh
10. Logout and protected-route redirects


## InfinityFree deployment (cloudie.wuaze.com)

InfinityFree serves the static frontend only; Convex remains the application backend.

1. Build the production frontend with the production Convex URL available at build time:
   `VITE_CONVEX_URL=https://avid-raccoon-932.convex.cloud npm run build`
   (On Windows PowerShell, set the variable first with `$env:VITE_CONVEX_URL="https://avid-raccoon-932.convex.cloud"`, then run `npm run build`.)
2. Upload the **contents** of the generated `dist/` folder to the InfinityFree website document root (usually `htdocs/`). Do not upload the source folder in place of the built files.
3. Ensure the included `404.html` and `.htaccess` are uploaded alongside `index.html`.
4. Open `https://cloudie.wuaze.com` and test the landing page, sign-in, dashboard, admin routes, and any integrations that rely on production Convex functions.

The Convex URL is public frontend configuration, not a deploy key. Never put `CONVEX_DEPLOY_KEY`, provider API keys, passwords, or other secrets in `VITE_*` variables or uploaded frontend files. If authentication redirects or external integrations reject the new domain, update the relevant allowlists/configuration in the Convex deployment and provider dashboards.

This repository change does not itself upload files or prove the production build succeeds. Build and runtime testing are still required before launch.


## Neon PostgreSQL migration

The current production application still uses Convex; Neon is provisioned but has not replaced the application backend. Do not change `VITE_CONVEX_URL` or remove Convex until the backend and data migration are complete.

See [Neon migration readiness](./docs/neon-migration-readiness.md) for the verified architecture, safe migration phases, financial-integrity requirements, and InfinityFree hosting constraints.


## Neon migration work (staging only)

A separate Node API scaffold is available in [`api/`](./api/), with a Render Blueprint at [`render.yaml`](./render.yaml). The schema and current migration status are documented in [`migrations/STATUS.md`](./migrations/STATUS.md).

**Current production backend remains Convex.** The API scaffold is not yet connected to the frontend, and user credentials/data have not been migrated. The Neon schema was smoke-checked on a separate test branch only. Do not change the production frontend URL or deploy financial write operations until authentication parity, authorization, financial invariants, import reconciliation, and integration tests have been completed.
