import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cloudie — one platform, five workspaces", template: "%s · Cloudie" },
  description: "A modular workspace platform powered by usage-based points.",
  manifest: "/manifest.json",
  applicationName: "Cloudie",
};
export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}<script src="/sw-register.js" defer /></body></html>;
}
