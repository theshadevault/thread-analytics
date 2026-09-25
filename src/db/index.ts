import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

/**
 * Lazy initialization so `next build` doesn't crash before DATABASE_URL is
 * provisioned (top-level module code runs at build time). Plain function, no
 * Proxy wrapper — Proxies break libraries that introspect the client.
 *
 * We connect to Supabase Postgres via postgres.js. On Vercel (serverless /
 * Fluid Compute) DATABASE_URL should point at Supabase's transaction pooler
 * (port 6543); `prepare: false` is required because pgbouncer in transaction
 * mode doesn't support prepared statements.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Set it to your Supabase connection string (transaction pooler, port 6543).',
    );
  }
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}
