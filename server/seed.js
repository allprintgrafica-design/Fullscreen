import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { openDatabase, uid, now, transaction } from './db.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('La demo no se puede crear en producción.');
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const db = openDatabase(dataDir);
if (db.prepare('SELECT id FROM users LIMIT 1').get()) {
  console.log('La base ya contiene usuarios. No se modificó ningún dato.');
  db.close();
  process.exit(0);
}
const adminHash = await bcrypt.hash('AdminDemo2026!', 12);
const tenantHash = await bcrypt.hash('ClienteDemo2026!', 12);
const tenantId = uid();
const packageId = uid();
const playlistId = uid();
const baseId = uid();
transaction(db, () => {
  db.prepare('INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?)').run(
    packageId,
    'Professional',
    2048,
    100,
    5,
    now(),
  );
  db.prepare('INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?)').run(
    uid(),
    'Starter',
    512,
    25,
    2,
    now(),
  );
  db.prepare('INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?)').run(
    uid(),
    'Business',
    10240,
    500,
    20,
    now(),
  );
  db.prepare('INSERT INTO tenants (id, name, package_id, created_at) VALUES (?, ?, ?, ?)').run(
    tenantId,
    'Clínica Horizonte',
    packageId,
    now(),
  );
  db.prepare(
    'INSERT INTO users (id, tenant_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(uid(), null, 'Administrador', 'admin@fullscreen.local', adminHash, 'superadmin', now());
  db.prepare(
    'INSERT INTO users (id, tenant_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(uid(), tenantId, 'Valentina', 'cliente@fullscreen.local', tenantHash, 'tenant', now());
  const files = [
    ['base.svg', null, 'Señal general · Fullscreen'],
    ['clinic.svg', tenantId, 'Bienvenida · Clínica Horizonte'],
    ['wellness.svg', tenantId, 'Hábitos saludables'],
  ];
  const mediaIds = files.map(([file, tenant, name]) => {
    const id = uid();
    const filename = id + '.svg';
    const contents = fs.readFileSync(new URL('../public/demo/' + file, import.meta.url));
    fs.writeFileSync(path.join(dataDir, 'uploads', filename), contents);
    db.prepare(
      'INSERT INTO media (id, tenant_id, name, filename, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, tenant, name, filename, 'image/svg+xml', contents.length, now());
    return id;
  });
  db.prepare('INSERT INTO playlists (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)').run(
    baseId,
    null,
    'Fullscreen · Señal 24/7',
    now(),
  );
  db.prepare('INSERT INTO playlists (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)').run(
    playlistId,
    tenantId,
    'Bienvenida y bienestar',
    now(),
  );
  db.prepare('INSERT INTO playlist_items VALUES (?, ?, ?, ?)').run(baseId, mediaIds[0], 0, 30);
  db.prepare('INSERT INTO playlist_items VALUES (?, ?, ?, ?)').run(playlistId, mediaIds[1], 0, 12);
  db.prepare('INSERT INTO playlist_items VALUES (?, ?, ?, ?)').run(playlistId, mediaIds[2], 1, 12);
  db.prepare('INSERT INTO platform_settings VALUES (?, ?)').run('base_playlist_id', baseId);
  for (const name of ['Recepción principal', 'Sala de espera'])
    db.prepare('INSERT INTO screens (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)').run(
      uid(),
      tenantId,
      name,
      now(),
    );
});
db.close();
if (!fs.existsSync('.env')) {
  fs.writeFileSync(
    '.env',
    'JWT_SECRET=' +
      randomBytes(48).toString('hex') +
      '\nAPP_ORIGIN=http://localhost:5173\nPORT=3001\nDATA_DIR=./data\n',
    { mode: 0o600 },
  );
}
console.log('Demo creada. Admin: admin@fullscreen.local / AdminDemo2026!');
console.log('Cliente: cliente@fullscreen.local / ClienteDemo2026!');
console.log('Genera un PIN desde Pantallas para vincular un dispositivo.');
