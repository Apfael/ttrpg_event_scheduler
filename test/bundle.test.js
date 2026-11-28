import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildHtml } from '../scripts/build.mjs';
import { sampleState } from '../lib/model.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="tabletop-code">([\s\S]*?)<\/script>/)[1];
test('root entry pages match sources, bundle all frontend assets, and use the same PHP endpoint', async () => {
  assert.equal(html, await buildHtml());
  assert.equal(await readFile(new URL('../organizer.html', import.meta.url), 'utf8'), html);
  assert.equal(await readFile(new URL('../players.html', import.meta.url), 'utf8'), await buildHtml('players'));
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:href="https?:|rel="stylesheet")/i);
  assert.doesNotMatch(script, /showDirectoryPicker|showSaveFilePicker|responseEnvelope|openQuestionnaireFile/);
  assert.match(html, /type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(html, /connect-src 'self'/);
});
function harness(player, state, hash = '', eventId = '', failedAction = '') {
  const elements = new Map(), listeners = new Map(), storage = new Map(), posts = [], calls = [];
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { innerHTML: '', textContent: key === '#tabletop-data' ? player ? '{"kind":"players"}' : 'null' : '', addEventListener() {}, open: false });
    return elements.get(key);
  };
  class FakeFormData {
    constructor(form) { this.fields = form.fields; }
    *[Symbol.iterator]() { yield* Object.entries(this.fields); }
  }
  const fetch = async (url, options = {}) => {
    const requestUrl = new URL(url, 'https://example.test/event/'), action = requestUrl.searchParams.get('action');
    calls.push({ action, eventId: requestUrl.searchParams.get('event'), search: requestUrl.search });
    let data;
    if (action === failedAction) return { ok: false, status: 404, json: async () => ({ error: 'This event could not be found.' }) };
    if (action === 'status') data = { initialized: true, authenticated: !player, csrf: 'test-csrf' };
    else if (action === 'event') data = { event: state.event, organization: state.organization, games: state.games, slots: state.slots, definitionRevision: 4, schedule: null, published: false };
    else if (action === 'admin') data = state;
    else if (action === 'default-event') data = { ...state, defaultEventId: state.event.id };
    else if (action === 'respond') {
      assert.equal(options.headers['X-Tabletop-CSRF'], 'test-csrf'); posts.push(JSON.parse(options.body)); data = { ok: true, token: 'a'.repeat(64) };
    } else throw new Error(`Unexpected request: ${action}`);
    return { ok: true, status: 200, json: async () => data };
  };
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (name, handler) => listeners.set(name, handler), documentElement: { dataset: {} }, visibilityState: 'visible' },
    window: { addEventListener() {}, scrollTo() {} }, location: { hash, protocol: 'https:', href: `https://example.test/event/${player ? 'players' : 'organizer'}.html${eventId ? `?event=${eventId}` : ''}`, search: eventId ? `?event=${eventId}` : '' },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }), structuredClone, TextEncoder, crypto: webcrypto, console,
    URL, URLSearchParams, FormData: FakeFormData, fetch, setTimeout: () => 0, clearTimeout() {}, setInterval() {},
  });
  return { context, element, listeners, posts, storage, calls };
}
test('player selection is a compact name/GM list; submitting ranks and vetoes saves to the shared endpoint', async () => {
  const state = { ...sampleState(), organization: { name: 'Lantern Guild', logo: null } }, h = harness(true, state);
  await new vm.Script(script).runInContext(h.context);
  const markup = h.element('#app').innerHTML;
  assert.match(markup, /Lantern Guild/);
  const visible = markup.replace(/<details\b[\s\S]*?<\/details>/g, '');
  assert.match(visible, /The Wild Beyond/); assert.match(visible, /Alex Morgan/);
  assert.doesNotMatch(visible, /players per table|Follow a wandering|Dungeons &amp; Dragons|game-emblem|game-summary/);
  assert.match(markup, /More about this/); assert.match(markup, /3–5 players per table/);
  assert.doesNotMatch(markup, /Save.*response file|Open questionnaire|Import responses/);
  const select = (id, rank) => h.listeners.get('change')({ target: { dataset: { rank: id }, value: String(rank), closest: () => true } });
  select(state.games[0].id, 1); select(state.games[1].id, -1);
  const form = { id: 'player-form', fields: { name: 'A player', gm: '' }, querySelector: (selector) => selector.startsWith('button') ? { disabled: false } : null };
  await h.listeners.get('submit')({ preventDefault() {}, target: form });
  assert.equal(h.posts.length, 1); assert.deepEqual(h.posts[0].preferences, [state.games[0].id]); assert.deepEqual(h.posts[0].vetoes, [state.games[1].id]);
  assert.equal(h.posts[0].eventId, state.event.id); assert.equal(h.posts[0].definitionRevision, 4);
  assert.match(h.element('#app').innerHTML, /saved on the event server/);
  assert.equal(h.storage.get(`tabletop-response-${state.event.id}`), 'a'.repeat(64));
});
test('player event-specific URL reaches the right event without matching the blocker filter', async () => {
  const state = sampleState(), h = harness(true, state, '', state.event.id);
  await new vm.Script(script).runInContext(h.context);
  assert.equal(h.calls.find((call) => call.action === 'status').eventId, null);
  const eventRequest = h.calls.find((call) => call.action === 'event');
  assert.equal(eventRequest.eventId, state.event.id);
  assert.equal(eventRequest.search, `?event=${state.event.id}&action=event`);
  assert.match(h.element('#app').innerHTML, new RegExp(state.event.name));
});
test('player error retry preserves the event-specific URL', async () => {
  const state = sampleState(), h = harness(true, state, '', state.event.id, 'event');
  await new vm.Script(script).runInContext(h.context);
  assert.match(h.element('#app').innerHTML, new RegExp(`href="https://example\\.test/event/players\\.html\\?event=${state.event.id}"`));
});
test('organizers have a visible rules page with methods, required first choices, veto-safe fallback, GM coverage, and player caps', async () => {
  const sample = sampleState();
  const h = harness(false, { ...sample, organization: { name: 'Lantern Guild', logo: null }, events: [{ id: sample.event.id, name: sample.event.name }], revision: 1, definitionRevision: 1 }, '#rules');
  await new vm.Script(script).runInContext(h.context);
  const markup = h.element('#app').innerHTML;
  for (const label of ['Assignment rules', 'Balanced', 'Preference score', 'First-choice coverage', 'Lottery', 'Require every player to receive their first choice', 'Allow unranked games', 'Require at least one session per GM', 'Maximum sessions per player']) assert.ok(markup.includes(label), label);
  assert.match(markup, /id="event-select"/); assert.match(markup, /data-action="create-event"/); assert.doesNotMatch(markup, /event-symbol/);
  assert.match(markup, /Lantern Guild/);
  assert.match(markup, /Vetoes are hard exclusions/);
});
test('organizers can see and change the default event used by the permanent player link', async () => {
  const sample = sampleState();
  const h = harness(false, { ...sample, defaultEventId: 'another-event', organization: { name: 'Lantern Guild', logo: null }, events: [{ id: sample.event.id, name: sample.event.name }, { id: 'another-event', name: 'Another event' }], revision: 1, definitionRevision: 1 }, '#games');
  await new vm.Script(script).runInContext(h.context);
  const markup = h.element('#app').innerHTML;
  assert.match(markup, /Another event · Player default/);
  assert.match(markup, /data-action="set-default-event"/);
  assert.match(markup, /Set as player default/);
  await h.listeners.get('click')({ target: { closest: () => ({ dataset: { action: 'set-default-event' }, disabled: false }) } });
  assert.ok(h.calls.some((call) => call.action === 'default-event'));
  assert.match(h.element('#app').innerHTML, /Player default<\/button>/);
});
test('organization settings expose a global name and safe image upload control', async () => {
  const sample = sampleState();
  const h = harness(false, { ...sample, organization: { name: 'Lantern Guild', logo: null }, events: [{ id: sample.event.id, name: sample.event.name }], revision: 1, definitionRevision: 1, organizationRevision: 0 }, '#settings');
  await new vm.Script(script).runInContext(h.context);
  const markup = h.element('#app').innerHTML;
  assert.match(markup, /name="organizationName"/);
  assert.match(markup, /id="organization-logo" type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(markup, /Save branding/);
});
