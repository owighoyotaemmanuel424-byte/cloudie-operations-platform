# Convex-to-Neon cutover decision

**Decision status: OPEN. No strategy is selected by this document.** Convex remains the live backend until the owner records a choice and the chosen acceptance gates pass. Neon is not yet an authoritative application backend.

## Option A — Full cutover

### What it requires
- Pick a maintenance window or explicitly accept downtime; freeze writes during final reconciliation.
- Implement and review one Neon API/service adapter for each application query and mutation being moved, with server-side auth, tenant/ownership checks, idempotency, and audit behavior.
- Complete schema and data backfill, including identity mapping and safe credential recovery; reconcile counts and financial totals.
- Deploy the matching API and frontend, switch traffic, monitor, and keep a tested rollback path that does not lose writes made after cutover.

### What it risks
- Missing function parity can turn previously working screens into runtime failures.
- Incomplete identity mapping or credential-format assumptions can lock users out or map data to the wrong account.
- A partial backfill or write freeze failure can lose or duplicate updates.
- Wallet, PointLedger, marketplace escrow, VTU, and tenant banking inconsistencies can cause financial harm.
- Rollback after Neon has accepted writes requires reverse reconciliation; simply switching the frontend back to Convex is not safe.

### How long it takes
High effort: multiple engineering phases, likely measured in weeks or more, depending on the final scope and identity/financial controls.

### When it is the right choice
When the team can schedule downtime or there are no meaningful live users, the complete required API/schema parity is proven, identity migration and financial reconciliation are ready, and a rollback window is staffed.

### What evidence closes it
- Every in-scope Convex call has a mapped Neon endpoint and passing contract/integration/E2E tests.
- Before/after reconciliation shows zero unexplained identity, tenant, order, wallet, points-ledger, and domain-record differences.
- A rehearsed write freeze, final sync, traffic switch, smoke test, and rollback exercise all pass.
- Production-origin browser tests and monitoring show no unexplained error/latency increase during the agreed observation window.

## Option B — Shadow reads with write-through replication

### What it requires
- Keep Convex as the source of truth and user-facing read source initially.
- Implement a write-through replication adapter for each state-changing mutation in scope, plus durable retry/outbox or equivalent delivery, idempotency keys, replay handling, and dead-letter/alerting.
- Implement comparable Neon read models and run shadow queries against Neon without serving their results to users at first.
- Build reconciliation for counts, per-user balances, ledger invariants, tenant boundaries, and record-level diffs; document the acceptable replication lag and divergence policy.

### What it risks
- Convex and Neon do not share a transaction. A mutation can commit in Convex and replication can fail, leaving Neon stale.
- Retried replication can duplicate rows or apply events out of order unless idempotency and ordering are explicit.
- Differences in query semantics, authorization, pagination, null handling, and sorting can produce false parity or user-visible differences if shadow reads are accidentally served.
- The dual-write path adds latency and an additional operational failure mode to the current production write path.

### How long it takes
High-to-very-high effort: generally longer than a narrow single-domain migration, because replication, replay, reconciliation, and observability must be built and operated before cutover.

### When it is the right choice
When Convex must remain live, production writes cannot pause, and the team has capacity to operate replication and reconcile divergence until the target data is demonstrably converged.

### What evidence closes it
- Injected replication failures, retries, duplicate deliveries, and out-of-order events recover without lost or duplicate logical writes.
- A sustained observation window records zero unexplained divergence and meets the explicit lag SLO.
- Shadow query results match Convex results for representative and adversarial cases, including tenant isolation and authorization.
- A documented promotion/rollback rehearsal passes before Neon reads become user-facing.

## Option C — Feature-flagged, domain-by-domain cutover

### What it requires
- Split shared `User` and `PointLedger` ownership first. Define one authoritative writer for each shared record and an explicit contract for any cross-domain transaction before flags can route writes.
- Build a feature flag per domain/cohort, not one global switch; keep reads and writes for a domain on the same authority unless a proven replication protocol is in place.
- For each domain, implement the API adapter, schema/data migration, authorization, observability, reconciliation, tests, rollout guardrails, and a domain-specific rollback.
- Keep financial writes disabled until all financial-write gates in `docs/convex-to-neon-cutover-gates.md` are satisfied.

### What it risks
- Shared entities can be split across systems, causing divergent `User`, wallet, or `PointLedger` state if ownership is unclear.
- Independent flags can create invalid mixed states: a Neon write followed by a Convex read, or vice versa.
- Domain dependencies can cross the flag boundary, so a nominally isolated rollout may still partially execute in both systems.
- More rollout states increase test and on-call complexity.

### How long it takes
High effort, but it can be delivered incrementally. Calendar duration depends on domain boundaries and the shared-state split; expect multiple iterations rather than a single switch.

### When it is the right choice
When production must remain available, domains can be isolated behind stable interfaces, the shared `User`/`PointLedger` model is split or explicitly coordinated, and the team can support parallel operation and per-domain rollback.

### What evidence closes it
- Each domain's flag has tested default-off behavior, rollout/rollback behavior, and an owner.
- Cross-domain contract tests prove a single authoritative writer and consistent read routing.
- Each domain independently passes its reconciliation, authorization, E2E, performance, and rollback gates before its flag is enabled.
- Shared-state tests prove no duplicate/missing ledger entries, no cross-tenant access, and no ambiguous identity ownership.

## How to choose

| Decision factor | Option A: full cutover | Option B: shadow reads | Option C: feature-flagged |
| --- | --- | --- | --- |
| Planned downtime acceptable | Strong fit | Not required | Not required |
| Need continuous production writes | Poor fit unless window is tiny | Strong fit | Strong fit if boundaries are real |
| Engineering complexity | Concentrated and high | High due to replication | High due to mixed states and per-domain gates |
| Rollback after new writes | Requires reverse reconciliation | Convex remains authority initially | Per-domain rollback only if writes remain unambiguous |
| Best precondition | Complete parity and controlled freeze | Reliable replication and reconciliation | Clear domain boundaries and shared-state ownership |

## Convex shared-state cutover checklist

This is a working checklist assembled from the committed `docs/neon-migration-trace.md` plus source-file inspection of the core stateful modules. The trace itself reports **373 distinct referenced functions**, while a literal extraction of its visible `module:function` identifiers yields **289 unique identifiers across 47 module headings**. That discrepancy means the trace's headline and visible function inventory are not internally reconcilable; this checklist must not be treated as exhaustive until `node scripts/trace-convex-usage.mjs` is rerun and the generated output is reviewed. Every item below must be mapped to a Neon contract, an ownership/tenant/admin policy, a data migration/reconciliation rule, tests, and a rollback decision before its domain can cut over.

### Module coverage inventory from the committed trace

- [ ] `admin` — 9 function identifiers visible in trace
- [ ] `adminApi` — 37 function identifiers visible in trace
- [ ] `adminSeed` — 1 function identifiers visible in trace
- [ ] `assets` — 2 function identifiers visible in trace
- [ ] `bankingAdmin` — 2 function identifiers visible in trace
- [ ] `bankingCustomer` — 16 function identifiers visible in trace
- [ ] `bankingTenant` — 10 function identifiers visible in trace
- [ ] `catalog` — 1 function identifiers visible in trace
- [ ] `cloudieClassifier` — 2 function identifiers visible in trace
- [ ] `cloudieClassifierAction` — 1 function identifiers visible in trace
- [ ] `docTemplateAdmin` — 9 function identifiers visible in trace
- [ ] `docTemplates` — 19 function identifiers visible in trace
- [ ] `documents` — 3 function identifiers visible in trace
- [ ] `email` — 7 function identifiers visible in trace
- [ ] `emailAdmin` — 4 function identifiers visible in trace
- [ ] `jejelaye` — 2 function identifiers visible in trace
- [ ] `logspanel` — 5 function identifiers visible in trace
- [ ] `marketplace` — 15 function identifiers visible in trace
- [ ] `notifications` — 4 function identifiers visible in trace
- [ ] `organization` — 2 function identifiers visible in trace
- [ ] `pairgate` — 1 function identifiers visible in trace
- [ ] `paystack` — 3 function identifiers visible in trace
- [ ] `platform` — 5 function identifiers visible in trace
- [ ] `points` — 1 function identifiers visible in trace
- [ ] `pricing` — 4 function identifiers visible in trace
- [ ] `referrals` — 4 function identifiers visible in trace
- [ ] `serviceHub` — 3 function identifiers visible in trace
- [ ] `storage` — 5 function identifiers visible in trace
- [ ] `support` — 6 function identifiers visible in trace
- [ ] `tenantResolver` — 2 function identifiers visible in trace
- [ ] `tenantTransfers` — 1 function identifiers visible in trace
- [ ] `tenants` — 34 function identifiers visible in trace
- [ ] `tracking` — 13 function identifiers visible in trace
- [ ] `trackingQueries` — 8 function identifiers visible in trace
- [ ] `trackingUser` — 6 function identifiers visible in trace
- [ ] `uploadedDocuments` — 6 function identifiers visible in trace
- [ ] `vtu` — 3 function identifiers visible in trace
- [ ] `vtuCatalog` — 2 function identifiers visible in trace
- [ ] `vtuCatalogSync` — 1 function identifiers visible in trace
- [ ] `vtuHttp` — 1 function identifiers visible in trace
- [ ] `vtuInternal` — 1 function identifiers visible in trace
- [ ] `vtuProviderAdmin` — 8 function identifiers visible in trace
- [ ] `vtuProviderCall` — 1 function identifiers visible in trace
- [ ] `vtuReceipt` — 1 function identifiers visible in trace
- [ ] `vtuServiceAdmin` — 10 function identifiers visible in trace
- [ ] `vtuUnresolvedAdmin` — 3 function identifiers visible in trace
- [ ] `wallet` — 4 function identifiers visible in trace

### Visible function identifiers from the trace

**`admin`**: `adminListOrders`, `deletePaymentProviderKey`, `getAuditLogs`, `getInfrastructure`, `getPaymentProviderKeys`, `listAdministrators`, `listUsers`, `savePaymentProviderKey`, `suspendUser`

**`adminApi`**: `addDisputeNote`, `addRiskCaseNote`, `adminBadgeCounts`, `adminDashboard`, `adminListNotifications`, `adminToggleProductActive`, `adminUserDetail`, `assignRiskCase`, `auditTransactionReview`, `bulkUpsertPricing`, `changeUserRole`, `createModerationFlag`, `getAnalyticsRange`, `getFinancialRisk`, `getMaintenanceMode`, `getPricing`, `getRiskCases`, `getSettings`, `getVendorAdmin`, `listModerationFlags`, `listVendorProducts`, `markDisputeUnderReview`, `openRiskCase`, `refundOrder`, `releaseEscrow`, `resolveDispute`, `reviewModerationFlag`, `reviewVendor`, `seedDefaultPricing`, `sendNotification`, `setDisputePriority`, `setMaintenanceMode`, `terminateUser`, `transitionRiskCase`, `unlockTenant`, `upsertPricing`, `upsertSetting`

**`adminSeed`**: `createAdministrator`

**`assets`**: `createCampaign`, `listCampaigns`

**`bankingAdmin`**: `adminListBalances`, `adminOverrideDeposit`

**`bankingCustomer`**: `addBeneficiary`, `adminOpenAccount`, `adminTenantHistory`, `bankingHistory`, `createDeposit`, `createTransfer`, `createWithdrawal`, `joinTenant`, `listBeneficiaries`, `memberAccounts`, `memberTenant`, `onboardingMe`, `openAccount`, `publicTenant`, `removeBeneficiary`, `statement`

**`bankingTenant`**: `applyBankingTemplateToTenant`, `createAdminTenant`, `createBankingTenant`, `getBankingFeeConfig`, `getTenantForAdmin`, `listBankingTenants`, `listTemplates`, `seedModernBankingTemplates`, `setTenantLifecycle`, `updateBankingTenant`

**`catalog`**: `getCatalog`

**`cloudieClassifier`**: `ingestClassifiedTemplate`, `listClassifiedTemplates`

**`cloudieClassifierAction`**: `classifyWithAi`

**`docTemplateAdmin`**: `adminBulkImportTemplates`, `adminCreateTemplate`, `adminDocumentStats`, `adminExportTemplates`, `adminGetTemplate`, `adminListTemplates`, `adminPublishTemplateVersion`, `adminSetTemplatePrice`, `adminSetTemplateStatus`

**`docTemplates`**: `archiveDocument`, `createDocument`, `createMyTemplate`, `ensureStarterTemplates`, `finalizeDocument`, `getDocument`, `getMyTemplate`, `getRenderQuote`, `getStudioStats`, `getTemplate`, `listCategories`, `listMyDocuments`, `listMyTemplates`, `listTemplates`, `publicViewDocument`, `revokeShare`, `shareDocument`, `updateDocumentValues`, `updateMyTemplate`

**`documents`**: `adminList`, `generate`, `list`

**`email`**: `clearApiKey`, `clearSmtpPassword`, `refreshEmailStatus`, `saveApiKey`, `saveSmtpPassword`, `saveTransportConfig`, `sendTestEmail`

**`emailAdmin`**: `getEmailDeliveryStats`, `getEmailSettings`, `listEmailLogs`, `saveConfig`

**`jejelaye`**: `listNumberProducts`, `purchaseNumber`

**`logspanel`**: `listBoostCategories`, `listBoostServices`, `purchase`, `refreshOrder`, `syncCatalog`

**`marketplace`**: `adminApproveProduct`, `adminBulkImportProducts`, `adminCreateProduct`, `adminListAllProducts`, `adminListVendors`, `adminSetProductPrice`, `createOrder`, `getLogspanelAdminStatus`, `getLogspanelProducts`, `getMyOrders`, `getMyVendor`, `listDisputes`, `listProducts`, `registerVendor`, `setLogspanelSettings`

**`module`**: `function`

**`notifications`**: `listAll`, `markAllRead`, `markRead`, `unreadCount`

**`organization`**: `getMyOrganization`, `setMyOrganization`

**`pairgate`**: `com`

**`paystack`**: `initializePayment`, `recoverPendingCredits`, `verifyAndCredit`

**`platform`**: `getPublicConfig`, `resetConfig`, `saveBrand`, `saveQuickActions`, `saveSupport`

**`points`**: `getBalance`

**`pricing`**: `getBillingConfig`, `getServicePrices`, `savePointPackages`, `updatePointRate`

**`referrals`**: `applyReferral`, `ensureCode`, `getMyCode`, `getMyReferrals`

**`serviceHub`**: `getOverview`, `listMyServices`, `syncMyServices`

**`storage`**: `deleteFile`, `generateUploadUrl`, `getFileUrl`, `listMyFiles`, `registerFile`

**`support`**: `close`, `create`, `get`, `listMine`, `markRead`, `reply`

**`tenantResolver`**: `resolveByHost`, `resolveBySubdomain`

**`tenants`**: `addTenantUser`, `adminAddCustomer`, `adminGetStats`, `adminKycReview`, `adminList`, `adminListCustomers`, `adminListDeposits`, `adminListKyc`, `adminListKycRecords`, `adminListTransactions`, `adminLockdown`, `adminRemoveCustomer`, `adminReviewCustomerKyc`, `create`, `createAccount`, `customerSubmitKyc`, `depositToAccount`, `get`, `getTenantLedger`, `listAccounts`, `listKyc`, `listMy`, `listTenantUsers`, `myAccounts`, `myKyc`, `myNotifications`, `myTransactions`, `publicGet`, `publicStats`, `removeTenantUser`, `submitKyc`, `toggleActive`, `update`, `withdrawFromAccount`

**`tenantTransfers`**: `transferBetweenAccounts`

**`tracking`**: `adminAddEvent`, `adminAddPackage`, `adminAddRouteStop`, `adminCreateFacility`, `adminCreateLocation`, `adminCreateShipment`, `adminDeleteFacility`, `adminDeleteLocation`, `adminDeleteShipment`, `adminUpdateRouteStop`, `adminUpdateShipment`, `adminUpdateStatus`, `seedTrackingDefaults`

**`trackingQueries`**: `adminLabelData`, `adminListShipments`, `adminShipmentDetail`, `listCarriers`, `listFacilities`, `listLocations`, `listServiceTypes`, `publicTracking`

**`trackingUser`**: `createMyShipment`, `customerAddShipmentEvent`, `customerUpdateShipment`, `myPointsBalance`, `myShipmentDetail`, `myShipments`

**`uploadedDocuments`**: `adminListAll`, `adminRemoveAny`, `create`, `list`, `remove`, `rename`

**`vtu`**: `getAirtimeOffers`, `listMyHistory`, `previewCost`

**`vtuCatalog`**: `getPurchaseDetail`, `listCatalog`

**`vtuCatalogSync`**: `syncAidaPayCatalog`

**`vtuHttp`**: `purchaseVtu`

**`vtuInternal`**: `getTransaction`

**`vtuProviderAdmin`**: `applyPreset`, `createProvider`, `deleteProvider`, `getPresetSetup`, `listProviders`, `migratePairgateFromEnv`, `setProviderStatus`, `updateProvider`

**`vtuProviderCall`**: `testProviderConnection`

**`vtuReceipt`**: `prepareReceipt`

**`vtuServiceAdmin`**: `createProduct`, `createRoute`, `deleteProduct`, `deleteRoute`, `listProducts`, `listRoutes`, `previewRoute`, `seedAirtimeCatalog`, `updateProduct`, `updateRoute`

**`vtuUnresolvedAdmin`**: `confirmDelivered`, `listUnresolved`, `refundCustomer`

**`wallet`**: `adminAdjust`, `getAdminLedger`, `getBalance`, `getLedger`

### Additional source-export checklist from directly inspected files

These exports were confirmed in the actual source and must be tracked even if the trace does not currently surface them:

- `src/convex/pointMarket.ts`: `listPackages` (query), `createOrder` (mutation), `getMyOrder` (query), `raiseDispute` (mutation), `fulfillOrder` (mutation), `applyAsVendor` (mutation), `vendorOverview` (query), `createPackage` (mutation), `updatePackage` (mutation), `setPackageActive` (mutation), `deletePackage` (mutation).
- `src/convex/wallet.ts`: `getBalance` (query), `getLedger` (query), `getAdminLedger` (query), `credit` (internal mutation), `debit` (internal mutation), `adminAdjust` (mutation), `migrateUser` (mutation), plus shared helpers `creditWallet` and `debitWallet`.
- `src/convex/marketplace.ts`: `registerVendor`, `createProduct`, `createOrder`, `createDispute`, `adminApproveProduct`, `adminSetProductPrice`, `adminUpdateVendor`, `adminCreateProduct`, `adminBulkImportProducts`, `prepareLogspanelOrder` (internal mutation), `finalizeLogspanelOrder` (internal mutation), `syncLogspanelProducts` (internal mutation), `prepareJejelayeNumberOrder` (internal mutation), `finalizeJejelayeNumberOrder` (internal mutation), and the associated product/vendor/order/dispute queries.
- `src/convex/admin.ts`: `savePaymentProviderKey`, `deletePaymentProviderKey`, `suspendUser`, `terminateUser`, `claimFirstAdmin`, `initializeUser`, `auditAdminPasswordReset` (internal mutation), and the associated user, administrator, audit, analytics, infrastructure, and order queries.
- `src/convex/users.ts`: `currentUser` (query).
- `src/convex/tenants.ts`: tenant, KYC, account, ledger, deposit/withdrawal, membership, notification and administrative queries/mutations, including `create`, `update`, `submitKyc`, `adminLockdown`, `adminKycReview`, `createAccount`, `depositToAccount`, `withdrawFromAccount`, `addLedgerEntry`, `creditDemoAccount`, and `debitDemoAccount`.
- `src/convex/bankingCustomer.ts` and `src/convex/bankingAdmin.ts`: account opening/status, beneficiary management, deposits, withdrawals, transfers, ledger/history, customer KYC and administrative override mutations.
- `src/convex/tracking.ts` and `src/convex/trackingUser.ts`: shipment creation/update/delete, status/event/package/route-stop mutations, location/facility changes, customer shipment edits, and tracking queries.
- `src/convex/vtuInternal.ts`, `src/convex/vtuServiceAdmin.ts`, `src/convex/vtuUnresolvedAdmin.ts`, and `src/convex/vtuHttp.ts`: transaction begin/settle/unknown/processing, catalog/route administration, unresolved fulfillment/refund, and provider callback processing.
- `src/convex/docTemplates.ts`, `src/convex/docTemplateAdmin.ts`, `src/convex/documents.ts`, `src/convex/storage.ts`, and `src/convex/uploadedDocuments.ts`: document/template creation, edit/finalize/share/archive, template administration, file registration/move/delete/rename, and related queries.
- `src/convex/notifications.ts`, `src/convex/support.ts`, `src/convex/referrals.ts`, `src/convex/serviceHub.ts`, `src/convex/organization.ts`, `src/convex/platform.ts`, `src/convex/pricing.ts`, `src/convex/emailAdmin.ts`, and `src/convex/email.ts`: notifications/read state, support tickets/replies, referral codes/rewards, service subscriptions, organization settings, platform settings, pricing, email config/queue/delivery status, and related queries.

The `pairgate` module appears in the trace, but `src/convex/pairgate.ts` could not be retrieved at that exact path through the repository connector. Resolve its actual path before finalizing the complete source-export inventory. This is a known inventory gap, not evidence that the module is absent.


## Decision record — owner to complete

- **Selected option (A, B, or C):** ____________________
- **Why this option fits current production constraints:** ____________________
- **Domains in the first cutover scope:** ____________________
- **Authoritative writer for User and PointLedger:** ____________________
- **Downtime/replication/feature-flag operating constraints:** ____________________
- **Acceptance evidence required before rollout:** ____________________
- **Rollback trigger and responsible owner:** ____________________
- **Decision owner and date:** ____________________


## Exported stateful function inventory — source declarations

This appendix lists query, mutation, and action declarations matched directly in source files. It complements the call-site trace above; functions that are helper exports, dynamically declared, or invoked indirectly may require manual review.

### `admin`
`savePaymentProviderKey` (mutation), `deletePaymentProviderKey` (mutation), `getPaymentProviderKeys` (query), `listUsers` (query), `getUser` (query), `suspendUser` (mutation), `terminateUser` (mutation), `getUserTransactions` (query), `adminExists` (query), `claimFirstAdmin` (mutation), `listAdministrators` (query), `resetAdminPassword` (action), `auditAdminPasswordReset` (internalMutation), `initializeUser` (mutation), `getAuditLogs` (query), `getAuditLogsPaged` (query), `adminListOrders` (query), `exportData` (query), `getAnalytics` (query), `getInfrastructure` (query)

### `adminApi`
`assertAdminSession` (internalQuery), `getPricing` (query), `upsertPricing` (mutation), `getPublicPricing` (query), `seedDefaultPricing` (mutation), `bulkUpsertPricing` (mutation), `getSettings` (query), `upsertSetting` (mutation), `getVendorAdmin` (query), `listVendorProducts` (query), `adminToggleProductActive` (mutation), `adminListDisputes` (query), `getDispute` (query), `addDisputeNote` (mutation), `setDisputePriority` (mutation), `resolveDispute` (mutation), `releaseEscrow` (mutation), `refundOrder` (mutation), `reviewVendor` (mutation), `terminateUser` (mutation), `changeUserRole` (mutation), `unlockTenant` (mutation), `listModerationFlags` (query), `createModerationFlag` (mutation), `reviewModerationFlag` (mutation), `sendNotification` (mutation), `broadcastNotificationBatch` (internalMutation), `adminListNotifications` (query), `globalSearch` (query), `adminUserDetail` (query), `logAdminSession` (mutation), `adminBadgeCounts` (query), `adminDashboard` (query), `auditTransactionReview` (mutation), `getFinancialRisk` (query), `getRiskCases` (query), `openRiskCase` (mutation), `assignRiskCase` (mutation), `addRiskCaseNote` (mutation), `transitionRiskCase` (mutation), `markDisputeUnderReview` (mutation), `getAnalyticsRange` (query), `getMaintenanceMode` (query), `setMaintenanceMode` (mutation)

### `adminSeed`
`seedAdminAccount` (action), `createAdministrator` (action)

### `assets`
`upload` (mutation), `listAssets` (query), `deleteAsset` (mutation), `getStorageUsage` (query), `createCampaign` (mutation), `listCampaigns` (query), `getCampaignDeliveries` (query)

### `bankingAdmin`
`adminDashboard` (query), `adminApproveAccount` (mutation), `adminFreezeAccount` (mutation), `adminUnfreezeAccount` (mutation), `adminOverrideTransfer` (mutation), `adminOverrideDeposit` (mutation), `adminOverrideWithdrawal` (mutation), `adminListCustomers` (query), `adminSetCustomerKyc` (mutation), `adminGetFeeConfig` (query), `adminSetFeeConfig` (mutation), `adminListBalances` (query), `adminAuditLog` (query)

### `bankingCustomer`
`memberTenant` (query), `memberAccounts` (query), `accountTransactions` (query), `onboardingMe` (query), `publicTenant` (query), `joinTenant` (mutation), `openAccount` (mutation), `adminOpenAccount` (mutation), `setAccountStatus` (mutation), `listBeneficiaries` (query), `addBeneficiary` (mutation), `removeBeneficiary` (mutation), `createDeposit` (mutation), `reconcileDeposit` (mutation), `createWithdrawal` (mutation), `createTransfer` (mutation), `bankingHistory` (query), `statement` (query), `adminTenantHistory` (query)

### `bankingTenant`
`listTemplates` (query), `ensureModernBankingTemplates` (internalMutation), `seedModernBankingTemplates` (mutation), `upsertTemplate` (mutation), `ensureCrestlineTemplate` (internalMutation), `createAdminTenant` (mutation), `createBankingTenant` (mutation), `updateBankingTenant` (mutation), `applyBankingTemplateToTenant` (mutation), `setTenantLifecycle` (mutation), `getTenantForAdmin` (query), `listBankingTenants` (query), `getBankingFeeConfig` (query), `health` (query)

### `catalog`
`getCatalog` (query)


### `cloudieClassifier`
`classifyDeterministic` (query), `ingestClassifiedTemplate` (mutation), `listClassifiedTemplates` (query)

### `cloudieClassifierAction`
`classifyWithAi` (action)

### `docTemplateAdmin`
`adminListTemplates` (query), `adminSetTemplateStatus` (mutation), `adminSetTemplatePrice` (mutation), `adminPublishTemplateVersion` (mutation), `adminGetTemplate` (query), `adminCreateTemplate` (mutation), `adminDocumentStats` (query), `adminBulkImportTemplates` (mutation), `adminExportTemplates` (query)

### `docTemplates`
`listCategories` (query), `listTemplates` (query), `getTemplate` (query), `ensureStarterTemplates` (mutation), `createDocument` (mutation), `updateDocumentValues` (mutation), `finalizeDocument` (mutation), `listMyDocuments` (query), `getDocument` (query), `getStudioStats` (query), `getRenderQuote` (query), `shareDocument` (mutation), `revokeShare` (mutation), `archiveDocument` (mutation), `publicViewDocument` (mutation), `listMyTemplates` (query), `getMyTemplate` (query), `createMyTemplate` (mutation), `updateMyTemplate` (mutation)

### `documents`
`generate` (mutation), `list` (query), `get` (query), `adminList` (query)

### `email`
`saveApiKey` (action), `clearApiKey` (action), `saveTransportConfig` (action), `saveSmtpPassword` (action), `clearSmtpPassword` (action), `refreshEmailStatus` (action), `sendTestEmail` (action), `sendTransactional` (internalAction), `enqueueCampaign` (internalAction), `enqueueCampaignMessage` (internalAction), `dispatchQueued` (internalAction)

### `emailAdmin`
`getEmailSettings` (query), `listEmailLogs` (query), `getEmailDeliveryStats` (query), `getAdminUser` (internalQuery), `getSystemSecret` (internalQuery), `getConfigForSend` (internalQuery), `getDispatchReadiness` (internalQuery), `claimQueuedMessages` (internalQuery), `putSystemSecretIfAbsent` (internalMutation), `saveConfig` (mutation), `saveApiKeyRow` (internalMutation), `saveTransportRow` (internalMutation), `saveSmtpCredentialRow` (internalMutation), `clearSmtpCredentialRow` (internalMutation), `clearApiKeyRow` (internalMutation), `recordVerification` (internalMutation), `recordTest` (internalMutation), `enqueueMessage` (internalMutation), `markMessageSending` (internalMutation), `markMessageSent` (internalMutation), `markMessageFailed` (internalMutation), `markMessageBounced` (internalMutation), `finalizeCampaign` (internalMutation), `failCampaign` (internalMutation)

### `jejelaye`
`listNumberProducts` (action), `purchaseNumber` (action), `refreshNumberSession` (action)


### `logspanel`
`listNumberCountries` (action), `listNumberServices` (action), `listNumberAreaCodes` (action), `listBoostCategories` (action), `listBoostServices` (action), `syncCatalog` (action), `purchase` (action), `refreshOrder` (action)

### `marketplace`
`registerVendor` (mutation), `getMyVendor` (query), `createProduct` (mutation), `listProducts` (query), `getProduct` (query), `createOrder` (mutation), `getMyOrders` (query), `getMyOrder` (query), `getVendorOrders` (query), `createDispute` (mutation), `listDisputes` (query), `adminApproveProduct` (mutation), `adminSetProductPrice` (mutation), `adminListVendors` (query), `adminUpdateVendor` (mutation), `adminListAllProducts` (query), `adminCreateProduct` (mutation), `adminBulkImportProducts` (mutation), `prepareLogspanelOrder` (internalMutation), `finalizeLogspanelOrder` (internalMutation), `getLogspanelProducts` (query), `getLogspanelAdminStatus` (query), `isLogspanelEnabled` (query), `setLogspanelSettings` (mutation), `syncLogspanelProducts` (internalMutation), `prepareJejelayeNumberOrder` (internalMutation), `finalizeJejelayeNumberOrder` (internalMutation)

### `notifications`
`list` (query), `listAll` (query), `unreadCount` (query), `markRead` (mutation), `markAllRead` (mutation)

### `organization`
`getMyOrganization` (query), `setMyOrganization` (mutation)

### `pairgate`
_RETRIEVAL ERROR: NOT_FOUND: Error code: NOT_FOUND; Error: GitHub API error 404: {"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#get-repository-content","status":"404"}_

### `paystack`
`initializePayment` (action), `verifyAndCredit` (action), `recoverPendingCredits` (action), `verifyWebhookSignature` (action), `getPublicKey` (action)

### `platform`
`getPublicConfig` (query), `saveBrand` (mutation), `saveSupport` (mutation), `saveQuickActions` (mutation), `resetConfig` (mutation)

### `points`
`getPointsBalance` (query), `getPointLedger` (query), `creditPoints` (internalMutation)
