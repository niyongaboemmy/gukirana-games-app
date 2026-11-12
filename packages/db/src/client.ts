import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type Database = ReturnType<typeof drizzlePg<Schema>> | ReturnType<typeof drizzlePglite<Schema>>;

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * DATABASE_URL = postgres://...   → node-postgres (staging / production)
 * DATABASE_URL = pglite://<dir>   → embedded Postgres (local dev without Docker)
 * DATABASE_URL = pglite://memory  → in-memory (tests)
 */
export async function createDatabase(url: string, opts: { migrate?: boolean } = {}): Promise<{ db: Database; close: () => Promise<void> }> {
  if (url.startsWith("pglite://")) {
    const target = url.slice("pglite://".length);
    if (target !== "memory") mkdirSync(resolve(target), { recursive: true });
    const client = target === "memory" ? new PGlite() : new PGlite(resolve(target));
    const db = drizzlePglite(client, { schema });
    if (opts.migrate !== false) await migratePglite(db, { migrationsFolder: MIGRATIONS });
    return { db, close: () => client.close() };
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzlePg(pool, { schema });
  if (opts.migrate) await migratePg(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => pool.end() };
}
