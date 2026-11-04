import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getRequestListener } from "@hono/node-server";
import type { Plugin } from "vite";

const execFileAsync = promisify(execFile);

/**
 * Serves the app's Hono API from the Vite dev server.
 *
 * `backend/src/server.ts` is deployed as a Vercel Node function
 * (`api/[...path].js`). A plain `vite dev` has no such runtime, so every `/api`
 * request fell through to the SPA fallback: `GET /api/me` answered `index.html`
 * with a 200 and `POST /api/auth/login` answered 404. Sign-in and registration
 * therefore could never succeed outside Vercel.
 *
 * Development only (`apply: "serve"`). The same Hono app is mounted in-process,
 * unchanged, against a local libSQL file database (`.data/`, gitignored) when
 * `TURSO_DATABASE_URL` is not configured. Production keeps using the Vercel
 * function and Turso.
 */

/** Fixed dev-only signing key so sessions survive a dev-server restart. */
const DEV_JWT_SECRET = "cloudie-local-development-jwt-secret-not-for-production";
const API_PATHS = ["/api/", "/health", "/ready"];
const DB_FILE = path.join(".data", "cloudie.db");

function isApiRequest(url: string): boolean {
  return API_PATHS.some((prefix) => url === prefix || url.startsWith(prefix));
}

export function devApiPlugin(): Plugin {
  return {
    name: "cloudie-dev-api",
    apply: "serve",
    configureServer(server) {
      let listenerPromise: Promise<ReturnType<typeof getRequestListener>> | undefined;

      async function createListener() {
        const root = server.config.root;

        // Vite owns the socket and hands requests to the app, so the API module
        // must not bind a port of its own.
        process.env.CLOUDIE_EMBEDDED_API = "1";
        // The sandbox HTTPS proxy in front of the preview rewrites Host to
        // localhost while forwarding the browser's Origin, so the API's origin
        // allowlist could never match. Trust the origin this dev server serves.
        process.env.CLOUDIE_DEV_TRUST_ORIGIN = "1";
        process.env.JWT_SECRET ||= DEV_JWT_SECRET;

        let databaseUrl = process.env.TURSO_DATABASE_URL?.trim();
        if (!databaseUrl) {
          const file = path.join(root, DB_FILE);
          await mkdir(path.dirname(file), { recursive: true });
          databaseUrl = `file:${file}`;
          process.env.TURSO_DATABASE_URL = databaseUrl;
          // Same migrations and checksum tracking the Turso deploy uses.
          await execFileAsync(
            process.execPath,
            [path.join(root, "backend/scripts/migrate-turso.mjs")],
            { cwd: root, env: process.env },
          );
          server.config.logger.info(`[dev-api] local database ${databaseUrl}`);
        }

        const mod = (await server.ssrLoadModule("/backend/src/server.ts")) as {
          app: { fetch: Parameters<typeof getRequestListener>[0] };
        };
        return getRequestListener(mod.app.fetch);
      }

      // Registered before Vite's own middlewares so `/api` never reaches the SPA
      // history fallback (which would answer with HTML).
      server.middlewares.use((req, res, next) => {
        if (!isApiRequest(req.url ?? "")) {
          next();
          return;
        }

        listenerPromise ??= createListener().catch((error: unknown) => {
          listenerPromise = undefined;
          throw error;
        });

        listenerPromise
          .then((listener) => listener(req, res))
          .catch((error: unknown) => {
            server.config.logger.error(
              `[dev-api] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
            );
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
            }
            res.end(JSON.stringify({ error: "Local API unavailable" }));
          });
      });
    },
  };
}
