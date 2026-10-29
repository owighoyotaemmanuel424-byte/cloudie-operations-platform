import { createClient } from "@libsql/client";

/**
 * Read-only deployment probe. It intentionally does not run migrations or mutate data.
 * Keep this endpoint limited to connectivity; never return credentials or SQL errors.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const respond = (status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return respond(405, { ok: false, error: "Method not allowed" });
  }

  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (!url) {
    return respond(503, {
      ok: false,
      database: "turso",
      error: "Database is not configured",
    });
  }

  const client = createClient({ url, authToken: authToken || undefined });

  try {
    await client.execute("SELECT 1 AS ok");
    return respond(200, {
      ok: true,
      database: "turso",
      configured: true,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return respond(503, {
      ok: false,
      database: "turso",
      error: "Database connectivity check failed",
    });
  } finally {
    client.close();
  }
}
