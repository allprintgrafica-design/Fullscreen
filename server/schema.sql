PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  max_storage_mb INTEGER NOT NULL CHECK (max_storage_mb > 0),
  max_files INTEGER NOT NULL CHECK (max_files > 0),
  max_screens INTEGER NOT NULL CHECK (max_screens > 0),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'tenant')),
  created_at TEXT NOT NULL,
  CHECK ((role = 'superadmin' AND tenant_id IS NULL) OR (role = 'tenant' AND tenant_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filename TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  duration_seconds REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_tenant ON media(tenant_id);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  duration_seconds REAL NOT NULL CHECK (duration_seconds >= 1 AND duration_seconds <= 3600),
  PRIMARY KEY (playlist_id, position)
);
CREATE TABLE IF NOT EXISTS screens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pairing_hash TEXT,
  pairing_expires_at TEXT,
  paired_at TEXT,
  last_seen_at TEXT,
  manual_mode TEXT CHECK (manual_mode IN ('base', 'client')),
  manual_playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
  manual_run_id TEXT,
  manual_expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS screens_tenant ON screens(tenant_id);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedules_screen ON schedules(screen_id, enabled);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  screen_id TEXT REFERENCES screens(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT NOT NULL,
  ip TEXT NOT NULL,
  CHECK ((user_id IS NOT NULL AND screen_id IS NULL) OR (user_id IS NULL AND screen_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sessions_live ON sessions(revoked_at, expires_at);
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
