import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleWindow } from '../server/scheduler.js';

const block = {
  id: 'block',
  enabled: 1,
  day_of_week: 1,
  start_time: '09:00',
  end_time: '18:00',
  timezone: 'America/Argentina/Buenos_Aires',
};
test('weekly schedule uses the selected timezone, with an exclusive end', () => {
  assert.equal(scheduleWindow(block, new Date('2026-10-12T11:59:59Z')), null);
  const active = scheduleWindow(block, new Date('2026-10-12T12:00:00Z'));
  assert.equal(active.key, 'block:2026-10-12');
  assert.equal(active.end, '2026-10-12T21:00:00.000Z');
  assert.equal(scheduleWindow(block, new Date('2026-10-12T21:00:00Z')), null);
});
test('overnight schedule remains active on the following local day', () => {
  const overnight = { ...block, start_time: '22:00', end_time: '02:00' };
  assert.equal(scheduleWindow(overnight, new Date('2026-10-13T04:00:00Z')).key, 'block:2026-10-12');
  assert.equal(scheduleWindow(overnight, new Date('2026-10-13T05:00:00Z')), null);
});
test('DST is calculated from local dates, and disabled blocks never activate', () => {
  const dst = {
    ...block,
    timezone: 'America/New_York',
    day_of_week: 6,
    start_time: '22:00',
    end_time: '04:00',
  };
  const active = scheduleWindow(dst, new Date('2026-03-08T07:30:00Z'));
  assert.equal(active.end, '2026-03-08T08:00:00.000Z');
  assert.equal(scheduleWindow({ ...block, enabled: 0 }, new Date('2026-10-12T15:00:00Z')), null);
});
