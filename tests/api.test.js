import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { uid, now } from '../server/db.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fullscreen-test-'));
let instance,
  origin,
  admin,
  tenantA,
  tenantB,
  packageId,
  tenantAId,
  tenantBId,
  mediaId,
  playlistId,
  screenId,
  player,
  baseId;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2c8AAAAASUVORK5CYII=',
  'base64',
);
const sockets = [];
async function request(url, { actor, method = 'GET', body, csrf = true } = {}) {
  const form = body instanceof FormData;
  const response = await fetch(origin + '/api' + url, {
    method,
    headers: {
      ...(actor
        ? { Cookie: actor.cookie, ...(csrf ? { 'X-CSRF-Token': actor.csrf_token } : {}) }
        : {}),
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const content = response.headers.get('content-type') || '';
  const data = content.includes('json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    headers: response.headers,
  };
}
async function login(email, password) {
  const r = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...r.data, cookie: r.cookie };
}
function upload(actor, contents = png) {
  const f = new FormData();
  f.append('file', new Blob([contents], { type: 'image/png' }), 'test.png');
  return request('/media', { method: 'POST', actor, body: f });
}
function waitEvent(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error('Timed out waiting for ' + name));
    }, 5000);
    function listener(data) {
      if (predicate(data)) {
        clearTimeout(timeout);
        socket.off(name, listener);
        resolve(data);
      }
    }
    socket.on(name, listener);
  });
}
function socket(actor, screen) {
  const s = connect(origin, {
    autoConnect: false,
    reconnection: false,
    extraHeaders: { Cookie: actor.cookie },
    auth: { csrfToken: actor.csrf_token, ...(screen ? { screenId: screen } : {}) },
  });
  sockets.push(s);
  return s;
}

before(async () => {
  instance = await createApp({
    dataDir: directory,
    jwtSecret: 'test-' + 'a'.repeat(48),
    appOrigin: 'http://localhost:5173',
    production: false,
    adminEmail: 'owner@test.local',
    adminPassword: 'OwnerSecure2026!',
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + instance.server.address().port;
  admin = await login('owner@test.local', 'OwnerSecure2026!');
});
after(async () => {
  for (const s of sockets) s.disconnect();
  await instance.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('JWT lives in an HttpOnly cookie, invalid login is rejected, and CSRF is required', async () => {
  const loginResponse = await request('/auth/login', {
    method: 'POST',
    body: { email: 'owner@test.local', password: 'OwnerSecure2026!' },
  });
  assert.match(loginResponse.headers.get('set-cookie'), /HttpOnly/);
  assert.match(loginResponse.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal(loginResponse.data.token, undefined);
  admin = { ...loginResponse.data, cookie: loginResponse.cookie };
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { email: 'owner@test.local', password: 'incorrect' },
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('/admin/packages', { method: 'POST', actor: admin, csrf: false, body: {} }))
      .status,
    403,
  );
  assert.equal(
    (
      await request('/admin/packages', {
        method: 'POST',
        actor: { ...admin, csrf_token: 'é'.repeat(64) },
        body: {},
      })
    ).status,
    403,
  );
});
test('admin creates packages and isolated tenants, and duplicate users roll back', async () => {
  const p = await request('/admin/packages', {
    method: 'POST',
    actor: admin,
    body: { name: 'Test', max_storage_mb: 1, max_files: 1, max_screens: 2 },
  });
  assert.equal(p.status, 201);
  packageId = p.data.id;
  for (const [name, mail] of [
    ['Tenant A', 'a@test.local'],
    ['Tenant B', 'b@test.local'],
  ]) {
    const t = await request('/admin/tenants', {
      method: 'POST',
      actor: admin,
      body: { name, email: mail, password: 'TenantSecure2026!', package_id: packageId },
    });
    assert.equal(t.status, 201);
    if (name === 'Tenant A') tenantAId = t.data.id;
    else tenantBId = t.data.id;
  }
  const duplicate = await request('/admin/tenants', {
    method: 'POST',
    actor: admin,
    body: {
      name: 'Duplicate',
      email: 'a@test.local',
      password: 'TenantSecure2026!',
      package_id: packageId,
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n, 2);
  tenantA = await login('a@test.local', 'TenantSecure2026!');
  tenantB = await login('b@test.local', 'TenantSecure2026!');
  assert.equal((await request('/admin/sessions', { actor: tenantA })).status, 403);
});
test('concurrent uploads cannot exceed the file count, and rejected uploads leave no temp files', async () => {
  const results = await Promise.all([upload(tenantA), upload(tenantA)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  mediaId = results.find((r) => r.status === 201).data.id;
  assert.equal(fs.readdirSync(path.join(directory, 'tmp')).length, 0);
  assert.equal((await request('/media', { actor: tenantB })).data.length, 0);
});
test('storage quota uses actual bytes and MIME spoofing is rejected', async () => {
  const oversized = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
  assert.equal((await upload(tenantB, oversized)).status, 409);
  assert.equal((await upload(tenantB, Buffer.from('<html>fake image</html>'))).status, 415);
  assert.equal((await request('/media', { actor: tenantB })).data.length, 0);
  assert.equal(fs.readdirSync(path.join(directory, 'tmp')).length, 0);
});
test('media, playlists, screens and schedules cannot cross tenants', async () => {
  assert.equal(
    (await request('/media/' + mediaId, { actor: tenantB, method: 'DELETE' })).status,
    404,
  );
  assert.equal((await request('/media/' + mediaId + '/content', { actor: tenantB })).status, 403);
  assert.equal(
    (
      await request('/playlists', {
        actor: tenantB,
        method: 'POST',
        body: { name: 'Stolen', items: [{ media_id: mediaId, duration_seconds: 1 }] },
      })
    ).status,
    404,
  );
  const p = await request('/playlists', {
    actor: tenantA,
    method: 'POST',
    body: { name: 'Client playlist', items: [{ media_id: mediaId, duration_seconds: 1 }] },
  });
  assert.equal(p.status, 201);
  playlistId = p.data.id;
  assert.equal(
    (await request('/playlists/' + playlistId, { actor: tenantB, method: 'DELETE' })).status,
    404,
  );
  assert.equal(
    (await request('/media/' + mediaId, { actor: tenantA, method: 'DELETE' })).status,
    409,
  );
  const s = await request('/screens', {
    actor: tenantA,
    method: 'POST',
    body: { name: 'Screen A' },
  });
  assert.equal(s.status, 201);
  screenId = s.data.id;
  assert.equal(
    (
      await request('/screens/' + screenId + '/playback', {
        actor: tenantB,
        method: 'POST',
        body: { mode: 'base' },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request('/schedules', {
        actor: tenantB,
        method: 'POST',
        body: {
          screen_id: screenId,
          playlist_id: playlistId,
          day_of_week: 1,
          start_time: '09:00',
          end_time: '10:00',
          timezone: 'UTC',
        },
      })
    ).status,
    404,
  );
  const pairing = await request('/player/' + screenId + '/pair', {
    method: 'POST',
    body: { pin: s.data.pin },
  });
  assert.equal(pairing.status, 200);
  player = { ...pairing.data, cookie: pairing.cookie };
  assert.equal(
    (await request('/player/' + screenId + '/pair', { method: 'POST', body: { pin: s.data.pin } }))
      .status,
    401,
  );
  assert.equal((await request('/auth/me', { actor: player })).status, 401);
  assert.equal((await request('/player/' + uid() + '/state', { actor: player })).status, 401);
});
test('screen quota and single-use PIN survive parallel requests', async () => {
  const s = await request('/screens', {
    actor: tenantA,
    method: 'POST',
    body: { name: 'Second screen' },
  });
  assert.equal(s.status, 201);
  assert.equal(
    (await request('/screens', { actor: tenantA, method: 'POST', body: { name: 'Over limit' } }))
      .status,
    409,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      request('/player/' + s.data.id + '/pair', { method: 'POST', body: { pin: s.data.pin } }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
});
test('WebSocket immediate control preserves the base identity; completion and manual return reveal base', async () => {
  const baseMedia = await upload(admin);
  assert.equal(baseMedia.status, 201);
  const base = await request('/playlists', {
    actor: admin,
    method: 'POST',
    body: { name: 'Base', items: [{ media_id: baseMedia.data.id, duration_seconds: 30 }] },
  });
  baseId = base.data.id;
  assert.equal(
    (await request('/admin/base', { actor: admin, method: 'PUT', body: { playlist_id: baseId } }))
      .status,
    200,
  );
  const s = socket(player, screenId);
  const initial = waitEvent(s, 'playback:state');
  s.connect();
  const original = await initial;
  assert.equal(original.mode, 'base');
  const override = waitEvent(s, 'playback:state', (x) => x.mode === 'client');
  assert.equal(
    (
      await request('/screens/' + screenId + '/playback', {
        actor: tenantA,
        method: 'POST',
        body: { mode: 'client', playlist_id: playlistId },
      })
    ).status,
    200,
  );
  const active = await override;
  assert.deepEqual(active.basePlaylist, original.basePlaylist);
  assert.equal(
    (await request(active.basePlaylist.items[0].url.slice(4), { actor: player })).status,
    200,
  );
  const finished = waitEvent(s, 'playback:state', (x) => x.mode === 'base');
  s.emit('playback:ended', { runId: active.runId });
  await finished;
  const again = waitEvent(s, 'playback:state', (x) => x.mode === 'client');
  await request('/screens/' + screenId + '/playback', {
    actor: tenantA,
    method: 'POST',
    body: { mode: 'client', playlist_id: playlistId },
  });
  await again;
  const returned = waitEvent(s, 'playback:state', (x) => x.mode === 'base');
  await request('/screens/' + screenId + '/playback', {
    actor: tenantA,
    method: 'POST',
    body: { mode: 'base' },
  });
  await returned;
});
test('schedule runs automatically, manual base suppresses the current block, and timeout is fail-safe', async () => {
  const current = new Date();
  const day = current.getUTCDay();
  const start = new Date(current.getTime() - 60_000).toISOString().slice(11, 16);
  const end = new Date(current.getTime() + 3600_000).toISOString().slice(11, 16);
  const s = await request('/schedules', {
    actor: tenantA,
    method: 'POST',
    body: {
      screen_id: screenId,
      playlist_id: playlistId,
      day_of_week: day,
      start_time: start,
      end_time: end,
      timezone: 'UTC',
    },
  });
  assert.equal(s.status, 201);
  assert.equal(
    (await request('/schedules/' + s.data.id, { actor: tenantB, method: 'DELETE' })).status,
    404,
  );
  assert.equal(instance.playback.selection(screenId).reason, 'schedule');
  await request('/screens/' + screenId + '/playback', {
    actor: tenantA,
    method: 'POST',
    body: { mode: 'base' },
  });
  assert.equal(instance.playback.selection(screenId).mode, 'base');
  await request('/screens/' + screenId + '/playback', {
    actor: tenantA,
    method: 'POST',
    body: { mode: 'client', playlist_id: playlistId },
  });
  instance.db
    .prepare('UPDATE screens SET manual_expires_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', screenId);
  assert.equal(instance.playback.selection(screenId).mode, 'base');
  await request('/schedules/' + s.data.id, { actor: tenantA, method: 'DELETE' });
});
test('admin sees live sessions; remote revocation invalidates HTTP, media and socket instantly', async () => {
  const adminSocket = socket(admin);
  const sessions = waitEvent(adminSocket, 'admin:sessions');
  adminSocket.connect();
  assert.ok((await sessions).some((s) => s.id === tenantA.user.id || s.role === 'tenant'));
  const clientSocket = socket(tenantA);
  const connected = waitEvent(clientSocket, 'connect');
  clientSocket.connect();
  await connected;
  const me = await request('/auth/me', { actor: tenantA });
  const sessionId = me.data.user.session_id;
  const revoked = waitEvent(clientSocket, 'session:revoked');
  assert.equal(
    (await request('/admin/sessions/' + sessionId, { actor: admin, method: 'DELETE' })).status,
    200,
  );
  await revoked;
  assert.equal((await request('/media', { actor: tenantA })).status, 401);
  assert.equal((await request('/media/' + mediaId + '/content', { actor: tenantA })).status, 401);
  tenantA = await login('a@test.local', 'TenantSecure2026!');
});
test('tenant suspension destroys user and player access without affecting another tenant', async () => {
  const response = await request('/admin/tenants/' + tenantAId, {
    actor: admin,
    method: 'PUT',
    body: { name: 'Tenant A', package_id: packageId, status: 'suspended' },
  });
  assert.equal(response.status, 200);
  assert.equal((await request('/media', { actor: tenantA })).status, 401);
  assert.equal((await request('/player/' + screenId + '/state', { actor: player })).status, 401);
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { email: 'a@test.local', password: 'TenantSecure2026!' },
      })
    ).status,
    403,
  );
  assert.equal((await request('/media', { actor: tenantB })).status, 200);
  assert.equal(instance.playback.selection(screenId).mode, 'base');
});
test('package changes cannot downgrade below existing consumption', async () => {
  const update = await request('/admin/packages/' + packageId, {
    actor: admin,
    method: 'PUT',
    body: { name: 'Test', max_storage_mb: 1, max_files: 1, max_screens: 1 },
  });
  assert.equal(update.status, 409);
});
test('player session renewal revokes the old JWT and preserves media access with the new cookie', async () => {
  await request('/admin/tenants/' + tenantAId, {
    actor: admin,
    method: 'PUT',
    body: { name: 'Tenant A', package_id: packageId, status: 'active' },
  });
  tenantA = await login('a@test.local', 'TenantSecure2026!');
  const pin = await request('/screens/' + screenId + '/pin', { actor: tenantA, method: 'POST' });
  const pair = await request('/player/' + screenId + '/pair', {
    method: 'POST',
    body: { pin: pin.data.pin },
  });
  const old = { ...pair.data, cookie: pair.cookie };
  const refreshed = await request('/player/' + screenId + '/refresh', {
    actor: old,
    method: 'POST',
  });
  assert.equal(refreshed.status, 200);
  assert.equal((await request('/player/' + screenId + '/state', { actor: old })).status, 401);
  const next = { ...refreshed.data, cookie: refreshed.cookie };
  assert.equal((await request('/player/' + screenId + '/state', { actor: next })).status, 200);
});
