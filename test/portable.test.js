import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleState } from '../lib/model.js';
import { PortablePlanner, publicSnapshot, responseEnvelope, importResponses, restoreEvent, restoreQuestionnaire, parseJsonFile } from '../lib/portable.js';

class MemoryFolder {
  constructor(name = 'Our gathering') { this.name = name; this.files = new Map(); this.directories = new Map(); }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw new DOMException('File not found', 'NotFoundError');
      this.files.set(name, '');
    }
    return { kind: 'file', getFile: async () => ({ size: new TextEncoder().encode(this.files.get(name)).length, text: async () => this.files.get(name) }), createWritable: async () => {
      let contents;
      return { write: async (text) => { contents = text; }, close: async () => { this.files.set(name, contents); }, abort: async () => {} };
    } };
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) throw new DOMException('Directory not found', 'NotFoundError');
      this.directories.set(name, new MemoryFolder(name));
    }
    return this.directories.get(name);
  }
  async *entries() { for (const name of this.files.keys()) yield [name, await this.getFileHandle(name)]; }
}
async function reply(state, name = 'A player') {
  const player = new PortablePlanner(publicSnapshot(state), true);
  return (await player.request('/responses', { name, gm: '', preferences: state.games.map((g) => g.id), availability: state.slots.map((s) => s.id) })).response;
}
test('organizer changes run entirely in memory without a server', async () => {
  const planner = new PortablePlanner();
  const event = { ...planner.state.event, name: 'Our actual event' };
  const updated = await planner.request('/organizer/event', event);
  assert.equal(updated.event.name, event.name); assert.equal(planner.dirty, true);
  assert.equal(updated.event.sample, false); assert.equal(updated.revision, 1);
  assert.deepEqual(restoreEvent(JSON.parse(JSON.stringify(updated))), updated);
});
test('opening a folder creates event.json and later edits persist beside the app', async () => {
  const planner = new PortablePlanner(), folder = new MemoryFolder();
  await planner.openFolder(folder);
  assert.equal(JSON.parse(folder.files.get('event.json')).event.id, planner.state.event.id);
  await planner.request('/organizer/event', { ...planner.state.event, name: 'Synced gathering' });
  assert.equal(JSON.parse(folder.files.get('event.json')).event.name, 'Synced gathering');
  assert.equal(planner.dirty, false);
  const anotherDevice = new PortablePlanner(); await anotherDevice.openFolder(folder);
  assert.equal(anotherDevice.state.event.name, 'Synced gathering');
});
test('opening corrupt data does not overwrite it or connect to the folder', async () => {
  const planner = new PortablePlanner(), folder = new MemoryFolder();
  folder.files.set('event.json', 'not valid json');
  await assert.rejects(planner.openFolder(folder), /JSON/);
  assert.equal(folder.files.get('event.json'), 'not valid json'); assert.equal(planner.folder, null);
});
test('visible cloud/concurrent changes are not overwritten and reloading recovers', async () => {
  const folder = new MemoryFolder(), first = new PortablePlanner(), second = new PortablePlanner();
  await first.openFolder(folder); await second.openFolder(folder);
  await first.request('/organizer/event', { ...first.state.event, name: 'Changed by first organizer' });
  await assert.rejects(second.request('/organizer/event', { ...second.state.event, name: 'Stale edit' }), /changed in another/);
  assert.equal(JSON.parse(folder.files.get('event.json')).event.name, 'Changed by first organizer');
  assert.notEqual(second.state.event.name, 'Stale edit');
  await second.reloadFolder();
  await second.request('/organizer/event', { ...second.state.event, location: 'New venue' });
  assert.equal(second.state.event.name, 'Changed by first organizer');
});
test('manual folder saves wait for pending edits instead of writing an old snapshot', async () => {
  const planner = new PortablePlanner(), folder = new MemoryFolder(); await planner.openFolder(folder);
  const edit = planner.request('/organizer/event', { ...planner.state.event, name: 'The updated event' });
  const save = planner.saveFolder(); await Promise.all([edit, save]);
  assert.equal(JSON.parse(folder.files.get('event.json')).event.name, 'The updated event');
});
test('response round-trip preserves identity and imports update instead of duplicating', async () => {
  const planner = new PortablePlanner(), state = planner.snapshot();
  const response = await reply(state);
  const envelope = responseEnvelope(response, state.event.id);
  let result = await planner.request('/organizer/import-responses', [envelope]);
  assert.equal(result.summary.added, 1);
  result = await planner.request('/organizer/import-responses', [envelope]); assert.equal(result.summary.unchanged, 1);
  const player = new PortablePlanner(publicSnapshot(state), true); player.openPlayerResponse(envelope);
  const updated = (await player.request('/responses', { ...response, name: 'Updated player' })).response;
  assert.equal(updated.id, response.id); assert.equal(updated.revision, 2);
  result = await planner.request('/organizer/import-responses', [responseEnvelope(updated, state.event.id)]);
  assert.equal(result.summary.updated, 1); assert.equal(result.state.responses.length, 1);
  assert.equal(result.state.responses[0].name, 'Updated player');
  result = await planner.request('/organizer/import-responses', [envelope]); assert.equal(result.summary.unchanged, 1);
  assert.equal(result.state.responses[0].name, 'Updated player');
});
test('wrong-event, invalid, and equal-version conflicting responses are rejected atomically', async () => {
  const state = new PortablePlanner().snapshot(), response = await reply(state);
  const valid = responseEnvelope(response, state.event.id);
  assert.throws(() => importResponses(state, [valid, { ...valid, eventId: 'other-event' }]), /different event/);
  assert.equal(state.responses.length, 0);
  const imported = importResponses(state, [valid]).state;
  assert.throws(() => importResponses(imported, [{ ...valid, response: { ...response, name: 'Conflicting name' } }]), /Conflicting/);
  assert.throws(() => importResponses(state, [{ ...valid, response: { ...response, preferences: ['missing'] } }]), /Rank at least/);
  assert.equal(imported.responses[0].name, response.name);
});
test('public questionnaire exports omit private responses and protect organizer actions', async () => {
  const planner = new PortablePlanner(), response = await reply(planner.state, 'Private player name');
  await planner.request('/organizer/import-responses', [responseEnvelope(response, planner.state.event.id)]);
  const snapshot = publicSnapshot(planner.state), serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes('Private player name')); assert.ok(!serialized.includes('responses'));
  const player = new PortablePlanner(snapshot, true);
  await assert.rejects(player.request('/organizer'), /not included/);
  await assert.rejects(player.request('/organizer/new', { confirm: 'NEW EVENT' }), /not included/);
  assert.equal(restoreQuestionnaire(snapshot).games.length, 6);
});
test('removed responses stay excluded on folder reimport until explicitly restored', async () => {
  const planner = new PortablePlanner();
  const envelope = responseEnvelope(await reply(planner.state), planner.state.event.id);
  await planner.request('/organizer/import-responses', [envelope]);
  await planner.request('/organizer/delete', { type: 'response', id: envelope.response.id });
  let result = await planner.request('/organizer/import-responses', [envelope]);
  assert.equal(result.state.responses.length, 0); assert.equal(result.summary.unchanged, 1);
  const reloaded = new PortablePlanner(restoreEvent(planner.state));
  await reloaded.request('/organizer/restore-response-imports', {});
  result = await reloaded.request('/organizer/import-responses', [envelope]);
  assert.equal(result.state.responses.length, 1);
});
test('unchanged response files remain importable after an organizer removes an offering', async () => {
  const planner = new PortablePlanner();
  const envelope = responseEnvelope(await reply(planner.state), planner.state.event.id);
  await planner.request('/organizer/import-responses', [envelope]);
  await planner.request('/organizer/delete', { type: 'game', id: planner.state.games[0].id });
  const result = await planner.request('/organizer/import-responses', [envelope]);
  assert.equal(result.summary.unchanged, 1); assert.equal(result.state.responses[0].preferences.length, 5);
});
test('complete file workflow: collect, schedule, export, reload personal assignment', async () => {
  const planner = new PortablePlanner(), initial = planner.snapshot(), envelopes = [];
  for (let i = 0; i < 12; i++) envelopes.push(responseEnvelope(await reply(initial, `Private player ${i}`), initial.event.id));
  await planner.request('/organizer/import-responses', envelopes);
  await assert.rejects(planner.request('/organizer/generate', { method: 'balanced' }), /Close preferences/);
  await planner.request('/organizer/event', { ...initial.event, acceptingResponses: false });
  const draft = await planner.request('/organizer/generate', { method: 'balanced' });
  assert.ok(draft.schedule.sessions.length);
  assert.equal(publicSnapshot(draft).schedule, null);
  const released = await planner.request('/organizer/publish', {});
  assert.deepEqual(restoreEvent(JSON.parse(JSON.stringify(released))), { ...released, schedule: { ...released.schedule, warnings: restoreEvent(released).schedule.warnings } });
  const snapshot = publicSnapshot(released); assert.ok(!JSON.stringify(snapshot).includes('Private player'));
  const player = new PortablePlanner(snapshot, true); player.openPlayerResponse(envelopes[0]);
  const personal = await player.request('/response'); assert.ok(personal.assignments.length);
  const reopened = new PortablePlanner(JSON.parse(JSON.stringify(released)));
  assert.equal(reopened.state.responses.length, 12); assert.ok(reopened.state.schedule.sessions.length);
  await planner.request('/organizer/game', { ...planner.state.games[0], summary: 'A revised adventure' });
  assert.equal(planner.state.schedule, null); assert.equal(planner.state.published, false);
});
test('reading response folder skips unrelated extensions and reports corrupt JSON', async () => {
  const planner = new PortablePlanner(), folder = new MemoryFolder(); await planner.openFolder(folder);
  const responses = await folder.getDirectoryHandle('responses', { create: true });
  responses.files.set('reply.json', JSON.stringify(responseEnvelope(await reply(planner.state), planner.state.event.id)));
  responses.files.set('broken.json', '{oops'); responses.files.set('notes.txt', 'Do not import');
  const read = await planner.readResponseFolder(); assert.equal(read.files.length, 1); assert.equal(read.rejected.length, 1);
});
test('legacy event import strips server credentials and rejects unsafe identifiers/schedules', () => {
  const state = sampleState(); state.responses = [{ id: 'player-a', name: 'Legacy player', preferences: [], availability: [], updatedAt: new Date().toISOString(), tokenHash: 'PRIVATE-OLD-CREDENTIAL' }];
  assert.ok(!JSON.stringify(restoreEvent(state)).includes('PRIVATE-OLD-CREDENTIAL'));
  assert.throws(() => restoreEvent({ ...state, games: [{ ...state.games[0], id: '\" onclick=alert(1)' }] }), /identifier/);
  assert.throws(() => restoreQuestionnaire({ ...state, published: true, schedule: { method: 'balanced', generatedAt: new Date().toISOString(), sessions: [{ id: 's', gameId: 'missing', slotId: state.slots[0].id, table: 1, playerIds: [] }] } }), /missing game/);
  assert.throws(() => parseJsonFile('{invalid'), /JSON/);
});
