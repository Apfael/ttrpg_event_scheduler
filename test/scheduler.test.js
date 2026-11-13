import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleState, blankState, validateSlot, validateGame, validateEvent, validateResponse, gmKey } from '../lib/model.js';
import { generateSchedule, METHODS } from '../lib/scheduler.js';

function fixture() {
  const state = sampleState();
  state.responses = Array.from({ length: 22 }, (_, i) => ({
    id: `player-${i}`, name: `Player ${i}`, gm: i === 0 ? state.games[0].gm : '',
    preferences: [...state.games.slice(i % 6), ...state.games.slice(0, i % 6)].map((g) => g.id),
    availability: state.slots.filter((_, j) => i % 5 !== 0 || j !== 1).map((s) => s.id),
  }));
  state.games[0].slotIds = [state.slots[0].id];
  return state;
}
function assertConstraints(state, schedule) {
  const runs = new Map(), allPlayed = new Set(), totalForPlayer = new Map();
  for (const slot of state.slots) {
    const sessions = schedule.sessions.filter((s) => s.slotId === slot.id);
    assert.ok(sessions.length <= state.event.parallelTables);
    const gms = new Set(), players = new Set(), tables = new Set();
    for (const session of sessions) {
      const game = state.games.find((g) => g.id === session.gameId);
      assert.ok(!gms.has(gmKey(game.gm)), 'GM is never double booked'); gms.add(gmKey(game.gm));
      assert.ok(!tables.has(session.table)); tables.add(session.table);
      assert.ok(session.table >= 1 && session.table <= state.event.parallelTables);
      assert.ok(session.playerIds.length >= game.minPlayers && session.playerIds.length <= game.maxPlayers);
      assert.ok(!game.slotIds.length || game.slotIds.includes(slot.id));
      runs.set(game.id, (runs.get(game.id) || 0) + 1);
      for (const id of session.playerIds) {
        const player = state.responses.find((r) => r.id === id);
        assert.ok(!players.has(id), 'player is never double booked'); players.add(id);
        assert.ok(player.availability.includes(slot.id));
        assert.ok(player.preferences.includes(game.id));
        const key = `${id}:${game.id}`;
        assert.ok(!allPlayed.has(key), 'player never repeats an adventure'); allPlayed.add(key);
        totalForPlayer.set(id, (totalForPlayer.get(id) || 0) + 1);
      }
    }
    for (const id of players) {
      const player = state.responses.find((r) => r.id === id);
      assert.ok(!player.gm || !gms.has(gmKey(player.gm)), 'a GM cannot play while running a session');
    }
  }
  for (const game of state.games) assert.ok((runs.get(game.id) || 0) <= game.runs);
  if (state.event.mode === 'free-choice') for (const total of totalForPlayer.values()) assert.equal(total, 1);
}
for (const method of METHODS) {
  test(`${method} respects capacity, availability, repeated games, and GM/player conflicts`, () => {
    const state = fixture();
    for (const seed of [1, 27, 908]) {
      const schedule = generateSchedule(state, method, seed);
      assert.ok(schedule.sessions.length > 0); assertConstraints(state, schedule);
      assert.equal(schedule.missingGms.length, 0, 'feasible GM coverage is achieved');
    }
  });
  test(`${method} respects single-session event mode`, () => {
    const state = fixture(); state.event.mode = 'free-choice';
    assertConstraints(state, generateSchedule(state, method, 8));
  });
}
test('impossible GM coverage and unseated players are reported without breaking minimum group sizes', () => {
  const state = fixture(); state.responses = [state.responses[0]];
  const result = generateSchedule(state, 'balanced', 5);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.unseated.length, 1);
  assert.equal(result.missingGms.length, 4);
  assert.ok(result.warnings.length >= 3);
});
test('a seed reproduces allocations and the input is not mutated', () => {
  const state = fixture(), original = structuredClone(state);
  assert.deepEqual(generateSchedule(state, 'lottery', 123).sessions, generateSchedule(state, 'lottery', 123).sessions);
  assert.deepEqual(state, original);
});
test('GM names differing by case or surrounding spaces share one identity', () => {
  const state = fixture(); state.games[1].gm = `  ${state.games[0].gm.toUpperCase()}  `;
  assertConstraints(state, generateSchedule(state, 'balanced', 9));
});
test('empty events return useful diagnostics', () => {
  const result = generateSchedule(blankState(), 'balanced', 1);
  assert.deepEqual(result.sessions, []); assert.ok(result.warnings.length);
});
test('slot validation rejects impossible dates, overnight times, and overlaps', () => {
  const slot = { label: 'Morning', date: '2027-02-28', start: '10:00', end: '13:00' };
  assert.throws(() => validateSlot({ ...slot, date: '2027-02-30' }));
  assert.throws(() => validateSlot({ ...slot, end: '09:00' }));
  assert.throws(() => validateSlot({ ...slot, start: '24:00' }));
  assert.throws(() => validateSlot(slot, [{ ...slot, id: 'another-slot' }]));
  assert.equal(validateSlot({ ...slot, start: '13:00', end: '16:00' }, [slot]).start, '13:00');
});
test('game, event, and response validation reject malformed scheduling inputs', () => {
  const state = sampleState(), game = state.games[0];
  assert.throws(() => validateGame({ ...game, maxPlayers: 1 }, state.slots));
  assert.throws(() => validateGame({ ...game, runs: 1.5 }, state.slots));
  assert.throws(() => validateGame({ ...game, slotIds: ['missing'] }, state.slots));
  assert.throws(() => validateEvent({ ...state.event, timezone: 'Not/AZone' }));
  assert.throws(() => validateEvent({ ...state.event, parallelTables: 0 }));
  const response = { name: 'A player', gm: '', preferences: [game.id], availability: [state.slots[0].id] };
  assert.equal(validateResponse(response, state).name, response.name);
  assert.throws(() => validateResponse({ ...response, preferences: [game.id, game.id] }, state));
  assert.throws(() => validateResponse({ ...response, availability: [] }, state));
  assert.throws(() => validateResponse({ ...response, gm: 'Unknown GM' }, state));
});
