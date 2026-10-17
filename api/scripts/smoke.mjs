const base = (process.env.API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const checks = [
  { name: "health endpoint", path: "/health", expected: 200 },
  { name: "protected profile endpoint", path: "/api/me", expected: 401 },
  { name: "admin endpoint is protected", path: "/api/admin/users", expected: 401 },
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
if (failed) process.exit(1);
