# Convex-to-Neon route and dependency audit (baseline)

**Audit date:** 2026-10-17  
**Baseline commit:** `13b8b920449a3a8cc076447548563452dd828990`  
**Latest documented source baseline:** `e7471f394d1eee95e5ca87768abbd17c926a3355`  
**Purpose:** Inventory the routed frontend surfaces and Convex module families before migration. This is a source-tree audit baseline, not proof that every hook call has been traced. Do not remove Convex fallback or enable financial writes based on this document.

## Verified cross-cutting dependencies

| Surface | Current evidence | Status / gate |
|---|---|---|
| App bootstrap | `src/main.tsx` creates `ConvexReactClient` and wraps routes in `ConvexAuthProvider` | Convex auth remains active |
| Authentication | `src/hooks/use-auth.ts`, `src/pages/Auth.tsx`, `src/pages/AdminLogin.tsx` | Convex sign-in / user initialization remains the production path |
| Neon auth scaffolding | `src/hooks/use-neon-auth.ts`, `src/lib/neonApi.ts` | Not production cutover: API URL is cross-origin; token is stored in sessionStorage and bearer Authorization is sent |
| Neon API | `api/src/server.ts` | Partial API coverage only; cookie set on auth routes, but login/register also return token JSON |
| Financial actions | Convex wallet/VTU/payment/provider families | Writes must remain disabled for Neon until all financial gates have tested evidence |
| Staging | `/health` endpoint exists in API source | Live response and deployed commit must be checked separately |

## Route/screen inventory

The route list below is taken from the repository's `src/pages` source tree. Where the exact route declaration or every hook call has not been independently traced in this pass, the likely domain is marked as a review target rather than a confirmed one-to-one dependency. Confirm exact paths in `src/main.tsx` and imports before migrating each screen.

| Screen / page source | Domain | Migration status | Convex module families to trace |
|---|---|---|---|
| `Landing.tsx`, `NotFound.tsx` | Public routing | Keep current behavior | tenant resolver / platform config if used |
| `Auth.tsx`, `AdminLogin.tsx` | Auth and routing | Convex auth active; do not cut over | auth, users, admin |
| `Dashboard.tsx`, `Personal.tsx`, `Settings.tsx`, `Notifications.tsx` | Customer profile/dashboard | Neon read APIs exist for profile/notifications; UI parity unverified | users, organization, notifications, tenants |
| `Wallet.tsx`, `Transactions.tsx`, `Billing.tsx`, `BuyPoints.tsx` | Wallet, ledger, billing | Read-only Neon ledger endpoint exists; writes remain blocked | wallet, points, paystack, paymentConfig, tenantTransfers |
| `Orders.tsx`, `Marketplace.tsx`, `MyServices.tsx`, `Services.tsx` | Commerce/catalog/services | Neon catalog and orders reads exist; complete UI parity unverified | marketplace, catalog, serviceHub, pricing |
| `Referrals.tsx`, `Support.tsx`, `Ticketing.tsx`, `Vendor.tsx` | Referrals, support, vendors | Convex fallback required until API + E2E are green | referrals, support, tenants, marketplace |
| `VtuAirtime.tsx`, `VtuBills.tsx`, `VtuCatalog.tsx`, `VtuData.tsx`, `VtuElectricity.tsx`, `VtuExamPins.tsx`, `VtuHistory.tsx`, `VtuPurchase.tsx` | VTU products and purchases | Convex-dependent until domain-specific parity and safeguards verified | vtu*, vtuCatalog*, vtuProvider*, wallet, pricing |
| `Shipments.tsx`, `NewShipment.tsx`, `ShipmentDetail.tsx`, `ShipmentUpdateForm.tsx`, `ShipmentUpdates.tsx`, `PublicTracking.tsx` | Shipments and tracking | Convex fallback required | shipments, tracking*, tenants |
| `Documents.tsx`, `DocumentDetail.tsx`, `DocumentBuilder.tsx`, `DocumentGenerator.tsx`, `DocumentTemplates.tsx`, `OwnDocumentTemplate.tsx`, `PublicDocument.tsx`, `CustomsDocument.tsx`, `FlightDocument.tsx`, `HotelDocument.tsx`, `InvoiceDocument.tsx` | Documents and templates | Convex fallback required | documents, docTemplates, docTemplateAdmin, uploadedDocuments, assets |
| `Assets.tsx`, `BusinessSuite.tsx`, `EmailCampaign.tsx`, `RenderStudio.tsx` | Workspace/creative/email | Convex fallback required until traced | assets, email*, storage, platform |
| `NewSite.tsx`, `SiteDetail.tsx`, `TenantBankingHost.tsx`, `site/SiteLanding.tsx`, `site/SiteAuth.tsx`, `site/SiteDashboard.tsx`, `site/SiteAccounts.tsx`, `site/SiteBanking.tsx`, `site/SiteTransactions.tsx`, `site/SiteKyc.tsx`, `site/SiteAdmin.tsx` | Tenant sites and banking | Convex fallback required | tenants, organization, banking*, tenantTransfers, users |
| `Admin.tsx`, `AdminAdministrators.tsx`, `AdminAnalytics.tsx`, `AdminAppearance.tsx`, `AdminAuditLogs.tsx`, `AdminInfrastructure.tsx`, `AdminMaintenance.tsx`, `AdminSettings.tsx` | Admin platform/operations | Convex fallback required | admin, platform, maintenance, health, users |
| `AdminUsers.tsx`, `AdminUserDetail.tsx`, `AdminTenants.tsx`, `AdminVendors.tsx`, `AdminVendorDetail.tsx` | Admin identity/tenant/vendor management | Neon admin users read exists; screen parity unverified | admin, users, tenants, organization |
| `AdminCatalog.tsx`, `AdminOrders.tsx`, `AdminNotifications.tsx`, `AdminTransactions.tsx`, `AdminDisputes.tsx`, `AdminRisk.tsx` | Admin commerce/risk | Convex fallback required | catalog, marketplace, notifications, wallet, admin |
| `AdminBankingTenants.tsx`, `AdminBankingTenantDetail.tsx`, `AdminBankingTenantSettings.tsx`, `AdminBankingCreateTenant.tsx` | Banking tenant administration | Convex fallback required | bankingAdmin, bankingTenant, bankingHttp, tenants |
| `AdminShipments.tsx`, `AdminShipmentDetail.tsx`, `AdminCreateShipment.tsx`, `AdminDocuments.tsx`, `AdminDocumentTemplates.tsx`, `AdminDocumentTemplateEditor.tsx` | Admin shipments/documents | Convex fallback required | shipments, tracking*, documents, docTemplateAdmin |
| `AdminKYC.tsx`, `AdminPricing.tsx`, `AdminPaymentProviders.tsx`, `AdminEmailSettings.tsx`, `AdminLocations.tsx`, `AdminTemplateClassifier.tsx` | KYC, pricing, providers, settings | Convex fallback required | admin, pricing, paymentConfig, providers, emailAdmin, cloudieClassifier |
| `AdminVtuCatalog.tsx`, `AdminVtuProviders.tsx`, `AdminVtuUnresolved.tsx` | VTU administration | Convex fallback required | vtuCatalog*, vtuProvider*, vtuReconcile*, vtuUnresolvedAdmin |

## API coverage currently confirmed in source

The Neon API source (`api/src/server.ts`) defines:
- `GET /health` and compatibility redirect `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- `GET /api/tenants`, `GET /api/profile`, `GET /api/notifications`, `GET /api/orders`, `GET /api/catalog`
- `GET /api/admin/users`, `GET /api/wallet/ledger`

This is not full domain parity. No statement here implies write endpoints exist or should be enabled.

## Mandatory per-route follow-up

For each route before declaring it migrated:
1. Inspect the actual route declaration and trace imported hooks, queries, mutations, actions, subscriptions, and authorization assumptions.
2. Record the exact Convex function names and replacement Neon endpoint/schema in a route-level checklist.
3. Implement server-side authentication, tenant/ownership authorization, validation, safe error handling, and audit behavior.
4. Add unit/integration tests plus browser E2E for success, denial, stale session, and failure paths.
5. Verify staged schema/data reconciliation and rollback.
6. Remove only that route's Convex dependency after all checks are terminal and green. Keep Convex for every untouched route.

## Security gates

- No production auth cutover until same-origin HTTPS proxy/gateway, HttpOnly + Secure + SameSite cookie sessions, Origin/CSRF checks, expiry, logout, revocation, rotation, browser privacy tests, and browser E2E are verified.
- No credential hash copying until source hash compatibility and identity ownership are verified. Prefer linked Convex identity or verified account recovery; preserve existing credentials and identities.
- No financial writes until authorization, atomicity, concurrency, idempotency, reconciliation, audit controls, retries, races, partial failure, and unauthorized-access tests all pass.
- Do not call this inventory exhaustive at the function-call level until the query/mutation trace is completed for each listed screen.


## Follow-up verification (source inspection, 2026-10-17)

### Confirmed implementation details

- `src/main.tsx` still constructs `ConvexReactClient` from `VITE_CONVEX_URL` and wraps the application with `ConvexAuthProvider`. The incremental `useNeonAuth` hook is explicitly separate from `use-auth`; it is not a replacement for the production auth provider.
- `src/lib/neonApi.ts` uses `VITE_NEON_API_URL`, sends `Authorization: Bearer` from `sessionStorage`, and includes credentials. This is not the required same-origin, cookie-only browser session architecture.
- `api/src/server.ts` stores an 8-hour session record and JWT in an HttpOnly cookie, checks active/revoked session records on authenticated requests, and clears/revokes sessions on logout. However, register/login also return the JWT in JSON. That token response plus the frontend bearer-token storage must be removed as part of a coordinated cookie-only cutover, not as an isolated change.
- API cookie configuration is `SameSite=Lax`; the app and API are currently configured as separate origins. Do not assume this cookie will be sent reliably from the deployed frontend to a cross-site Render API. The same-origin gateway must be deployed and tested first.
- `vercel.json` currently rewrites unmatched paths to `/index.html`; it does not define an API proxy route. A proxy must be designed so API routes are not swallowed by the SPA rewrite and must use a server-side environment variable for the upstream origin (never expose the upstream secret/config as a client-side variable).
- `api/package.json` defines build and typecheck scripts but no API test script. An API-focused test harness and explicit auth/session tests are required before the session cutover.
- `api/src/server.ts` exposes read-only API endpoints for profile, notifications, orders, catalog, tenants, admin users, and wallet ledger. This does not establish parity for the corresponding Convex queries, subscriptions, mutations, or authorization rules.

### Current route-level status (updated 2026-10-17)

The project owner supplied this live staging response at `2026-10-17T11:41:46.714Z`:

```json
{
  "ok": true,
  "service": "cloudie-neon-api",
  "database": "connected",
  "timestamp": "2026-10-17T11:41:46.714Z"
}
```

This is evidence that the deployed staging API returned healthy and could reach Neon at that timestamp. The response alone does not identify the deployed commit or validate auth, browser cookies, authorization, route parity, or financial workflows.

| Capability | Neon source endpoint | Evidence level | Safe status |
|---|---|---|---|
| Health + DB connectivity | `GET /health` | Live response supplied by project owner at the timestamp above; deployed commit SHA still not correlated | Staging health confirmed at that timestamp; repeat after deployment and record deployed SHA |
| Register/login/logout/current user | `/api/auth/*`, `GET /api/me` | Implemented in source; cookie-only browser flow not verified | Do not cut over |
| Profile + notifications | `GET /api/profile`, `GET /api/notifications` | Implemented in source | Read parity/E2E unverified |
| Orders + catalog | `GET /api/orders`, `GET /api/catalog` | Implemented in source | Read parity/E2E unverified |
| Admin user list | `GET /api/admin/users` | Implemented in source with admin role middleware | Screen parity/authorization E2E unverified |
| Wallet ledger | `GET /api/wallet/ledger` | Implemented in source; read-only | Reconciliation/parity unverified; no financial writes enabled |
| All remaining route families | No complete endpoint mapping established | Not audited at function-call level | Keep Convex fallback |

### Required implementation order

1. Add and test a same-origin HTTPS API gateway without changing the current production auth provider.
2. Add API tests for cookie flags, CSRF/Origin rejection, expired/revoked sessions, disabled accounts, logout, login/register token leakage, and authorization boundaries.
3. Change API auth responses and frontend client together to cookie-only sessions; remove token storage and bearer fallback only after gateway/E2E tests pass.
4. Migrate one read-only route at a time and document exact Convex functions, ownership/tenant rules, schema mapping, parity tests, and rollback.
5. Do not migrate wallet, payment, VTU purchase, banking transfer, or other financial writes until a separate reviewed implementation passes idempotency, atomicity, race, reconciliation, audit, and failure-path tests.
6. Record the staged health response, deployed commit SHA, API build/typecheck output, browser E2E output, and rollback evidence before claiming the migration is verified.

The health URL was not independently fetched through the inspection path (the request returned a tooling `DisabledError`, not an HTTP status from the service). The owner-supplied response above is recorded as external staging evidence; it should not be described as independently reproduced by this audit.
