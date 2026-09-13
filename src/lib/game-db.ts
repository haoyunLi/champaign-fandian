import { env } from 'cloudflare:workers';
export function database(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error('Database binding unavailable');
  return db;
}
