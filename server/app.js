import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import { z, ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomInt } from 'node:crypto';
import { openDatabase, transaction, uid, now, audit } from './db.js';
import { createAuth, bootstrapAdmin } from './auth.js';
import { createPlayback, validTimezone } from './scheduler.js';
import { createRealtime, listSessions } from './realtime.js';
import { check, HttpError } from './errors.js';

const runFile = promisify(execFile);
const text = z.string().trim().min(1).max(120);
const identifier = z.string().uuid();
const password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (s) => Buffer.byteLength(s, 'utf8') <= 72,
    'La contraseña debe ocupar como máximo 72 bytes UTF-8.',
  );
const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const packageInput = z.object({
  name: text,
  max_storage_mb: z.number().int().min(1).max(1_000_000),
  max_files: z.number().int().min(1).max(100_000),
  max_screens: z.number().int().min(1).max(10_000),
});
const playlistInput = z.object({
  name: text,
  items: z
    .array(z.object({ media_id: identifier, duration_seconds: z.number().min(1).max(3600) }))
    .min(1)
    .max(200),
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleInput = z.object({
  screen_id: identifier,
  playlist_id: identifier,
  day_of_week: z.number().int().min(0).max(6),
  start_time: time,
  end_time: time,
  timezone: z.string().refine(validTimezone, 'Zona horaria IANA inválida.'),
  enabled: z.boolean().default(true),
});

export async function createApp(overrides = {}) {
  const config = {
    dataDir: path.resolve(process.env.DATA_DIR || './data'),
    jwtSecret: process.env.JWT_SECRET,
    appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
    production: process.env.NODE_ENV === 'production',
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 250),
    trustProxy: Number(process.env.TRUST_PROXY || 0),
    bootstrap: true,
    ...overrides,
  };
  check(
    typeof config.jwtSecret === 'string' && config.jwtSecret.length >= 32,
    500,
    'JWT_SECRET debe tener al menos 32 caracteres aleatorios.',
  );
  check(
    Number.isInteger(config.maxUploadMB) && config.maxUploadMB > 0 && config.maxUploadMB <= 2048,
    500,
    'MAX_UPLOAD_MB inválido.',
  );
  check(
    !config.production || config.appOrigin.startsWith('https://'),
    500,
    'Producción requiere APP_ORIGIN con HTTPS.',
  );
  const db = openDatabase(config.dataDir);
  if (config.bootstrap) await bootstrapAdmin(db, config);
  const app = express();
  const server = createServer(app);
  const auth = createAuth(db, config);
  const playback = createPlayback(db, auth);
  const realtime = createRealtime(server, db, auth, playback, config);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'connect-src': ["'self'", config.appOrigin],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use(cors({ origin: config.appOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) => req.path.endsWith('/content'),
      message: { error: 'Demasiadas solicitudes. Intenta nuevamente en un minuto.' },
    }),
  );
  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  });
  const pairLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de vinculación. Espera 15 minutos.' },
  });
  const uploadLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    message: { error: 'Demasiadas cargas simultáneas. Espera un minuto.' },
  });
  const userAuth = auth.middleware(['superadmin', 'tenant']);
  const adminAuth = auth.middleware(['superadmin']);
  const tenantAuth = auth.middleware(['tenant']);
  const playerAuth = auth.middleware(['player'], true);
  const scope = (actor) => (actor.role === 'superadmin' ? null : actor.tenant_id);
  function own(table, id, actor) {
    identifier.parse(id);
    const allowed = new Set(['media', 'playlists', 'screens', 'schedules']);
    check(allowed.has(table), 500, 'Tabla inválida.');
    const row = db
      .prepare('SELECT * FROM ' + table + ' WHERE id = ? AND tenant_id IS ?')
      .get(id, scope(actor));
    check(row, 404, 'Recurso no encontrado.');
    return row;
  }
  function limits(tenantId) {
    return db
      .prepare(
        `SELECT t.*, p.name AS package_name, p.max_storage_mb, p.max_files, p.max_screens,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM media WHERE tenant_id = t.id) AS used_bytes,
      (SELECT COUNT(*) FROM media WHERE tenant_id = t.id) AS file_count,
      (SELECT COUNT(*) FROM screens WHERE tenant_id = t.id) AS screen_count
      FROM tenants t JOIN packages p ON p.id = t.package_id WHERE t.id = ?`,
      )
      .get(tenantId);
  }
  const screenRows = (tenantId) =>
    db
      .prepare('SELECT * FROM screens WHERE tenant_id IS ? ORDER BY created_at DESC')
      .all(tenantId)
      .map((s) => ({
        id: s.id,
        tenant_id: s.tenant_id,
        name: s.name,
        paired_at: s.paired_at,
        last_seen_at: s.last_seen_at,
        online: [...realtime.io.sockets.sockets.values()].some(
          (x) => x.data.actor?.screen_id === s.id,
        ),
        playback: playback.selection(s.id),
      }));
  const notify = (actor) => {
    realtime.tenantChanged(scope(actor));
    realtime.refreshPlayers();
  };

  app.get('/api/health', (req, res) =>
    res.json({ status: 'ok', database: db.prepare('SELECT 1 AS ok').get().ok === 1 }),
  );
  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const input = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email);
    // Always hash-check to reduce account enumeration through timing.
    const valid = await bcrypt.compare(
      input.password,
      user?.password_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5rWkT1pRf6Jn2FZjT8TWxhKC8xI.hjO',
    );
    check(user && valid, 401, 'Correo o contraseña incorrectos.');
    if (user.tenant_id)
      check(limits(user.tenant_id)?.status === 'active', 403, 'La cuenta está suspendida.');
    try {
      realtime.revoke(
        auth.authenticate(req).session_id,
        'Se inició una nueva sesión en este navegador.',
      );
    } catch {
      /* No prior session. */
    }
    const actor = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
    };
    audit(db, actor, 'login', 'Inicio de sesión');
    res.json(auth.issue(req, res, actor));
    realtime.sessionsChanged();
  });
  app.get('/api/auth/me', userAuth, (req, res) =>
    res.json({
      user: req.actor,
      csrf_token: auth.csrf(req.actor.session_id),
      expires_at: req.actor.expires_at,
    }),
  );
  app.post('/api/auth/logout', userAuth, (req, res) => {
    realtime.revoke(req.actor.session_id, 'Sesión cerrada.');
    auth.clearCookie(res);
    res.json({ ok: true });
  });
  app.post('/api/auth/password', userAuth, async (req, res) => {
    const input = z
      .object({ current_password: z.string().max(128), new_password: password })
      .parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.actor.id);
    check(
      await bcrypt.compare(input.current_password, user.password_hash),
      401,
      'Contraseña actual incorrecta.',
    );
    const newHash = await bcrypt.hash(input.new_password, 12);
    auth.resolveSession(req.actor.session_id);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    for (const s of db
      .prepare('SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL')
      .all(user.id))
      realtime.revoke(s.id, 'Contraseña actualizada.');
    auth.clearCookie(res);
    res.json({ ok: true });
  });
  app.get('/api/overview', userAuth, (req, res) => {
    if (req.actor.role === 'superadmin') {
      const allScreens = db.prepare('SELECT id, tenant_id FROM screens').all();
      res.json({
        tenants: db
          .prepare(
            'SELECT t.*, p.name AS package_name FROM tenants t JOIN packages p ON p.id = t.package_id ORDER BY t.created_at DESC',
          )
          .all(),
        packages: db.prepare('SELECT * FROM packages ORDER BY max_storage_mb').all(),
        sessions: listSessions(db, realtime.io),
        screens: allScreens.flatMap((s, i, all) =>
          all.findIndex((x) => x.tenant_id === s.tenant_id) === i ? screenRows(s.tenant_id) : [],
        ),
        events: db
          .prepare(
            'SELECT a.*, t.name AS tenant_name FROM audit_events a LEFT JOIN tenants t ON t.id = a.tenant_id ORDER BY a.id DESC LIMIT 12',
          )
          .all(),
        base_playlist_id:
          db.prepare("SELECT value FROM platform_settings WHERE key = 'base_playlist_id'").get()
            ?.value || null,
        max_upload_mb: config.maxUploadMB,
      });
    } else
      res.json({
        tenant: limits(req.actor.tenant_id),
        screens: screenRows(req.actor.tenant_id),
        max_upload_mb: config.maxUploadMB,
        events: db
          .prepare('SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY id DESC LIMIT 12')
          .all(req.actor.tenant_id),
      });
  });

  app.get('/api/admin/packages', adminAuth, (req, res) =>
    res.json(db.prepare('SELECT * FROM packages ORDER BY max_storage_mb').all()),
  );
  app.post('/api/admin/packages', adminAuth, (req, res) => {
    const p = packageInput.parse(req.body);
    const id = uid();
    db.prepare(
      'INSERT INTO packages (id, name, max_storage_mb, max_files, max_screens, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, p.name, p.max_storage_mb, p.max_files, p.max_screens, now());
    notify(req.actor);
    res.status(201).json({ id, ...p });
  });
  app.put('/api/admin/packages/:id', adminAuth, (req, res) => {
    const p = packageInput.parse(req.body);
    check(
      db.prepare('SELECT id FROM packages WHERE id = ?').get(req.params.id),
      404,
      'Paquete no encontrado.',
    );
    for (const t of db.prepare('SELECT id FROM tenants WHERE package_id = ?').all(req.params.id)) {
      const usage = limits(t.id);
      check(
        usage.used_bytes <= p.max_storage_mb * 1024 * 1024 &&
          usage.file_count <= p.max_files &&
          usage.screen_count <= p.max_screens,
        409,
        'Los límites propuestos son inferiores al uso de un cliente.',
      );
    }
    db.prepare(
      'UPDATE packages SET name = ?, max_storage_mb = ?, max_files = ?, max_screens = ? WHERE id = ?',
    ).run(p.name, p.max_storage_mb, p.max_files, p.max_screens, req.params.id);
    for (const t of db.prepare('SELECT id FROM tenants WHERE package_id = ?').all(req.params.id))
      realtime.tenantChanged(t.id);
    notify(req.actor);
    res.json({ id: req.params.id, ...p });
  });
  app.post('/api/admin/tenants', adminAuth, async (req, res) => {
    const t = z.object({ name: text, email, password, package_id: identifier }).parse(req.body);
    check(
      db.prepare('SELECT id FROM packages WHERE id = ?').get(t.package_id),
      404,
      'Paquete no encontrado.',
    );
    const hash = await bcrypt.hash(t.password, 12);
    const id = uid();
    auth.resolveSession(req.actor.session_id);
    transaction(db, () => {
      db.prepare('INSERT INTO tenants (id, name, package_id, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        t.name,
        t.package_id,
        now(),
      );
      db.prepare(
        "INSERT INTO users (id, tenant_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'tenant', ?)",
      ).run(uid(), id, t.name, t.email, hash, now());
    });
    audit(db, req.actor, 'tenant:create', 'Cliente creado: ' + t.name, id);
    notify(req.actor);
    res.status(201).json(limits(id));
  });
  app.get('/api/admin/tenants', adminAuth, (req, res) =>
    res.json(
      db
        .prepare('SELECT id FROM tenants ORDER BY created_at DESC')
        .all()
        .map((t) => ({
          ...limits(t.id),
          email: db.prepare('SELECT email FROM users WHERE tenant_id = ?').get(t.id)?.email,
        })),
    ),
  );
  app.put('/api/admin/tenants/:id', adminAuth, (req, res) => {
    const t = z
      .object({ name: text, package_id: identifier, status: z.enum(['active', 'suspended']) })
      .parse(req.body);
    const usage = limits(req.params.id);
    check(usage, 404, 'Cliente no encontrado.');
    const p = db.prepare('SELECT * FROM packages WHERE id = ?').get(t.package_id);
    check(p, 404, 'Paquete no encontrado.');
    check(
      usage.used_bytes <= p.max_storage_mb * 1024 * 1024 &&
        usage.file_count <= p.max_files &&
        usage.screen_count <= p.max_screens,
      409,
      'El paquete no cubre el uso actual del cliente.',
    );
    db.prepare('UPDATE tenants SET name = ?, package_id = ?, status = ? WHERE id = ?').run(
      t.name,
      t.package_id,
      t.status,
      req.params.id,
    );
    if (t.status === 'suspended') realtime.revokeTenant(req.params.id);
    audit(db, req.actor, 'tenant:update', 'Cuenta ' + t.status, req.params.id);
    realtime.tenantChanged(req.params.id);
    realtime.refreshPlayers();
    res.json(limits(req.params.id));
  });
  app.get('/api/admin/sessions', adminAuth, (req, res) => res.json(listSessions(db, realtime.io)));
  app.delete('/api/admin/sessions/:id', adminAuth, (req, res) => {
    check(
      db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id),
      404,
      'Sesión no encontrada.',
    );
    realtime.revoke(req.params.id);
    audit(db, req.actor, 'session:revoke', 'Sesión revocada');
    res.json({ ok: true });
  });

  app.get('/api/media', userAuth, (req, res) =>
    res.json(
      db
        .prepare('SELECT * FROM media WHERE tenant_id IS ? ORDER BY created_at DESC')
        .all(scope(req.actor))
        .map((m) => ({ ...m, url: auth.grant(m.id, req.actor) })),
    ),
  );
  const upload = multer({
    dest: path.join(config.dataDir, 'tmp'),
    limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 1, fields: 0 },
  }).single('file');
  app.post('/api/media', userAuth, uploadLimit, upload, async (req, res) => {
    check(req.file, 400, 'Selecciona un archivo.');
    let destination;
    try {
      const type = await fileTypeFromFile(req.file.path);
      check(
        type &&
          [
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
            'video/mp4',
            'video/webm',
          ].includes(type.mime),
        415,
        'Formato inválido. Usa PNG, JPG, WebP, GIF, MP4 o WebM.',
      );
      let duration = null;
      if (type.mime.startsWith('video/')) {
        const { stdout } = await runFile(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_type',
            '-of',
            'json',
            req.file.path,
          ],
          { timeout: 15_000, maxBuffer: 100_000 },
        );
        const meta = JSON.parse(stdout);
        check(
          meta.streams?.some((s) => s.codec_type === 'video'),
          415,
          'El archivo no contiene video válido.',
        );
        duration = Number(meta.format?.duration);
        check(
          Number.isFinite(duration) && duration > 0,
          415,
          'No se pudo determinar la duración del video.',
        );
      }
      // Auth is rechecked after IO: suspension/revocation cannot race an upload.
      auth.resolveSession(req.actor.session_id);
      const id = uid();
      const filename = id + '.' + type.ext;
      destination = path.join(config.dataDir, 'uploads', filename);
      transaction(db, () => {
        if (req.actor.role === 'tenant') {
          const quota = limits(req.actor.tenant_id);
          check(
            quota.file_count < quota.max_files,
            409,
            'Alcanzaste la cantidad máxima de archivos de tu paquete.',
          );
          check(
            quota.used_bytes + req.file.size <= quota.max_storage_mb * 1024 * 1024,
            409,
            'La carga supera el almacenamiento disponible de tu paquete.',
          );
        }
        fs.renameSync(req.file.path, destination);
        db.prepare(
          'INSERT INTO media (id, tenant_id, name, filename, mime_type, size_bytes, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          scope(req.actor),
          path.basename(req.file.originalname).slice(0, 180),
          filename,
          type.mime,
          req.file.size,
          duration,
          now(),
        );
      });
      audit(
        db,
        req.actor,
        'media:upload',
        'Archivo subido: ' + req.file.originalname.slice(0, 120),
      );
      notify(req.actor);
      const m = own('media', id, req.actor);
      res.status(201).json({ ...m, url: auth.grant(id, req.actor) });
    } catch (err) {
      fs.rmSync(req.file.path, { force: true });
      if (
        destination &&
        !db.prepare('SELECT id FROM media WHERE filename = ?').get(path.basename(destination))
      )
        fs.rmSync(destination, { force: true });
      if (err.code === 'ENOENT')
        throw new HttpError(503, 'FFprobe no está instalado en el servidor.');
      if (err.killed || (err.code && !(err instanceof HttpError)))
        throw new HttpError(415, 'El archivo de video no es válido o no pudo analizarse.');
      throw err;
    }
  });
  app.delete('/api/media/:id', userAuth, (req, res) => {
    const m = own('media', req.params.id, req.actor);
    check(
      !db.prepare('SELECT 1 FROM playlist_items WHERE media_id = ? LIMIT 1').get(m.id),
      409,
      'El archivo pertenece a una playlist. Retíralo de ella antes de eliminarlo.',
    );
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    fs.rmSync(path.join(config.dataDir, 'uploads', m.filename), { force: true });
    notify(req.actor);
    res.json({ ok: true });
  });
  app.get('/api/media/:id/content', (req, res, next) => {
    try {
      const actor = auth.resolveGrant(req);
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
      check(m, 404, 'Archivo no encontrado.');
      check(
        actor.role === 'superadmin' ||
          m.tenant_id === actor.tenant_id ||
          (actor.role === 'player' && m.tenant_id === null),
        403,
        'Archivo no autorizado.',
      );
      res.set({
        'Content-Type': m.mime_type,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.sendFile(path.join(config.dataDir, 'uploads', m.filename), (err) => {
        if (err && !res.headersSent) next(err);
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/playlists', userAuth, (req, res) =>
    res.json(
      db
        .prepare('SELECT id FROM playlists WHERE tenant_id IS ? ORDER BY created_at DESC')
        .all(scope(req.actor))
        .map((p) => playback.playlist(p.id, req.actor)),
    ),
  );
  function savePlaylist(req, res, updating) {
    const input = playlistInput.parse(req.body);
    const id = updating ? own('playlists', req.params.id, req.actor).id : uid();
    for (const item of input.items) own('media', item.media_id, req.actor);
    transaction(db, () => {
      if (updating) {
        db.prepare('UPDATE playlists SET name = ?, revision = revision + 1 WHERE id = ?').run(
          input.name,
          id,
        );
        db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
      } else
        db.prepare(
          'INSERT INTO playlists (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)',
        ).run(id, scope(req.actor), input.name, now());
      input.items.forEach((item, index) =>
        db
          .prepare(
            'INSERT INTO playlist_items (playlist_id, media_id, position, duration_seconds) VALUES (?, ?, ?, ?)',
          )
          .run(id, item.media_id, index, item.duration_seconds),
      );
    });
    audit(db, req.actor, 'playlist:save', 'Playlist: ' + input.name);
    notify(req.actor);
    res.status(updating ? 200 : 201).json(playback.playlist(id, req.actor));
  }
  app.post('/api/playlists', userAuth, (req, res) => savePlaylist(req, res, false));
  app.put('/api/playlists/:id', userAuth, (req, res) => savePlaylist(req, res, true));
  app.delete('/api/playlists/:id', userAuth, (req, res) => {
    const p = own('playlists', req.params.id, req.actor);
    for (const s of db.prepare('SELECT id FROM screens WHERE manual_playlist_id = ?').all(p.id))
      playback.returnToBase(s.id);
    transaction(db, () => {
      db.prepare(
        "UPDATE platform_settings SET value = NULL WHERE key = 'base_playlist_id' AND value = ?",
      ).run(p.id);
      db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
    });
    notify(req.actor);
    res.json({ ok: true });
  });
  app.put('/api/admin/base', adminAuth, (req, res) => {
    const input = z.object({ playlist_id: identifier.nullable() }).parse(req.body);
    if (input.playlist_id) own('playlists', input.playlist_id, req.actor);
    db.prepare(
      "INSERT INTO platform_settings (key, value) VALUES ('base_playlist_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(input.playlist_id);
    audit(db, req.actor, 'base:update', 'Señal base actualizada');
    realtime.refreshPlayers();
    notify(req.actor);
    res.json({ ok: true });
  });

  async function pairing(screenId, actor) {
    const pin = String(randomInt(100000, 1000000));
    const hash = await bcrypt.hash(pin, 12);
    auth.resolveSession(actor.session_id);
    own('screens', screenId, actor);
    db.prepare('UPDATE screens SET pairing_hash = ?, pairing_expires_at = ? WHERE id = ?').run(
      hash,
      new Date(Date.now() + 15 * 60_000).toISOString(),
      screenId,
    );
    return pin;
  }
  app.get('/api/screens', tenantAuth, (req, res) => res.json(screenRows(req.actor.tenant_id)));
  app.post('/api/screens', tenantAuth, async (req, res) => {
    const input = z.object({ name: text }).parse(req.body);
    const id = uid();
    const pin = String(randomInt(100000, 1000000));
    const hash = await bcrypt.hash(pin, 12);
    auth.resolveSession(req.actor.session_id);
    transaction(db, () => {
      const q = limits(req.actor.tenant_id);
      check(
        q.screen_count < q.max_screens,
        409,
        'Alcanzaste el límite de pantallas de tu paquete.',
      );
      db.prepare(
        'INSERT INTO screens (id, tenant_id, name, pairing_hash, pairing_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        req.actor.tenant_id,
        input.name,
        hash,
        new Date(Date.now() + 900_000).toISOString(),
        now(),
      );
    });
    audit(db, req.actor, 'screen:create', 'Pantalla: ' + input.name);
    notify(req.actor);
    res.status(201).json({ id, pin, expires_in: 900 });
  });
  app.put('/api/screens/:id', tenantAuth, (req, res) => {
    const s = own('screens', req.params.id, req.actor);
    const input = z.object({ name: text }).parse(req.body);
    db.prepare('UPDATE screens SET name = ? WHERE id = ?').run(input.name, s.id);
    notify(req.actor);
    res.json({ ok: true });
  });
  app.post('/api/screens/:id/pin', tenantAuth, async (req, res) => {
    const s = own('screens', req.params.id, req.actor);
    const pin = await pairing(s.id, req.actor);
    for (const session of db
      .prepare('SELECT id FROM sessions WHERE screen_id = ? AND revoked_at IS NULL')
      .all(s.id))
      realtime.revoke(session.id, 'La pantalla debe vincularse nuevamente.');
    res.json({ id: s.id, pin, expires_in: 900 });
    notify(req.actor);
  });
  app.delete('/api/screens/:id', tenantAuth, (req, res) => {
    const s = own('screens', req.params.id, req.actor);
    for (const session of db
      .prepare('SELECT id FROM sessions WHERE screen_id = ? AND revoked_at IS NULL')
      .all(s.id))
      realtime.revoke(session.id);
    db.prepare('DELETE FROM screens WHERE id = ?').run(s.id);
    notify(req.actor);
    res.json({ ok: true });
  });
  app.post('/api/screens/:id/playback', tenantAuth, (req, res) => {
    const screen = own('screens', req.params.id, req.actor);
    const input = z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('base') }),
        z.object({ mode: z.literal('client'), playlist_id: identifier }),
      ])
      .parse(req.body);
    if (input.mode === 'client') {
      own('playlists', input.playlist_id, req.actor);
      playback.immediate(screen.id, input.playlist_id);
    } else playback.returnToBase(screen.id);
    audit(
      db,
      req.actor,
      'playback:' + input.mode,
      input.mode === 'client'
        ? 'Transmitir de inmediato: ' + screen.name
        : 'Volver a transmisión base: ' + screen.name,
    );
    notify(req.actor);
    res.json(playback.selection(screen.id));
  });
  app.get('/api/schedules', tenantAuth, (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT s.*, sc.name AS screen_name, p.name AS playlist_name FROM schedules s JOIN screens sc ON sc.id = s.screen_id JOIN playlists p ON p.id = s.playlist_id WHERE s.tenant_id = ? ORDER BY s.day_of_week, s.start_time',
        )
        .all(req.actor.tenant_id),
    ),
  );
  function saveSchedule(req, res, updating) {
    const input = scheduleInput.parse(req.body);
    check(input.start_time !== input.end_time, 400, 'El inicio y el final deben ser distintos.');
    own('screens', input.screen_id, req.actor);
    own('playlists', input.playlist_id, req.actor);
    const id = updating ? own('schedules', req.params.id, req.actor).id : uid();
    if (updating)
      db.prepare(
        'UPDATE schedules SET screen_id = ?, playlist_id = ?, day_of_week = ?, start_time = ?, end_time = ?, timezone = ?, enabled = ? WHERE id = ?',
      ).run(
        input.screen_id,
        input.playlist_id,
        input.day_of_week,
        input.start_time,
        input.end_time,
        input.timezone,
        Number(input.enabled),
        id,
      );
    else
      db.prepare(
        'INSERT INTO schedules (id, tenant_id, screen_id, playlist_id, day_of_week, start_time, end_time, timezone, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        req.actor.tenant_id,
        input.screen_id,
        input.playlist_id,
        input.day_of_week,
        input.start_time,
        input.end_time,
        input.timezone,
        Number(input.enabled),
        now(),
      );
    audit(db, req.actor, 'schedule:save', 'Horario ' + input.start_time + '–' + input.end_time);
    notify(req.actor);
    res.status(updating ? 200 : 201).json({ id });
  }
  app.post('/api/schedules', tenantAuth, (req, res) => saveSchedule(req, res, false));
  app.put('/api/schedules/:id', tenantAuth, (req, res) => saveSchedule(req, res, true));
  app.delete('/api/schedules/:id', tenantAuth, (req, res) => {
    own('schedules', req.params.id, req.actor);
    db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
    notify(req.actor);
    res.json({ ok: true });
  });

  app.post('/api/player/:screenId/pair', pairLimit, async (req, res) => {
    identifier.parse(req.params.screenId);
    const input = z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const s = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.screenId);
    const valid = await bcrypt.compare(
      input.pin,
      s?.pairing_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5rWkT1pRf6Jn2FZjT8TWxhKC8xI.hjO',
    );
    check(
      s && valid && s.pairing_expires_at > now(),
      401,
      'PIN incorrecto, vencido o ya utilizado.',
    );
    check(limits(s.tenant_id)?.status === 'active', 403, 'Cliente suspendido.');
    // Atomic consumption prevents parallel requests from reusing a PIN.
    const consumed = db
      .prepare(
        'UPDATE screens SET pairing_hash = NULL, pairing_expires_at = NULL, paired_at = ? WHERE id = ? AND pairing_hash = ? AND pairing_expires_at > ?',
      )
      .run(now(), s.id, s.pairing_hash, now());
    check(consumed.changes === 1, 401, 'PIN ya utilizado.');
    for (const old of db
      .prepare('SELECT id FROM sessions WHERE screen_id = ? AND revoked_at IS NULL')
      .all(s.id))
      realtime.revoke(old.id, 'Pantalla vinculada en otro dispositivo.');
    res.json(
      auth.issue(req, res, {
        id: s.id,
        screen_id: s.id,
        tenant_id: s.tenant_id,
        name: s.name,
        role: 'player',
      }),
    );
    realtime.tenantChanged(s.tenant_id);
    realtime.sessionsChanged();
  });
  app.get('/api/player/:screenId/state', playerAuth, (req, res) =>
    res.json({
      user: req.actor,
      csrf_token: auth.csrf(req.actor.session_id),
      ...playback.state(req.actor.screen_id, req.actor),
    }),
  );
  app.post('/api/player/:screenId/refresh', playerAuth, (req, res) => {
    const actor = req.actor;
    const issued = auth.issue(req, res, actor);
    realtime.revoke(actor.session_id, 'Sesión renovada.', false);
    res.json(issued);
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint no encontrado.' }));
  const dist = path.resolve('dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((err, req, res, next) => {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    if (res.headersSent) return next(err);
    if (err instanceof ZodError)
      return res
        .status(400)
        .json({
          error: 'Datos inválidos.',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
    if (err instanceof multer.MulterError)
      return res
        .status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({
          error:
            err.code === 'LIMIT_FILE_SIZE'
              ? 'El archivo supera el máximo de ' + config.maxUploadMB + ' MB por carga.'
              : 'Carga inválida: envía un único archivo con el campo file.',
        });
    if (
      String(err.code).startsWith('SQLITE_CONSTRAINT') ||
      String(err.message).includes('constraint failed')
    )
      return res
        .status(409)
        .json({ error: 'Ya existe un registro con estos datos o el recurso está en uso.' });
    const status = err.status || 500;
    if (status >= 500) console.error('[API]', err.message);
    res
      .status(status)
      .json({ error: status >= 500 ? 'No se pudo completar la operación.' : err.message });
  });
  return {
    app,
    server,
    db,
    auth,
    playback,
    realtime,
    config,
    async close() {
      await realtime.close();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
