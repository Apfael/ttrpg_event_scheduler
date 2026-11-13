export function randomUUID() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class InputError extends Error {}
const fail = (message) => { throw new InputError(message); };
export function text(value, label, max = 200, optional = false) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) fail(`${label} must be ${optional ? 'at most' : 'between 1 and'} ${max} characters.`);
  return result;
}
export function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
export const gmKey = (name) => name.trim().normalize('NFKC').toLocaleLowerCase('en');
export function validateEvent(input) {
  const name = text(input.name, 'Event name', 100);
  const timezone = text(input.timezone, 'Time zone', 80);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('Enter a valid IANA time zone, such as Europe/Berlin.'); }
  if (!['rotation', 'free-choice'].includes(input.mode)) fail('Choose a valid play format.');
  if (typeof input.acceptingResponses !== 'boolean' || typeof input.ensureEveryGm !== 'boolean') fail('Invalid event options.');
  const assignmentMethod = input.assignmentMethod || 'balanced';
  if (!['balanced', 'preference', 'lottery', 'first-choice'].includes(assignmentMethod)) fail('Choose a valid assignment method.');
  if (input.requireFirstChoice !== undefined && typeof input.requireFirstChoice !== 'boolean' || input.allowUnranked !== undefined && typeof input.allowUnranked !== 'boolean') fail('Invalid assignment rules.');
  return {
    name, timezone, location: text(input.location, 'Location', 160, true),
    description: text(input.description, 'Introduction', 3000, true),
    mode: input.mode, parallelTables: integer(input.parallelTables, 'Parallel tables', 1, 16),
    ensureEveryGm: input.ensureEveryGm, acceptingResponses: input.acceptingResponses,
    assignmentMethod, requireFirstChoice: input.requireFirstChoice === true, allowUnranked: input.allowUnranked === true,
    maxSessionsPerPlayer: integer(input.maxSessionsPerPlayer ?? 0, 'Maximum sessions per player', 0, 30),
  };
}
export function validateSlot(input, existing = []) {
  const date = text(input.date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail('Enter a valid date.');
  const time = (value, label) => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(`Enter a valid ${label}.`);
    return value;
  };
  const start = time(input.start, 'start time'), end = time(input.end, 'end time');
  if (end <= start) fail('The end time must be after the start time, on the same day.');
  if (existing.some((s) => s.id !== input.id && s.date === date && s.start < end && s.end > start)) fail('Time slots cannot overlap. Use parallel tables within a slot.');
  return { label: text(input.label, 'Slot name', 80), date, start, end };
}
export function validateGame(input, slots) {
  const minPlayers = integer(input.minPlayers, 'Minimum players', 1, 30);
  const maxPlayers = integer(input.maxPlayers, 'Maximum players', minPlayers, 30);
  if (!Array.isArray(input.slotIds) || input.slotIds.some((id) => !slots.some((s) => s.id === id))) fail('Choose valid time slots.');
  return {
    title: text(input.title, 'Game title', 120), adventure: text(input.adventure, 'Adventure name', 120, true),
    system: text(input.system, 'Game system', 80, true), gm: text(input.gm, 'Game master', 80),
    summary: text(input.summary, 'Short description', 300, true), description: text(input.description, 'Long description', 5000, true),
    minPlayers, maxPlayers, runs: integer(input.runs, 'Maximum sessions', 1, 30), slotIds: [...new Set(input.slotIds)],
  };
}
export function validateResponse(input, state) {
  if (!Array.isArray(input.preferences) || input.preferences.length < 1 || input.preferences.length > state.games.length || new Set(input.preferences).size !== input.preferences.length || input.preferences.some((id) => !state.games.some((g) => g.id === id))) fail('Rank at least one offered game, with no duplicates.');
  if (!Array.isArray(input.availability) || !input.availability.length || new Set(input.availability).size !== input.availability.length || input.availability.some((id) => !state.slots.some((s) => s.id === id))) fail('Select at least one valid time slot.');
  const gm = text(input.gm || '', 'Game master identity', 80, true);
  if (gm && !state.games.some((g) => gmKey(g.gm) === gmKey(gm))) fail('Select a game master from the roster.');
  const vetoes = input.vetoes || [];
  if (!Array.isArray(vetoes) || vetoes.length > state.games.length || new Set(vetoes).size !== vetoes.length || vetoes.some((id) => !state.games.some((g) => g.id === id) || input.preferences.includes(id))) fail('Vetoes must be offered games and cannot also be ranked.');
  return { name: text(input.name, 'Player name', 80), gm, preferences: input.preferences, vetoes, availability: input.availability };
}
export function blankState() {
  return {
    version: 1, event: { id: randomUUID(), name: 'Our tabletop gathering', location: '', timezone: 'Europe/Berlin', description: '', mode: 'rotation', parallelTables: 3, ensureEveryGm: true, acceptingResponses: true, sample: false, assignmentMethod: 'balanced', requireFirstChoice: false, allowUnranked: false, maxSessionsPerPlayer: 0 },
    games: [], slots: [], responses: [], ignoredResponseIds: [], schedule: null, published: false,
  };
}
export function sampleState() {
  const state = blankState();
  state.event = { ...state.event, name: 'A weekend of adventures', location: 'The guild hall', sample: true,
    description: 'Good company. New worlds. A seat at the table. Tell us what you would love to play, and we’ll bring the party together.' };
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 14);
  date.setUTCDate(date.getUTCDate() + (6 - date.getUTCDay() + 7) % 7);
  const day1 = date.toISOString().slice(0, 10); date.setUTCDate(date.getUTCDate() + 1);
  const day2 = date.toISOString().slice(0, 10);
  state.slots = [
    { id: 'slot-1', label: 'Saturday · Morning', date: day1, start: '10:00', end: '13:00' },
    { id: 'slot-2', label: 'Saturday · Afternoon', date: day1, start: '14:00', end: '17:00' },
    { id: 'slot-3', label: 'Sunday · Morning', date: day2, start: '10:00', end: '13:00' },
  ];
  // Labels follow the actual dates, including when this example is created midweek.
  state.slots.forEach((s, i) => { s.label = `${new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${s.date}T12:00:00Z`))} · ${i === 1 ? 'Afternoon' : 'Morning'}`; });
  state.games = [
    ['The Wild Beyond', 'A lantern in the woods', 'Dungeons & Dragons', 'Alex Morgan', 3, 5, 2, 'Follow a wandering light into a forest that remembers every promise.', 'A welcoming fantasy adventure with curious creatures, difficult bargains, and room for creative solutions. No experience needed; characters are provided.'],
    ['Dead Air', 'The last transmission', 'Call of Cthulhu', 'Sam Rivera', 3, 4, 2, 'A remote radio station goes silent. One signal keeps broadcasting.', 'An atmospheric investigation set in the 1920s. Expect mystery and unsettling discoveries. We will agree on boundaries together before play.'],
    ['Neon After Dark', 'One last delivery', 'Cyberpunk RED', 'Jamie Chen', 3, 5, 1, 'A simple courier job. A city full of people who want your package.', 'A fast-moving urban heist with ready-to-play characters. Choose your approach: talk your way in, slip past security, or make a little noise.'],
    ['A Very Small Quest', 'Trouble at Mossbridge', 'Mausritter', 'Robin Ellis', 2, 4, 2, 'Tiny heroes, enormous trouble. Save a village from a rising river.', 'A rules-light woodland adventure for curious explorers. Newcomers welcome. All materials and mouse-sized courage supplied.'],
    ['The Midnight Society', '', 'Brindlewood Bay', 'Sam Rivera', 3, 5, 1, 'Tea, knitting, and a murder nobody at the retirement club can explain.', 'A collaborative cozy mystery. We discover the solution together through play, with a little supernatural strangeness at the edges.'],
    ['Beyond the Belt', 'A distress call from nowhere', 'Mothership', 'Jamie Chen', 3, 4, 1, 'Your salvage crew finds a ship that should not still be out there.', 'Science fiction survival horror. Teamwork and careful choices matter more than combat. Content boundaries discussed before play.'],
  ].map(([title, adventure, system, gm, minPlayers, maxPlayers, runs, summary, description], i) => ({ id: `game-${i + 1}`, title, adventure, system, gm, minPlayers, maxPlayers, runs, summary, description, slotIds: [] }));
  return state;
}
