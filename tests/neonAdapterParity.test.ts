import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { api } from "../src/convex/_generated/api";
import { resolveFunctionName } from "../src/lib/neonClient";
import { formatNgn, formatUsd, DEFAULT_POINT_PACKAGES } from "../src/lib/pricing";
import { fmtMoney } from "../src/lib/money";
import { discoverMigrations, computeChecksum } from "../api/scripts/migrate.mjs";
import { verifyDistDirectory } from "../scripts/verify-dist.mjs";

describe("Neon adapter & currency formatting regression suite", () => {
  test("resolveFunctionName extracts exact module:fn name from Convex anyApi Proxies", () => {
    expect(resolveFunctionName(api.wallet.getBalance)).toBe("wallet:getBalance");
    expect(resolveFunctionName(api.points.getBalance)).toBe("points:getBalance");
    expect(resolveFunctionName(api.wallet.getLedger)).toBe("wallet:getLedger");
    expect(resolveFunctionName(api.shipments.listMy)).toBe("shipments:listMy");
    expect(resolveFunctionName(api.serviceHub.getOverview)).toBe("serviceHub:getOverview");
    expect(resolveFunctionName(api.adminApi.adminDashboard)).toBe("adminApi:adminDashboard");
    expect(resolveFunctionName(api.trackingQueries.publicTracking)).toBe("trackingQueries:publicTracking");
    expect(resolveFunctionName("custom:query")).toBe("custom:query");
    expect(resolveFunctionName(null)).toBe("");
  });

  test("formatNgn and fmtMoney never produce ₦[object Object] or ₦NaN for any input shape", () => {
    expect(formatNgn(0)).toBe("₦0");
    expect(formatNgn(1500)).toBe("₦1,500");
    expect(formatNgn(-2500)).toBe("-₦2,500");
    expect(formatNgn(NaN)).toBe("₦0");
    expect(formatNgn(undefined)).toBe("₦0");
    expect(formatNgn(null)).toBe("₦0");
    expect(formatNgn({ balance: 0, ngnEquivalent: 0, currency: "NGN" })).toBe("₦0");
    expect(formatNgn({ walletBalanceNgn: 5000 })).toBe("₦5,000");
    expect(formatNgn("12500")).toBe("₦12,500");
    expect(formatNgn("invalid")).toBe("₦0");

    expect(fmtMoney({ balance: 0 } as never, "NGN")).toBe("₦0.00");
    expect(fmtMoney({ walletBalanceNgn: 150000 } as never, "NGN")).toBe("₦1,500.00");
    expect(fmtMoney(NaN, "NGN")).toBe("₦0.00");
    expect(fmtMoney(undefined, "NGN")).toBe("₦0.00");
  });

  test("formatUsd never produces $[object Object] or $NaN for any input shape", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(NaN)).toBe("$0.00");
    expect(formatUsd(undefined)).toBe("$0.00");
    expect(formatUsd({ balance: 25 })).toBe("$25.00");
  });

  test("DEFAULT_POINT_PACKAGES provides valid funding presets", () => {
    expect(DEFAULT_POINT_PACKAGES.length).toBeGreaterThanOrEqual(3);
    for (const pkg of DEFAULT_POINT_PACKAGES) {
      expect(typeof pkg.id).toBe("string");
      expect(typeof pkg.name).toBe("string");
      expect(pkg.priceNgn).toBeGreaterThan(0);
      expect(pkg.points).toBeGreaterThan(0);
    }
  });

  test("ordered SQL migrations are discovered with deterministic SHA-256 checksums", () => {
    const migrations = discoverMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(6);
    const versions = migrations.map((m) => m.version);
    // The runner applies migrations in lexical order; the baseline phases 001–006
    // must always be present, and later phases (e.g. 007) simply extend the list.
    expect(versions).toEqual([...versions].sort());
    expect(versions.slice(0, 6)).toEqual(["001", "002", "003", "004", "005", "006"]);
    for (const m of migrations) {
      expect(m.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(computeChecksum(m.sql)).toBe(m.checksum);
    }
  });

  test("public/.htaccess and public/sw.js prevent text/html JavaScript MIME errors", () => {
    const htaccess = readFileSync("public/.htaccess", "utf8");
    expect(htaccess).toContain("AddType text/javascript .js .mjs");
    expect(htaccess).toContain("AddType text/css .css");
    expect(htaccess).toContain("RewriteCond %{REQUEST_URI} ^/assets/ [OR]");
    expect(htaccess).toContain("RewriteRule ^ - [R=404,L]");
    expect(htaccess).toContain("RewriteRule ^ /index.html [L]");
    expect(htaccess).toContain("no-cache, no-store, must-revalidate");
    expect(htaccess).toContain("public, max-age=31536000, immutable");

    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain('const CACHE_VERSION = "cloudie-v3"');
    expect(sw).toContain("function hasValidAssetMimeType(url, response)");
    expect(sw).toContain('contentType.includes("text/html")');

    const mainTsx = readFileSync("src/main.tsx", "utf8");
    expect(mainTsx).toContain('import Dashboard from "./pages/Dashboard.tsx"');
    expect(mainTsx).toContain('import { AppShell } from "./components/nav/AppShell"');
    expect(mainTsx).toContain('window.addEventListener("vite:preloadError"');
  });

  test("production dist output passes asset and MIME verification when built", () => {
    if (existsSync("dist/index.html")) {
      const summary = verifyDistDirectory();
      expect(summary.htmlAssetCount).toBeGreaterThanOrEqual(4);
      expect(summary.totalAssetFiles).toBeGreaterThan(10);
    }
  });
});

