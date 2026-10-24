# Cloudie modular SaaS foundation

Cloudie is a five-workspace platform (Personal, Shipments, Ticketing, Business Suite, Services) with usage-based points. The new monorepo lives under `cloudie/` to keep the existing application untouched while this foundation is validated.

## Prerequisites
Node.js 20.11+ (22 recommended), pnpm 9+, Docker Compose.

## Local setup
1. Copy `.env.example` to `.env`; replace secrets before exposing services.
2. From this directory, run `docker compose -f infra/docker-compose.yml up -d postgres redis minio`.
3. Run `corepack enable && pnpm install`.
4. Generate Prisma client: `pnpm db:generate`.
5. Create/apply the initial migration: `pnpm db:migrate -- --name init`.
6. Seed development admin/vendor: `pnpm db:seed`.
7. Start services with `pnpm dev`.

Local seed login: `admin@cloudie.dev / password`. Never use this password in production.

## Foundation milestone
- Workspace registry and canonical billable action costs.
- Prisma models for users, workspaces, ledger, shipments, tenants, vendors, disputes, audit, deposits, KYC, assets, email campaigns and notifications.
- Ledger transaction service with row locking, balance validation, idempotency and refund helper.
- Fastify API foundation, health/readiness, OpenAPI UI, Redis-backed rate limit and Socket.IO Redis adapter.
- Docker Compose for PostgreSQL, Redis, MinIO, API and web.

## API documentation
Once API is running, open http://localhost:4000/docs.

## Deployment guide
- Web: Vercel; configure the monorepo root as `cloudie` and deploy `apps/web`.
- API: Railway/Fly.io from `infra/Dockerfile.api`, health check `/health`, secrets set in provider dashboard.
- Database: PostgreSQL/Neon; set `DATABASE_URL` and `DIRECT_URL`.
- Redis: Upstash or managed Redis; configure TLS URL if required.
- Storage: AWS S3 or private MinIO-compatible service. Keep bucket private.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before enabling payment providers. Payments are off by default, private socket/SSE authentication must be completed, and a transactional outbox is needed for guaranteed event delivery. This is the foundation milestone, not a claim that every workspace workflow is complete.
