import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { PlatformProvider } from "@/platform/Provider";
import { AppShell, RequireAuth } from "@/app/AppShell";
import Landing from "@/app/Landing";
import AuthPage from "@/app/AuthPage";
import "./index.css";

const PersonalPage = lazy(() => import("@/app/Personal"));
const ShipmentsPage = lazy(() => import("@/app/Shipments"));
const TicketingPage = lazy(() => import("@/app/Ticketing"));
const BusinessPage = lazy(() => import("@/app/Business"));
const ServicesPage = lazy(() => import("@/app/Services"));
const PublicTracking = lazy(() => import("@/app/PublicTracking"));
const PublicDocument = lazy(() => import("@/app/PublicDocument"));

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/register" element={<AuthPage />} />
            <Route path="/track/:token" element={<PublicTracking />} />
            <Route path="/d/:token" element={<PublicDocument />} />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/app/personal" replace />} />
              <Route path="personal" element={<PersonalPage />} />
              <Route path="shipments" element={<ShipmentsPage />} />
              <Route path="ticketing" element={<TicketingPage />} />
              <Route path="business" element={<BusinessPage />} />
              <Route path="services" element={<ServicesPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
    </PlatformProvider>
  </StrictMode>,
);
