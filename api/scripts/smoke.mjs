const base = (process.env.API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const checks = [
  { name: "health endpoint", path: "/health", expected: 200 },
  { name: "protected current-user endpoint", path: "/api/me", expected: 401 },
  { name: "protected tenant list", path: "/api/tenants", expected: 401 },
  { name: "protected profile endpoint", path: "/api/profile", expected: 401 },
  { name: "protected notifications endpoint", path: "/api/notifications", expected: 401 },
  { name: "protected orders endpoint", path: "/api/orders", expected: 401 },
  { name: "protected catalog endpoint", path: "/api/catalog", expected: 401 },
  { name: "protected admin endpoint", path: "/api/admin/users", expected: 401 },
  { name: "protected wallet ledger endpoint", path: "/api/wallet/ledger", expected: 401 },
];
let failed = false;
for (const check of checks) {
  try {
    const response = await fetch(base + check.path, { headers: { Accept: "application/json" } });
    const ok = response.status === check.expected;
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name}: HTTP ${response.status} (expected ${check.expected})`);
    if (!ok) failed = true;
    if (check.path === "/health" && ok) {
      const body = await response.json();
      if (!body.ok || body.database !== "connected") {
        console.error("FAIL health response did not confirm database connectivity");
        failed = true;
      }
    }
  } catch (error) {
    console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}
try {
  const response = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ name: "", email: "not-an-email", password: "short" }),
  });
  const ok = response.status === 400;
  console.log(`${ok ? "PASS" : "FAIL"} invalid registration is rejected: HTTP ${response.status} (expected 400)`);
  if (!ok) failed = true;
} catch (error) {
  console.error(`FAIL invalid registration check: ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}
if (failed) process.exit(1);
