#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";

const migrationsDir = resolve(import.meta.dirname, "../../migrations/turso");
const url = process.env.TEST_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.TEST_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
const dryRun = process.argv.includes("--dry-run");

function checksum(sql) {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n").trim()).digest("hex");
}

function discover() {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(migrationsDir, filename), "utf8");
      return { filename, version: filename.slice(0, 3), sql, checksum: checksum(sql) };
    });
}

const migrations = discover();
if (!migrations.length) throw new Error(`No Turso migrations found in ${migrationsDir}`);
if (dryRun && !url) {
  console.log(`[turso:migrate:dry-run] ${migrations.length} migration(s) discovered`);
  for (const migration of migrations) console.log(`  - ${migration.filename} (${migration.checksum.slice(0, 12)}...)`);
  process.exit(0);
}
if (!url) throw new Error("TURSO_DATABASE_URL or TEST_TURSO_DATABASE_URL is required");

const db = createClient({ url, authToken: authToken || undefined });
await db.execute(`CREATE TABLE IF NOT EXISTS _turso_migrations (version TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
const existing = await db.execute("SELECT version, filename, checksum FROM _turso_migrations ORDER BY version");
const applied = new Map(existing.rows.map((row) => [String(row.version), row]));

for (const migration of migrations) {
  const recorded = applied.get(migration.version);
  if (recorded) {
    if (String(recorded.checksum) !== migration.checksum) throw new Error(`Turso migration checksum drift: ${migration.filename}`);
    console.log(`[turso:migrate] Already applied ${migration.filename}`);
    continue;
  }
  if (dryRun) {
    console.log(`[turso:migrate:dry-run] Would apply ${migration.filename}`);
    continue;
  }
  console.log(`[turso:migrate] Applying ${migration.filename}`);
  const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
  const script = [
    "BEGIN IMMEDIATE;",
    migration.sql,
    `INSERT INTO _turso_migrations (version, filename, checksum) VALUES (${quote(migration.version)}, ${quote(migration.filename)}, ${quote(migration.checksum)});`,
    "COMMIT;",
  ].join("\n");
  try {
    // executeMultiple is required because each migration is a multi-statement SQL
    // file (including SQLite trigger bodies); execute/batch treats each item as one statement.
    await db.executeMultiple(script);
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
console.log("[turso:migrate] Complete");
