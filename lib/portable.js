import { blankState, sampleState, validateEvent, validateGame, validateSlot, validateResponse, randomUUID, integer, text, gmKey, InputError } from './model.js';
import { generateSchedule, METHODS } from './scheduler.js';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const invalid = (message) => { throw new InputError(message); };
const clone = (value) => structuredClone(value);
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) invalid('Invalid identifier in event file.');
  return value;
}
function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) invalid(`Invalid ${label} list (maximum ${max}).`);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) invalid('Invalid saved date.');
  return value;
}
function uniqueIds(items) {
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid('Duplicate identifiers in event file.');
}
export function parseJsonFile(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_FILE_BYTES) invalid('File is too large (maximum 8 MB).');
  try { return JSON.parse(source.replace(/^\uFEFF/, '')); } catch { invalid('This is not a valid JSON file.'); }
}
function eventData(input) {
  if (!input || input.version !== 1) invalid('Unsupported event file version.');
  const state = { version: 1, revision: integer(input.revision ?? 0, 'File revision', 0, Number.MAX_SAFE_INTEGER),
    event: { ...validateEvent(input.event), id: identifier(input.event.id), sample: input.event.sample === true }, games: [], slots: [], responses: [], ignoredResponseIds: [], schedule: null, published: false };
  for (const slot of list(input.slots, 30, 'time slot')) state.slots.push({ ...validateSlot(slot, state.slots), id: identifier(slot.id) });
  uniqueIds(state.slots);
  state.slots.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  for (const game of list(input.games, 100, 'game')) {
    const unavailable = game.slotIds?.length === 1 && game.slotIds[0] === 'unavailable';
    state.games.push({ ...validateGame(unavailable ? { ...game, slotIds: [] } : game, state.slots), id: identifier(game.id), ...(unavailable ? { slotIds: ['unavailable'] } : {}) });
  }
  uniqueIds(state.games);
  return state;
}
function responseRecord(input, state, strict = true) {
  // Existing organizer files can contain choices removed since collection.
  const valid = strict ? validateResponse(input, state) : {
    name: text(input.name, 'Player name', 80), gm: text(input.gm || '', 'GM', 80, true),
    preferences: list(input.preferences, 100, 'preference').map(identifier).filter((id) => state.games.some((g) => g.id === id)),
    availability: list(input.availability, 30, 'availability').map(identifier).filter((id) => state.slots.some((s) => s.id === id)),
  };
  return { ...valid, id: identifier(input.id), revision: integer(input.revision ?? 1, 'Response revision', 1, Number.MAX_SAFE_INTEGER), updatedAt: timestamp(input.updatedAt) };
}
function restoreSchedule(input, state, publicOnly = false) {
  if (!input || !METHODS.includes(input.method)) invalid('Invalid schedule method.');
  const sessions = [], usedTables = new Set(), busyGms = new Set(), busyPlayers = new Set(), played = new Set(), runs = new Map();
  for (const item of list(input.sessions, 480, 'scheduled session')) {
    const game = state.games.find((g) => g.id === item.gameId), slot = state.slots.find((s) => s.id === item.slotId);
    if (!game || !slot) invalid('Schedule refers to a missing game or time slot.');
    const table = integer(item.table, 'Table number', 1, state.event.parallelTables);
    const ids = list(item.playerIds, game.maxPlayers, 'seated player').map(identifier);
    if (ids.length < game.minPlayers || new Set(ids).size !== ids.length) invalid('Invalid scheduled group size.');
    if (game.slotIds.length && !game.slotIds.includes(slot.id)) invalid('Schedule conflicts with GM availability.');
    const tableKey = `${slot.id}:${table}`, gm = gmKey(game.gm), gmSlot = `${slot.id}:${gm}`;
    if (usedTables.has(tableKey) || busyGms.has(gmSlot)) invalid('Schedule contains a table or GM conflict.');
    usedTables.add(tableKey); busyGms.add(gmSlot);
    runs.set(game.id, (runs.get(game.id) || 0) + 1);
    if (runs.get(game.id) > game.runs) invalid('Schedule exceeds a game’s repeat limit.');
    for (const id of ids) {
      const slotKey = `${slot.id}:${id}`, gameKey = `${game.id}:${id}`;
      if (busyPlayers.has(slotKey) || played.has(gameKey) || state.event.mode === 'free-choice' && sessions.some((s) => s.playerIds.includes(id))) invalid('Schedule contains a player conflict.');
      busyPlayers.add(slotKey); played.add(gameKey);
      if (!publicOnly) {
        const player = state.responses.find((r) => r.id === id);
        if (!player || !player.preferences.includes(game.id) || !player.availability.includes(slot.id)) invalid('Schedule conflicts with player preferences or availability.');
      }
    }
    sessions.push({ id: identifier(item.id), gameId: game.id, slotId: slot.id, table, playerIds: ids });
  }
  uniqueIds(sessions);
  if (!publicOnly) for (const session of sessions) for (const id of session.playerIds) {
    const gm = state.responses.find((r) => r.id === id).gm;
    if (gm && busyGms.has(`${session.slotId}:${gmKey(gm)}`)) invalid('A GM cannot play while running a session.');
  }
  const unseated = state.responses.filter((r) => !sessions.some((s) => s.playerIds.includes(r.id))).map((r) => r.id);
  const scheduledGms = new Set(sessions.map((s) => gmKey(state.games.find((g) => g.id === s.gameId).gm)));
  const missingGms = [...new Map(state.games.map((g) => [gmKey(g.gm), g.gm])).entries()].filter(([key]) => !scheduledGms.has(key)).map(([, name]) => name);
  const warnings = [];
  if (unseated.length) warnings.push(`${unseated.length} players have no session. Review their choices and availability.`);
  if (state.event.ensureEveryGm && missingGms.length) warnings.push(`No session for: ${missingGms.join(', ')}.`);
  return { method: input.method, seed: Number.isSafeInteger(input.seed) ? input.seed : 0, generatedAt: timestamp(input.generatedAt), sessions, warnings, unseated, missingGms };
}
export function restoreEvent(input) {
  const state = eventData(input);
  state.ignoredResponseIds = [...new Set(list(input.ignoredResponseIds || [], 10000, 'ignored response').map(identifier))];
  state.responses = list(input.responses, 2000, 'player response').map((r) => responseRecord(r, state, false));
  uniqueIds(state.responses);
  if (input.schedule) state.schedule = restoreSchedule(input.schedule, state);
  state.published = !!state.schedule && input.published === true;
  if (state.schedule && state.event.acceptingResponses) invalid('A scheduled event must have preferences closed.');
  return state;
}
export function publicSnapshot(state) {
  return {
    version: 1, revision: state.revision || 0, event: clone(state.event), games: clone(state.games), slots: clone(state.slots),
    published: state.published, schedule: state.published ? {
      method: state.schedule.method, generatedAt: state.schedule.generatedAt,
      sessions: state.schedule.sessions.map(({ id, slotId, table, gameId, playerIds }) => ({ id, slotId, table, gameId, playerIds: [...playerIds] })),
    } : null,
  };
}
export function restoreQuestionnaire(input) {
  const state = eventData(input);
  if (input.published && input.schedule) { state.schedule = restoreSchedule(input.schedule, state, true); state.published = true; }
  return state;
}
export function responseEnvelope(response, eventId) {
  return { kind: 'tabletop-response', version: 1, eventId, response: clone(response) };
}
export function importResponses(state, envelopes) {
  const draft = clone(state), summary = { added: 0, updated: 0, unchanged: 0 };
  for (const envelope of list(envelopes, 2000, 'response file')) {
    if (!envelope || envelope.kind !== 'tabletop-response' || envelope.version !== 1 || envelope.eventId !== state.event.id) invalid('A response belongs to a different event. No files were imported.');
    if (draft.ignoredResponseIds?.includes(identifier(envelope.response?.id))) { summary.unchanged++; continue; }
    const id = identifier(envelope.response?.id), revision = integer(envelope.response.revision ?? 1, 'Response revision', 1, Number.MAX_SAFE_INTEGER);
    const index = draft.responses.findIndex((r) => r.id === id), old = draft.responses[index];
    if (old && old.revision > revision) { summary.unchanged++; continue; }
    if (old && old.revision === revision) {
      const normalized = responseRecord(envelope.response, state, false);
      if (JSON.stringify(responseRecord(old, state, false)) !== JSON.stringify(normalized)) invalid(`Conflicting versions for ${normalized.name}. Ask the player to open and update their original response file.`);
      summary.unchanged++; continue;
    }
    const response = responseRecord(envelope.response, state);
    if (index >= 0) { draft.responses[index] = response; summary.updated++; }
    else { if (draft.responses.length >= 2000) invalid('Maximum 2,000 responses per event.'); draft.responses.push(response); summary.added++; }
  }
  if (summary.added || summary.updated) { draft.schedule = null; draft.published = false; }
  return { state: draft, summary };
}
export async function readJsonHandle(handle) {
  const file = await handle.getFile();
  if (file.size > MAX_FILE_BYTES) invalid('File is too large (maximum 8 MB).');
  return parseJsonFile(await file.text());
}
export async function writeHandle(handle, content) {
  const stream = await handle.createWritable();
  try { await stream.write(content); await stream.close(); }
  catch (error) { try { await stream.abort(); } catch {} throw error; }
}
export class PortablePlanner {
  constructor(initial = sampleState(), playerMode = false) {
    this.playerMode = playerMode;
    this.state = playerMode ? restoreQuestionnaire(initial) : restoreEvent(initial);
    this.folder = null; this.diskText = null; this.response = null; this.dirty = false;
    this.queue = Promise.resolve();
  }
  snapshot() { return clone(this.state); }
  async commit(next) {
    const draft = clone(next); draft.revision = Math.max(this.state.revision || 0, next.revision || 0) + 1;
    if (!Number.isSafeInteger(draft.revision)) invalid('Event revision limit reached. Export a new event before continuing.');
    if (this.folder) await this.writeEvent(draft);
    this.state = draft; this.dirty = !this.folder;
    return this.snapshot();
  }
  async writeEvent(draft) {
    const handle = await this.folder.getFileHandle('event.json', { create: true });
    const current = await (await handle.getFile()).text();
    if (this.diskText !== null && current !== this.diskText) invalid('event.json changed in another window or synced device. Reload the folder before saving; this change was not written.');
    const content = JSON.stringify(draft, null, 2);
    await writeHandle(handle, content); this.diskText = content;
  }
  async openFolder(folder) {
    if (this.playerMode) invalid('The player questionnaire does not open organizer data.');
    await this.queue;
    let state, contents;
    try {
      const handle = await folder.getFileHandle('event.json');
      const file = await handle.getFile();
      if (file.size > MAX_FILE_BYTES) invalid('event.json is too large.');
      contents = await file.text(); state = restoreEvent(parseJsonFile(contents));
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      state = this.snapshot(); contents = '';
    }
    const previous = { folder: this.folder, diskText: this.diskText };
    this.folder = folder; this.diskText = contents;
    try { await this.writeEvent(state); }
    catch (error) { this.folder = previous.folder; this.diskText = previous.diskText; throw error; }
    this.state = state; this.dirty = false;
    return this.snapshot();
  }
  async reloadFolder() {
    await this.queue;
    if (!this.folder) return this.snapshot();
    const handle = await this.folder.getFileHandle('event.json');
    const contents = await (await handle.getFile()).text();
    const state = restoreEvent(parseJsonFile(contents));
    this.state = state; this.diskText = contents; this.dirty = false;
    return this.snapshot();
  }
  saveFolder() {
    const operation = this.queue.then(async () => {
      if (!this.folder) invalid('Open the event folder before saving to it.');
      await this.writeEvent(this.state); this.dirty = false;
      return this.snapshot();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async readResponseFolder() {
    if (!this.folder) invalid('Open the event folder first, or import response files.');
    let folder;
    try { folder = await this.folder.getDirectoryHandle('responses'); }
    catch (error) { if (error.name === 'NotFoundError') return { files: [], rejected: [] }; throw error; }
    const files = [], rejected = [];
    for await (const [name, handle] of folder.entries()) {
      if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
      try { files.push(await readJsonHandle(handle)); }
      catch (error) { rejected.push(`${name}: ${error.message}`); }
      if (files.length + rejected.length >= 2000) break;
    }
    return { files, rejected };
  }
  async request(path, input) {
    if (path === '/event') {
      const snapshot = publicSnapshot(this.state);
      if (snapshot.schedule) snapshot.schedule.sessions = snapshot.schedule.sessions.map((s) => ({ ...s, playerCount: s.playerIds.length }));
      return snapshot;
    }
    if (path === '/response') {
      if (!this.response) { const error = new InputError('Open your response file to load your choices.'); error.status = 404; throw error; }
      return { response: clone(this.response), assignments: this.state.published ? this.state.schedule.sessions.filter((s) => s.playerIds.includes(this.response.id)).map(({ playerIds, ...s }) => s) : [] };
    }
    if (path === '/responses') {
      if (!this.playerMode) invalid('Open a player questionnaire to fill out preferences.');
      if (!this.state.event.acceptingResponses) invalid('This questionnaire is closed. Get the latest file from the organizers.');
      this.response = { ...validateResponse(input, this.state), id: this.response?.id || randomUUID(), revision: (this.response?.revision || 0) + 1, updatedAt: new Date().toISOString() };
      return { response: clone(this.response) };
    }
    if (this.playerMode) invalid('Organizer data is not included in a player questionnaire.');
    if (path === '/organizer') return this.snapshot();
    const operation = this.queue.then(async () => {
      const draft = this.snapshot();
      const invalidate = () => { draft.schedule = null; draft.published = false; };
      if (path === '/organizer/event') { draft.event = { ...draft.event, ...validateEvent(input), sample: false }; invalidate(); }
      else if (path === '/organizer/game' || path === '/organizer/slot') {
        const game = path.endsWith('game'), collection = game ? draft.games : draft.slots;
        const value = game ? validateGame(input, draft.slots) : validateSlot(input, draft.slots);
        const index = collection.findIndex((item) => item.id === input.id);
        if (input.id && index < 0) invalid('This item no longer exists. Reload the event file.');
        if (index < 0 && collection.length >= (game ? 100 : 30)) invalid('The event has reached its offering or slot limit.');
        if (index < 0) collection.push({ ...value, id: randomUUID() }); else collection[index] = { ...value, id: input.id };
        draft.slots.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)); invalidate();
      } else if (path === '/organizer/delete') {
        const collection = { game: 'games', slot: 'slots', response: 'responses' }[input.type];
        if (!collection) invalid('Invalid item type.');
        draft[collection] = draft[collection].filter((item) => item.id !== input.id);
        if (input.type === 'response' && !draft.ignoredResponseIds.includes(input.id)) {
          if (draft.ignoredResponseIds.length >= 10000) invalid('Clear excluded response IDs before removing more responses.');
          draft.ignoredResponseIds.push(identifier(input.id));
        }
        for (const response of draft.responses) {
          if (input.type === 'game') response.preferences = response.preferences.filter((id) => id !== input.id);
          if (input.type === 'slot') response.availability = response.availability.filter((id) => id !== input.id);
        }
        if (input.type === 'slot') for (const game of draft.games) {
          if (!game.slotIds.length) continue;
          game.slotIds = game.slotIds.filter((id) => id !== input.id);
          if (!game.slotIds.length) game.slotIds = ['unavailable'];
        }
        invalidate();
      } else if (path === '/organizer/generate') {
        if (!METHODS.includes(input.method)) invalid('Choose a valid scheduling method.');
        if (draft.event.acceptingResponses) invalid('Close preferences in Event settings before generating a schedule.');
        if (!draft.games.length || !draft.slots.length || !draft.responses.length) invalid('Add games, time slots, and player responses first.');
        draft.schedule = generateSchedule(draft, input.method); draft.published = false;
      } else if (path === '/organizer/publish') {
        if (!draft.schedule?.sessions.length) invalid('Generate a schedule with at least one session first.');
        draft.published = !draft.published; draft.event.acceptingResponses = false;
      } else if (path === '/organizer/new') {
        if (input.confirm !== 'NEW EVENT') invalid('Type NEW EVENT to replace this event.');
        Object.assign(draft, blankState());
      } else if (path === '/organizer/import-event') {
        // An explicitly opened file replaces the current folder file only after UI confirmation.
        Object.assign(draft, restoreEvent(input));
      } else if (path === '/organizer/import-responses') {
        const imported = importResponses(draft, input);
        if (!imported.summary.added && !imported.summary.updated) return { state: this.snapshot(), summary: imported.summary };
        const state = await this.commit(imported.state); return { state, summary: imported.summary };
      } else if (path === '/organizer/restore-response-imports') {
        draft.ignoredResponseIds = [];
      } else if (path === '/organizer/sample-responses') {
        if (!draft.event.sample || draft.responses.length) invalid('Sample responses are only available for an empty sample event.');
        if (!draft.games.length || !draft.slots.length) invalid('Add games and slots before trying sample responses.');
        const names = ['Taylor', 'Casey', 'Drew', 'Jordan', 'Avery', 'Morgan', 'Riley', 'Quinn', 'Parker', 'Skyler', 'Rowan', 'Sage', 'Blair', 'Finley', 'Hayden', 'Reese', 'Elliot', 'Charlie'];
        draft.responses = names.map((name, i) => ({ id: randomUUID(), name: `${name} (sample)`, gm: '', revision: 1, preferences: [...draft.games.slice(i % draft.games.length), ...draft.games.slice(0, i % draft.games.length)].slice(0, 4).map((g) => g.id), availability: draft.slots.map((s) => s.id), updatedAt: new Date().toISOString() })); invalidate();
      } else invalid('Unknown planner action.');
      return this.commit(draft);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  openPlayerResponse(envelope) {
    if (envelope.kind !== 'tabletop-response' || envelope.version !== 1 || envelope.eventId !== this.state.event.id) invalid('This response is for a different event.');
    this.response = responseRecord(envelope.response, this.state, false);
    return clone(this.response);
  }
}
