import { createClient } from "@libsql/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Read-only deployment probe. It intentionally does not run migrations or mutate data.
 * Keep this endpoint limited to connectivity; never return credentials or SQL errors.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (_req.method !== "GET" && _req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) {
    return res.status(503).json({
      ok: false,
      database: "turso",
      error: "Database is not configured",
    });
  }

  const client = createClient({ url, authToken: authToken || undefined });
  try {
    await client.execute("SELECT 1 AS ok");
    return res.status(200).json({
      ok: true,
      database: "turso",
      configured: true,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      ok: false,
      database: "turso",
      error: "Database connectivity check failed",
    });
  } finally {
    client.close();
  }
}
