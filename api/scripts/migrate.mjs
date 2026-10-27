#!/usr/bin/env node
/**
 * Ordered, repeatable PostgreSQL migration runner for Cloudie Operations Platform.
 *
 * Guarantees:
 * - Applies SQL migrations in lexical order from ../migrations/*.sql
 * - Each migration's schema changes AND its schema_migrations record commit in
 *   ONE runner-owned transaction, so a database can never contain a migration's
 *   objects without the history row (or the reverse).
 * - Explicit `BEGIN;`/`COMMIT;` wrappers inside a migration file are removed
 *   before execution; the runner owns the transaction. PL/pgSQL bodies, string
 *   literals and dollar-quoted blocks are never rewritten.
 * - Statements that cannot run inside a transaction block (e.g. CREATE INDEX
 *   CONCURRENTLY, VACUUM) are rejected up front instead of silently breaking
 *   atomicity.
 * - Acquires a PostgreSQL session advisory lock to prevent concurrent runs
 * - Tracks applied versions and SHA-256 checksums in schema_migrations
 * - Refuses to silently accept migration checksum drift
 * - Supports --dry-run: fully READ-ONLY (no CREATE/ALTER, no writes at all)
 * - Supports TEST_DATABASE_URL or DATABASE_URL
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADVISORY_LOCK_KEY = 729481023;
const migrationsDir = resolve(import.meta.dirname, "../../migrations");

export function computeChecksum(sqlContent) {
  const normalized = sqlContent.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function discoverMigrations(dir = migrationsDir) {
  const files = readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b));

  return files.map((filename) => {
    const version = filename.split("_")[0];
    const fullPath = join(dir, filename);
    const sql = readFileSync(fullPath, "utf8");
    const checksum = computeChecksum(sql);
    return { version, filename, fullPath, sql, checksum };
  });
}

/**
 * Split SQL into statements without breaking on semicolons inside string
 * literals, quoted identifiers, dollar-quoted bodies (PL/pgSQL), line comments
 * or nested block comments.
 *
 * Returns `{ raw, code }` pairs: `raw` is the statement as written (executed),
 * `code` is the same statement with comments blanked out (used for
 * classification only). Comments inside literals are preserved in both.
 */
export function splitSqlStatements(sql) {
  const statements = [];
  let raw = "";
  let code = "";
  let state = "normal";
  let dollarTag = "";
  let blockDepth = 0;

  const push = (ch, alsoCode = true) => {
    raw += ch;
    code += alsoCode ? ch : " ";
  };

  const flush = () => {
    if (code.trim().length > 0) statements.push({ raw: raw.trim(), code: code.trim() });
    raw = "";
    code = "";
  };

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === "line-comment") {
      push(ch, false);
      if (ch === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        push("*/", false);
        i += 1;
        blockDepth -= 1;
        if (blockDepth === 0) state = "normal";
        continue;
      }
      if (ch === "/" && next === "*") {
        push("/*", false);
        i += 1;
        blockDepth += 1;
        continue;
      }
      push(ch, false);
      continue;
    }

    if (state === "single-quote") {
      push(ch);
      if (ch === "'" && next === "'") {
        push(next);
        i += 1;
      } else if (ch === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double-quote") {
      push(ch);
      if (ch === '"' && next === '"') {
        push(next);
        i += 1;
      } else if (ch === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (ch === "$" && sql.startsWith(dollarTag, i)) {
        for (const tagChar of dollarTag) push(tagChar);
        i += dollarTag.length - 1;
        state = "normal";
        continue;
      }
      push(ch);
      continue;
    }

    // normal state
    if (ch === "-" && next === "-") {
      push("--", false);
      i += 1;
      state = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      push("/*", false);
      i += 1;
      blockDepth = 1;
      state = "block-comment";
      continue;
    }
    if (ch === "'") {
      push(ch);
      state = "single-quote";
      continue;
    }
    if (ch === '"') {
      push(ch);
      state = "double-quote";
      continue;
    }
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tagMatch) {
        dollarTag = tagMatch[0];
        for (const tagChar of dollarTag) push(tagChar);
        i += dollarTag.length - 1;
        state = "dollar-quote";
        continue;
      }
    }
    if (ch === ";") {
      flush();
      continue;
    }
    push(ch);
  }

  flush();
  return statements;
}

const BARE_TRANSACTION_CONTROL =
  /^(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION|COMMIT(?:\s+(?:WORK|TRANSACTION))?|END(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?)$/i;

const OTHER_TRANSACTION_CONTROL = /^(?:SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO|ABORT)\b/i;

const NON_TRANSACTIONAL = [
  [/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i, "CREATE INDEX CONCURRENTLY"],
  [/\bDROP\s+INDEX\s+CONCURRENTLY\b/i, "DROP INDEX CONCURRENTLY"],
  [/\bREINDEX\b[\s\S]*\bCONCURRENTLY\b/i, "REINDEX CONCURRENTLY"],
  [/\bVACUUM\b/i, "VACUUM"],
  [/\bCREATE\s+DATABASE\b/i, "CREATE DATABASE"],
  [/\bDROP\s+DATABASE\b/i, "DROP DATABASE"],
  [/\bCREATE\s+TABLESPACE\b/i, "CREATE TABLESPACE"],
  [/\bALTER\s+TYPE\b[\s\S]*\bADD\s+VALUE\b/i, "ALTER TYPE ... ADD VALUE"],
];

/**
 * Turn a migration file into the ordered list of statements the runner will
 * execute inside its own transaction.
 *
 * Throws when the file needs a transaction context the runner cannot give it.
 */
export function planMigrationStatements(migration) {
  const statements = splitSqlStatements(migration.sql);
  const executable = [];

  for (const statement of statements) {
    const bare = statement.code.replace(/;\s*$/, "").trim();

    if (BARE_TRANSACTION_CONTROL.test(bare)) continue;
    if (OTHER_TRANSACTION_CONTROL.test(bare)) {
      throw new Error(
        `Migration ${migration.filename} contains transaction control ("${bare.split(/\s+/)[0]}") ` +
          `that cannot be nested inside the runner's transaction. Remove it from the migration file.`,
      );
    }
    for (const [pattern, label] of NON_TRANSACTIONAL) {
      if (pattern.test(statement.code)) {
        throw new Error(
          `Migration ${migration.filename} contains ${label}, which PostgreSQL refuses to run inside a ` +
            `transaction block. Migrations must be atomic, so this statement must be applied as a separate, ` +
            `explicitly reviewed operation instead.`,
        );
      }
    }
    executable.push(statement.raw);
  }

  return executable;
}

const CREATE_HISTORY_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

/**
 * Read the recorded migration history without writing anything.
 *
 * Tolerates the legacy bookkeeping table created by migration 001 (which has a
 * `description` column and no `filename`).
 */
export async function loadAppliedMigrations(client) {
  const exists = await client.query("SELECT to_regclass('public.schema_migrations') AS oid");
  if (!exists.rows?.[0]?.oid) return new Map();

  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
  );
  const names = new Set((columns.rows ?? []).map((row) => row.column_name));
  if (!names.has("version")) return new Map();

  const checksumExpr = names.has("checksum") ? "checksum" : "NULL::text";
  const filenameExpr = names.has("filename")
    ? "filename"
    : names.has("description")
      ? "version || '.sql'"
      : "NULL::text";

  const result = await client.query(
    `SELECT version, ${filenameExpr} AS filename, ${checksumExpr} AS checksum, applied_at
     FROM schema_migrations ORDER BY version ASC`,
  );
  return new Map((result.rows ?? []).map((row) => [row.version, row]));
}

/**
 * Bring a legacy bookkeeping table up to the runner's shape, additively.
 * Never drops or rewrites history.
 */
async function normalizeHistoryTable(client) {
  const columnResult = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
  );
  const columnNames = new Set((columnResult.rows ?? []).map((row) => row.column_name));
  if (!columnNames.has("filename")) {
    await client.query("ALTER TABLE schema_migrations ADD COLUMN filename TEXT");
  }
  if (columnNames.has("description")) {
    await client.query("ALTER TABLE schema_migrations ALTER COLUMN description SET DEFAULT ''");
    await client.query(
      "UPDATE schema_migrations SET filename = version || '.sql' WHERE filename IS NULL",
    );
  }
}

function label(statement) {
  return statement.replace(/\s+/g, " ").slice(0, 80);
}

/**
 * Apply pending migrations against an already-connected client.
 *
 * Exported so tests can drive the exact transaction behaviour with a fake
 * client instead of a live database.
 */
export async function runMigrationPlan({
  client,
  migrations,
  applied,
  dryRun = false,
  logger = console,
}) {
  const summary = { applied: [], skipped: [], pending: [] };

  if (!dryRun) {
    await client.query(CREATE_HISTORY_TABLE);
    await normalizeHistoryTable(client);
  }

  for (const migration of migrations) {
    const recorded = applied.get(migration.version);
    if (recorded) {
      if (recorded.checksum && recorded.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum drift detected for version ${migration.version} (${migration.filename}): ` +
            `database has ${recorded.checksum}, file has ${migration.checksum}. Refusing to proceed.`,
        );
      }
      summary.skipped.push(migration.filename);
      continue;
    }

    const statements = planMigrationStatements(migration);

    if (dryRun) {
      logger.log(
        `[migrate:dry-run] Would apply ${migration.filename} (${migration.checksum.slice(0, 12)}..., ${statements.length} statements)`,
      );
      summary.pending.push(migration.filename);
      continue;
    }

    if (statements.length === 0) {
      // Nothing to execute, but the history row must still be recorded so the
      // version is not re-planned forever.
      logger.log(`[migrate] ${migration.filename} contains no executable statements; recording it.`);
    }

    logger.log(`[migrate] Applying ${migration.filename}...`);
    await client.query("BEGIN");
    try {
      for (const statement of statements) {
        try {
          await client.query(statement);
        } catch (err) {
          throw new Error(
            `statement failed: ${label(statement)}${err instanceof Error ? `: ${err.message}` : ""}`,
          );
        }
      }
      await client.query(
        `INSERT INTO schema_migrations (version, filename, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.filename, migration.checksum],
      );
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // A dead connection rolls back server-side; there is nothing to do but
        // surface the original failure. The migration is never recorded.
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Migration ${migration.filename} failed and was rolled back; schema_migrations was not updated. Cause: ${reason}`,
      );
    }

    summary.applied.push(migration.filename);
    logger.log(`[migrate] Applied ${migration.filename}`);
  }

  return { ...summary, dryRun };
}

export async function runMigrations({
  connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  dryRun = process.argv.includes("--dry-run"),
  logger = console,
  migrations = discoverMigrations(),
  createClient,
} = {}) {
  if (migrations.length === 0) {
    throw new Error(`No SQL migration files found in ${migrationsDir}`);
  }

  // Validate every file before touching the database: a non-atomic statement
  // must never be discovered halfway through a run.
  for (const migration of migrations) planMigrationStatements(migration);

  const isPlaceholderUrl =
    !connectionString || connectionString.includes("@HOST") || connectionString.includes("//USER:");
  if (dryRun && isPlaceholderUrl) {
    logger.log(`[migrate:dry-run] No database configured; validating files only.`);
    logger.log(`[migrate:dry-run] Discovered ${migrations.length} ordered migrations:`);
    for (const m of migrations) {
      const statements = planMigrationStatements(m);
      logger.log(
        `  - ${m.filename} (version=${m.version}, sha256=${m.checksum.slice(0, 12)}..., ${statements.length} statements)`,
      );
    }
    return { applied: [], skipped: [], pending: migrations.map((m) => m.filename), dryRun: true };
  }

  if (!connectionString) {
    throw new Error("DATABASE_URL or TEST_DATABASE_URL is required to run migrations.");
  }

  const client = createClient
    ? await createClient(connectionString)
    : await (async () => {
        const { default: pg } = await import("pg");
        const created = new pg.Client({ connectionString });
        await created.connect();
        return created;
      })();

  let locked = false;
  try {
    if (dryRun) {
      // Shared lock: conflicts with an applying run, proves nobody is migrating
      // while we read, and writes nothing.
      await client.query("SELECT pg_advisory_lock_shared($1)", [ADVISORY_LOCK_KEY]);
    } else {
      await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    }
    locked = true;

    const applied = await loadAppliedMigrations(client);
    return await runMigrationPlan({ client, migrations, applied, dryRun, logger });
  } finally {
    if (locked) {
      const fn = dryRun ? "pg_advisory_unlock_shared" : "pg_advisory_unlock";
      await client.query(`SELECT ${fn}($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  runMigrations()
    .then((summary) => {
      console.log(
        `[migrate] Complete. Applied: ${summary.applied.length}, Already up-to-date: ${summary.skipped.length}` +
          (summary.dryRun ? `, Pending (dry-run): ${summary.pending.length}` : ""),
      );
    })
    .catch((err) => {
      console.error("[migrate] Failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
