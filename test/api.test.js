import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, readFile, writeFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { once } from 'node:events';
import { SharedPlanner } from '../lib/shared.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let php = process.env.PHP_BINARY;
if (!php) {
  const portable = resolve(root, 'test-results/php-runtime/php.exe');
  try { await access(portable); php = portable; }
  catch { if (spawnSync('php', ['-v'], { stdio: 'ignore' }).status === 0) php = 'php'; }
}
async function start(directory) {
  const port = 32000 + Math.floor(Math.random() * 20000), url = `http://127.0.0.1:${port}/gathering/`;
  const child = spawn(php, ['-n', '-d', 'display_errors=0', '-d', `session.save_path=${resolve(directory, 'sessions')}`, '-S', `127.0.0.1:${port}`, '-t', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`PHP did not start: ${logs}`)); }, 10000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`PHP exited ${code}: ${logs}`)); });
    child.stderr.on('data', (chunk) => { logs += chunk; if (logs.includes('Development Server') && logs.includes('started')) { clearTimeout(timeout); ready(); } });
  });
  return { child, url };
}
async function stop(child) { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; }
function client(url) {
  let cookie = '';
  return new SharedPlanner(`${url}api.php`, async (endpoint, options = {}) => {
    const response = await fetch(endpoint, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
    const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0];
    return response;
  });
}
test('shared PHP app: automatic submissions, one durable store, rules, vetoes, privacy, and concurrent clients', { skip: php ? false : 'PHP is required for HTTP tests (set PHP_BINARY or put php on PATH).' }, async (t) => {
  const testRoot = resolve(root, 'test-results'); await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(resolve(testRoot, 'shared-'));
  const app = resolve(directory, 'gathering'); await mkdir(app); await mkdir(resolve(directory, 'sessions'));
  await copyFile(resolve(root, 'api.php'), resolve(app, 'api.php'));
  let running = await start(directory);
  t.after(async () => {
    await stop(running.child);
    assert.ok(resolve(directory).startsWith(testRoot + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const admin = client(running.url), guest = client(running.url);
  const password = 'Test-organizer-password-123';
  let status = await admin.request('/api/auth'); assert.equal(status.initialized, false);
  let raw = await fetch(`${running.url}api.php?action=setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(raw.status, 403, 'CSRF protection applies to setup');
  await assert.rejects(admin.request('/api/setup', { password: 'short' }), /12 and 72/);
  await admin.request('/api/setup', { password });
  await assert.rejects(guest.request('/api/admin'), /sign in/);
  await assert.rejects(guest.request('/api/login', { password: 'wrong' }), /did not match/);
  await assert.rejects(guest.request('/api/setup', { password }), /already configured/);
  let state = await admin.request('/api/admin'); assert.equal(state.responses.length, 0);
  for (const slot of [
    { label: 'Morning', date: '2027-01-09', start: '10:00', end: '13:00' },
    { label: 'Afternoon', date: '2027-01-09', start: '14:00', end: '17:00' },
  ]) state = await admin.request('/api/admin/slot', slot);
  await assert.rejects(admin.request('/api/admin/slot', { label: 'Overlap', date: '2027-01-09', start: '11:00', end: '14:00' }), /overlap/);
  for (let i = 0; i < 3; i++) state = await admin.request('/api/admin/game', { title: `Adventure ${i + 1}`, gm: ['Alex', 'Robin', 'Sam'][i], minPlayers: 2, maxPlayers: 4, runs: 2, slotIds: [], description: 'Long description hidden from the compact list.', summary: 'A short pitch', system: 'Example system', adventure: '' });
  const initial = state, players = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const player = client(running.url); await player.request('/api/event');
    const payload = { name: `Player ${i}`, gm: '', preferences: [initial.games[i % 3].id, initial.games[(i + 1) % 3].id], vetoes: [initial.games[(i + 2) % 3].id], availability: initial.slots.map((s) => s.id) };
    const reply = await player.request('/api/responses', payload);
    return { player, payload, token: reply.token };
  }));
  state = await admin.request('/api/admin/event', initial.event);
  assert.equal(state.responses.length, 12, 'saving settings preserves responses received since the form was opened');
  await assert.rejects(admin.call('event-save', { ...state.event, expectedDefinitionRevision: -1 }), /changed in another window/);
  state = await admin.request('/api/admin'); assert.equal(state.responses.length, 12, 'parallel submissions do not overwrite each other');
  assert.ok(state.responses.every((r) => !('tokenHash' in r)));
  const event = await guest.request('/api/event'); assert.equal(event.responses, undefined);
  const first = players[0];
  await first.player.request('/api/event');
  await first.player.request('/api/responses', { ...first.payload, token: first.token, name: 'Updated player' });
  const own = await first.player.request('/api/response', undefined, { headers: { Authorization: `Bearer ${first.token}` } }); assert.equal(own.response.name, 'Updated player');
  state = await admin.request('/api/admin'); assert.equal(state.responses.length, 12);
  for (const name of ['event-data.php', 'event-lock.php']) { raw = await fetch(running.url + name); assert.equal(raw.status, 404); assert.equal(await raw.text(), ''); }
  const before = await readFile(resolve(app, 'event-data.php'), 'utf8'); assert.ok(before.startsWith('<?php http_response_code(404); exit; ?>'));
  assert.ok(before.includes('Updated player')); assert.ok(!before.includes(password));
  await assert.rejects(admin.request('/api/admin/generate', {}), /Close preferences/);
  state = await admin.request('/api/admin/event', { ...state.event, acceptingResponses: false, assignmentMethod: 'first-choice', requireFirstChoice: true, allowUnranked: true, maxSessionsPerPlayer: 1 });
  await assert.rejects(first.player.request('/api/responses', { ...first.payload, token: first.token }), /closed/);
  state = await admin.request('/api/admin/generate', {});
  assert.equal(state.schedule.validForPublication, true); assert.equal(state.schedule.unmetFirstChoices.length, 0);
  for (const session of state.schedule.sessions) for (const id of session.playerIds) {
    const r = state.responses.find((r) => r.id === id); assert.ok(!r.vetoes.includes(session.gameId));
  }
  assert.equal((await guest.request('/api/event')).schedule, null, 'draft is private');
  state = await admin.request('/api/admin/publish', {}); assert.equal(state.published, true);
  const publicEvent = await guest.request('/api/event'); assert.ok(publicEvent.schedule.sessions.length); assert.equal(publicEvent.schedule.sessions[0].playerIds, undefined);
  const personal = await first.player.request('/api/response', undefined, { headers: { Authorization: `Bearer ${first.token}` } }); assert.equal(personal.assignments.length, 1);
  assert.equal(personal.assignments[0].gameId, first.payload.preferences[0]);
  state = await admin.request('/api/admin/game', { ...state.games[0], maxPlayers: 2, runs: 1, slotIds: [state.slots[0].id] });
  state = await admin.request('/api/admin/generate', {}); assert.equal(state.schedule.validForPublication, false); assert.ok(state.schedule.unmetFirstChoices.length);
  await assert.rejects(admin.request('/api/admin/publish', {}), /first-choice guarantee/);
  const tampered = { ...state.schedule, validForPublication: true, unmetFirstChoices: [] };
  state = await admin.call('schedule-save', { expectedRevision: state.revision, schedule: tampered }); admin.state = state;
  assert.equal(state.schedule.validForPublication, false, 'server recomputes guarantees rather than trusting the browser');
  const vetoedPlayers = state.responses.filter((r) => r.vetoes.includes(state.games[2].id)).slice(0, 2).map((r) => r.id);
  await assert.rejects(admin.call('schedule-save', { expectedRevision: state.revision, schedule: { method: 'first-choice', sessions: [{ gameId: state.games[2].id, slotId: state.slots[0].id, table: 1, playerIds: vetoedPlayers }] } }), /veto/);
  await assert.rejects(admin.call('schedule-save', { expectedRevision: state.revision, schedule: { method: 'lottery', sessions: [] } }), /method changed/);
  admin.state = state;
  const originalFirstChoice = first.payload.preferences[0];
  state = await admin.request('/api/admin/delete', { type: 'game', id: originalFirstChoice });
  const affected = state.responses.find((r) => r.name === 'Updated player');
  assert.equal(affected.preferences[0], originalFirstChoice, 'deletion must not relabel an old second choice as rank 1');
  assert.equal(affected.needsReview, true);
  const stored = await readFile(resolve(app, 'event-data.php'), 'utf8');
  await writeFile(resolve(app, 'event-data.php'), 'corrupt data');
  raw = await fetch(`${running.url}api.php?action=event`); assert.equal(raw.status, 500); assert.equal(await readFile(resolve(app, 'event-data.php'), 'utf8'), 'corrupt data');
  await writeFile(resolve(app, 'event-data.php'), stored);
  await stop(running.child); running = await start(directory);
  const afterRestart = client(running.url); await afterRestart.request('/api/auth');
  const restored = await afterRestart.request('/api/response', undefined, { headers: { Authorization: `Bearer ${first.token}` } }); assert.equal(restored.response.name, 'Updated player');
  await afterRestart.request('/api/login', { password }); state = await afterRestart.request('/api/admin'); assert.equal(state.responses.length, 12);
  await afterRestart.request('/api/logout', {}); await assert.rejects(afterRestart.request('/api/admin'), /sign in/);
});
