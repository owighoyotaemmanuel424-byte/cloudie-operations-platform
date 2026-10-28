#!/usr/bin/env node
/**
 * Verifies the active browser/API runtime is Vercel + Turso, not a live Convex
 * client or legacy Neon/Render origin. This is a runtime guard, not a claim that
 * every historical Convex function has API feature parity.
 */
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, `file://${process.cwd()}/`), "utf8");
const [pkgText, main, vite, apiClient, apiServer, apiEntry, envExample] = await Promise.all([
  read("package.json"),
  read("src/main.tsx"),
  read("vite.config.ts"),
  read("src/lib/neonApi.ts"),
  read("api/src/server.ts"),
  read("api/[...path].ts"),
  read(".env.example"),
]);
const pkg = JSON.parse(pkgText);
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

check(!main.includes("ConvexReactClient"), "src/main.tsx still instantiates a Convex client");
check(!main.includes("VITE_CONVEX_URL"), "src/main.tsx still reads VITE_CONVEX_URL");
check(vite.includes('"convex/react": path.resolve(__dirname, "./src/lib/neonClient.tsx")'), "Vite must route legacy React hooks through the Turso-backed compatibility client");
check(vite.includes('"convex/server": path.resolve(__dirname, "./src/lib/convexServerCompat.ts")'), "Vite must use the local API-reference compatibility proxy");
check(!pkg.dependencies?.convex && !pkg.dependencies?.["@convex-dev/auth"] && !pkg.dependencies?.["@auth/core"], "Convex packages must not be production dependencies");
check(!Object.hasOwn(pkg.scripts ?? {}, "deploy:convex") && !Object.hasOwn(pkg.scripts ?? {}, "build:freebuff"), "legacy Convex deployment scripts remain enabled");
check(apiClient.includes('credentials: "include"'), "browser API requests must include same-origin session cookies");
check(apiClient.includes("VITE_API_BASE_URL") && apiClient.includes('|| ""'), "API client must default to same-origin Vercel routing");
check(!apiClient.includes("VITE_NEON_API_URL") && !apiClient.includes("onrender.com"), "API client still references the legacy Neon/Render origin");
check(apiServer.includes('from "./db.js"') && !apiServer.includes('from "pg"'), "API runtime must use the Turso adapter, not the PostgreSQL driver");
check(apiEntry.includes('from "@hono/node-server"') && apiEntry.includes("./src/server.js"), "Vercel catch-all function is not wired to the Hono app");
check(!envExample.includes("VITE_CONVEX_URL"), "environment template still requests a Convex URL");

if (failures.length) {
  console.error("Turso runtime guard failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Turso runtime guard passed: same-origin cookie client, Vercel Hono function, and no production Convex client/dependency.");
  console.log("Feature parity and live data import remain separately gated.");
}
