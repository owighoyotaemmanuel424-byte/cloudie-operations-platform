import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

export function getTursoClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) throw new Error("TURSO_DATABASE_URL is required");

  client = createClient({ url, authToken: authToken || undefined });
  return client;
}

export async function checkTursoHealth(): Promise<boolean> {
  try {
    const result = await getTursoClient().execute("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1 || result.rows[0]?.ok === BigInt(1);
  } catch {
    return false;
  }
}
