import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { blankState, sampleState, validateEvent, validateGame, validateSlot, validateResponse, InputError, gmKey } from './lib/model.js';
import { generateSchedule, METHODS } from './lib/scheduler.js';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
await mkdir(dataDir, { recursive: true });
let password = process.env.ORGANIZER_PASSWORD;
if (!password) {
  const keyPath = resolve(dataDir, 'organizer-key.txt');
  try { password = (await readFile(keyPath, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    password = randomBytes(24).toString('base64url');
    await writeFile(keyPath, `${password}\n`, { mode: 0o600 });
  }
  console.log(`Organizer password is in ${keyPath}`);
}
if (password.length < 12) throw new Error('ORGANIZER_PASSWORD must contain at least 12 characters.');
const salt = randomBytes(16), passwordHash = scryptSync(password, salt, 32);
password = undefined;
const statePath = resolve(dataDir, 'event.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = sampleState(); await persist(state); }
if (state.version !== 1) throw new Error('Unsupported data version. Restore a compatible backup before starting.');
async function persist(value) {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, statePath);
}
const sessions = new Map(), limits = new Map();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const invalidate = (draft) => { draft.schedule = null; draft.published = false; };
let writeQueue = Promise.resolve();
function transaction(action) {
  const operation = writeQueue.then(async () => {
    const draft = structuredClone(state);
    const result = action(draft);
    await persist(draft); state = draft; return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
function send(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
function rateLimit(req, key, count, interval) {
  const now = Date.now(), id = `${key}:${req.socket.remoteAddress}`;
  let entry = limits.get(id);
  if (!entry || entry.until <= now) { entry = { count: 0, until: now + interval }; limits.set(id, entry); }
  if (++entry.count > count) { const error = new Error('Too many attempts. Please try again later.'); error.status = 429; throw error; }
}
setInterval(() => {
  for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key);
  for (const [key, value] of sessions) if (value < Date.now()) sessions.delete(key);
}, 60000).unref();
function sessionId(req) { return /(?:^|;\s*)organizer=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; }
function isOrganizer(req) { return (sessions.get(sessionId(req)) || 0) > Date.now(); }
function requireOrganizer(req) { if (!isOrganizer(req)) { const error = new Error('Please sign in as an organizer.'); error.status = 401; throw error; } }
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new InputError('Send JSON with Content-Type: application/json.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) { const error = new Error('Request is too large.'); error.status = 413; throw error; } chunks.push(chunk); }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new InputError('Invalid JSON object.'); }
}
function publicState() {
  return { event: state.event, games: state.games, slots: state.slots, published: state.published,
    schedule: state.published ? { sessions: state.schedule.sessions.map(({ playerIds, ...s }) => ({ ...s, playerCount: playerIds.length })) } : null };
}
function privateState() {
  return { ...state, responses: state.responses.map(({ tokenHash, ...r }) => r) };
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const expected = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : `${process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expected) { send(res, 403, { error: 'Request origin does not match PUBLIC_URL.' }); return; }
    }
    if (path === '/api/event' && req.method === 'GET') { send(res, 200, publicState()); return; }
    if (path === '/api/auth' && req.method === 'GET') { send(res, 200, { authenticated: isOrganizer(req) }); return; }
    if (path === '/api/login' && req.method === 'POST') {
      rateLimit(req, 'login', 10, 15 * 60000);
      const input = await body(req);
      if (typeof input.password !== 'string' || input.password.length > 1000 || !timingSafeEqual(scryptSync(input.password, salt, 32), passwordHash)) { send(res, 401, { error: 'That organizer password did not match.' }); return; }
      const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 12 * 3600000);
      const secure = process.env.PUBLIC_URL?.startsWith('https://') || process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https';
      send(res, 200, { ok: true }, { 'Set-Cookie': `organizer=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}` }); return;
    }
    if (path === '/api/logout' && req.method === 'POST') {
      sessions.delete(sessionId(req)); send(res, 200, { ok: true }, { 'Set-Cookie': 'organizer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return;
    }
    if (path === '/api/response' && req.method === 'GET') {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const response = token && state.responses.find((r) => r.tokenHash === hash(token));
      if (!response) { send(res, 404, { error: 'No saved response on this browser.' }); return; }
      const { tokenHash, ...safe } = response;
      send(res, 200, { response: safe, assignments: state.published ? state.schedule.sessions.filter((s) => s.playerIds.includes(response.id)).map(({ playerIds, ...s }) => s) : [] }); return;
    }
    if (path === '/api/responses' && req.method === 'POST') {
      rateLimit(req, 'response', 30, 60000);
      const input = await body(req);
      const result = await transaction((draft) => {
        if (!draft.event.acceptingResponses) throw new InputError('Preferences are closed. Contact the organizers to make a change.');
        const valid = validateResponse(input, draft);
        const existing = typeof input.token === 'string' && draft.responses.find((r) => r.tokenHash === hash(input.token));
        if (input.token && !existing) throw new InputError('This saved response no longer exists. Clear the saved response on this device and submit again.');
        if (!existing && draft.responses.length >= 2000) throw new InputError('The event has reached its response limit.');
        const token = existing ? input.token : randomBytes(32).toString('hex');
        const response = { ...valid, id: existing?.id || randomUUID(), tokenHash: hash(token), updatedAt: new Date().toISOString() };
        if (existing) draft.responses[draft.responses.indexOf(existing)] = response; else draft.responses.push(response);
        invalidate(draft);
        return { ok: true, token };
      });
      send(res, 200, result); return;
    }
    if (path.startsWith('/api/admin')) {
      requireOrganizer(req);
      if (path === '/api/admin' && req.method === 'GET') { send(res, 200, privateState()); return; }
      if (path === '/api/admin/backup' && req.method === 'GET') { send(res, 200, { ...privateState(), note: 'Review export. Response edit credentials are intentionally excluded; back up the data directory for a full restore.' }, { 'Content-Disposition': 'attachment; filename="tabletop-event.json"' }); return; }
      if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed.' }); return; }
      const input = await body(req);
      await transaction((draft) => {
        if (path === '/api/admin/event') {
          draft.event = { ...draft.event, ...validateEvent(input), sample: false }; invalidate(draft);
        } else if (path === '/api/admin/game') {
          const game = validateGame(input, draft.slots);
          const index = draft.games.findIndex((g) => g.id === input.id);
          if (input.id && index < 0) throw new InputError('Game no longer exists. Refresh the page.');
          if (index < 0 && draft.games.length >= 100) throw new InputError('Maximum 100 game offerings per event.');
          if (index >= 0) draft.games[index] = { ...game, id: input.id }; else draft.games.push({ ...game, id: randomUUID() });
          invalidate(draft);
        } else if (path === '/api/admin/slot') {
          const slot = validateSlot(input, draft.slots);
          const index = draft.slots.findIndex((s) => s.id === input.id);
          if (input.id && index < 0) throw new InputError('Time slot no longer exists.');
          if (index < 0 && draft.slots.length >= 30) throw new InputError('Maximum 30 time slots per event.');
          if (index >= 0) draft.slots[index] = { ...slot, id: input.id }; else draft.slots.push({ ...slot, id: randomUUID() });
          draft.slots.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)); invalidate(draft);
        } else if (path === '/api/admin/delete') {
          if (!['game', 'slot', 'response'].includes(input.type)) throw new InputError('Invalid item type.');
          const collection = { game: 'games', slot: 'slots', response: 'responses' }[input.type];
          draft[collection] = draft[collection].filter((item) => item.id !== input.id);
          for (const response of draft.responses) {
            if (input.type === 'game') response.preferences = response.preferences.filter((id) => id !== input.id);
            if (input.type === 'slot') response.availability = response.availability.filter((id) => id !== input.id);
          }
          if (input.type === 'slot') for (const game of draft.games) {
            const wasRestricted = game.slotIds.length > 0;
            game.slotIds = game.slotIds.filter((id) => id !== input.id);
            // An explicitly restricted game must not silently become available everywhere.
            if (wasRestricted && !game.slotIds.length) game.slotIds = ['unavailable'];
          }
          invalidate(draft);
        } else if (path === '/api/admin/generate') {
          if (!METHODS.includes(input.method)) throw new InputError('Choose a valid scheduling method.');
          if (!draft.games.length || !draft.slots.length || !draft.responses.length) throw new InputError('Add games, time slots, and player responses before generating a schedule.');
          if (draft.event.acceptingResponses) throw new InputError('Close preferences in Event settings before generating the schedule.');
          draft.schedule = generateSchedule(draft, input.method); draft.published = false;
        } else if (path === '/api/admin/publish') {
          if (!draft.schedule?.sessions.length) throw new InputError('Generate a schedule with at least one session first.');
          draft.published = !draft.published; draft.event.acceptingResponses = false;
        } else if (path === '/api/admin/new') {
          if (input.confirm !== 'NEW EVENT') throw new InputError('Type NEW EVENT to replace the event.');
          Object.assign(draft, blankState());
        } else if (path === '/api/admin/sample-responses') {
          if (draft.responses.length) throw new InputError('Sample responses can only be added when there are no responses.');
          if (!draft.event.sample) throw new InputError('Sample responses are available only for the initial sample event.');
          if (!draft.games.length || !draft.slots.length) throw new InputError('Add games and time slots first.');
          const names = ['Taylor', 'Casey', 'Drew', 'Jordan', 'Avery', 'Morgan', 'Riley', 'Quinn', 'Parker', 'Skyler', 'Rowan', 'Sage', 'Blair', 'Finley', 'Hayden', 'Reese', 'Elliot', 'Charlie'];
          draft.responses = names.map((name, i) => ({ id: randomUUID(), name: `${name} (sample)`, preferences: [...draft.games.slice(i % draft.games.length), ...draft.games.slice(0, i % draft.games.length)].slice(0, 4).map((g) => g.id), availability: draft.slots.map((s) => s.id), tokenHash: hash(randomBytes(32)), updatedAt: new Date().toISOString() }));
          invalidate(draft);
        } else throw new InputError('Unknown action.');
      });
      send(res, 200, privateState()); return;
    }
    if (path.startsWith('/api/')) { send(res, 404, { error: 'Not found.' }); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { send(res, 405, { error: 'Method not allowed.' }); return; }
    const files = { '/': 'index.html', '/organizer': 'index.html', '/play': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
    if (!files[path]) { send(res, 404, { error: 'Page not found.' }); return; }
    const content = await readFile(resolve(root, 'public', files[path]));
    res.writeHead(200, { 'Content-Type': mime[extname(files[path])], 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error instanceof InputError ? 400 : error.status || 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'The server could not save this change. Please try again.' : error.message });
    else res.end();
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`Tabletop planner: http://${host}:${server.address().port}\nOrganizer: /organizer · Players: /play`));
