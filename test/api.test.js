import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';
import { once } from 'node:events';

const password = 'test-only-organizer-password';
async function startServer(directory) {
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory, ORGANIZER_PASSWORD: password, PUBLIC_URL: '', TRUST_PROXY: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const url = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server did not start.')); }, 10000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${errors}`)); });
    child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolveUrl(match[0]); } });
  });
  return { child, url };
}
async function stopServer(child) { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; }
test('HTTP workflow: auth, validation, player updates, scheduling, publishing, and durable storage', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'tabletop-test-'));
  let running = await startServer(directory), cookie = '';
  t.after(async () => {
    await stopServer(running.child);
    const within = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(within && !within.startsWith(`..${sep}`) && !within.includes(':') && within.startsWith('tabletop-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, body, authenticated = false, extraHeaders = {}) {
    const response = await fetch(`${running.url}${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(authenticated ? { Cookie: cookie } : {}), ...extraHeaders } });
    return { response, data: await response.json() };
  }
  let result = await request('/api/admin'); assert.equal(result.response.status, 401);
  result = await request('/api/login', { password: 'wrong' }); assert.equal(result.response.status, 401);
  result = await request('/api/login', { password }); assert.equal(result.response.status, 200);
  cookie = result.response.headers.get('set-cookie').split(';')[0];
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly/);
  result = await request('/api/admin', undefined, true); assert.equal(result.data.games.length, 6);
  const initial = result.data;
  result = await request('/api/admin/event', initial.event, false); assert.equal(result.response.status, 401);
  result = await request('/api/admin/event', initial.event, true, { Origin: 'https://elsewhere.invalid' }); assert.equal(result.response.status, 403);
  result = await request('/api/admin/game', { ...initial.games[0], minPlayers: -1 }, true); assert.equal(result.response.status, 400);
  result = await request('/api/admin/slot', { label: 'Overlapping', date: initial.slots[0].date, start: '11:00', end: '14:00' }, true); assert.equal(result.response.status, 400);
  const payload = { name: '<script>Player</script>', preferences: initial.games.map((g) => g.id), availability: initial.slots.map((s) => s.id) };
  result = await request('/api/responses', { ...payload, preferences: [] }); assert.equal(result.response.status, 400);
  result = await request('/api/responses', payload); assert.equal(result.response.status, 200);
  const token = result.data.token; assert.match(token, /^[a-f0-9]{64}$/);
  result = await request('/api/responses', { ...payload, token, name: 'Updated player' }); assert.equal(result.response.status, 200);
  result = await request('/api/admin', undefined, true); assert.equal(result.data.responses.length, 1);
  assert.equal(result.data.responses[0].tokenHash, undefined);
  result = await request('/api/response', undefined, false, { Authorization: `Bearer ${token}` }); assert.equal(result.data.response.name, 'Updated player');
  result = await request('/api/response', undefined, false, { Authorization: 'Bearer invalid' }); assert.equal(result.response.status, 404);
  for (let i = 0; i < 11; i++) await request('/api/responses', { ...payload, name: `Player ${i}` });
  result = await request('/api/admin/generate', { method: 'balanced' }, true); assert.equal(result.response.status, 400, 'intake must close first');
  result = await request('/api/admin/event', { ...initial.event, acceptingResponses: false }, true); assert.equal(result.response.status, 200);
  result = await request('/api/responses', payload); assert.equal(result.response.status, 400);
  result = await request('/api/admin/generate', { method: 'balanced' }, true); assert.ok(result.data.schedule.sessions.length);
  result = await request('/api/event'); assert.equal(result.data.schedule, null, 'draft stays private'); assert.equal(result.data.responses, undefined);
  result = await request('/api/admin/publish', {}, true); assert.equal(result.data.published, true);
  result = await request('/api/event'); assert.ok(result.data.schedule.sessions.length); assert.equal(result.data.schedule.sessions[0].playerIds, undefined);
  result = await request('/api/response', undefined, false, { Authorization: `Bearer ${token}` }); assert.ok(Array.isArray(result.data.assignments));
  assert.equal(result.data.response.tokenHash, undefined);
  const disk = JSON.parse(await readFile(resolve(directory, 'event.json'), 'utf8')); assert.equal(disk.published, true); assert.equal(disk.responses.length, 12);
  await stopServer(running.child); running = await startServer(directory);
  result = await request('/api/event'); assert.equal(result.data.published, true, 'data survives a restart');
  result = await request('/api/response', undefined, false, { Authorization: `Bearer ${token}` }); assert.equal(result.data.response.name, 'Updated player', 'edit token survives a restart');
  result = await request('/api/admin', undefined, true); assert.equal(result.response.status, 401, 'organizers sign in again after restart');
  result = await request('/api/login', { password }); cookie = result.response.headers.get('set-cookie').split(';')[0];
  result = await request('/api/admin/game', { ...initial.games[0], summary: 'Changed game' }, true); assert.equal(result.data.schedule, null); assert.equal(result.data.published, false);
  result = await request('/api/admin/new', { confirm: 'wrong' }, true); assert.equal(result.response.status, 400);
  result = await request('/api/admin/new', { confirm: 'NEW EVENT' }, true); assert.equal(result.data.games.length, 0); assert.equal(result.data.responses.length, 0); assert.notEqual(result.data.event.id, initial.event.id);
  result = await request('/api/response', undefined, false, { Authorization: `Bearer ${token}` }); assert.equal(result.response.status, 404);
});
