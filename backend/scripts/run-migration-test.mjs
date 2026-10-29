#!/usr/bin/env node
/**
 * Runs a migration behavior test (SQL file) against DATABASE_URL / TEST_DATABASE_URL.
 *
 * The 005 ledger-integrity test is self-rolling-back: fixtures are inserted inside
 * a DO block that raises a sentinel exception so everything is rolled back even on
 * success. It is safe to run against a shared database — no rows persist.
 *
 * Usage: node api/scripts/run-migration-test.mjs migrations/tests/005_financial_integrity_test.sql
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: node api/scripts/run-migration-test.mjs <path-to-test.sql>");
  process.exit(1);
}

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL (or TEST_DATABASE_URL) is required.");
  process.exit(1);
}

const sql = readFileSync(resolve(sqlPath), "utf8");
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });

try {
  await client.connect();
  // The test file is a single DO block (or a sequence of statements); sending it
  // as one query keeps any surrounding transaction behavior identical to psql.
  await client.query(sql);
  console.log(`PASS ${resolve(sqlPath)}`);
} catch (error) {
  console.error(`FAIL ${resolve(sqlPath)}:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
