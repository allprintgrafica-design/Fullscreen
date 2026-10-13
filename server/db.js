import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

export function openDatabase(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'tmp'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'signage.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function audit(db, actor, action, detail, tenantId = actor?.tenant_id ?? null) {
  db.prepare(
    'INSERT INTO audit_events (tenant_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(tenantId, actor?.id ?? actor?.screen_id ?? null, action, detail, now());
}
