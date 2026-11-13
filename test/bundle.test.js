import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildHtml } from '../scripts/build.mjs';
import { sampleState } from '../lib/model.js';
import { publicSnapshot } from '../lib/portable.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="tabletop-code">([\s\S]*?)<\/script>/)[1];
test('checked-in HTML is current, self-contained, and compiles without module imports', async () => {
  assert.equal(html, await buildHtml());
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:href="https?:|rel="stylesheet")/i);
  assert.doesNotMatch(script, /\bfetch\s*\(|\bimport\s*(?:\(|\{)|node:/);
  assert.match(html, /connect-src 'none'/);
});
test('standalone organizer boots without network access, login, or browser event storage', async () => {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { innerHTML: '', textContent: key === '#tabletop-data' ? 'null' : '', addEventListener() {} });
    return elements.get(key);
  };
  const writes = [], context = vm.createContext({
    document: { querySelector: element, addEventListener() {}, documentElement: { dataset: {} } },
    window: { addEventListener() {} }, location: { hash: '', protocol: 'file:', href: 'file:///event/index.html' },
    localStorage: { getItem: () => null, setItem: (key) => writes.push(key) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    structuredClone, TextEncoder, crypto: webcrypto, console,
    fetch: () => { throw new Error('Network is forbidden in this test'); },
  });
  await new vm.Script(script).runInContext(context);
  const content = element('#app').innerHTML;
  assert.match(content, /The game roster/); assert.match(content, /Open event file/); assert.match(content, /Save event file/);
  assert.doesNotMatch(content, /Organizer password|data-action="logout"/);
  assert.deepEqual(writes, []);
});
test('bundled player form ranks choices and saves a portable response without a network', async () => {
  const state = sampleState(), elements = new Map(), listeners = new Map(), blobs = new Map(), downloads = [];
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { innerHTML: '', className: '', textContent: key === '#tabletop-data' ? JSON.stringify({ kind: 'questionnaire', state: publicSnapshot(state) }) : '', addEventListener() {} });
    return elements.get(key);
  };
  class FakeFormData {
    constructor(form) { this.fields = form.fields; }
    *[Symbol.iterator]() { yield* Object.entries(this.fields); }
  }
  class DownloadURL extends URL {
    static createObjectURL(blob) { const id = `blob:test-${blobs.size}`; blobs.set(id, blob); return id; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (type, listener) => listeners.set(type, listener), documentElement: { dataset: {} }, createElement: () => ({ click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } }) },
    window: { addEventListener() {}, scrollTo() {} }, location: { hash: '', protocol: 'file:', href: 'file:///event/questionnaire.html' },
    localStorage: { getItem: () => null, setItem: () => { throw new Error('Do not store player data in the browser'); } },
    matchMedia: () => ({ matches: false, addEventListener() {} }), structuredClone, TextEncoder, crypto: webcrypto, console,
    Blob, URL: DownloadURL, FormData: FakeFormData, setTimeout: () => 0, clearTimeout() {},
    fetch: () => { throw new Error('Network is forbidden'); },
  });
  await new vm.Script(script).runInContext(context);
  assert.match(element('#app').innerHTML, /Save my response file/);
  const select = (id, rank) => listeners.get('change')({ target: { dataset: { rank: id }, value: String(rank), closest: () => true } });
  select(state.games[1].id, 1); select(state.games[0].id, 1);
  const submit = { disabled: false };
  const form = { id: 'player-form', fields: { name: 'A phone player', gm: '' }, querySelector: (selector) => selector.startsWith('button') ? submit : null };
  await listeners.get('submit')({ preventDefault() {}, target: form });
  assert.equal(downloads.length, 1); assert.match(downloads[0].name, /^response-[\w-]+\.json$/);
  const response = JSON.parse(await downloads[0].blob.text());
  assert.equal(response.eventId, state.event.id); assert.equal(response.response.name, 'A phone player');
  assert.deepEqual(response.response.preferences, [state.games[0].id, state.games[1].id]);
  assert.match(element('#app').innerHTML, /Nothing is uploaded automatically/);
});
