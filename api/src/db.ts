import { createClient, type Client, type Transaction } from "@libsql/client";

export type QueryResultRow = Record<string, unknown>;
export type QueryResult<R extends QueryResultRow = QueryResultRow> = {
  rows: R[];
  rowCount: number;
};

function normalizeSql(sql: string): string {
  return sql
    .replace(/NOW\(\)\s*\+\s*INTERVAL\s+'8 hours'/gi, "datetime('now', '+8 hours')")
    .replace(/NOW\(\)\s*\+\s*INTERVAL\s+'([^']+)'/gi, "datetime('now', '$1')")
    .replace(/NOW\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bGREATEST\s*\(/gi, "MAX(")
    .replace(/\bILIKE\b/gi, "LIKE");
}

function argsFor(values?: unknown[]): (string | number | bigint | boolean | null | ArrayBuffer | Uint8Array)[] {
  return (values ?? []).map((value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object" && !(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) {
      return JSON.stringify(value);
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || value instanceof ArrayBuffer || value instanceof Uint8Array) return value;
    return String(value);
  });
}

class TursoConnection {
  private transaction?: Transaction;
  constructor(private readonly client: Client) {}

  async query<R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<R>> {
    const statement = sql.trim().toUpperCase();
    if (statement === "BEGIN" || statement === "BEGIN TRANSACTION" || statement === "BEGIN IMMEDIATE") {
      if (this.transaction) throw new Error("Nested transactions are not supported");
      this.transaction = await this.client.transaction("write");
      return { rows: [], rowCount: 0 };
    }
    if (statement === "COMMIT" || statement === "END" || statement === "END TRANSACTION") {
      if (this.transaction) {
        await this.transaction.commit();
        this.transaction.close();
        this.transaction = undefined;
      }
      return { rows: [], rowCount: 0 };
    }
    if (statement === "ROLLBACK" || statement === "ROLLBACK TRANSACTION") {
      if (this.transaction) {
        await this.transaction.rollback();
        this.transaction.close();
        this.transaction = undefined;
      }
      return { rows: [], rowCount: 0 };
    }
    const result = await (this.transaction ?? this.client).execute({
      sql: normalizeSql(sql),
      args: argsFor(values),
    });
    return {
      rows: result.rows as unknown as R[],
      rowCount: result.rowsAffected ?? result.rows.length,
    };
  }

  async release(): Promise<void> {
    if (this.transaction) {
      try { await this.transaction.rollback(); } catch { /* Best-effort cleanup */ }
      this.transaction.close();
      this.transaction = undefined;
    }
  }
}

/** Small compatibility layer for the existing Hono API while its SQL is moved to libSQL. */
export class TursoPool {
  private client?: Client;
  private getClient(): Client {
    if (this.client) return this.client;
    const url = process.env.TURSO_DATABASE_URL?.trim();
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!url) throw new Error("TURSO_DATABASE_URL is required");
    this.client = createClient({ url, authToken: authToken || undefined });
    return this.client;
  }

  async query<R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<R>> {
    return new TursoConnection(this.getClient()).query<R>(sql, values);
  }

  async connect(): Promise<TursoConnection> {
    return new TursoConnection(this.getClient());
  }

  async end(): Promise<void> {
    this.client?.close();
    this.client = undefined;
  }
}

export const pool = new TursoPool();
