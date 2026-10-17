# Convex-to-Neon route and dependency audit (baseline)

**Audit date:** 2026-10-17  
**Baseline commit:** `13b8b920449a3a8cc076447548563452dd828990`  
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
