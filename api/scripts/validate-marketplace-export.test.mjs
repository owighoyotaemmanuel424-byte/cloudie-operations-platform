import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateFiles } from "./validate-marketplace-export.mjs";

function withExports(vendors, packages, callback) {
  const dir = mkdtempSync(join(tmpdir(), "cloudie-marketplace-export-"));
  const vendorsPath = join(dir, "vendors.jsonl");
  const packagesPath = join(dir, "packages.jsonl");
  writeFileSync(vendorsPath, vendors.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(packagesPath, packages.map((row) => JSON.stringify(row)).join("\n") + "\n");
  try {
    return callback(vendorsPath, packagesPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const vendor = { _id: "vendor_1", businessName: "Example Vendor", status: "approved", createdAt: 1_700_000_000_000 };
const pack = { _id: "package_1", vendorId: "vendor_1", name: "Starter", points: 100, priceMinor: 25000, currency: "NGN", isActive: true, totalSold: 0, createdAt: 1_700_000_000_000 };

test("validates source IDs, vendor references and supported marketplace fields without DB access", () => {
  withExports([vendor], [pack], (vendorsPath, packagesPath) => {
    const report = validateFiles(vendorsPath, packagesPath);
    assert.equal(report.ok, true);
    assert.equal(report.mode, "validation-only-no-database-connection-no-writes");
    assert.equal(report.counts.vendors.approved, 1);
    assert.equal(report.counts.packages.active, 1);
    assert.equal(report.counts.packages.ngn, 1);
    assert.match(report.sourceHashes.vendorsSha256, /^[a-f0-9]{64}$/);
  });
});

test("fails closed when a package points to a missing vendor", () => {
  withExports([vendor], [{ ...pack, vendorId: "missing" }], (vendorsPath, packagesPath) => {
    assert.throws(() => validateFiles(vendorsPath, packagesPath), /vendorId does not resolve/);
  });
});

test("fails closed on duplicate source IDs", () => {
  withExports([vendor, vendor], [pack], (vendorsPath, packagesPath) => {
    assert.throws(() => validateFiles(vendorsPath, packagesPath), /duplicate source ID/);
  });
});

test("fails closed on invalid points or price values", () => {
  withExports([vendor], [{ ...pack, points: 0 }], (vendorsPath, packagesPath) => {
    assert.throws(() => validateFiles(vendorsPath, packagesPath), /points.*safe integer/);
  });
});
