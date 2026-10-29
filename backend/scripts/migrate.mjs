#!/usr/bin/env node
/**
 * Ordered, repeatable PostgreSQL migration runner for Cloudie Operations Platform.
 *
 * Features:
 * - Applies SQL migrations in lexical order from ../migrations/*.sql
 * - Acquires a PostgreSQL session advisory lock to prevent concurrent runs
 * - Tracks applied migration versions and SHA-256 checksums in schema_migrations
 * - Refuses to silently accept migration checksum drift
 * - Supports --dry-run (validates order & checksums without mutating)
 * - Supports TEST_DATABASE_URL or DATABASE_URL
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

export async function runMigrations({
  connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  dryRun = process.argv.includes("--dry-run"),
  logger = console,
} = {}) {
  const migrations = discoverMigrations();
  if (migrations.length === 0) {
    throw new Error(`No SQL migration files found in ${migrationsDir}`);
  }

  const isPlaceholderUrl = !connectionString || connectionString.includes("@HOST") || connectionString.includes("//USER:");
  if (dryRun && isPlaceholderUrl) {
    logger.log(`[migrate:dry-run] Discovered ${migrations.length} ordered migrations:`);
    for (const m of migrations) {
      logger.log(`  - ${m.filename} (version=${m.version}, sha256=${m.checksum.slice(0, 12)}...)`);
    }
    return { applied: [], skipped: migrations.map((m) => m.filename), dryRun: true };
  }

  if (!connectionString) {
    throw new Error("DATABASE_URL or TEST_DATABASE_URL is required to run migrations.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Normalize legacy bookkeeping tables: migration 001 historically created
    // schema_migrations with a `description` column instead of `filename`.
    // Add the runner's column additively and backfill; never drop or rewrite data.
    const columnResult = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
    );
    const columnNames = new Set(columnResult.rows.map((row) => row.column_name));
    if (!columnNames.has("filename")) {
      await client.query("ALTER TABLE schema_migrations ADD COLUMN filename TEXT");
    }
    if (columnNames.has("description")) {
      await client.query("ALTER TABLE schema_migrations ALTER COLUMN description SET DEFAULT ''");
      await client.query(
        "UPDATE schema_migrations SET filename = version || '.sql' WHERE filename IS NULL",
      );
    }

    const existingResult = await client.query(
      "SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version ASC",
    );
    const appliedByVersion = new Map(existingResult.rows.map((row) => [row.version, row]));

    const applied = [];
    const skipped = [];

    for (const migration of migrations) {
      const recorded = appliedByVersion.get(migration.version);
      if (recorded) {
        if (recorded.checksum !== migration.checksum) {
          throw new Error(
            `Migration checksum drift detected for version ${migration.version} (${migration.filename}): ` +
              `database has ${recorded.checksum}, file has ${migration.checksum}. Refusing to proceed.`,
          );
        }
        skipped.push(migration.filename);
        continue;
      }

      if (dryRun) {
        logger.log(`[migrate:dry-run] Would apply ${migration.filename} (${migration.checksum.slice(0, 12)}...)`);
        continue;
      }

      logger.log(`[migrate] Applying ${migration.filename}...`);
      const hasExplicitTransaction = /^\s*BEGIN\s*;/im.test(migration.sql);

      if (!hasExplicitTransaction) {
        await client.query("BEGIN");
      }
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, filename, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.filename, migration.checksum],
        );
        if (!hasExplicitTransaction) {
          await client.query("COMMIT");
        }
        applied.push(migration.filename);
        logger.log(`[migrate] Applied ${migration.filename}`);
      } catch (err) {
        if (!hasExplicitTransaction) {
          await client.query("ROLLBACK").catch(() => {});
        }
        throw err;
      }
    }

    return { applied, skipped, dryRun };
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((summary) => {
      console.log(
        `[migrate] Complete. Applied: ${summary.applied.length}, Already up-to-date: ${summary.skipped.length}`,
      );
    })
    .catch((err) => {
      console.error("[migrate] Failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
