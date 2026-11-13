import { gmKey } from './model.js';

export const METHODS = ['balanced', 'preference', 'lottery', 'first-choice'];
function randomGenerator(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function generateSchedule(state, method = 'balanced', seed = Date.now()) {
  if (!METHODS.includes(method)) throw new Error('Unknown scheduling method.');
  const random = randomGenerator(seed);
  const slots = [...state.slots].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const allGms = [...new Set(state.games.map((g) => gmKey(g.gm)))];
  const responsesById = new Map(state.responses.map((r) => [r.id, r]));
  const attempts = Math.max(1, Math.min(160, Math.floor(3000000 / Math.max(1, state.responses.length * state.games.length * slots.length * state.event.parallelTables))));
  let best = null, bestScore = -Infinity;
  // Multi-start greedy search: every candidate obeys all hard constraints.
  // This is intentionally a heuristic; diagnostics make unmet soft goals visible.
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sessions = [], gameRuns = new Map(), gmRuns = new Map(), allocations = new Map(), played = new Map(), firstChoices = new Set();
    const orderedSlots = attempt % 3 === 0 ? [...slots].sort(() => random() - 0.5) : slots;
    for (const slot of orderedSlots) {
      const busyPlayers = new Set(), busyGms = new Set();
      for (let table = 1; table <= state.event.parallelTables; table++) {
        let candidate = null, candidateScore = -Infinity;
        for (const game of state.games) {
          const key = gmKey(game.gm);
          if ((gameRuns.get(game.id) || 0) >= game.runs || busyGms.has(key) || [...busyPlayers].some((id) => gmKey(responsesById.get(id).gm || '') === key) || (game.slotIds.length && !game.slotIds.includes(slot.id))) continue;
          const willing = state.responses.filter((r) => r.availability.includes(slot.id) && (r.preferences.includes(game.id) || state.event.allowUnranked) && !r.vetoes?.includes(game.id) && !busyPlayers.has(r.id) && !played.get(r.id)?.has(game.id) && (!r.gm || gmKey(r.gm) !== key && !busyGms.has(gmKey(r.gm))) && (state.event.mode !== 'free-choice' || !allocations.get(r.id)) && (!state.event.maxSessionsPerPlayer || (allocations.get(r.id) || 0) < state.event.maxSessionsPerPlayer));
          const scores = new Map(willing.map((r) => {
            const rank = r.preferences.indexOf(game.id);
            const count = allocations.get(r.id) || 0;
            const firstChoiceBonus = (state.event.requireFirstChoice || method === 'first-choice') && rank === 0 && !firstChoices.has(r.id) ? 1000 : 0;
            const value = firstChoiceBonus + (method === 'lottery' ? random() * 100 : (method === 'balanced' ? 70 / (count + 1) : 12 / (count + 1)) + (rank >= 0 ? 40 / (rank + 1) : 1) + random() * 18);
            return [r.id, value];
          }));
          willing.sort((a, b) => scores.get(b.id) - scores.get(a.id));
          const players = willing.slice(0, game.maxPlayers);
          if (players.length < game.minPlayers) continue;
          const coverage = state.event.ensureEveryGm && !gmRuns.get(key) ? 20000 : 0;
          const score = coverage + players.reduce((sum, r) => sum + scores.get(r.id), 0) / Math.sqrt(players.length) + random() * 65;
          if (score > candidateScore) { candidateScore = score; candidate = { game, players }; }
        }
        if (!candidate) break;
        const { game, players } = candidate;
        sessions.push({ id: `session-${slot.id}-${table}`, slotId: slot.id, table, gameId: game.id, playerIds: players.map((r) => r.id) });
        gameRuns.set(game.id, (gameRuns.get(game.id) || 0) + 1);
        gmRuns.set(gmKey(game.gm), (gmRuns.get(gmKey(game.gm)) || 0) + 1);
        busyGms.add(gmKey(game.gm));
        for (const player of players) {
          busyPlayers.add(player.id); allocations.set(player.id, (allocations.get(player.id) || 0) + 1);
          if (!played.has(player.id)) played.set(player.id, new Set());
          played.get(player.id).add(game.id);
          if (player.preferences[0] === game.id) firstChoices.add(player.id);
        }
      }
    }
    const preferenceScore = sessions.reduce((sum, s) => sum + s.playerIds.reduce((total, id) => { const rank = responsesById.get(id).preferences.indexOf(s.gameId); return total + (rank >= 0 ? 1 / (rank + 1) : 0); }, 0), 0);
    const coverageScore = state.event.ensureEveryGm ? gmRuns.size * 100000000000 : 0;
    const firstChoiceScore = state.event.requireFirstChoice || method === 'first-choice' ? firstChoices.size * 10000000 : 0;
    const score = firstChoiceScore + coverageScore + (method === 'balanced' ? allocations.size * 1000 + [...allocations.values()].reduce((n, count) => n + Math.sqrt(count), 0) * 100 : allocations.size * 150) + preferenceScore * (method === 'preference' ? 300 : 10) + sessions.reduce((n, s) => n + s.playerIds.length, 0) * 20;
    if (score > bestScore) { bestScore = score; best = { sessions, allocations, gmRuns, firstChoices }; }
  }
  const unseated = state.responses.filter((r) => !best.allocations.has(r.id)).map((r) => r.id);
  const missingGms = allGms.filter((gm) => !best.gmRuns.has(gm)).map((gm) => state.games.find((g) => gmKey(g.gm) === gm).gm);
  const warnings = [];
  const unmetFirstChoices = state.responses.filter((r) => !best.firstChoices.has(r.id)).map((r) => r.id);
  if (state.event.requireFirstChoice && unmetFirstChoices.length) warnings.push(`First-choice requirement is unmet for ${unmetFirstChoices.length} players. This draft cannot be published. Adjust capacity, availability, or the rule.`);
  if (unseated.length) warnings.push(`${unseated.length} player${unseated.length === 1 ? ' has' : 's have'} no session. Check preferences, availability, and minimum group sizes.`);
  if (state.event.ensureEveryGm && missingGms.length) warnings.push(`Required GM coverage is unmet for: ${missingGms.join(', ')}. Publication is blocked. Adjust availability, group sizes, or the rule.`);
  if (!best.sessions.length) warnings.push('No viable groups found. Add responses and time slots, or lower minimum player counts.');
  return { method, seed, generatedAt: new Date().toISOString(), sessions: best.sessions, warnings, unseated, missingGms, unmetFirstChoices, validForPublication: (!state.event.requireFirstChoice || !unmetFirstChoices.length) && (!state.event.ensureEveryGm || !missingGms.length) };
}
