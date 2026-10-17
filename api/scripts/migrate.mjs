import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../migrations");
const migrationFiles = [
  ["001_foundation.sql", "Foundation tables and indexes"],
  ["002_tenant_banking.sql", "Tenant banking and double-entry ledger"],
  ["003_core_services.sql", "Core services, logistics, catalog, and commerce"],
  ["004_auth_fields.sql", "API password fields and revocable sessions"],
  ["005_financial_integrity.sql", "Deferred ledger integrity and immutability"],
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Use a disposable/test Neon branch first.");
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL).hostname)
    ? undefined
    : { rejectUnauthorized: true },
  application_name: "cloudie-neon-migration-runner",
});

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('cloudie-schema-migrations'))");
  for (const [filename, description] of migrationFiles) {
    const sql = await readFile(resolve(migrationsDir, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const tableExists = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists");
    if (tableExists.rows[0]?.exists) {
      const prior = await client.query("SELECT checksum FROM schema_migrations WHERE version=$1", [filename]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) {
          throw new Error(`Checksum mismatch for applied migration ${filename}; do not edit applied SQL. Add a new migration instead.`);
        }
        console.log(`SKIP ${filename} (already applied)`);
        continue;
      }
    } else if (filename !== "001_foundation.sql") {
      throw new Error(`schema_migrations is missing before ${filename}; apply 001_foundation.sql first`);
    }

    console.log(`APPLY ${filename}`);
    await client.query(sql);
    // 001 creates this bookkeeping table; record the version after the SQL succeeds.
    await client.query(
      "INSERT INTO schema_migrations (version,description,checksum) VALUES ($1,$2,$3)",
      [filename, description, checksum],
    );
    console.log(`OK ${filename}`);
  }
  console.log("Migration sequence complete. This does not migrate Convex data or authorize production cutover.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try { await client.query("SELECT pg_advisory_unlock(hashtext('cloudie-schema-migrations'))"); } catch {}
  await client.end().catch(() => {});
}
