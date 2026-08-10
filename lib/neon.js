import { neon } from '@neondatabase/serverless';

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL ontbreekt. Zet deze in Vercel → Settings → Environment Variables.');
  }
  return neon(url);
}

/** Zorg dat tabellen bestaan (idempotent). */
export async function ensureSchema() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      share_token TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS presence (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS presence_project_idx ON presence (project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS presence_last_seen_idx ON presence (last_seen)`;
}

export function randomId(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
