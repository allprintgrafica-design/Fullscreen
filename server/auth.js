import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse, serialize } from 'cookie';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { uid, now } from './db.js';
import { check, HttpError } from './errors.js';

export function createAuth(db, config) {
  const cookieName = (screenId) => (screenId ? 'signage_player_' + screenId : 'signage_session');
  const csrf = (id) =>
    createHmac('sha256', config.jwtSecret)
      .update('csrf:' + id)
      .digest('hex');
  function readToken(req, screenId) {
    const bearer = req.headers.authorization;
    if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
    return parse(req.headers.cookie || '')[cookieName(screenId)];
  }
  function verify(token, audience = 'signage') {
    try {
      return jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'fullscreen',
        audience,
      });
    } catch {
      throw new HttpError(401, 'La sesión expiró o fue revocada. Inicia sesión nuevamente.');
    }
  }
  function resolveSession(id) {
    const s = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?')
      .get(id, now());
    check(s, 401, 'La sesión expiró o fue revocada.');
    let actor;
    if (s.user_id) {
      actor = db
        .prepare('SELECT id, name, email, role, tenant_id FROM users WHERE id = ?')
        .get(s.user_id);
    } else {
      const screen = db.prepare('SELECT * FROM screens WHERE id = ?').get(s.screen_id);
      actor = screen && {
        id: screen.id,
        screen_id: screen.id,
        tenant_id: screen.tenant_id,
        name: screen.name,
        role: 'player',
      };
    }
    check(actor, 401, 'Sesión inválida.');
    if (actor.tenant_id) {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(actor.tenant_id);
      check(tenant?.status === 'active', 403, 'La cuenta del cliente está suspendida.');
      actor.tenant_name = tenant.name;
    }
    return { ...actor, session_id: s.id, expires_at: s.expires_at };
  }
  function authenticate(req, screenId) {
    const payload = verify(readToken(req, screenId));
    const actor = resolveSession(payload.jti);
    check(payload.sub === actor.id && payload.role === actor.role, 401, 'Sesión inválida.');
    if (screenId)
      check(
        actor.role === 'player' && actor.screen_id === screenId,
        403,
        'Pantalla no autorizada.',
      );
    return actor;
  }
  function verifyCsrf(actor, supplied) {
    const expected = Buffer.from(csrf(actor.session_id));
    const candidate = typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0);
    check(
      candidate.length === expected.length && timingSafeEqual(candidate, expected),
      403,
      'Token CSRF inválido.',
    );
  }
  function middleware(roles, player = false) {
    return (req, res, next) => {
      try {
        req.actor = authenticate(req, player ? req.params.screenId : undefined);
        check(roles.includes(req.actor.role), 403, 'No tienes permisos para esta operación.');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
          verifyCsrf(req.actor, req.headers['x-csrf-token']);
        next();
      } catch (err) {
        next(err);
      }
    };
  }
  function issue(req, res, actor) {
    const id = uid();
    const seconds = actor.role === 'player' ? 30 * 86400 : 8 * 3600;
    const expiration = new Date(Date.now() + seconds * 1000).toISOString();
    db.prepare(
      'INSERT INTO sessions (id, user_id, screen_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      actor.role === 'player' ? null : actor.id,
      actor.role === 'player' ? actor.id : null,
      now(),
      expiration,
      now(),
      String(req.headers['user-agent'] || '').slice(0, 300),
      req.ip || 'unknown',
    );
    const token = jwt.sign({ role: actor.role }, config.jwtSecret, {
      algorithm: 'HS256',
      subject: actor.id,
      jwtid: id,
      issuer: 'fullscreen',
      audience: 'signage',
      expiresIn: seconds,
    });
    res.append(
      'Set-Cookie',
      serialize(cookieName(actor.role === 'player' ? actor.id : undefined), token, {
        httpOnly: true,
        secure: config.production,
        sameSite: 'strict',
        path: '/',
        maxAge: seconds,
      }),
    );
    return { user: actor, csrf_token: csrf(id), expires_at: expiration };
  }
  function grant(mediaId, actor) {
    // Stable, cookie-authenticated URLs preserve the base video's currentTime.
    // No bearer token is exposed in URLs, browser history or referrer headers.
    return (
      '/api/media/' +
      mediaId +
      '/content' +
      (actor.role === 'player' ? '?screen=' + encodeURIComponent(actor.screen_id) : '')
    );
  }
  function resolveGrant(req) {
    check(!req.query.screen || typeof req.query.screen === 'string', 400, 'Pantalla inválida.');
    return authenticate(req, req.query.screen || undefined);
  }
  return {
    csrf,
    verifyCsrf,
    authenticate,
    middleware,
    issue,
    grant,
    resolveGrant,
    resolveSession,
    clearCookie(res, screenId) {
      res.append(
        'Set-Cookie',
        serialize(cookieName(screenId), '', {
          httpOnly: true,
          secure: config.production,
          sameSite: 'strict',
          path: '/',
          maxAge: 0,
        }),
      );
    },
  };
}

export async function bootstrapAdmin(db, config) {
  if (db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get()) return;
  check(
    config.adminEmail &&
      config.adminPassword?.length >= 12 &&
      Buffer.byteLength(config.adminPassword, 'utf8') <= 72,
    500,
    'Base vacía: configura ADMIN_EMAIL y ADMIN_PASSWORD (12 caracteres mínimo, 72 bytes máximo) o ejecuta npm run seed para una demo local.',
  );
  db.prepare(
    'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    uid(),
    'Administrador',
    config.adminEmail.toLowerCase(),
    await bcrypt.hash(config.adminPassword, 12),
    'superadmin',
    now(),
  );
}
