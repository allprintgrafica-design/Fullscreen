import { Server } from 'socket.io';
import { now } from './db.js';

export function listSessions(db, io) {
  const connected = new Set([...io.sockets.sockets.values()].map((s) => s.data.actor?.session_id));
  return db
    .prepare(
      `SELECT s.id, s.created_at, s.expires_at, s.last_seen_at, s.user_agent, s.ip,
    COALESCE(u.name, sc.name) AS name, COALESCE(u.email, '') AS email,
    COALESCE(u.role, 'player') AS role, COALESCE(u.tenant_id, sc.tenant_id) AS tenant_id, t.name AS tenant_name
    FROM sessions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN screens sc ON sc.id = s.screen_id
    LEFT JOIN tenants t ON t.id = COALESCE(u.tenant_id, sc.tenant_id)
    WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.created_at DESC`,
    )
    .all(now())
    .map((s) => ({ ...s, connected: connected.has(s.id) }));
}

export function createRealtime(httpServer, db, auth, playback, config) {
  const io = new Server(httpServer, {
    cors: { origin: config.appOrigin, credentials: true },
    maxHttpBufferSize: 16_384,
  });
  const sessionsChanged = () => io.to('admins').emit('admin:sessions', listSessions(db, io));
  const tenantChanged = (tenantId, event = 'data:changed') => {
    if (tenantId) io.to('tenant:' + tenantId).emit(event);
    io.to('admins').emit('data:changed');
  };
  function revoke(id, reason = 'Sesión revocada por el administrador.', notify = true) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
      now(),
      id,
    );
    if (notify) io.to('session:' + id).emit('session:revoked', { message: reason });
    io.in('session:' + id).disconnectSockets(true);
    sessionsChanged();
  }
  function revokeTenant(tenantId) {
    const sessions = db
      .prepare(
        `SELECT s.id FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN screens sc ON sc.id = s.screen_id WHERE s.revoked_at IS NULL AND (u.tenant_id = ? OR sc.tenant_id = ?)`,
      )
      .all(tenantId, tenantId);
    for (const s of sessions) revoke(s.id, 'La cuenta del cliente fue suspendida.');
  }
  function refreshPlayers(force = false) {
    for (const socket of io.sockets.sockets.values()) {
      const actor = socket.data.actor;
      if (actor?.role !== 'player') continue;
      const signature = playback.signature(actor.screen_id);
      if (
        force ||
        signature !== socket.data.signature ||
        Date.now() - (socket.data.grantedAt || 0) > 3600_000
      ) {
        socket.data.signature = signature;
        socket.data.grantedAt = Date.now();
        socket.emit('playback:state', playback.state(actor.screen_id, actor));
      }
    }
  }
  io.use((socket, next) => {
    try {
      const actor = auth.authenticate(socket.request, socket.handshake.auth?.screenId);
      auth.verifyCsrf(actor, socket.handshake.auth?.csrfToken);
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== config.appOrigin) throw new Error('Origen no permitido.');
      socket.data.actor = actor;
      next();
    } catch {
      next(new Error('Sesión inválida o no autorizada.'));
    }
  });
  io.on('connection', (socket) => {
    const actor = socket.data.actor;
    socket.join('session:' + actor.session_id);
    if (actor.role === 'superadmin') socket.join('admins');
    if (actor.role === 'tenant') socket.join('tenant:' + actor.tenant_id);
    if (actor.role === 'player') {
      socket.join('screen:' + actor.screen_id);
      db.prepare('UPDATE screens SET last_seen_at = ? WHERE id = ?').run(now(), actor.screen_id);
      refreshPlayers();
      tenantChanged(actor.tenant_id);
    }
    sessionsChanged();
    socket.on('heartbeat', () => {
      try {
        auth.resolveSession(actor.session_id);
        db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(
          now(),
          actor.session_id,
        );
        if (actor.role === 'player')
          db.prepare('UPDATE screens SET last_seen_at = ? WHERE id = ?').run(
            now(),
            actor.screen_id,
          );
      } catch {
        socket.emit('session:revoked', { message: 'Sesión no válida.' });
        socket.disconnect(true);
      }
    });
    socket.on('playback:ended', ({ runId } = {}) => {
      if (actor.role !== 'player') return;
      try {
        auth.resolveSession(actor.session_id);
        const current = playback.selection(actor.screen_id);
        if (current?.reason === 'manual' && current.runId === runId) {
          playback.returnToBase(actor.screen_id);
          refreshPlayers();
          tenantChanged(actor.tenant_id);
        }
      } catch {
        socket.disconnect(true);
      }
    });
    socket.on('disconnect', () => {
      sessionsChanged();
      if (actor.role === 'player') tenantChanged(actor.tenant_id);
    });
  });
  const timer = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      try {
        auth.resolveSession(socket.data.actor.session_id);
      } catch {
        socket.emit('session:revoked', { message: 'Sesión expirada o revocada.' });
        socket.disconnect(true);
      }
    }
    refreshPlayers();
  }, 1000);
  timer.unref();
  return {
    io,
    revoke,
    revokeTenant,
    sessionsChanged,
    tenantChanged,
    refreshPlayers,
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        io.close(resolve);
      }),
  };
}
