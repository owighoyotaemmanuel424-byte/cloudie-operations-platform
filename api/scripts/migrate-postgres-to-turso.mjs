#!/usr/bin/env node
/**
 * Safe, resumable PostgreSQL/Neon -> Turso/libSQL data migration.
 *
 * Dry-run is the default. Writes require --apply and an explicit private backup
 * path. This script never deletes source data or clears target tables.
 */
import { Pool } from "pg";
import { createClient } from "@libsql/client";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const apply = process.argv.includes("--apply");
const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const targetUrl = process.env.TURSO_DATABASE_URL;
const targetToken = process.env.TURSO_AUTH_TOKEN;
const backupArg = process.argv.find((arg) => arg.startsWith("--backup="))?.slice("--backup=".length);
const backupPath = backupArg || process.env.CLOUDIE_BACKUP_PATH;

const tableOrder = [
  "roles", "permissions", "app_users", "tenant_sites", "role_permissions",
  "api_sessions", "platform_settings", "wallet_ledger", "tenant_users",
  "tenant_accounts", "banking_beneficiaries", "banking_ledger_groups",
  "banking_ledger_entries", "banking_deposits", "banking_withdrawals",
  "banking_transfers", "service_subscriptions", "shipments", "shipment_events",
  "user_documents", "kyc_records", "storage_files", "catalog_products",
  "commerce_orders", "commerce_order_items", "user_notifications", "vtu_products",
  "vtu_routes", "service_prices", "payment_records", "crypto_deposit_requests",
  "provider_configs", "service_orders", "background_jobs", "admin_audit_logs",
];

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function quoteTable(value) {
  return quoteIdentifier(value);
}

function safeValue(value, targetType) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object" && !(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) {
    return JSON.stringify(value);
  }
  if (typeof value === "string" && /^(TEXT|CHAR|CLOB)$/i.test(targetType || "") && /^\d{4}-\d\d-\d\dT/.test(value)) {
    return value;
  }
  return value;
}

function writePrivateBackup(path, payload) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  // wx prevents accidentally overwriting the only backup from a previous run.
  const fd = openSync(absolute, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8");
  } finally {
    closeSync(fd);
  }
  console.log(`[backup] Wrote private pre-import backup: ${absolute}`);
  console.warn("[backup] This file contains personal records and password hashes. Keep it private and never commit it.");
}

if (!sourceUrl) throw new Error("Set SOURCE_DATABASE_URL (or legacy DATABASE_URL) to the source PostgreSQL/Neon database.");
if (!targetUrl) throw new Error("Set TURSO_DATABASE_URL to the target Turso/libSQL database.");
if (apply && !backupPath) throw new Error("Refusing --apply without --backup=/private/path/file.json or CLOUDIE_BACKUP_PATH.");
if (apply && !targetToken && !targetUrl.startsWith("file:")) {
  throw new Error("TURSO_AUTH_TOKEN is required for remote Turso imports.");
}

const sourceHost = new URL(sourceUrl).hostname;
const source = new Pool({
  connectionString: sourceUrl,
  max: 2,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(sourceHost) ? false : { rejectUnauthorized: true },
});
const target = createClient({ url: targetUrl, authToken: targetToken || undefined });
let inSourceSnapshot = false;

try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  inSourceSnapshot = true;

  const sourceResult = await source.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  const sourceTables = new Set(sourceResult.rows.map((row) => String(row.table_name)).filter((name) => name !== "schema_migrations"));
  const targetResult = await target.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_turso_migrations' ORDER BY name",
  );
  const targetTables = new Set(targetResult.rows.map((row) => String(row.name)));
  const ordered = [
    ...tableOrder.filter((name) => sourceTables.has(name)),
    ...[...sourceTables].filter((name) => !tableOrder.includes(name)),
  ];
  const missingTables = ordered.filter((name) => !targetTables.has(name));
  if (missingTables.length) {
    throw new Error("Target Turso schema is missing source tables; refusing to proceed: " + missingTables.join(", "));
  }

  const plans = [];
  const backup = { format: "cloudie-postgres-to-turso-v1", createdAt: new Date().toISOString(), tables: {} };
  let totalRows = 0;

  for (const table of ordered) {
    const sourceColumnsResult = await source.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
      [table],
    );
    const sourceColumns = sourceColumnsResult.rows.map((row) => String(row.column_name));
    const targetColumnsResult = await target.execute({ sql: `PRAGMA table_info(${quoteTable(table)})` });
    const targetColumns = targetColumnsResult.rows.map((row) => ({
      name: String(row.name),
      type: String(row.type ?? ""),
      pk: Number(row.pk ?? 0),
    }));
    const targetNames = new Set(targetColumns.map((column) => column.name));
    const missingColumns = sourceColumns.filter((column) => !targetNames.has(column));
    if (missingColumns.length) {
      throw new Error(`Target table ${table} is missing source columns; refusing data loss: ${missingColumns.join(", ")}`);
    }

    const countResult = await source.query(`SELECT COUNT(*)::bigint AS count FROM public.${quoteTable(table)}`);
    const rowCount = Number(countResult.rows[0]?.count ?? 0);
    totalRows += rowCount;
    plans.push({ table, rowCount, columns: sourceColumns.length });
    backup.tables[table] = [];

    if (rowCount > 0) {
      const pageSize = 500;
      for (let offset = 0; offset < rowCount; offset += pageSize) {
        const page = await source.query(
          `SELECT * FROM public.${quoteTable(table)} LIMIT $1 OFFSET $2`,
          [pageSize, offset],
        );
        backup.tables[table].push(...page.rows);
      }
    }
  }

  console.log("[plan] PostgreSQL source and Turso target schemas are compatible for the shared table set.");
  for (const plan of plans) console.log(`  ${plan.table}: ${plan.rowCount} row(s), ${plan.columns} column(s)`);
  console.log(`[plan] ${plans.length} table(s), ${totalRows} row(s) in the consistent source snapshot.`);

  if (!apply) {
    console.log("[dry-run] No target data was changed. Run again with --apply and a private backup path to import.");
    await source.query("ROLLBACK");
    inSourceSnapshot = false;
    process.exitCode = 0;
  } else {
    writePrivateBackup(backupPath, backup);
    let imported = 0;
    for (const plan of plans) {
      const table = plan.table;
      const rows = backup.tables[table];
      if (!rows.length) continue;
      const targetInfo = await target.execute({ sql: `PRAGMA table_info(${quoteTable(table)})` });
      const columns = targetInfo.rows.map((row) => ({
        name: String(row.name),
        type: String(row.type ?? ""),
        pk: Number(row.pk ?? 0),
      }));
      const pk = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
      if (!pk.length) throw new Error(`Target table ${table} has no primary key; safe resumable import is not possible.`);
      const common = columns.filter((column) => Object.hasOwn(rows[0], column.name));
      const columnSql = common.map((column) => quoteIdentifier(column.name)).join(", ");
      const placeholders = common.map(() => "?").join(", ");
      const nonPk = common.filter((column) => !pk.includes(column.name));
      const conflictSql = nonPk.length
        ? `ON CONFLICT (${pk.map(quoteIdentifier).join(", ")}) DO UPDATE SET ${nonPk.map((column) => `${quoteIdentifier(column.name)}=excluded.${quoteIdentifier(column.name)}`).join(", ")}`
        : `ON CONFLICT (${pk.map(quoteIdentifier).join(", ")}) DO NOTHING`;
      const sql = `INSERT INTO ${quoteTable(table)} (${columnSql}) VALUES (${placeholders}) ${conflictSql}`;

      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100).map((row) => ({
          sql,
          args: common.map((column) => safeValue(row[column.name], column.type)),
        }));
        await target.batch(batch, "write");
        imported += batch.length;
      }
      console.log(`[import] ${table}: ${rows.length} row(s)`);
    }
    await source.query("COMMIT");
    inSourceSnapshot = false;
    console.log(`[import] Complete: ${imported} row(s) copied. Source rows were not modified or deleted.`);
    console.log("[verify] Re-run without --apply to compare schemas/counts; then run app-level authentication, tenant isolation, and ledger tests.");
  }
} catch (error) {
  if (inSourceSnapshot) await source.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  target.close();
  await source.end();
}
