import { Toaster } from "@/components/ui/sonner";
import { PlatformBranding } from "@/components/PlatformBranding";
import { SupportWidget } from "@/components/SupportWidget";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireAdmin } from "@/components/RequireAdmin";
import { ThemeProvider } from "@/components/ThemeProvider";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@/lib/neonClient";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { EASE_OUT_QUINT } from "@/components/motion";
import "./index.css";
import Landing from "./pages/Landing.tsx";
import AuthPage from "./pages/Auth.tsx";
import LoginPage from "./pages/Login.tsx";
import RegisterPage from "./pages/Register.tsx";
import AdminLogin from "./pages/AdminLogin.tsx";
import NotFound from "./pages/NotFound.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import DesignSystem from "./pages/DesignSystem.tsx";
import { AppLayout } from "./components/AppLayout.tsx";

const CHUNK_RELOAD_KEY = "cloudie:chunk-reload";

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /not a valid JavaScript MIME type|Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS/i.test(
    msg,
  );
}

async function clearStaleAssetCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
    }
  } catch {
    // Ignore storage/SW cleanup errors in restricted browsing contexts.
  }
}

function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await importer();
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // Ignore storage errors
      }
      return mod;
    } catch (err) {
      if (typeof window !== "undefined" && isChunkLoadError(err)) {
        await clearStaleAssetCaches();
        try {
          const target = window.location.pathname + window.location.search;
          if (sessionStorage.getItem(CHUNK_RELOAD_KEY) !== target) {
            sessionStorage.setItem(CHUNK_RELOAD_KEY, target);
            window.location.reload();
          }
        } catch {
          // Storage blocked; fall through to error boundary.
        }
      }
      throw err;
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    void clearStaleAssetCaches().finally(() => {
      try {
        const target = window.location.pathname + window.location.search;
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY) !== target) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, target);
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    });
  });
}

// Lazy-loaded secondary pages with automatic stale-chunk recovery
const Personal = lazyWithRetry(() => import("./pages/Personal.tsx"));
const Wallet = lazyWithRetry(() => import("./pages/Wallet.tsx"));
const MyServices = lazyWithRetry(() => import("./pages/MyServices.tsx"));
const Billing = lazyWithRetry(() => import("./pages/Billing.tsx"));
const Shipments = lazyWithRetry(() => import("./pages/Shipments.tsx"));
const NewShipment = lazyWithRetry(() => import("./pages/NewShipment.tsx"));
const ShipmentDetail = lazyWithRetry(() => import("./pages/ShipmentDetail.tsx"));
const ShipmentUpdates = lazyWithRetry(() => import("./pages/ShipmentUpdates.tsx"));
const ShipmentUpdateForm = lazyWithRetry(() => import("./pages/ShipmentUpdateForm.tsx"));
const VtuCatalog = lazyWithRetry(() => import("./pages/VtuCatalog.tsx"));
const VtuAirtime = lazyWithRetry(() => import("./pages/VtuAirtime.tsx"));
const VtuBills = lazyWithRetry(() => import("./pages/VtuBills.tsx"));
const VtuData = lazyWithRetry(() => import("./pages/VtuData.tsx"));
const VtuElectricity = lazyWithRetry(() => import("./pages/VtuElectricity.tsx"));
const VtuExamPins = lazyWithRetry(() => import("./pages/VtuExamPins.tsx"));
const VtuHistory = lazyWithRetry(() => import("./pages/VtuHistory.tsx"));
const PublicTracking = lazyWithRetry(() => import("./pages/PublicTracking.tsx"));
const SiteLanding = lazyWithRetry(() => import("./pages/site/SiteLanding.tsx"));
const SiteBanking = lazyWithRetry(() => import("./pages/site/SiteBanking.tsx"));
const SiteAuth = lazyWithRetry(() => import("./pages/site/SiteAuth.tsx"));
const SiteDashboard = lazyWithRetry(() => import("./pages/site/SiteDashboard.tsx"));
const SiteAccounts = lazyWithRetry(() => import("./pages/site/SiteAccounts.tsx"));
const SiteTransactions = lazyWithRetry(() => import("./pages/site/SiteTransactions.tsx"));
const SiteKyc = lazyWithRetry(() => import("./pages/site/SiteKyc.tsx"));
const SiteAdmin = lazyWithRetry(() => import("./pages/site/SiteAdmin.tsx"));
const AdminBankingTenants = lazyWithRetry(() => import("./pages/AdminBankingTenants.tsx"));
const AdminBankingCreateTenant = lazyWithRetry(() => import("./pages/AdminBankingCreateTenant.tsx"));
const AdminBankingTenantDetail = lazyWithRetry(() => import("./pages/AdminBankingTenantDetail.tsx"));
const AdminBankingTenantSettings = lazyWithRetry(() => import("./pages/AdminBankingTenantSettings.tsx"));
const TenantBankingHost = lazyWithRetry(() => import("./pages/TenantBankingHost.tsx"));
const TenantGateLazy = lazyWithRetry(() => import("./components/tenant/TenantGate.tsx").then(m => ({ default: m.TenantGate })));

const Ticketing = lazyWithRetry(() => import("./pages/Ticketing.tsx"));
const FlightDocument = lazyWithRetry(() => import("./pages/FlightDocument.tsx"));
const HotelDocument = lazyWithRetry(() => import("./pages/HotelDocument.tsx"));
const InvoiceDocument = lazyWithRetry(() => import("./pages/InvoiceDocument.tsx"));
const CustomsDocument = lazyWithRetry(() => import("./pages/CustomsDocument.tsx"));
const BusinessSuite = lazyWithRetry(() => import("./pages/BusinessSuite.tsx"));
const NewSite = lazyWithRetry(() => import("./pages/NewSite.tsx"));
const BusinessSiteDetail = lazyWithRetry(() => import("./pages/BusinessSiteDetail.tsx"));
const PortalLogin = lazyWithRetry(() => import("./pages/t/PortalLogin.tsx"));
const PortalDashboard = lazyWithRetry(() => import("./pages/t/PortalDashboard.tsx"));
const PortalKyc = lazyWithRetry(() => import("./pages/t/PortalKyc.tsx"));
const PortalLedger = lazyWithRetry(() => import("./pages/t/PortalLedger.tsx"));
const PortalSettings = lazyWithRetry(() => import("./pages/t/PortalSettings.tsx"));
const PointMarketplace = lazyWithRetry(() => import("./pages/marketplace/PointMarketplace.tsx"));
const PointOrderDetail = lazyWithRetry(() => import("./pages/marketplace/PointOrderDetail.tsx"));
const VendorApply = lazyWithRetry(() => import("./pages/vendor/VendorApply.tsx"));
const VendorDashboard = lazyWithRetry(() => import("./pages/vendor/VendorDashboard.tsx"));
const DocumentsPage = lazyWithRetry(() => import("./pages/Documents.tsx"));
const DocumentTemplates = lazyWithRetry(() => import("./pages/DocumentTemplates.tsx"));
const DocumentGenerator = lazyWithRetry(() => import("./pages/DocumentGenerator.tsx"));
const DocumentBuilder = lazyWithRetry(() => import("./pages/DocumentBuilder.tsx"));
const OwnDocumentTemplate = lazyWithRetry(() => import("./pages/OwnDocumentTemplate.tsx"));
const DocumentDetail = lazyWithRetry(() => import("./pages/DocumentDetail.tsx"));
const PublicDocument = lazyWithRetry(() => import("./pages/PublicDocument.tsx"));
const AdminDocumentTemplates = lazyWithRetry(() => import("./pages/AdminDocumentTemplates.tsx"));
const AdminDocumentTemplateEditor = lazyWithRetry(() => import("./pages/AdminDocumentTemplateEditor.tsx"));
const AdminTemplateClassifier = lazyWithRetry(() => import("./pages/AdminTemplateClassifier.tsx"));
const Services = lazyWithRetry(() => import("./pages/Services.tsx"));
const EmailCampaign = lazyWithRetry(() => import("./pages/EmailCampaign.tsx"));
const EmailComposer = lazyWithRetry(() => import("./pages/EmailComposer.tsx"));
const RenderStudio = lazyWithRetry(() => import("./pages/RenderStudio.tsx"));
const ImageStudio = lazyWithRetry(() => import("./pages/ImageStudio.tsx"));
const AssetManager = lazyWithRetry(() => import("./pages/AssetManager.tsx"));
const MarketplacePage = lazyWithRetry(() => import("./pages/Marketplace.tsx"));
const Referrals = lazyWithRetry(() => import("./pages/Referrals.tsx"));
const NotificationsPage = lazyWithRetry(() => import("./pages/Notifications.tsx"));
const Support = lazyWithRetry(() => import("./pages/Support.tsx"));
const Settings = lazyWithRetry(() => import("./pages/Settings.tsx"));
const BuyPoints = lazyWithRetry(() => import("./pages/BuyPoints.tsx"));
const Orders = lazyWithRetry(() => import("./pages/Orders.tsx"));
const Vendor = lazyWithRetry(() => import("./pages/Vendor.tsx"));
const Transactions = lazyWithRetry(() => import("./pages/Transactions.tsx"));
const Ledger = lazyWithRetry(() => import("./pages/Ledger.tsx"));
const Admin = lazyWithRetry(() => import("./pages/Admin.tsx"));
const AdminUsers = lazyWithRetry(() => import("./pages/AdminUsers.tsx"));
const AdminUserDetail = lazyWithRetry(() => import("./pages/AdminUserDetail.tsx"));
const AdminVendors = lazyWithRetry(() => import("./pages/AdminVendors.tsx"));
const AdminVendorDetail = lazyWithRetry(() => import("./pages/AdminVendorDetail.tsx"));
const AdminTenants = lazyWithRetry(() => import("./pages/AdminTenants.tsx"));
const AdminAnalytics = lazyWithRetry(() => import("./pages/AdminAnalytics.tsx"));
const AdminAuditLogs = lazyWithRetry(() => import("./pages/AdminAuditLogs.tsx"));
const AdminMarketplace = lazyWithRetry(() => import("./pages/AdminMarketplace.tsx"));
const AdminOrders = lazyWithRetry(() => import("./pages/AdminOrders.tsx"));
const AdminDisputes = lazyWithRetry(() => import("./pages/AdminDisputes.tsx"));
const AdminShipments = lazyWithRetry(() => import("./pages/AdminShipments.tsx"));
const AdminCreateShipment = lazyWithRetry(() => import("./pages/AdminCreateShipment.tsx"));
const AdminShipmentDetail = lazyWithRetry(() => import("./pages/AdminShipmentDetail.tsx"));
const AdminLocations = lazyWithRetry(() => import("./pages/AdminLocations.tsx"));
const AdminDocuments = lazyWithRetry(() => import("./pages/AdminDocuments.tsx"));
const AdminTransactions = lazyWithRetry(() => import("./pages/AdminTransactions.tsx"));
const AdminRisk = lazyWithRetry(() => import("./pages/AdminRisk.tsx"));
const AdminMaintenance = lazyWithRetry(() => import("./pages/AdminMaintenance.tsx"));
const AdminKYC = lazyWithRetry(() => import("./pages/AdminKYC.tsx"));
const AdminNotifications = lazyWithRetry(() => import("./pages/AdminNotifications.tsx"));
const AdminInfrastructure = lazyWithRetry(() => import("./pages/AdminInfrastructure.tsx"));
const AdminPricing = lazyWithRetry(() => import("./pages/AdminPricing.tsx"));
const AdminVtuProviders = lazyWithRetry(() => import("./pages/AdminVtuProviders.tsx"));
const AdminVtuCatalog = lazyWithRetry(() => import("./pages/AdminVtuCatalog.tsx"));
const AdminVtuUnresolved = lazyWithRetry(() => import("./pages/AdminVtuUnresolved.tsx"));
const AdminCatalog = lazyWithRetry(() => import("./pages/AdminCatalog.tsx"));
const AdminSettings = lazyWithRetry(() => import("./pages/AdminSettings.tsx"));
const AdminAppearance = lazyWithRetry(() => import("./pages/AdminAppearance.tsx"));
const AdminPaymentProviders = lazyWithRetry(() => import("./pages/AdminPaymentProviders.tsx"));
const AdminEmailSettings = lazyWithRetry(() => import("./pages/AdminEmailSettings.tsx"));
const AdminAdministrators = lazyWithRetry(() => import("./pages/AdminAdministrators.tsx"));
const AdminLayout = lazyWithRetry(() => import("./components/admin/AdminLayout.tsx").then(m => ({ default: m.AdminLayout })));

function RouteLoading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
      </div>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

/**
 * Scrolls to the top once the incoming route's wrapper has mounted.
 *
 * Rendered *inside* the keyed `motion.div` below, so it runs when the new page
 * actually replaces the old one (`AnimatePresence mode="wait"` finishes the
 * exit first). Without this, navigating from the bottom of a long page left the
 * next page scrolled halfway down.
 *
 * Uses `behavior: "instant"` deliberately: `index.css` sets
 * `scroll-behavior: smooth` globally, and animating the scroll on every
 * navigation reads as lag rather than polish.
 */
function RouteScrollReset() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);
  return null;
}

/**
 * Replays the enter animation on every navigation.
 *
 * Keying on `pathname` remounts the subtree per route, so `PageTransition`
 * runs again for each new page without any page needing to opt in.
 */
function RouteTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.28, ease: EASE_OUT_QUINT }}
      >
        <RouteScrollReset />
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { console.warn("[VlyToolbar] Caught error:", err.message); }
  render() { return this.state.hasError ? null : this.props.children; }
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || "Unknown error" };
  }
  handleReload = () => {
    void clearStaleAssetCaches().finally(() => {
      window.location.reload();
    });
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center space-y-3">
            <p className="text-sm font-semibold">Runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Reload application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


// Register the Cloudie service worker (offline fallback + static asset caching).
// Production only: in development the managed dev server serves assets directly
// and a service worker would risk serving stale bundles to the preview.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        reg.update().catch(() => undefined);
      })
      .catch(() => undefined);
  });
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage({ type: "iframe-route-change", path: location.pathname }, "*");
  }, [location.pathname]);
  return null;
}

/**
 * Restores a deep link parked by `public/404.html`.
 *
 * Hosts that answer unknown paths with a static 404 page (instead of the SPA
 * shell) send the browser to `/` with the intended path in sessionStorage.
 * Replaying it here — before `BrowserRouter` reads `window.location` — means
 * `/dashboard`, `/marketplace` and `/admin` deep links open the real route
 * (and `RequireAuth` then preserves it in `/auth?returnTo=...`) rather than
 * dumping the user on the landing page.
 *
 * Storage is not always available (private browsing blocks it). The fallback
 * page then carries the same target in `?cloudie-redirect=`, which is read here
 * as a second source and consumed — it is never forwarded to the router.
 */
function restoreDeepLink() {
  const STORAGE_KEY = "cloudie:spa-redirect";
  const QUERY_KEY = "cloudie-redirect";

  // Read the parked path: sessionStorage first, then the query parameter the
  // fallback page uses when nothing could be stored.
  let intended = "";
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      // Cleared before the check below, so a hostile value cannot linger.
      sessionStorage.removeItem(STORAGE_KEY);
      intended = stored;
    }
  } catch {
    /* Storage unavailable — the query parameter is the only source. */
  }

  if (!intended) {
    try {
      intended =
        new URLSearchParams(window.location.search).get(QUERY_KEY) ?? "";
    } catch {
      intended = "";
    }
  }

  // Same-origin paths only: `//host` and `https://…` would be an open redirect.
  if (!intended.startsWith("/") || intended.startsWith("//")) return;

  // Skip the write when the browser is already on the intended route.
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (intended === current) return;
  window.history.replaceState(null, "", intended);
}

restoreDeepLink();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider>
        <ThemeProvider>
          <BrowserRouter>
            <PlatformBranding />
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <TenantGateLazy>
              <RouteTransition>
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />
                <Route path="/login" element={<LoginPage redirectAfterAuth="/dashboard" />} />
                <Route path="/register" element={<RegisterPage redirectAfterAuth="/dashboard" />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/track/:trackingNumber" element={<PublicTracking />} />
                <Route path="/tracking" element={<PublicTracking />} />
                <Route path="/tracking/:trackingNumber" element={<PublicTracking />} />
                <Route path="/d/:slug" element={<React.Suspense fallback={<RouteLoading />}><PublicDocument /></React.Suspense>} />

                {/* Tenant banking via wildcard subdomain — *.g0ki.com/banking (dynamic tenant context) */}
                <Route path="/banking" element={<React.Suspense fallback={<RouteLoading />}><TenantBankingHost /></React.Suspense>} />

                {/* Generated tenant banking site (public) — canonical = /site/:siteId/banking (full portal) */}
                <Route path="/site/:siteId" element={<React.Suspense fallback={<RouteLoading />}><SiteLanding /></React.Suspense>} />
                <Route path="/site/:siteId/banking" element={<React.Suspense fallback={<RouteLoading />}><SiteBanking /></React.Suspense>} />
                <Route path="/site/:siteId/about" element={<React.Suspense fallback={<RouteLoading />}><SiteLanding /></React.Suspense>} />
                <Route path="/site/:siteId/services" element={<React.Suspense fallback={<RouteLoading />}><SiteLanding /></React.Suspense>} />
                <Route path="/site/:siteId/contact" element={<React.Suspense fallback={<RouteLoading />}><SiteLanding /></React.Suspense>} />
                <Route path="/site/:siteId/login" element={<React.Suspense fallback={<RouteLoading />}><SiteAuth /></React.Suspense>} />
                <Route path="/site/:siteId/signup" element={<React.Suspense fallback={<RouteLoading />}><SiteAuth /></React.Suspense>} />
                <Route path="/site/:siteId/dashboard" element={<React.Suspense fallback={<RouteLoading />}><SiteDashboard /></React.Suspense>} />
                <Route path="/site/:siteId/accounts" element={<React.Suspense fallback={<RouteLoading />}><SiteAccounts /></React.Suspense>} />
                <Route path="/site/:siteId/transactions" element={<React.Suspense fallback={<RouteLoading />}><SiteTransactions /></React.Suspense>} />
                <Route path="/site/:siteId/kyc" element={<React.Suspense fallback={<RouteLoading />}><SiteKyc /></React.Suspense>} />
                <Route path="/site/:siteId/notifications" element={<React.Suspense fallback={<RouteLoading />}><SiteDashboard /></React.Suspense>} />
                <Route path="/site/:siteId/admin" element={<React.Suspense fallback={<RouteLoading />}><SiteAdmin /></React.Suspense>} />
                <Route path="/:tenant/banking" element={<React.Suspense fallback={<RouteLoading />}><SiteBanking /></React.Suspense>} />
                <Route path="/t/:subdomain/banking" element={<React.Suspense fallback={<RouteLoading />}><TenantBankingHost /></React.Suspense>} />
                {/* White-label tenant portal — full brand replacement, own customer auth */}
                <Route path="/t/:subdomain" element={<PortalLogin />} />
                <Route path="/t/:subdomain/login" element={<PortalLogin />} />
                <Route path="/t/:subdomain/dashboard" element={<PortalDashboard />} />
                <Route path="/t/:subdomain/kyc" element={<PortalKyc />} />
                <Route path="/t/:subdomain/ledger" element={<PortalLedger />} />
                <Route path="/t/:subdomain/settings" element={<PortalSettings />} />

                {/* Authenticated app routes with layout */}
                <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  {/* `/app` is the Master Prompt's name for the personal workspace dashboard. */}
                  <Route path="/app" element={<Dashboard />} />
                  <Route path="/app/ledger" element={<Ledger />} />
                  <Route path="/ledger" element={<Ledger />} />
                  <Route path="/app/shipments" element={<Shipments />} />
                  <Route path="/services/my" element={<MyServices />} />
                  <Route path="/billing" element={<Billing />} />
                  <Route path="/personal" element={<Personal />} />
                  <Route path="/personal/wallet" element={<Wallet />} />
                  <Route path="/personal/transactions" element={<Wallet />} />
                  <Route path="/shipments" element={<Shipments />} />
                  <Route path="/vtu" element={<VtuCatalog />} />
                  <Route path="/vtu/airtime" element={<VtuAirtime />} />
                  <Route path="/vtu/bills" element={<VtuBills />} />
                  <Route path="/vtu/data" element={<VtuData />} />
                  <Route path="/vtu/electricity" element={<VtuElectricity />} />
                  <Route path="/vtu/exam-pins" element={<VtuExamPins />} />
                  <Route path="/vtu/history" element={<VtuHistory />} />
                  <Route path="/shipments/new" element={<NewShipment />} />
                  <Route path="/app/shipments/new" element={<NewShipment />} />
                  <Route path="/shipments/:id" element={<ShipmentDetail />} />
                  <Route path="/app/shipments/:id" element={<ShipmentDetail />} />
                  <Route path="/shipments/:id/updates" element={<ShipmentUpdates />} />
                  <Route path="/shipments/:id/edit" element={<ShipmentUpdateForm />} />
                  <Route path="/ticketing" element={<Ticketing />} />
                  <Route path="/ticketing/flight" element={<FlightDocument />} />
                  <Route path="/ticketing/hotel" element={<HotelDocument />} />
                  <Route path="/ticketing/invoice" element={<InvoiceDocument />} />
                  <Route path="/ticketing/customs" element={<CustomsDocument />} />
                  <Route path="/business" element={<BusinessSuite />} />
                  <Route path="/business/sites" element={<BusinessSuite />} />
                  <Route path="/business/sites/new" element={<NewSite />} />
                  <Route path="/app/business" element={<BusinessSuite />} />
                  <Route path="/app/business/:siteId" element={<BusinessSiteDetail />} />
                  <Route path="/business/sites/:siteId" element={<BusinessSiteDetail />} />
                  <Route path="/documents" element={<DocumentsPage />} />
                  <Route path="/documents/templates" element={<DocumentTemplates />} />
                  <Route path="/documents/generate" element={<DocumentGenerator />} />
                  <Route path="/documents/own/new" element={<OwnDocumentTemplate />} />
                  <Route path="/documents/own/:templateId" element={<OwnDocumentTemplate />} />
                  <Route path="/documents/new/:templateId" element={<DocumentBuilder />} />
                  <Route path="/documents/:documentId" element={<DocumentDetail />} />
                  <Route path="/services" element={<Services />} />
                  <Route path="/services/email" element={<EmailCampaign />} />
                  <Route path="/services/email/new" element={<EmailComposer />} />
                  <Route path="/app/services/email" element={<EmailCampaign />} />
                  <Route path="/app/services/email/new" element={<EmailComposer />} />
                  <Route path="/services/render" element={<RenderStudio />} />
                  <Route path="/services/images" element={<ImageStudio />} />
                  <Route path="/app/services/images" element={<ImageStudio />} />
                  <Route path="/services/assets" element={<AssetManager />} />
                  <Route path="/app/services/assets" element={<AssetManager />} />
                  <Route path="/app/marketplace" element={<PointMarketplace />} />
                  <Route path="/app/marketplace/orders/:orderId" element={<PointOrderDetail />} />
                  <Route path="/app/vendor" element={<VendorDashboard />} />
                  <Route path="/app/vendor/apply" element={<VendorApply />} />
                  <Route path="/marketplace" element={<MarketplacePage />} />
                  <Route path="/marketplace/numbers" element={<MarketplacePage />} />
                  <Route path="/marketplace/boost" element={<MarketplacePage />} />
                  <Route path="/marketplace/orders" element={<Orders />} />
                  <Route path="/referrals" element={<Referrals />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/support" element={<Support />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/buy-points" element={<BuyPoints />} />
                  <Route path="/wallet/fund" element={<BuyPoints />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/vendor" element={<Vendor />} />
                  <Route path="/transactions" element={<Transactions />} />
                  <Route path="/app/design-system" element={<DesignSystem />} />

                </Route>

                {/* Admin routes — server-side authorization re-verified in every admin Convex function */}
                <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
                  <Route index element={<Admin />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="users/:userId" element={<AdminUserDetail />} />
                  <Route path="vendors" element={<AdminVendors />} />
                  <Route path="vendors/:vendorId" element={<AdminVendorDetail />} />
                  <Route path="marketplace" element={<AdminMarketplace />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="disputes" element={<AdminDisputes />} />
                  <Route path="transactions" element={<AdminTransactions />} />
                  <Route path="risk" element={<AdminRisk />} />
                  <Route path="maintenance" element={<AdminMaintenance />} />
                  <Route path="shipments" element={<AdminShipments />} />
                  <Route path="shipments/create" element={<AdminCreateShipment />} />
                  <Route path="shipments/:shipmentId" element={<AdminShipmentDetail />} />
                  <Route path="locations" element={<AdminLocations tab="locations" />} />
                  <Route path="facilities" element={<AdminLocations tab="facilities" />} />
                  <Route path="documents" element={<AdminDocuments />} />
                  <Route path="document-templates" element={<AdminDocumentTemplates />} />
                  <Route path="document-templates/new" element={<AdminDocumentTemplateEditor />} />
                  <Route path="document-templates/:templateId/edit" element={<AdminDocumentTemplateEditor />} />
                  <Route path="document-templates/classify" element={<AdminTemplateClassifier />} />
                  <Route path="template-classifier" element={<AdminTemplateClassifier />} />
                  <Route path="tenants" element={<AdminTenants />} />
                  <Route path="tenants/new" element={<AdminBankingCreateTenant />} />
                  <Route path="tenants/banking" element={<AdminBankingTenants />} />
                  <Route path="tenants/:tenantId/banking" element={<AdminBankingTenantDetail />} />
                  <Route path="tenants/:tenantId/banking/settings" element={<AdminBankingTenantSettings />} />
                  <Route path="kyc" element={<AdminKYC />} />
                  <Route path="notifications" element={<AdminNotifications />} />
                  <Route path="audit" element={<AdminAuditLogs />} />
                  <Route path="audit-logs" element={<AdminAuditLogs />} />
                  <Route path="analytics" element={<AdminAnalytics />} />
                  <Route path="system-health" element={<AdminInfrastructure />} />
                  <Route path="infrastructure" element={<AdminInfrastructure />} />
                  <Route path="pricing" element={<AdminPricing />} />
                  <Route path="vtu/providers" element={<AdminVtuProviders />} />
                  <Route path="vtu/catalog" element={<AdminVtuCatalog />} />
                  <Route path="vtu/unresolved" element={<AdminVtuUnresolved />} />
                  <Route path="catalog" element={<AdminCatalog />} />
                  <Route path="settings" element={<AdminSettings />} />
                  <Route path="appearance" element={<AdminAppearance />} />
                  <Route path="settings/email" element={<AdminEmailSettings />} />
                  <Route path="email" element={<AdminEmailSettings />} />
                  <Route path="payments" element={<AdminPaymentProviders />} />
                  <Route path="administrators" element={<AdminAdministrators />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
              </RouteTransition>
              </TenantGateLazy>
            </Suspense>
            {/* Config-driven support launcher — hidden on admin + tenant banking surfaces */}
            <SupportWidget />
          </BrowserRouter>
          <Toaster />
        </ThemeProvider>
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
