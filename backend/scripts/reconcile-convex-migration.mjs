#!/usr/bin/env node
/**
 * Convex -> Neon PostgreSQL data reconciliation & relationship verifier.
 *
 * Compares an exported Convex snapshot directory (or verifies existing Neon database
 * table counts and foreign-key integrity) before declaring data migration complete.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;

const TABLE_MAPPINGS = [
  { convexTable: "users", neonTable: "app_users" },
  { convexTable: "tenants", neonTable: "tenant_sites" },
  { convexTable: "shipments", neonTable: "shipments" },
  { convexTable: "shipmentEvents", neonTable: "shipment_events" },
  { convexTable: "walletLedger", neonTable: "wallet_ledger" },
  { convexTable: "marketplaceProducts", neonTable: "catalog_products" },
  { convexTable: "marketplaceOrders", neonTable: "commerce_orders" },
  { convexTable: "notifications", neonTable: "user_notifications" },
  { convexTable: "auditLogs", neonTable: "admin_audit_logs" },
];

function countJsonLines(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8").trim();
  if (!content) return 0;
  return content.split("\n").filter((line) => line.trim().length > 0).length;
}

export async function verifyNeonIntegrity({
  connectionString = process.env.DATABASE_URL,
  exportDir = process.env.CONVEX_EXPORT_DIR,
} = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to verify Neon database integrity.");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const counts = {};
    for (const mapping of TABLE_MAPPINGS) {
      const res = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${mapping.neonTable}`);
      const neonCount = Number(res.rows[0]?.count ?? 0);
      const sourceCount = exportDir
        ? countJsonLines(join(exportDir, mapping.convexTable, "documents.jsonl"))
        : null;
      counts[mapping.neonTable] = {
        neonCount,
        sourceCount,
        matchesSource: sourceCount === null ? null : neonCount >= sourceCount,
      };
    }

    // Verify critical relational invariants
    const orphanWallets = await client.query(`
      SELECT COUNT(*)::bigint AS count
      FROM wallet_ledger w
      LEFT JOIN app_users u ON u.id = w.user_id
      WHERE u.id IS NULL
    `);
    const orphanShipmentEvents = await client.query(`
      SELECT COUNT(*)::bigint AS count
      FROM shipment_events se
      LEFT JOIN shipments s ON s.id = se.shipment_id
      WHERE s.id IS NULL
    `);
    const unbalancedPostedGroups = await client.query(`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT g.id
        FROM banking_ledger_groups g
        JOIN banking_ledger_entries e ON e.ledger_group_id = g.id
        WHERE g.status = 'posted'
        GROUP BY g.id, e.currency
        HAVING SUM(CASE WHEN e.direction = 'debit' THEN e.amount_minor ELSE 0 END)
            <> SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE 0 END)
      ) bad
    `);

    const relationshipChecks = {
      orphanWallets: Number(orphanWallets.rows[0]?.count ?? 0),
      orphanShipmentEvents: Number(orphanShipmentEvents.rows[0]?.count ?? 0),
      unbalancedPostedGroups: Number(unbalancedPostedGroups.rows[0]?.count ?? 0),
    };

    const ok =
      relationshipChecks.orphanWallets === 0 &&
      relationshipChecks.orphanShipmentEvents === 0 &&
      relationshipChecks.unbalancedPostedGroups === 0 &&
      Object.values(counts).every((c) => c.matchesSource !== false);

    return { ok, counts, relationshipChecks };
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyNeonIntegrity()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exit(1);
    })
    .catch((err) => {
      console.error("[reconcile] Failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
