import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

test('panels, mobile layout and persistent video base survive cached overlays, schedules and revocation', async ({
  browser,
  baseURL,
}, testInfo) => {
  const adminContext = await browser.newContext({ baseURL });
  const tenantContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const tenantPage = await tenantContext.newPage();
  const errors = [];
  for (const page of [adminPage, tenantPage])
    page.on('pageerror', (error) => errors.push(error.message));
  async function call(context, route, csrf, data, method = 'POST', multipart) {
    const response = await context.request.fetch('/api' + route, {
      method,
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      data,
      multipart,
    });
    expect(response.ok(), route + ': ' + (await response.text())).toBeTruthy();
    return response.json();
  }
  async function login(page, email, password) {
    await page.goto('/');
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
    await expect(page.locator('.hero-banner')).toBeVisible();
  }
  try {
    await login(adminPage, 'e2e-owner@test.local', 'E2eOwnerSecure2026!');
    const admin = await call(adminContext, '/auth/me', null, undefined, 'GET');
    const ac = admin.csrf_token;
    const plan = await call(adminContext, '/admin/packages', ac, {
      name: 'E2E',
      max_storage_mb: 100,
      max_files: 10,
      max_screens: 2,
    });
    await call(adminContext, '/admin/tenants', ac, {
      name: 'Cliente E2E',
      email: 'e2e-tenant@test.local',
      password: 'E2eTenantSecure2026!',
      package_id: plan.id,
    });
    await login(tenantPage, 'e2e-tenant@test.local', 'E2eTenantSecure2026!');
    const tc = (await call(tenantContext, '/auth/me', null, undefined, 'GET')).csrf_token;
    for (const label of ['Biblioteca', 'Playlists', 'Programación', 'Pantallas']) {
      await tenantPage.locator('nav').getByRole('button', { name: label }).click();
      await expect(tenantPage.locator('.page-heading h1')).toBeVisible();
    }
    await tenantPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await tenantPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await tenantPage.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
    for (const label of [
      'Clientes',
      'Paquetes',
      'Sesiones activas',
      'Transmisión base',
      'Biblioteca general',
      'Playlists generales',
    ]) {
      await adminPage.locator('nav').getByRole('button', { name: label, exact: true }).click();
      await expect(adminPage.locator('.page-heading h1')).toBeVisible();
    }
    const videoPath = testInfo.outputPath('base.mp4');
    const imagePath = testInfo.outputPath('overlay.png');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24',
      '-t',
      '30',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      '-movflags',
      '+faststart',
      '-y',
      videoPath,
    ]);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x86a463:s=640x360',
      '-frames:v',
      '1',
      '-threads',
      '1',
      '-y',
      imagePath,
    ]);
    const video = await call(adminContext, '/media', ac, undefined, 'POST', {
      file: { name: 'base.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(videoPath) },
    });
    const image = await call(tenantContext, '/media', tc, undefined, 'POST', {
      file: { name: 'overlay.png', mimeType: 'image/png', buffer: fs.readFileSync(imagePath) },
    });
    const base = await call(adminContext, '/playlists', ac, {
      name: 'Base video',
      items: [{ media_id: video.id, duration_seconds: 30 }],
    });
    const overlay = await call(tenantContext, '/playlists', tc, {
      name: 'Overlay',
      items: [{ media_id: image.id, duration_seconds: 3 }],
    });
    await call(adminContext, '/admin/base', ac, { playlist_id: base.id }, 'PUT');
    const screen = await call(tenantContext, '/screens', tc, { name: 'Pantalla E2E' });
    const player = await tenantContext.newPage();
    player.on('pageerror', (error) => errors.push(error.message));
    await player.goto('/player/' + screen.id);
    await player.locator('.pin-input').fill(screen.pin);
    await player.getByRole('button', { name: 'Vincular pantalla' }).click();
    await player.waitForFunction(
      () => document.querySelector('.layer-base video')?.currentTime > 0.5,
    );
    await player.evaluate(() => {
      window.baseVideo = document.querySelector('.layer-base video');
      window.baseTime = window.baseVideo.currentTime;
    });
    const layer = player.getByTestId('layer-cliente');
    const playback = (mode) =>
      call(tenantContext, '/screens/' + screen.id + '/playback', tc, {
        mode,
        ...(mode === 'client' ? { playlist_id: overlay.id } : {}),
      });
    await playback('client');
    await expect(layer).toHaveCSS('opacity', '1');
    await expect
      .poll(() => player.evaluate(() => window.baseVideo.currentTime))
      .toBeGreaterThan(await player.evaluate(() => window.baseTime));
    expect(
      await player.evaluate(
        () =>
          window.baseVideo === document.querySelector('.layer-base video') &&
          !window.baseVideo.paused,
      ),
    ).toBeTruthy();
    await playback('base');
    await expect(layer).toHaveCSS('opacity', '0');
    // Regression: retransmitting an already cached image must still reveal it.
    await playback('client');
    await expect(layer).toHaveCSS('opacity', '1');
    await expect(layer).toHaveCSS('opacity', '0', { timeout: 6000 });
    await expect
      .poll(
        async () =>
          (await call(tenantContext, '/player/' + screen.id + '/state', null, undefined, 'GET'))
            .mode,
      )
      .toBe('base');
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 3600_000);
    const schedule = await call(tenantContext, '/schedules', tc, {
      screen_id: screen.id,
      playlist_id: overlay.id,
      day_of_week: start.getUTCDay(),
      start_time: start.toISOString().slice(11, 16),
      end_time: end.toISOString().slice(11, 16),
      timezone: 'UTC',
    });
    await expect(layer).toHaveCSS('opacity', '1');
    await playback('base');
    await expect(layer).toHaveCSS('opacity', '0');
    await call(tenantContext, '/schedules/' + schedule.id, tc, undefined, 'DELETE');
    const state = await call(
      tenantContext,
      '/player/' + screen.id + '/state',
      null,
      undefined,
      'GET',
    );
    await call(adminContext, '/admin/sessions/' + state.user.session_id, ac, undefined, 'DELETE');
    await expect(player.locator('.pairing-card')).toBeVisible();
    await expect(layer).toHaveCSS('opacity', '0');
    expect(
      await player.evaluate(
        () =>
          window.baseVideo === document.querySelector('.layer-base video') &&
          !window.baseVideo.paused,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
    await tenantContext.close();
  }
});
