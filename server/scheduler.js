import { DateTime, IANAZone } from 'luxon';
import { now, uid } from './db.js';

export const validTimezone = (zone) => IANAZone.isValidZone(zone);

export function scheduleWindow(schedule, instant = new Date()) {
  const local = DateTime.fromJSDate(instant, { zone: schedule.timezone });
  if (!local.isValid || !schedule.enabled) return null;
  const [sh, sm] = schedule.start_time.split(':').map(Number);
  const [eh, em] = schedule.end_time.split(':').map(Number);
  for (const day of [local.startOf('day'), local.startOf('day').minus({ days: 1 })]) {
    if (day.weekday % 7 !== schedule.day_of_week) continue;
    const start = day.set({ hour: sh, minute: sm });
    let end = day.set({ hour: eh, minute: em });
    if (end <= start) end = end.plus({ days: 1 });
    if (local >= start && local < end)
      return {
        key: schedule.id + ':' + day.toISODate(),
        start: start.toUTC().toISO(),
        end: end.toUTC().toISO(),
      };
  }
  return null;
}

export function createPlayback(db, auth) {
  function activeSchedule(screenId, instant = new Date()) {
    const rows = db
      .prepare(
        'SELECT * FROM schedules WHERE screen_id = ? AND enabled = 1 ORDER BY created_at DESC, id DESC',
      )
      .all(screenId);
    for (const row of rows) {
      const window = scheduleWindow(row, instant);
      if (
        window &&
        db
          .prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? LIMIT 1')
          .get(row.playlist_id)
      )
        return { ...row, window };
    }
    return null;
  }
  function selection(screenId) {
    const screen = db
      .prepare(
        'SELECT s.*, t.status FROM screens s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = ?',
      )
      .get(screenId);
    if (!screen) return null;
    const schedule = screen.status === 'active' ? activeSchedule(screenId) : null;
    if (
      screen.manual_mode === 'client' &&
      (!screen.manual_playlist_id || !screen.manual_expires_at || screen.manual_expires_at <= now())
    ) {
      returnToBase(screenId);
      return selection(screenId);
    }
    if (
      screen.manual_mode === 'base' &&
      ((screen.manual_expires_at && screen.manual_expires_at <= now()) ||
        (!screen.manual_expires_at && schedule))
    ) {
      db.prepare(
        'UPDATE screens SET manual_mode = NULL, manual_expires_at = NULL WHERE id = ?',
      ).run(screenId);
      screen.manual_mode = null;
    }
    const baseId =
      db.prepare("SELECT value FROM platform_settings WHERE key = 'base_playlist_id'").get()
        ?.value || null;
    if (screen.status !== 'active' || screen.manual_mode === 'base')
      return {
        mode: 'base',
        reason: 'base',
        baseId,
        runId: null,
        playlistId: null,
        activeUntil: null,
      };
    if (screen.manual_mode === 'client')
      return {
        mode: 'client',
        reason: 'manual',
        baseId,
        runId: screen.manual_run_id,
        playlistId: screen.manual_playlist_id,
        activeUntil: screen.manual_expires_at,
      };
    if (schedule)
      return {
        mode: 'client',
        reason: 'schedule',
        baseId,
        runId: schedule.window.key,
        playlistId: schedule.playlist_id,
        activeUntil: schedule.window.end,
      };
    return {
      mode: 'base',
      reason: 'base',
      baseId,
      runId: null,
      playlistId: null,
      activeUntil: null,
    };
  }
  function playlist(id, actor) {
    if (!id) return null;
    const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!p) return null;
    const items = db
      .prepare(
        'SELECT m.*, i.position, i.duration_seconds AS play_seconds FROM playlist_items i JOIN media m ON m.id = i.media_id WHERE i.playlist_id = ? ORDER BY i.position',
      )
      .all(id);
    return { ...p, items: items.map((m) => ({ ...m, url: auth.grant(m.id, actor) })) };
  }
  function state(screenId, actor) {
    const selected = selection(screenId);
    if (!selected) return null;
    return {
      mode: selected.mode,
      reason: selected.reason,
      runId: selected.runId,
      activeUntil: selected.activeUntil,
      serverTime: now(),
      basePlaylist: playlist(selected.baseId, actor),
      playlist: playlist(selected.playlistId, actor),
    };
  }
  function signature(screenId) {
    const selected = selection(screenId);
    if (!selected) return '';
    return JSON.stringify([
      selected,
      ...[selected.baseId, selected.playlistId].map(
        (id) => id && db.prepare('SELECT revision FROM playlists WHERE id = ?').get(id)?.revision,
      ),
    ]);
  }
  function returnToBase(screenId) {
    const active = activeSchedule(screenId);
    db.prepare(
      "UPDATE screens SET manual_mode = 'base', manual_playlist_id = NULL, manual_run_id = NULL, manual_expires_at = ? WHERE id = ?",
    ).run(active?.window.end || null, screenId);
  }
  function immediate(screenId, playlistId) {
    const duration = db
      .prepare('SELECT SUM(duration_seconds) AS duration FROM playlist_items WHERE playlist_id = ?')
      .get(playlistId).duration;
    const runId = uid();
    db.prepare(
      "UPDATE screens SET manual_mode = 'client', manual_playlist_id = ?, manual_run_id = ?, manual_expires_at = ? WHERE id = ?",
    ).run(
      playlistId,
      runId,
      new Date(Date.now() + duration * 1000 + 15_000).toISOString(),
      screenId,
    );
    return runId;
  }
  return { state, signature, selection, playlist, activeSchedule, immediate, returnToBase };
}
