#!/usr/bin/env node
/**
 * Fail-closed validator for a private Convex vendors/pointPackages JSONL export.
 * This tool never connects to a database and never writes/imports records.
 *
 * Usage:
 *   node api/scripts/validate-marketplace-export.mjs --vendors /private/vendors.jsonl --packages /private/packages.jsonl
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--vendors" || argv[i] === "--packages") {
      const key = argv[i] === "--vendors" ? "vendors" : "packages";
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing path for ${argv[i]}`);
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unsupported argument: ${argv[i]}`);
    }
  }
  if (!args.vendors || !args.packages) throw new Error("Both --vendors and --packages are required.");
  return args;
}

function loadJsonl(path, label) {
  const raw = readFileSync(path, "utf8");
  const records = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`${label}: invalid JSON on line ${index + 1}`);
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`${label}: line ${index + 1} must be a JSON object`);
    }
    records.push(record);
  }
  return { records, sha256: createHash("sha256").update(raw).digest("hex") };
}

function idOf(record, label, index) {
  const id = record._id ?? record.id;
  if (typeof id !== "string" || !id.trim()) throw new Error(`${label} row ${index + 1}: missing string _id`);
  return id;
}

function safeInteger(value, label, index, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${label} row ${index + 1}: expected safe integer >= ${min}`);
  }
}

function validateMarketplaceExport(vendorRows, packageRows) {
  const vendors = new Map();
  const counts = {
    vendors: { total: vendorRows.length, approved: 0, nonApproved: 0 },
    packages: { total: packageRows.length, active: 0, inactive: 0, ngn: 0, nonNgn: 0 },
  };

  vendorRows.forEach((row, index) => {
    const id = idOf(row, "vendors", index);
    if (vendors.has(id)) throw new Error(`vendors: duplicate source ID at row ${index + 1}`);
    if (typeof row.businessName !== "string" || !row.businessName.trim()) {
      throw new Error(`vendors row ${index + 1}: businessName must be a non-empty string`);
    }
    if (!["pending", "approved", "rejected", "suspended"].includes(row.status)) {
      throw new Error(`vendors row ${index + 1}: unsupported status`);
    }
    if (!Number.isSafeInteger(row.createdAt) || row.createdAt < 0) {
      throw new Error(`vendors row ${index + 1}: createdAt must be epoch milliseconds`);
    }
    vendors.set(id, row);
    if (row.status === "approved") counts.vendors.approved += 1;
    else counts.vendors.nonApproved += 1;
  });

  const packageIds = new Set();
  let orphanPackages = 0;
  let invalidForReadModel = 0;
  packageRows.forEach((row, index) => {
    const id = idOf(row, "pointPackages", index);
    if (packageIds.has(id)) throw new Error(`pointPackages: duplicate source ID at row ${index + 1}`);
    packageIds.add(id);
    if (typeof row.vendorId !== "string" || !vendors.has(row.vendorId)) {
      orphanPackages += 1;
      throw new Error(`pointPackages row ${index + 1}: vendorId does not resolve to an exported vendor`);
    }
    if (typeof row.name !== "string" || !row.name.trim()) {
      throw new Error(`pointPackages row ${index + 1}: name must be a non-empty string`);
    }
    safeInteger(row.points, "pointPackages points", index, { min: 1 });
    safeInteger(row.priceMinor, "pointPackages priceMinor", index);
    safeInteger(row.totalSold, "pointPackages totalSold", index);
    if (typeof row.isActive !== "boolean") throw new Error(`pointPackages row ${index + 1}: isActive must be boolean`);
    if (!Number.isSafeInteger(row.createdAt) || row.createdAt < 0) {
      throw new Error(`pointPackages row ${index + 1}: createdAt must be epoch milliseconds`);
    }
    if (row.currency === "NGN") counts.packages.ngn += 1;
    else {
      counts.packages.nonNgn += 1;
      invalidForReadModel += 1;
    }
    if (row.isActive) counts.packages.active += 1;
    else counts.packages.inactive += 1;
  });

  return {
    ok: true,
    mode: "validation-only-no-database-connection-no-writes",
    sourceHashes: null,
    counts,
    excludedFromReadModel: { nonNgnPackages: invalidForReadModel, orphanPackages },
    note: "Counts and hashes contain no source field values. NGN and relationship checks passed only where stated; review non-NGN exclusions before import.",
  };
}

export function validateFiles(vendorsPath, packagesPath) {
  const vendorFile = loadJsonl(vendorsPath, "vendors");
  const packageFile = loadJsonl(packagesPath, "pointPackages");
  const report = validateMarketplaceExport(vendorFile.records, packageFile.records);
  report.sourceHashes = {
    vendorsSha256: vendorFile.sha256,
    pointPackagesSha256: packageFile.sha256,
  };
  return report;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = validateFiles(args.vendors, args.packages);
    console.log(JSON.stringify(report, null, 2));
    if (report.counts.packages.nonNgn > 0) process.exitCode = 2;
  } catch (error) {
    console.error("[marketplace-export-validation] Failed closed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  }
}
