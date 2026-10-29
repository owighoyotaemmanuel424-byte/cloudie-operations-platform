import { createClient } from "@libsql/client";

/**
 * Read-only deployment probe. Checks both connectivity and the minimum auth
 * schema required by registration. Never runs migrations or exposes SQL errors.
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
      configured: false,
      error: "Database is not configured",
    });
  }

  const client = createClient({ url, authToken: authToken || undefined });

  try {
    await client.execute("SELECT 1 AS ok");

    const requiredTables = ["app_users", "api_sessions"];
    const tablesResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_users','api_sessions')",
    );
    const existingTables = new Set(tablesResult.rows.map((row) => String(row.name)));
    const missingTables = requiredTables.filter((table) => !existingTables.has(table));

    let missingColumns = [];
    if (existingTables.has("app_users")) {
      const columns = await client.execute("PRAGMA table_info(app_users)");
      const names = new Set(columns.rows.map((row) => String(row.name)));
      missingColumns = ["id", "name", "email", "role", "password_hash", "is_suspended", "is_terminated"]
        .filter((column) => !names.has(column))
        .map((column) => `app_users.${column}`);
    }
    if (existingTables.has("api_sessions")) {
      const columns = await client.execute("PRAGMA table_info(api_sessions)");
      const names = new Set(columns.rows.map((row) => String(row.name)));
      missingColumns.push(
        ...["id", "user_id", "expires_at", "revoked_at"]
          .filter((column) => !names.has(column))
          .map((column) => `api_sessions.${column}`),
      );
    }

    const schemaReady = missingTables.length === 0 && missingColumns.length === 0;
    return respond(schemaReady ? 200 : 503, {
      ok: schemaReady,
      database: "turso",
      configured: true,
      schema_ready: schemaReady,
      ...(schemaReady ? {} : { missing_tables: missingTables, missing_columns: missingColumns }),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return respond(503, {
      ok: false,
      database: "turso",
      configured: true,
      error: "Database connectivity or schema check failed",
    });
  } finally {
    client.close();
  }
}
