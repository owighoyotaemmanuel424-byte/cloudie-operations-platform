import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  computeChecksum,
  discoverMigrations,
  planMigrationStatements,
  runMigrationPlan,
  runMigrations,
  splitSqlStatements,
} from "../api/scripts/migrate.mjs";

type Call = { sql: string; params?: unknown[] };

function fixture(version: string, filename: string, sql: string) {
  return { version, filename, fullPath: filename, sql, checksum: computeChecksum(sql) };
}

/** Minimal pg.Client stand-in that records every query it is sent. */
function fakeClient({ applied = [] as { version: string; filename: string; checksum: string }[] } = {}) {
  const calls: Call[] = [];
  let failOn: ((sql: string) => boolean) | null = null;

  return {
    calls,
    failWhen(predicate: (sql: string) => boolean) {
      failOn = predicate;
    },
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (failOn?.(sql)) throw new Error("simulated database failure");
      if (sql.includes("to_regclass('public.schema_migrations')")) {
        return { rows: [{ oid: applied.length > 0 ? "schema_migrations" : null }] };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [{ column_name: "version" }, { column_name: "filename" }, { column_name: "checksum" }],
        };
      }
      if (sql.includes("FROM schema_migrations ORDER BY version ASC")) {
        return { rows: applied };
      }
      return { rows: [] };
    },
    async end() {},
  };
}

const silentLogger = { log: () => {} };

describe("migration SQL planning", () => {
  test("splits statements without breaking dollar quotes, literals or comments", () => {
    const sql = `
      -- leading comment; with a semicolon
      CREATE TABLE a (id TEXT);
      /* block ; comment /* nested ; */ still comment */
      INSERT INTO a VALUES ('semi;colon', 'it''s fine');
      CREATE FUNCTION f() RETURNS void AS $body$
      BEGIN
        PERFORM 1;
      END;
      $body$ LANGUAGE plpgsql;
      SELECT "weird;ident" FROM a;
    `;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(4);
    expect(statements[0].code.startsWith("CREATE TABLE a")).toBe(true);
    expect(statements[1].code).toContain("'semi;colon'");
    expect(statements[2].code).toContain("PERFORM 1;");
    expect(statements[2].code).toContain("$body$");
    expect(statements[3].code).toContain('"weird;ident"');
    // Comments are blanked in `code` but preserved verbatim in `raw`.
    expect(statements[0].code).not.toContain("leading comment");
    expect(statements[0].raw).toContain("leading comment");
  });

  test("strips the outer BEGIN/COMMIT wrapper from every real migration", () => {
    for (const migration of discoverMigrations()) {
      const statements = planMigrationStatements(migration);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement.trim()).not.toMatch(/^BEGIN\s*;?$/i);
        expect(statement.trim()).not.toMatch(/^COMMIT\s*;?$/i);
      }
    }
  });

  test("preserves PL/pgSQL BEGIN/END blocks inside function bodies (migration 005)", () => {
    const migration = discoverMigrations().find((m) => m.version === "005");
    expect(migration).toBeDefined();
    const statements = planMigrationStatements(migration!);
    const functionStatements = statements.filter((s) => /CREATE OR REPLACE FUNCTION/i.test(s));
    expect(functionStatements.length).toBeGreaterThanOrEqual(4);
    for (const statement of functionStatements) {
      expect(statement).toContain("BEGIN");
      expect(statement).toContain("END;");
    }
    // Triggers are created after the functions in the same plan.
    expect(statements.some((s) => /CREATE TRIGGER banking_ledger_entries_immutable_posted/i.test(s))).toBe(true);
  });

  test("rejects statements PostgreSQL cannot run in a transaction block", () => {
    const cases = [
      "CREATE INDEX CONCURRENTLY idx ON t (a);",
      "VACUUM ANALYZE app_users;",
      "CREATE DATABASE other;",
      "ALTER TYPE mood ADD VALUE 'happy';",
    ];
    for (const sql of cases) {
      expect(() => planMigrationStatements(fixture("900", "900_bad.sql", sql))).toThrow(
        /cannot|refuses|atomic/i,
      );
    }
  });

  test("rejects nested savepoints rather than silently breaking atomicity", () => {
    expect(() =>
      planMigrationStatements(fixture("901", "901_bad.sql", "SAVEPOINT sp; SELECT 1;")),
    ).toThrow(/transaction control/i);
  });
});

describe("atomic migration execution", () => {
  test("records the migration in the same transaction as its schema changes", async () => {
    const client = fakeClient();
    const migration = fixture("900", "900_example.sql", "BEGIN;\nCREATE TABLE x (id TEXT);\nCOMMIT;");
    await runMigrationPlan({
      client,
      migrations: [migration],
      applied: new Map(),
      logger: silentLogger,
    });

    const sqls = client.calls.map((c) => c.sql.trim());
    const beginIndex = sqls.findIndex((s) => s === "BEGIN");
    const insertIndex = sqls.findIndex((s) => s.includes("INSERT INTO schema_migrations"));
    const commitIndex = sqls.findIndex((s) => s === "COMMIT");

    expect(sqls.filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(sqls.filter((s) => s === "COMMIT")).toHaveLength(1);
    expect(beginIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(beginIndex);
    expect(commitIndex).toBeGreaterThan(insertIndex);
    // The file's own BEGIN/COMMIT never reached the server.
    expect(sqls.filter((s) => /^BEGIN\s*;?$/i.test(s))).toHaveLength(1);
    // History insert carries the exact version/filename/checksum.
    const insert = client.calls.find((c) => c.sql.includes("INSERT INTO schema_migrations"));
    expect(insert?.params).toEqual(["900", "900_example.sql", migration.checksum]);
  });

  test("rolls back and never records history when a statement fails", async () => {
    const client = fakeClient();
    client.failWhen((sql) => sql.includes("INSERT INTO broken"));
    const migration = fixture(
      "902",
      "902_failure.sql",
      "CREATE TABLE ok (id TEXT);\nINSERT INTO broken VALUES (1);",
    );

    await expect(
      runMigrationPlan({ client, migrations: [migration], applied: new Map(), logger: silentLogger }),
    ).rejects.toThrow(/902_failure\.sql failed and was rolled back/);

    const sqls = client.calls.map((c) => c.sql.trim());
    expect(sqls.filter((s) => s === "ROLLBACK")).toHaveLength(1);
    expect(sqls.some((s) => s.includes("INSERT INTO schema_migrations"))).toBe(false);
    expect(sqls.filter((s) => s === "COMMIT")).toHaveLength(0);
    // The rollback happens after the failure and before anything else.
    expect(sqls.indexOf("ROLLBACK")).toBeGreaterThan(sqls.findIndex((s) => s.includes("INSERT INTO broken")));
  });

  test("a failed history insert also rolls back the schema changes", async () => {
    const client = fakeClient();
    client.failWhen((sql) => sql.includes("INSERT INTO schema_migrations"));
    const migration = fixture("903", "903_history_failure.sql", "CREATE TABLE y (id TEXT);");

    await expect(
      runMigrationPlan({ client, migrations: [migration], applied: new Map(), logger: silentLogger }),
    ).rejects.toThrow(/schema_migrations was not updated/);

    const sqls = client.calls.map((c) => c.sql.trim());
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
  });

  test("is idempotent: already-recorded migrations open no transaction", async () => {
    const migration = fixture("900", "900_example.sql", "CREATE TABLE x (id TEXT);");
    const client = fakeClient({
      applied: [{ version: "900", filename: "900_example.sql", checksum: migration.checksum }],
    });

    const summary = await runMigrationPlan({
      client,
      migrations: [migration],
      applied: new Map([["900", { version: "900", checksum: migration.checksum }]]),
      logger: silentLogger,
    });

    expect(summary.applied).toEqual([]);
    expect(summary.skipped).toEqual(["900_example.sql"]);
    const sqls = client.calls.map((c) => c.sql.trim());
    expect(sqls).not.toContain("BEGIN");
    expect(sqls).not.toContain("COMMIT");
    expect(sqls.some((s) => s.includes("INSERT INTO schema_migrations"))).toBe(false);
  });

  test("refuses checksum drift without touching the schema", async () => {
    const migration = fixture("900", "900_example.sql", "CREATE TABLE x (id TEXT);");
    const client = fakeClient();
    await expect(
      runMigrationPlan({
        client,
        migrations: [migration],
        applied: new Map([["900", { version: "900", checksum: "0".repeat(64) }]]),
        logger: silentLogger,
      }),
    ).rejects.toThrow(/checksum drift/i);
    expect(client.calls.map((c) => c.sql.trim())).not.toContain("BEGIN");
  });

  test("dry-run is strictly read-only", async () => {
    const client = fakeClient();
    const migration = fixture("900", "900_example.sql", "CREATE TABLE x (id TEXT);");
    const summary = await runMigrationPlan({
      client,
      migrations: [migration],
      applied: new Map(),
      dryRun: true,
      logger: silentLogger,
    });

    expect(summary.pending).toEqual(["900_example.sql"]);
    const sqls = client.calls.map((c) => c.sql.trim());
    expect(sqls.some((s) => /CREATE TABLE|ALTER TABLE|INSERT INTO|UPDATE |BEGIN|COMMIT/i.test(s))).toBe(false);
  });

  test("dry-run connection path writes nothing, not even bookkeeping DDL", async () => {
    const client = fakeClient();
    const migration = fixture("900", "900_example.sql", "CREATE TABLE x (id TEXT);");
    await runMigrations({
      connectionString: "postgresql://user:pass@example.test/db",
      dryRun: true,
      logger: silentLogger,
      migrations: [migration],
      createClient: async () => client,
    });

    const sqls = client.calls.map((c) => c.sql.trim());
    expect(sqls.some((s) => /CREATE TABLE|ALTER TABLE|INSERT INTO|UPDATE /i.test(s))).toBe(false);
    expect(sqls.some((s) => s.includes("pg_advisory_lock_shared"))).toBe(true);
    expect(sqls.some((s) => s.includes("pg_advisory_unlock_shared"))).toBe(true);
  });

  test("offline dry-run validates every file and connects to nothing", async () => {
    let factoryCalls = 0;
    const summary = await runMigrations({
      connectionString: "",
      dryRun: true,
      logger: silentLogger,
      createClient: async () => {
        factoryCalls += 1;
        return fakeClient();
      },
    });
    expect(factoryCalls).toBe(0);
    expect(summary.pending.length).toBe(discoverMigrations().length);
    expect(summary.applied).toEqual([]);
  });

  test("a migration file containing a non-transactional statement fails before any SQL runs", async () => {
    const client = fakeClient();
    await expect(
      runMigrations({
        connectionString: "postgresql://user:pass@example.test/db",
        logger: silentLogger,
        migrations: [fixture("904", "904_concurrent.sql", "CREATE INDEX CONCURRENTLY i ON t (a);")],
        createClient: async () => client,
      }),
    ).rejects.toThrow(/CREATE INDEX CONCURRENTLY/);
    expect(client.calls).toHaveLength(0);
  });
});

describe("real migration files", () => {
  test("every shipped migration plans cleanly and stays inside one transaction", async () => {
    const migrations = discoverMigrations();
    const client = fakeClient();
    const summary = await runMigrationPlan({
      client,
      migrations,
      applied: new Map(),
      logger: silentLogger,
    });

    expect(summary.applied).toHaveLength(migrations.length);
    const sqls = client.calls.map((c) => c.sql.trim());
    // One transaction per migration, none of them nested.
    expect(sqls.filter((s) => s === "BEGIN")).toHaveLength(migrations.length);
    expect(sqls.filter((s) => s === "COMMIT")).toHaveLength(migrations.length);
    expect(sqls.filter((s) => s.includes("INSERT INTO schema_migrations"))).toHaveLength(migrations.length);

    const foundation = readFileSync("migrations/001_foundation.sql", "utf8");
    expect(foundation).toContain("BEGIN;");
  });
});
