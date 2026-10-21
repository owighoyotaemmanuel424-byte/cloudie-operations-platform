/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminApi from "../adminApi.js";
import type * as adminOverview from "../adminOverview.js";
import type * as adminSeed from "../adminSeed.js";
import type * as adminSeedInternal from "../adminSeedInternal.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as bankingAdmin from "../bankingAdmin.js";
import type * as bankingCron from "../bankingCron.js";
import type * as bankingCustomer from "../bankingCustomer.js";
import type * as bankingHttp from "../bankingHttp.js";
import type * as bankingTenant from "../bankingTenant.js";
import type * as catalog from "../catalog.js";
import type * as cloudieClassifier from "../cloudieClassifier.js";
import type * as cloudieClassifierAction from "../cloudieClassifierAction.js";
import type * as crons from "../crons.js";
import type * as docTemplateAdmin from "../docTemplateAdmin.js";
import type * as docTemplates from "../docTemplates.js";
import type * as documents from "../documents.js";
import type * as email from "../email.js";
import type * as emailAdmin from "../emailAdmin.js";
import type * as emailCrypto from "../emailCrypto.js";
import type * as emailRender from "../emailRender.js";
import type * as emailShared from "../emailShared.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as imageRender from "../imageRender.js";
import type * as jejelaye from "../jejelaye.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as logspanel from "../logspanel.js";
import type * as maintenance from "../maintenance.js";
import type * as marketplace from "../marketplace.js";
import type * as notifications from "../notifications.js";
import type * as organization from "../organization.js";
import type * as paymentConfig from "../paymentConfig.js";
import type * as paystack from "../paystack.js";
import type * as paystackInternal from "../paystackInternal.js";
import type * as platform from "../platform.js";
import type * as pointMarket from "../pointMarket.js";
import type * as points from "../points.js";
import type * as pricing from "../pricing.js";
import type * as providers_aidapay from "../providers/aidapay.js";
import type * as providers_signature from "../providers/signature.js";
import type * as referrals from "../referrals.js";
import type * as serviceHub from "../serviceHub.js";
import type * as shipments from "../shipments.js";
import type * as storage from "../storage.js";
import type * as support from "../support.js";
import type * as tenantDomainVerify from "../tenantDomainVerify.js";
import type * as tenantPortal from "../tenantPortal.js";
import type * as tenantResolver from "../tenantResolver.js";
import type * as tenantSuite from "../tenantSuite.js";
import type * as tenantTransfers from "../tenantTransfers.js";
import type * as tenants from "../tenants.js";
import type * as tracking from "../tracking.js";
import type * as trackingDemo from "../trackingDemo.js";
import type * as trackingEngine from "../trackingEngine.js";
import type * as trackingQueries from "../trackingQueries.js";
import type * as trackingUser from "../trackingUser.js";
import type * as uploadedDocuments from "../uploadedDocuments.js";
import type * as users from "../users.js";
import type * as vtu from "../vtu.js";
import type * as vtuCatalog from "../vtuCatalog.js";
import type * as vtuCatalogSync from "../vtuCatalogSync.js";
import type * as vtuHttp from "../vtuHttp.js";
import type * as vtuInternal from "../vtuInternal.js";
import type * as vtuPairgate from "../vtuPairgate.js";
import type * as vtuProviderAdmin from "../vtuProviderAdmin.js";
import type * as vtuProviderCall from "../vtuProviderCall.js";
import type * as vtuProviderConfig from "../vtuProviderConfig.js";
import type * as vtuProviderStatus from "../vtuProviderStatus.js";
import type * as vtuReceipt from "../vtuReceipt.js";
import type * as vtuReconcile from "../vtuReconcile.js";
import type * as vtuReconcileConfig from "../vtuReconcileConfig.js";
import type * as vtuReconcileSweep from "../vtuReconcileSweep.js";
import type * as vtuRegistry from "../vtuRegistry.js";
import type * as vtuSchema_catalog from "../vtuSchema/catalog.js";
import type * as vtuSchema_ledger from "../vtuSchema/ledger.js";
import type * as vtuSchema_providers from "../vtuSchema/providers.js";
import type * as vtuSchema_types from "../vtuSchema/types.js";
import type * as vtuServiceAdmin from "../vtuServiceAdmin.js";
import type * as vtuServiceRouting from "../vtuServiceRouting.js";
import type * as vtuShared from "../vtuShared.js";
import type * as vtuUnresolvedAdmin from "../vtuUnresolvedAdmin.js";
import type * as wallet from "../wallet.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminApi: typeof adminApi;
  adminOverview: typeof adminOverview;
  adminSeed: typeof adminSeed;
  adminSeedInternal: typeof adminSeedInternal;
  assets: typeof assets;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  bankingAdmin: typeof bankingAdmin;
  bankingCron: typeof bankingCron;
  bankingCustomer: typeof bankingCustomer;
  bankingHttp: typeof bankingHttp;
  bankingTenant: typeof bankingTenant;
  catalog: typeof catalog;
  cloudieClassifier: typeof cloudieClassifier;
  cloudieClassifierAction: typeof cloudieClassifierAction;
  crons: typeof crons;
  docTemplateAdmin: typeof docTemplateAdmin;
  docTemplates: typeof docTemplates;
  documents: typeof documents;
  email: typeof email;
  emailAdmin: typeof emailAdmin;
  emailCrypto: typeof emailCrypto;
  emailRender: typeof emailRender;
  emailShared: typeof emailShared;
  health: typeof health;
  http: typeof http;
  imageRender: typeof imageRender;
  jejelaye: typeof jejelaye;
  "lib/encryption": typeof lib_encryption;
  logspanel: typeof logspanel;
  maintenance: typeof maintenance;
  marketplace: typeof marketplace;
  notifications: typeof notifications;
  organization: typeof organization;
  paymentConfig: typeof paymentConfig;
  paystack: typeof paystack;
  paystackInternal: typeof paystackInternal;
  platform: typeof platform;
  pointMarket: typeof pointMarket;
  points: typeof points;
  pricing: typeof pricing;
  "providers/aidapay": typeof providers_aidapay;
  "providers/signature": typeof providers_signature;
  referrals: typeof referrals;
  serviceHub: typeof serviceHub;
  shipments: typeof shipments;
  storage: typeof storage;
  support: typeof support;
  tenantDomainVerify: typeof tenantDomainVerify;
  tenantPortal: typeof tenantPortal;
  tenantResolver: typeof tenantResolver;
  tenantSuite: typeof tenantSuite;
  tenantTransfers: typeof tenantTransfers;
  tenants: typeof tenants;
  tracking: typeof tracking;
  trackingDemo: typeof trackingDemo;
  trackingEngine: typeof trackingEngine;
  trackingQueries: typeof trackingQueries;
  trackingUser: typeof trackingUser;
  uploadedDocuments: typeof uploadedDocuments;
  users: typeof users;
  vtu: typeof vtu;
  vtuCatalog: typeof vtuCatalog;
  vtuCatalogSync: typeof vtuCatalogSync;
  vtuHttp: typeof vtuHttp;
  vtuInternal: typeof vtuInternal;
  vtuPairgate: typeof vtuPairgate;
  vtuProviderAdmin: typeof vtuProviderAdmin;
  vtuProviderCall: typeof vtuProviderCall;
  vtuProviderConfig: typeof vtuProviderConfig;
  vtuProviderStatus: typeof vtuProviderStatus;
  vtuReceipt: typeof vtuReceipt;
  vtuReconcile: typeof vtuReconcile;
  vtuReconcileConfig: typeof vtuReconcileConfig;
  vtuReconcileSweep: typeof vtuReconcileSweep;
  vtuRegistry: typeof vtuRegistry;
  "vtuSchema/catalog": typeof vtuSchema_catalog;
  "vtuSchema/ledger": typeof vtuSchema_ledger;
  "vtuSchema/providers": typeof vtuSchema_providers;
  "vtuSchema/types": typeof vtuSchema_types;
  vtuServiceAdmin: typeof vtuServiceAdmin;
  vtuServiceRouting: typeof vtuServiceRouting;
  vtuShared: typeof vtuShared;
  vtuUnresolvedAdmin: typeof vtuUnresolvedAdmin;
  wallet: typeof wallet;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
