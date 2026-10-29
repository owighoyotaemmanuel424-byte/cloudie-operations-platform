#!/usr/bin/env node
/**
 * Read-only database inspector for the Neon migration.
 *
 * Reports (never prints credentials):
 * - database name + server version
 * - for every public base table: live row count and column definitions
 * - foreign keys and unique constraints (name only)
 * - schema_migrations contents
 *
 * Usage: node api/scripts/inspect-db.mjs
 * Requires DATABASE_URL (or TEST_DATABASE_URL).
 */

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL (or TEST_DATABASE_URL) is required.");
  process.exit(1);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });

try {
  await client.connect();

  const meta = await client.query(
    "SELECT current_database() AS db, version() AS ver",
  );
  console.log(`connected: db=${meta.rows[0].db}`);
  console.log(`server: ${meta.rows[0].ver.split(",").slice(0, 2).join(",")}`);

  const tables = await client.query(`
    SELECT c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);

  for (const { table } of tables.rows) {
    // Row counts: tables are small here; quoting the identifier is safe since
    // names come from the catalog.
    const count = await client.query(`SELECT count(*) AS n FROM public."${table}"`);
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default,
             (SELECT EXISTS(
                SELECT 1 FROM pg_constraint cc
                WHERE cc.contype = 'u' AND cc.conrelid = ('public.' || quote_ident($1))::regclass
                  AND cc.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                         WHERE attrelid = ('public.' || quote_ident($1))::regclass
                                           AND attname = columns.column_name)]::smallint[]
              )) AS in_unique
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);

    console.log(`\n== ${table} (${count.rows[0].n} rows)`);
    for (const c of cols.rows) {
      const def = c.column_default ? ` DEFAULT ${c.column_default.slice(0, 60)}` : "";
      console.log(`   ${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${def}`);
    }

    const fks = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = ('public.' || quote_ident($1))::regclass AND contype = 'f'
      ORDER BY conname
    `, [table]);
    for (const fk of fks.rows) console.log(`   FK ${fk.conname}: ${fk.def}`);

    const uniques = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = ('public.' || quote_ident($1))::regclass AND contype IN ('u', 'p')
      ORDER BY conname
    `, [table]);
    for (const u of uniques.rows) console.log(`   ${u.conname}: ${u.def}`);
  }

  const sm = await client.query(`
    SELECT version, description, checksum, applied_at
    FROM schema_migrations ORDER BY version
  `).catch(() => null);
  if (sm) {
    console.log(`\nschema_migrations rows: ${sm.rowCount}`);
    for (const row of sm.rows) console.log(`  ${JSON.stringify(row)}`);
  }

  const triggers = await client.query(`
    SELECT tgname, c.relname AS table
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
    ORDER BY c.relname, tgname
  `);
  console.log(`\nuser triggers: ${triggers.rowCount}`);
  for (const t of triggers.rows) console.log(`  ${t.table}: ${t.tgname}`);
} finally {
  await client.end().catch(() => {});
}
