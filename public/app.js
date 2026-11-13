const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  dice: '<path d="m12 2 9 6v10l-9 4-9-4V8Z"/><path d="m12 2-5 14 14-8-9 14-5-6h10L12 2M3 8l14 8-14 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  sliders: '<path d="M4 5h8m4 0h4M4 12h3m4 0h9M4 19h10m4 0h2M12 2v6M7 9v6m7 1v6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4.24 4.24 0 0 1-6-6l5-5a4.24 4.24 0 0 1 6 0m0 10a4.24 4.24 0 0 0 6 0l5-5a4.24 4.24 0 0 0-6-6l-2 2" transform="translate(1 0) scale(.9)"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m0-11H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  logout: '<path d="M9 4H4v16h5m-1-8h14m-5-5 5 5-5 5"/>',
};
const icon = (name, className = '') => `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.dice}</svg>`;
const brand = () => `<span class="brand-mark">${icon('dice')}</span><span>tabletop<span class="brand-dot">.</span></span>`;
const initials = (name) => name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function storageRemove(key) { try { localStorage.removeItem(key); } catch {} }
let theme = storageGet('tabletop-theme') || 'system';
if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
const media = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme; };
applyTheme(); media.addEventListener('change', applyTheme);
const themeButton = () => `<button class="icon-button" data-action="theme" title="Theme: ${theme}. Click to change." aria-label="Theme: ${theme}. Click to change.">${icon(theme === 'system' ? 'monitor' : theme === 'dark' ? 'moon' : 'sun')}</button>`;
let data, page = ['overview', 'games', 'slots', 'responses', 'schedule', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'games';
const playerMode = location.pathname === '/play';
let playerToken, savedResponse = null, assignments = [], submitted = false, picks = [], availability = [], playerName = '', playerGm = '', search = '';
async function api(path, body, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !playerMode && path !== '/api/login') { renderLogin(); }
    const error = new Error(result.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}
let toastTimer;
function toast(message, error = false) {
  const element = $('#toast'); element.textContent = message; element.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.className = ''; }, 5500);
}
function dateLabel(date, long = false) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
function eventDates() {
  if (!data.slots.length) return 'Dates to be decided';
  const dates = data.slots.map((s) => s.date).sort();
  return dates[0] === dates.at(-1) ? dateLabel(dates[0], true) : `${dateLabel(dates[0])} – ${dateLabel(dates.at(-1), true)}`;
}
const tag = (text, className = '') => `<span class="tag ${className}">${esc(text)}</span>`;
function empty(title, description, action = '') { return `<div class="empty"><div class="empty-icon">${icon('dice')}</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`; }
function field(label, name, value = '', attrs = '', type = 'text') { return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`; }
const btn = (label, action, className = 'button', symbol = '') => `<button type="button" class="${className}" data-action="${action}">${symbol ? icon(symbol) : ''}${label}</button>`;
function stats() {
  const gms = new Set(data.games.map((g) => g.gm.trim().toLocaleLowerCase()));
  const possibleRuns = data.games.reduce((n, g) => n + g.runs, 0);
  return `<div class="stats-grid">
    <div class="stat"><span class="stat-icon lavender">${icon('dice')}</span><div><span class="stat-label">Game offerings</span><strong>${data.games.length}<small>${possibleRuns} possible sessions</small></strong></div></div>
    <div class="stat"><span class="stat-icon peach">${icon('people')}</span><div><span class="stat-label">Game masters</span><strong>${gms.size}<small>${data.event.ensureEveryGm ? 'Every GM gets priority' : 'Preference-based selection'}</small></strong></div></div>
    <div class="stat"><span class="stat-icon mint">${icon('calendar')}</span><div><span class="stat-label">Time slots</span><strong>${data.slots.length}<small>${plural(data.event.parallelTables, 'parallel table')}</small></strong></div></div>
    <div class="stat"><span class="stat-icon blue">${icon('check')}</span><div><span class="stat-label">Player responses</span><strong>${data.responses.length}<small>${data.event.acceptingResponses ? 'Preferences are open' : 'Preferences are closed'}</small></strong></div></div>
  </div>`;
}
const pages = {
  overview: ['Your next great gathering', 'A little preparation. A lot of adventure. Keep everything on track.'],
  games: ['A world of possibilities', 'Build your game roster. We’ll help everyone find their next adventure.'],
  slots: ['Make room for adventure', 'Set the dates and play windows. Each time slot can host multiple tables.'],
  responses: ['Meet your adventurers', 'See what your players want to play and when they can join.'],
  schedule: ['Bring the party together', 'Turn preferences into a schedule, then share it with your players.'],
  settings: ['Make it your gathering', 'The essentials, the play format, and the rules that hold it all together.'],
};
function renderOrganizer() {
  document.title = `${data.event.name} · Tabletop`;
  const nav = [['overview', 'grid', 'Overview'], ['games', 'dice', 'Game roster'], ['slots', 'calendar', 'Time slots'], ['responses', 'people', 'Player responses'], ['schedule', 'sliders', 'Schedule']];
  $('#app').innerHTML = `<div class="workspace">
    <aside class="sidebar"><a class="brand" href="/organizer">${brand()}</a><div class="workspace-label">ORGANIZER WORKSPACE</div>
      <div class="event-switch"><span class="event-symbol">${icon('dice')}</span><div><strong>${esc(data.event.name)}</strong><span>${esc(data.event.location || 'Your gathering')}</span></div></div>
      <nav aria-label="Organizer">${nav.map(([id, symbol, label]) => `<a class="nav-item ${page === id ? 'active' : ''}" href="#${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${id === 'responses' ? `<span class="nav-count">${data.responses.length}</span>` : ''}${page === id ? '<span class="active-dot"></span>' : ''}</a>`).join('')}</nav>
      <div class="sidebar-note"><span class="tiny-spark">✧</span><strong>Great stories start<br>around a table.</strong><p>You bring the people.<br>We’ll help with the plan.</p></div>
      <div class="sidebar-bottom"><a class="nav-item ${page === 'settings' ? 'active' : ''}" href="#settings">${icon('sliders')}<span>Event settings</span></a><button class="icon-button mobile-signout" data-action="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button><div class="organizer-profile"><span class="avatar">OT</span><div><strong>Organizer team</strong><span>Planning together</span></div><button class="icon-button" data-action="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div></div>
    </aside>
    <div class="workspace-body"><header class="topbar"><div class="breadcrumb">Your events<span>/</span><strong>${esc(data.event.name)}</strong></div><div class="topbar-actions">${tag(data.event.sample ? 'Sample event' : data.published ? 'Schedule published' : 'Planning in progress', data.published ? 'green' : '')}${themeButton()}<a class="button small" href="/play" target="_blank" rel="noopener">${icon('external')}<span>Player preview</span></a></div></header>
    <main id="main" class="main-content" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">LET’S MAKE A LITTLE MAGIC</div><h1>${pages[page][0]}</h1><p>${pages[page][1]}</p></div>${btn('Share player link', 'share', 'button primary', 'link')}</div>
    <div class="event-meta"><span>${icon('calendar')}${esc(eventDates())}</span><span>${icon('pin')}${esc(data.event.location || 'Location to be decided')}</span><span class="status"><i class="status-dot ${data.event.acceptingResponses ? '' : 'closed'}"></i>${data.event.acceptingResponses ? 'Collecting preferences' : data.published ? 'Schedule is live' : 'Preferences closed'}</span></div>
    ${page !== 'settings' ? stats() : ''}<div id="page-content">${renderPage()}</div>
    <footer class="main-footer"><span>Made for the people around your table.</span><span>Tabletop · Event planner <span class="version">v0.1</span></span></footer></main></div></div>`;
}
function renderPage() {
  if (page === 'games') return gamesPage();
  if (page === 'overview') return overviewPage();
  if (page === 'slots') return slotsPage();
  if (page === 'responses') return responsesPage();
  if (page === 'schedule') return schedulePage();
  return settingsPage();
}
function gamesPage() {
  return `<section class="panel"><div class="section-heading"><div><h2>The game roster <span class="count">${data.games.length}</span></h2><p>One offering per adventure. Repeat it across multiple sessions.</p></div>${btn('Add a game', 'add-game', 'button primary', 'plus')}</div>
    <div class="list-toolbar"><label class="search">${icon('search')}<input id="game-search" placeholder="Find a game, system, or GM…" value="${esc(search)}" aria-label="Search the game roster"></label><span class="quiet">${plural(data.games.length, 'offering')} · ${plural(new Set(data.games.map((g) => g.gm.toLocaleLowerCase())).size, 'GM')}</span></div>
    <div class="roster-labels"><span>GAME & ADVENTURE</span><span>GAME MASTER</span><span>PLAYERS</span><span>SESSIONS</span><span></span></div><div id="game-list">${gameRows()}</div>
    <div class="panel-note">${icon('sliders')}<span>${data.event.ensureEveryGm ? 'Scheduling will prioritize at least one session for every game master.' : 'Scheduling will prioritize player preferences.'} <a href="#settings">Adjust scheduling rules ${icon('arrow')}</a></span></div></section>
    <div class="tip-card"><span class="tip-symbol">✧</span><div><strong>A little detail goes a long way.</strong><p>A short description helps players choose. Add longer adventure notes for anyone who wants to explore.</p></div><a href="/play" target="_blank" rel="noopener">See the player view ${icon('external')}</a></div>`;
}
function gameRows() {
  const games = data.games.filter((g) => `${g.title} ${g.adventure} ${g.gm} ${g.system}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (!games.length) return empty(data.games.length ? 'No games match your search' : 'Your next adventure starts here', data.games.length ? 'Try another title, game system, or game master.' : 'Add your first game and tell players what awaits.');
  return games.map((g) => {
    const index = data.games.indexOf(g);
    return `<article class="game-row"><div class="game-info"><div class="game-emblem tone-${index % 6}">${icon('dice')}</div><div class="game-copy"><div class="game-title-line"><h3>${esc(g.title)}</h3>${g.system ? tag(g.system) : ''}</div>${g.adventure ? `<div class="adventure">${esc(g.adventure)}</div>` : ''}<p>${esc(g.summary || 'An adventure waiting to be discovered.')}</p>${g.description ? `<details class="description"><summary>Adventure notes</summary><p>${esc(g.description)}</p></details>` : ''}</div></div><div class="gm-cell"><span class="avatar tone-${index % 6}">${esc(initials(g.gm))}</span><span>${esc(g.gm)}</span></div><div class="players-cell">${icon('people')}<span>${g.minPlayers}–${g.maxPlayers}<small>players / table</small></span></div><div class="runs-cell"><strong>${g.runs}</strong><small>${g.runs === 1 ? 'session' : 'sessions'} max.</small></div><div class="row-actions"><button class="icon-button" data-action="edit-game" data-id="${g.id}" title="Edit ${esc(g.title)}" aria-label="Edit ${esc(g.title)}">${icon('edit')}</button></div></article>`;
  }).join('');
}
function overviewPage() {
  const steps = [
    ['settings', 'Set the scene', 'Name your event, choose a format, and set your table count.', !data.event.sample],
    ['games', 'Build your game roster', 'Add adventures, game masters, and player limits.', !!data.games.length],
    ['slots', 'Save a little time', 'Create play windows for your event.', !!data.slots.length],
    ['responses', 'Invite your players', 'Share the questionnaire and gather ranked preferences.', !!data.responses.length],
    ['schedule', 'Find everyone a seat', 'Close preferences, generate a schedule, and publish it.', data.published],
  ];
  return `<div class="overview-grid"><section class="panel"><div class="section-heading"><div><h2>A gathering, step by step</h2><p>Everything you need for a well-planned adventure.</p></div>${tag(`${steps.filter((s) => s[3]).length} / 5 ready`, 'purple')}</div><div class="checklist">${steps.map(([id, title, desc, done], i) => `<a href="#${id}" class="checklist-item"><span class="step-number ${done ? 'done' : ''}">${done ? icon('check') : `0${i + 1}`}</span><div><h3>${title}</h3><p>${desc}</p></div>${icon('arrow')}</a>`).join('')}</div></section><aside class="stack"><section class="invite-card"><div class="eyebrow">EVERY ADVENTURE NEEDS A PARTY</div><span class="invite-dice">${icon('dice')}</span><h2>A link. A few choices.<br>A table full of stories.</h2><p>Your player questionnaire is ready to explore.</p>${btn('Share the questionnaire', 'share', 'button primary', 'link')}</section>${data.event.sample ? `<section class="panel compact"><h3>Make yourself at home</h3><p>This is a sample roster. Try the planner with sample responses, or start a blank event for your own gathering.</p>${btn('Try sample responses', 'sample-responses', 'button')}${btn('Start a blank event', 'new-event', 'button text-button')}</section>` : ''}</aside></div>`;
}
function slotsPage() {
  return `<section class="panel"><div class="section-heading"><div><h2>Your play windows <span class="count">${data.slots.length}</span></h2><p>All times are local to ${esc(data.event.timezone)}. Breaks are the gaps between slots.</p></div>${btn('Add a time slot', 'add-slot', 'button primary', 'plus')}</div>${data.slots.length ? `<div class="slot-list">${data.slots.map((s, i) => `<article class="slot-row"><div class="slot-number">${String(i + 1).padStart(2, '0')}</div><div><h3>${esc(s.label)}</h3><p>${dateLabel(s.date, true)}</p></div><div class="slot-time">${icon('clock')} ${esc(s.start)} – ${esc(s.end)}</div><span class="tag">${plural(data.event.parallelTables, 'table')}</span><button class="icon-button" data-action="edit-slot" data-id="${s.id}" aria-label="Edit ${esc(s.label)}">${icon('edit')}</button></article>`).join('')}</div>` : empty('Set a time to play', 'Add your first slot, then choose how many tables can run in parallel.')}<div class="panel-note">${icon('calendar')}<span>Each slot is one play window. Sessions cannot span slots. Set specific GM availability when editing a game.</span></div></section>`;
}
function responsesPage() {
  const demand = data.games.map((g) => ({ ...g, total: data.responses.filter((r) => r.preferences.includes(g.id)).length, first: data.responses.filter((r) => r.preferences[0] === g.id).length })).sort((a, b) => b.first - a.first || b.total - a.total);
  return `<div class="section-heading outside"><div><h2>Player preferences <span class="count">${data.responses.length}</span></h2><p>Names and preferences are visible only to the organizer team.</p></div><div class="button-group">${btn('Refresh', 'refresh', 'button')}${btn('Export CSV', 'export-responses', 'button', 'download')}</div></div>
    ${!data.responses.length ? `<section class="panel">${empty('The party is still gathering', 'Share the player link to start collecting ranked game choices.', btn('Share player link', 'share', 'button primary', 'link'))}${data.event.sample ? `<div class="sample-bar">Just exploring? ${btn('Add 18 sample responses', 'sample-responses', 'button small')}</div>` : ''}</section>` : `<div class="responses-layout"><section class="panel table-scroll"><table><caption class="sr-only">Players, ranked game preferences, and availability</caption><thead><tr><th>PLAYER</th><th>RANKED PREFERENCES</th><th>AVAILABILITY</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${data.responses.map((r) => `<tr><td><strong>${esc(r.name)}</strong><small>${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: data.event.timezone }).format(new Date(r.updatedAt))}</small></td><td><ol class="rank-list">${r.preferences.map((id) => `<li>${esc(data.games.find((g) => g.id === id)?.title || 'Removed game')}</li>`).join('')}</ol></td><td><span title="${esc(r.availability.map((id) => data.slots.find((s) => s.id === id)?.label || '').join(', '))}">${r.availability.length} / ${plural(data.slots.length, 'slot')}</span></td><td><button class="icon-button danger-text" data-action="delete-response" data-id="${r.id}" aria-label="Remove response from ${esc(r.name)}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></section><aside class="panel compact demand-panel"><h3>What’s catching their eye?</h3><p>First choices · total interested</p>${demand.map((g, i) => `<div class="demand-row"><span class="demand-number">${i + 1}</span><span><strong>${esc(g.title)}</strong><small>${plural(g.first, 'first choice')} · ${g.total} interested</small></span></div>`).join('')}</aside></div>`}`;
}
function schedulePage() {
  const schedule = data.schedule;
  return `<section class="panel schedule-controls"><div><h2>A good seat for everyone</h2><p>${data.event.mode === 'rotation' ? 'Players can join one game per available slot, without repeating an adventure.' : 'Each player joins at most one session across the whole event.'}</p></div><form id="schedule-form"><label class="field"><span>Scheduling method</span><select name="method"><option value="balanced" ${schedule?.method === 'balanced' ? 'selected' : ''}>Balanced · spread opportunities</option><option value="preference" ${schedule?.method === 'preference' ? 'selected' : ''}>Preference first · favor higher choices</option><option value="lottery" ${schedule?.method === 'lottery' ? 'selected' : ''}>Lottery · randomize willing players</option></select></label><button class="button primary" ${data.event.acceptingResponses ? 'disabled' : ''}>${icon('sliders')}${schedule ? 'Regenerate' : 'Generate schedule'}</button></form>${data.event.acceptingResponses ? '<p class="inline-notice">Close preferences in <a href="#settings">Event settings</a> before generating a schedule.</p>' : ''}<p class="method-note">All methods respect player limits, availability, GM conflicts, and table capacity. Results are suggestions; review them before publishing.</p></section>
    ${schedule ? `<div class="section-heading outside schedule-result-header"><div><h2>${data.published ? 'Published schedule' : 'Your draft schedule'} ${tag(data.published ? 'Live' : 'Organizer only', data.published ? 'green' : 'purple')}</h2><p>${plural(schedule.sessions.length, 'session')} · ${plural(new Set(schedule.sessions.flatMap((s) => s.playerIds)).size, 'player')} seated · ${esc(schedule.method)} method</p></div><div class="button-group">${btn('Export CSV', 'export-schedule', 'button', 'download')}${btn(data.published ? 'Unpublish' : 'Publish schedule', 'publish', 'button primary', 'check')}</div></div>
      ${schedule.warnings.length ? `<div class="notice warning"><strong>A few things to review</strong><ul>${schedule.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>${schedule.unseated.length ? `<p>Unseated: ${esc(schedule.unseated.map((id) => data.responses.find((r) => r.id === id)?.name).join(', '))}</p>` : ''}</div>` : '<div class="notice success">All players have a seat, and the requested GM coverage is met.</div>'}${scheduleGrid(schedule, true)}` : `<section class="panel">${empty('A plan is taking shape', 'Collect preferences, close the questionnaire, and choose a scheduling method. Your draft will appear here.')}</section>`}`;
}
function scheduleGrid(schedule, admin = false) {
  return `<div class="schedule-grid">${data.slots.map((slot) => `<section class="schedule-column"><header><span class="eyebrow">${esc(dateLabel(slot.date))}</span><h3>${esc(slot.label)}</h3><p>${esc(slot.start)} – ${esc(slot.end)}</p></header>${schedule.sessions.filter((s) => s.slotId === slot.id).sort((a, b) => a.table - b.table).map((session) => {
    const game = data.games.find((g) => g.id === session.gameId);
    return `<article class="scheduled-game"><div class="session-meta">TABLE ${session.table}${tag(game.system)}</div><h3>${esc(game.title)}</h3>${game.adventure ? `<p>${esc(game.adventure)}</p>` : ''}<div class="scheduled-gm">${icon('people')} GM · ${esc(game.gm)}</div>${admin ? `<ul class="seated-players">${session.playerIds.map((id) => `<li>${esc(data.responses.find((r) => r.id === id)?.name || 'Unknown player')}</li>`).join('')}</ul>` : `<div class="seated-count">${session.playerCount} players at the table</div>`}</article>`;
  }).join('') || '<div class="open-slot">No sessions in this slot</div>'}</section>`).join('')}</div>`;
}
function settingsPage() {
  const event = data.event;
  return `<form id="settings-form" class="settings-layout"><div class="stack"><section class="panel form-panel"><div class="section-heading"><div><h2>The gathering</h2><p>These details appear on the player questionnaire.</p></div></div><div class="form-content">${field('Event name', 'name', event.name, 'required maxlength="100"')}${field('Location <span class="optional">optional</span>', 'location', event.location, 'maxlength="160"')}<label class="field"><span>A welcome for your players <span class="optional">optional</span></span><textarea name="description" rows="4" maxlength="3000">${esc(event.description)}</textarea></label>${field('Time zone', 'timezone', event.timezone, 'required placeholder="Europe/Berlin" maxlength="80"')}<p class="field-help">Use an IANA time zone. Dates and times are entered in the event’s local time.</p></div></section>
      <section class="panel form-panel"><div class="section-heading"><div><h2>The way you play</h2><p>Choose how people move between games.</p></div></div><div class="form-content"><label class="field"><span>Play format</span><select name="mode"><option value="rotation" ${event.mode === 'rotation' ? 'selected' : ''}>Rotation · one game per time slot</option><option value="free-choice" ${event.mode === 'free-choice' ? 'selected' : ''}>Single session · one game for the event</option></select></label>${field('Tables running in parallel', 'parallelTables', event.parallelTables, 'required min="1" max="16"', 'number')}<label class="check-option"><input type="checkbox" name="ensureEveryGm" ${event.ensureEveryGm ? 'checked' : ''}><span><strong>Give every game master a session</strong><small>Prioritize at least one session per GM. Any unmet coverage is flagged for review.</small></span></label><label class="check-option"><input type="checkbox" name="acceptingResponses" ${event.acceptingResponses ? 'checked' : ''}><span><strong>Accept player preferences</strong><small>Close the questionnaire when you’re ready to generate the schedule.</small></span></label><div class="form-footer"><span>Saving changes clears the current schedule.</span><button class="button primary">${icon('check')}Save settings</button></div></div></section></div>
      <aside class="stack"><section class="panel compact"><h3>Your event, ready to share</h3><p>Players open the questionnaire in any browser. No account needed.</p>${btn('Copy player link', 'share', 'button', 'link')}</section><section class="panel compact"><h3>Keep a copy</h3><p>Download an event export for review. Back up your server’s data folder to preserve player edit access.</p><a class="button" href="/api/admin/backup" download>${icon('download')}Download JSON</a></section><section class="panel compact"><h3>A fresh start</h3><p>Create a blank event on this server. Download a copy of the current event first if you need it.</p>${btn('Create a blank event', 'new-event', 'button danger-outline')}</section></aside></form>`;
}
function renderLogin() {
  $('#app').innerHTML = `<div class="auth-page"><header class="public-header"><a class="brand" href="/organizer">${brand()}</a>${themeButton()}</header><main id="main" class="auth-main"><div class="auth-art"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="auth-dice">${icon('dice')}</div><span class="art-spark spark-one">✧</span><span class="art-spark spark-two">✦</span></div><div class="eyebrow">BEHIND EVERY GREAT ADVENTURE</div><h1>A little planning.<br>A lot of possibility.</h1><p>Welcome to your organizer workspace.<br>Let’s bring your next gathering to life.</p><form id="login-form" class="panel login-panel"><h2>Come on in, organizer.</h2>${field('Organizer password', 'password', '', 'required autocomplete="current-password"', 'password')}<p id="login-error" class="form-error" role="alert"></p><button class="button primary">Open the workspace ${icon('arrow')}</button><p class="field-help">Use the password set on your server. For a local first run, find it in <code>data/organizer-key.txt</code>.</p></form><a class="subtle-link" href="/play">Here to play? Visit the questionnaire ${icon('arrow')}</a></main><footer class="public-footer">Good stories start around a table.</footer></div>`;
}
function showModal(html) {
  const modal = $('#modal'); modal.innerHTML = `<div class="modal-shell">${html}</div>`; modal.showModal();
}
function modalHeader(title, description) { return `<div class="modal-heading"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button type="button" class="icon-button close-modal" data-action="close-modal" aria-label="Close dialog">×</button></div>`; }
function gameModal(id) {
  const game = data.games.find((g) => g.id === id) || { title: '', adventure: '', system: '', gm: '', summary: '', description: '', minPlayers: 3, maxPlayers: 5, runs: 1, slotIds: [] };
  showModal(`${modalHeader(id ? 'A little adventure editing' : 'Add a new adventure', 'Give your players something to look forward to.')}<form id="game-form" data-id="${id || ''}"><div class="modal-content">${field('Game title', 'title', game.title, 'required maxlength="120" placeholder="The Wild Beyond"')}<div class="form-grid">${field('Adventure name <span class="optional">optional</span>', 'adventure', game.adventure, 'maxlength="120"')}${field('Game system <span class="optional">optional</span>', 'system', game.system, 'maxlength="80" placeholder="Dungeons & Dragons"')}</div>${field('Game master', 'gm', game.gm, 'required maxlength="80" list="gm-names"')}<datalist id="gm-names">${[...new Set(data.games.map((g) => g.gm))].map((gm) => `<option value="${esc(gm)}"></option>`).join('')}</datalist><p class="field-help">Use the same name for the same GM across all offerings.</p><div class="form-grid three">${field('Minimum players', 'minPlayers', game.minPlayers, 'required min="1" max="30"', 'number')}${field('Maximum players', 'maxPlayers', game.maxPlayers, 'required min="1" max="30"', 'number')}${field('Maximum sessions', 'runs', game.runs, 'required min="1" max="30"', 'number')}</div><p class="field-help">Player counts exclude the GM. Sessions are repeats of this offering, once per slot at most.</p><label class="field"><span>Short description <span class="optional">optional</span></span><textarea name="summary" rows="2" maxlength="300" placeholder="A sentence or two to spark their curiosity.">${esc(game.summary)}</textarea></label><label class="field"><span>Adventure notes <span class="optional">optional</span></span><textarea name="description" rows="4" maxlength="5000" placeholder="The longer pitch, experience level, content notes, or anything players should know.">${esc(game.description)}</textarea></label><fieldset class="availability-fields"><legend>When can this GM run this game?</legend>${data.slots.length ? data.slots.map((s) => `<label class="check-option compact-check"><input type="checkbox" name="slotIds" value="${s.id}" ${!game.slotIds.length || game.slotIds.includes(s.id) ? 'checked' : ''}><span>${esc(s.label)}<small>${dateLabel(s.date)} · ${s.start}–${s.end}</small></span></label>`).join('') : '<p class="field-help">No time slots yet. This game will be available in every slot you add.</p>'}</fieldset><p class="form-error" id="modal-error" role="alert"></p></div><div class="modal-footer">${id ? `<button type="button" class="button danger-text text-button" data-action="delete-game" data-id="${id}">${icon('trash')}Delete game</button>` : '<span></span>'}<div class="button-group">${btn('Cancel', 'close-modal', 'button')}<button class="button primary">${icon('check')}Save game</button></div></div></form>`);
}
function slotModal(id) {
  const slot = data.slots.find((s) => s.id === id) || { label: '', date: data.slots.at(-1)?.date || new Date().toISOString().slice(0, 10), start: '10:00', end: '13:00' };
  showModal(`${modalHeader(id ? 'Edit a play window' : 'A time for adventure', `Times are local to ${esc(data.event.timezone)}.`)}<form id="slot-form" data-id="${id || ''}"><div class="modal-content">${field('Slot name', 'label', slot.label, 'required maxlength="80" placeholder="Saturday · Morning"')}${field('Date', 'date', slot.date, 'required', 'date')}<div class="form-grid">${field('Starts at', 'start', slot.start, 'required', 'time')}${field('Ends at', 'end', slot.end, 'required', 'time')}</div><p class="field-help">Time slots cannot overlap. Use parallel tables to run several games at once. Split overnight play into separate dates.</p><p class="form-error" id="modal-error" role="alert"></p></div><div class="modal-footer">${id ? `<button type="button" class="button text-button danger-text" data-action="delete-slot" data-id="${id}">${icon('trash')}Delete slot</button>` : '<span></span>'}<div class="button-group">${btn('Cancel', 'close-modal', 'button')}<button class="button primary">Save time slot</button></div></div></form>`);
}
async function loadPlayer() {
  data = await api('/api/event');
  savedResponse = null; assignments = [];
  playerToken = storageGet(`tabletop-response-${data.event.id}`);
  if (playerToken) {
    try { const result = await api('/api/response', undefined, { headers: { Authorization: `Bearer ${playerToken}` } }); savedResponse = result.response; assignments = result.assignments; }
    catch (error) { if (error.status !== 404) throw error; playerToken = null; storageRemove(`tabletop-response-${data.event.id}`); }
  }
  playerName = savedResponse?.name || '';
  playerGm = savedResponse?.gm || '';
  picks = (savedResponse?.preferences || []).filter((id) => data.games.some((g) => g.id === id));
  availability = savedResponse ? savedResponse.availability.filter((id) => data.slots.some((s) => s.id === id)) : data.slots.map((s) => s.id);
  submitted = !!savedResponse;
  renderPlayer();
}
function renderPlayer() {
  document.title = `${data.event.name} · Choose your adventure`;
  $('#app').innerHTML = `<div class="player-page"><header class="public-header"><a class="brand" href="/play">${brand()}</a><div class="public-header-right"><span class="quiet">A SEAT AT THE TABLE</span>${themeButton()}</div></header><main id="main" class="player-main"><section class="player-hero"><div class="hero-copy"><div class="eyebrow">YOUR NEXT STORY STARTS HERE</div><h1>${esc(data.event.name)}</h1><p>${esc(data.event.description || 'New worlds, good company, and a little adventure. Tell us what you would love to play.')}</p><div class="event-meta"><span>${icon('calendar')}${esc(eventDates())}</span>${data.event.location ? `<span>${icon('pin')}${esc(data.event.location)}</span>` : ''}</div><div class="hero-tags">${tag(`${plural(data.games.length, 'game')} to discover`, 'purple')}${tag(data.event.mode === 'rotation' ? 'A new adventure each round' : 'One session per player')}${tag(data.event.acceptingResponses ? 'Preferences open' : 'Preferences closed', data.event.acceptingResponses ? 'green' : '')}</div></div><div class="hero-art" aria-hidden="true"><div class="hero-ring"></div><div class="hero-dice">${icon('dice')}</div><span class="hero-star one">✧</span><span class="hero-star two">✦</span><span class="hero-star three">✧</span><span class="hero-caption">GOOD COMPANY. GREAT STORIES.</span></div></section>
    ${data.event.sample ? '<div class="notice sample-notice">You’re exploring a sample event. The organizers can replace these adventures before opening their own gathering.</div>' : ''}
    ${data.published ? publishedPlayer() : submitted ? confirmationPlayer() : !data.event.acceptingResponses ? `<section class="panel">${empty('The party is being assembled', 'Preferences are closed while the organizers prepare the schedule. Come back to this link for updates.')}</section>` : questionnaire()}
    </main><footer class="public-footer"><span>Made for the people around your table.</span><a href="/organizer">Organizer workspace ${icon('arrow')}</a></footer></div>`;
}
function questionnaire() {
  if (!data.games.length || !data.slots.length) return `<section class="panel">${empty('A gathering in the making', 'The organizers are still adding games and dates. Check back soon to choose your adventure.')}</section>`;
  return `<form id="player-form" class="questionnaire"><div class="questionnaire-content"><section class="player-section" id="your-details"><div class="numbered-title"><span>01</span><div><h2>First, who’s joining us?</h2><p>A name the organizers will recognize. No account needed.</p></div></div>${field('Your name', 'name', playerName, 'required maxlength="80" autocomplete="name" placeholder="What should we call you?"')}<label class="field"><span>Also running a game? <span class="optional">optional</span></span><select name="gm"><option value="">I’m joining as a player</option>${[...new Set(data.games.map((g) => g.gm))].map((gm) => `<option value="${esc(gm)}" ${playerGm === gm ? 'selected' : ''}>I’m ${esc(gm)}</option>`).join('')}</select></label><p class="field-help">Select your GM identity so we don’t seat you while you’re running a game.</p></section><section class="player-section" id="your-games"><div class="numbered-title"><span>02</span><div><h2>Choose your adventures</h2><p>Rank the games you’d enjoy. 1 is your first choice. Leave games you don’t want unranked.</p></div></div><div class="player-game-list">${data.games.map((g, i) => `<article class="player-game"><div class="player-game-top"><div class="game-emblem tone-${i % 6}">${icon('dice')}</div><div><div class="game-title-line"><h3>${esc(g.title)}</h3>${g.system ? tag(g.system) : ''}</div>${g.adventure ? `<div class="adventure">${esc(g.adventure)}</div>` : ''}</div></div>${g.summary ? `<p class="game-summary">${esc(g.summary)}</p>` : ''}<div class="player-game-meta"><span>${icon('people')}${esc(g.gm)} · GM</span><span>${g.minPlayers}–${g.maxPlayers} players</span></div>${g.slotIds.length ? `<p class="game-availability">Available: ${esc(g.slotIds.map((id) => data.slots.find((s) => s.id === id)?.label || 'No current slot').join(', '))}</p>` : ''}${g.description ? `<details class="description"><summary>More about this adventure</summary><p>${esc(g.description)}</p></details>` : ''}<div class="rank-control"><label for="rank-${g.id}">Your preference</label><select id="rank-${g.id}" data-rank="${g.id}" aria-label="Preference for ${esc(g.title)}">${rankOptions(g.id)}</select></div></article>`).join('')}</div></section><section class="player-section" id="your-time"><div class="numbered-title"><span>03</span><div><h2>When can you play?</h2><p>Choose every slot you can join. All times are in ${esc(data.event.timezone)}.</p></div></div><fieldset class="player-availability"><legend class="sr-only">Your available time slots</legend>${data.slots.map((s) => `<label class="availability-card"><input type="checkbox" name="availability" value="${s.id}" ${availability.includes(s.id) ? 'checked' : ''}><span><strong>${esc(s.label)}</strong><small>${dateLabel(s.date, true)} · ${s.start}–${s.end}</small></span>${icon('calendar')}</label>`).join('')}</fieldset></section></div><aside class="player-summary"><div class="summary-inner"><div class="eyebrow">YOUR ADVENTURE WISHLIST</div><h2>A little of what you love.</h2><p>We’ll use your choices to find you a good seat. More choices give us more possibilities.</p><div id="picked-list">${pickedList()}</div><div class="summary-note">${icon('sliders')}<span>Preferences guide the plan. A particular game or seat isn’t guaranteed.</span></div><p class="form-error" id="player-error" role="alert"></p><button class="button primary submit-preferences">${savedResponse ? 'Update my preferences' : 'Send my preferences'}${icon('arrow')}</button><p class="privacy-note">Only the organizers see your name and choices. Your edit access is saved on this browser.</p></div></aside></form>`;
}
function rankOptions(id) {
  const rank = picks.indexOf(id) + 1;
  return `<option value="0" ${!rank ? 'selected' : ''}>Not this time</option>${data.games.map((_, i) => `<option value="${i + 1}" ${rank === i + 1 ? 'selected' : ''}>${i + 1}${i === 0 ? ' · First choice' : i === 1 ? ' · Second choice' : i === 2 ? ' · Third choice' : ' · Choice'}</option>`).join('')}`;
}
function pickedList() {
  return picks.length ? `<ol class="wishlist">${picks.map((id, i) => `<li><span>${i + 1}</span><div><strong>${esc(data.games.find((g) => g.id === id)?.title || '')}</strong><small>${i === 0 ? 'Your first choice' : `Choice ${i + 1}`}</small></div></li>`).join('')}</ol>` : `<div class="wishlist-empty">${icon('dice')}<p>Your next adventure is out there.<br>Pick a game to start your list.</p></div>`;
}
function confirmationPlayer() {
  return `<section class="panel confirmation"><span class="confirmation-check">${icon('check')}</span><div class="eyebrow">ONE STEP CLOSER TO ADVENTURE</div><h2>You’re on the list, ${esc(playerName)}.</h2><p>Your preferences are saved. The organizers will use them to bring the tables together.</p><div class="confirmation-picks">${pickedList()}</div><p class="quiet">Return to this link in the same browser to see your schedule${data.event.acceptingResponses ? ' or update your preferences' : ''}.</p><div class="button-group">${data.event.acceptingResponses ? btn('Edit my preferences', 'edit-preferences', 'button primary', 'edit') : tag('Preferences are now closed')}${btn('Check for updates', 'refresh-player', 'button')}</div></section>`;
}
function publishedPlayer() {
  return `${savedResponse ? `<section class="panel my-schedule"><div class="section-heading"><div><div class="eyebrow">YOUR ADVENTURE AWAITS</div><h2>Here’s your plan, ${esc(savedResponse.name)}.</h2><p>All times are in ${esc(data.event.timezone)}.</p></div>${tag('Schedule published', 'green')}</div>${assignments.length ? `<div class="my-assignments">${assignments.map((s) => {
    const game = data.games.find((g) => g.id === s.gameId), slot = data.slots.find((item) => item.id === s.slotId);
    return `<article><span class="eyebrow">${dateLabel(slot.date)} · ${esc(slot.start)}–${esc(slot.end)}</span><h3>${esc(game.title)}</h3><p>Table ${s.table} · GM ${esc(game.gm)}</p></article>`;
  }).join('')}</div>` : '<div class="notice warning">We couldn’t find a seat for your choices this time. Please contact the organizers about open places.</div>'}</section>` : '<div class="notice">The schedule is live. If you submitted preferences, use the same browser and device to see your personal assignments. The organizers can also look them up for you.</div>'}<div class="section-heading outside"><div><h2>The gathering, at a glance</h2><p>Everyone’s adventures. Player names are only visible to the organizers.</p></div>${btn('Refresh', 'refresh-player', 'button')}</div>${scheduleGrid(data.schedule)}`;
}
async function mutate(path, input, message) {
  data = await api(`/api/admin/${path}`, input); renderOrganizer(); if (message) toast(message);
}
function downloadCsv(filename, rows) {
  // Neutralize spreadsheet formulas when exported values begin with control/formula characters.
  const cell = (value) => { let text = String(value ?? ''); if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  const blob = new Blob(['\uFEFF', rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action, id = button.dataset.id;
  try {
    if (action === 'theme') { theme = ['system', 'light', 'dark'][(['system', 'light', 'dark'].indexOf(theme) + 1) % 3]; storageSet('tabletop-theme', theme); applyTheme(); document.querySelectorAll('[data-action="theme"]').forEach((b) => { b.innerHTML = icon(theme === 'system' ? 'monitor' : theme === 'dark' ? 'moon' : 'sun'); b.title = `Theme: ${theme}. Click to change.`; b.setAttribute('aria-label', b.title); }); toast(`Theme: ${theme}`); return; }
    if (action === 'close-modal') { $('#modal').close(); return; }
    if (action === 'add-game' || action === 'edit-game') { gameModal(id); return; }
    if (action === 'add-slot' || action === 'edit-slot') { slotModal(id); return; }
    if (action === 'share') {
      const link = `${location.origin}/play`;
      showModal(`${modalHeader('A seat at the table, one link away', 'Share this questionnaire with your players.')}<div class="modal-content"><label class="field"><span>Player questionnaire link</span><input id="share-link" value="${esc(link)}" readonly></label><p class="field-help">Use your server’s public HTTPS address when inviting other people. A localhost link works only on this computer.</p><p class="field-help">${data.event.acceptingResponses ? 'The questionnaire is open for preferences.' : 'Preferences are currently closed. Reopen them in Event settings if needed.'}</p></div><div class="modal-footer"><span></span><div class="button-group"><a class="button" href="/play" target="_blank" rel="noopener">Preview ${icon('external')}</a>${btn('Copy link', 'copy-link', 'button primary', 'link')}</div></div>`); return;
    }
    if (action === 'copy-link') { try { await navigator.clipboard.writeText($('#share-link').value); toast('Player link copied.'); } catch { $('#share-link').focus(); $('#share-link').select(); toast('Select and copy the highlighted link.'); } return; }
    if (action === 'logout') { await api('/api/logout', {}); renderLogin(); return; }
    if (action === 'refresh') { data = await api('/api/admin'); renderOrganizer(); toast('You’re up to date.'); return; }
    if (action === 'refresh-player') { await loadPlayer(); toast('You’re up to date.'); return; }
    if (action === 'edit-preferences') { submitted = false; renderPlayer(); $('#player-form input[name="name"]').focus(); return; }
    if (action.startsWith('delete-')) {
      const type = action.slice(7);
      if (!confirm(`Remove this ${type}? Any generated schedule will be cleared.`)) return;
      await mutate('delete', { type, id }, `${type[0].toUpperCase() + type.slice(1)} removed.`); $('#modal').close(); return;
    }
    if (action === 'new-event') { showModal(`${modalHeader('Start a new gathering', 'This replaces the event, games, responses, and schedule on this server.')}<form id="new-event-form"><div class="modal-content"><p>Download your JSON export first if you want to keep a reference copy.</p>${field('Type NEW EVENT to continue', 'confirm', '', 'required pattern="NEW EVENT" autocomplete="off"')}<p class="form-error" id="modal-error" role="alert"></p></div><div class="modal-footer"><a class="button" href="/api/admin/backup" download>Download current event</a><button class="button primary">Create blank event</button></div></form>`); return; }
    if (action === 'sample-responses') { button.disabled = true; await mutate('sample-responses', {}, '18 sample responses added.'); return; }
    if (action === 'publish') { button.disabled = true; await mutate('publish', {}, data.published ? 'Schedule unpublished.' : 'Schedule published. Players can see their assignments on the same link.'); return; }
    if (action === 'export-responses') {
      downloadCsv('tabletop-preferences.csv', [['Player', 'Ranked preferences', 'Availability'], ...data.responses.map((r) => [r.name, r.preferences.map((id, i) => `${i + 1}. ${data.games.find((g) => g.id === id)?.title || ''}`).join(' | '), r.availability.map((id) => data.slots.find((s) => s.id === id)?.label || '').join(' | ')])]); return;
    }
    if (action === 'export-schedule') {
      downloadCsv('tabletop-schedule.csv', [['Date', 'Time zone', 'Slot', 'Start', 'End', 'Table', 'Game', 'Adventure', 'GM', 'Players'], ...data.schedule.sessions.map((s) => { const g = data.games.find((g) => g.id === s.gameId), slot = data.slots.find((slot) => slot.id === s.slotId); return [slot.date, data.event.timezone, slot.label, slot.start, slot.end, s.table, g.title, g.adventure, g.gm, s.playerIds.map((id) => data.responses.find((r) => r.id === id)?.name || '').join(' | ')]; })]); return;
    }
  } catch (error) { toast(error.message, true); button.disabled = false; }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'game-search') { search = event.target.value; $('#game-list').innerHTML = gameRows(); }
  if (event.target.name === 'name' && event.target.closest('#player-form')) playerName = event.target.value;
});
document.addEventListener('change', (event) => {
  if (event.target.name === 'gm' && event.target.closest('#player-form')) playerGm = event.target.value;
  if (event.target.dataset.rank) {
    const id = event.target.dataset.rank, rank = Number(event.target.value);
    picks = picks.filter((value) => value !== id);
    if (rank) picks.splice(Math.min(rank - 1, picks.length), 0, id);
    document.querySelectorAll('[data-rank]').forEach((select) => { select.innerHTML = rankOptions(select.dataset.rank); });
    $('#picked-list').innerHTML = pickedList();
  }
  if (event.target.name === 'availability' && event.target.closest('#player-form')) availability = [...document.querySelectorAll('[name="availability"]:checked')].map((el) => el.value);
});
document.addEventListener('submit', async (event) => {
  const form = event.target; event.preventDefault();
  const fields = new FormData(form), values = Object.fromEntries(fields);
  const submit = form.querySelector('button:not([type="button"]):last-of-type');
  if (submit) submit.disabled = true;
  const errorElement = $('#modal-error', form) || $('#player-error', form) || $('#login-error', form);
  if (errorElement) errorElement.textContent = '';
  try {
    if (form.id === 'login-form') { await api('/api/login', { password: values.password }); data = await api('/api/admin'); renderOrganizer(); window.scrollTo(0, 0); }
    if (form.id === 'game-form') {
      const selected = fields.getAll('slotIds');
      if (data.slots.length && !selected.length) throw new Error('Choose at least one time slot for this game.');
      await mutate('game', { ...values, id: form.dataset.id || undefined, minPlayers: Number(values.minPlayers), maxPlayers: Number(values.maxPlayers), runs: Number(values.runs), slotIds: selected.length === data.slots.length ? [] : selected }, 'Adventure saved.'); $('#modal').close();
    }
    if (form.id === 'slot-form') { await mutate('slot', { ...values, id: form.dataset.id || undefined }, 'Play window saved.'); $('#modal').close(); }
    if (form.id === 'settings-form') { await mutate('event', { ...values, parallelTables: Number(values.parallelTables), ensureEveryGm: fields.has('ensureEveryGm'), acceptingResponses: fields.has('acceptingResponses') }, 'Settings saved.'); }
    if (form.id === 'schedule-form') { await mutate('generate', { method: values.method }, 'Draft schedule ready to review.'); }
    if (form.id === 'new-event-form') { await mutate('new', { confirm: values.confirm }, 'A fresh gathering, ready to plan.'); $('#modal').close(); }
    if (form.id === 'player-form') {
      if (!picks.length) throw new Error('Choose at least one game you’d enjoy.');
      if (!availability.length) throw new Error('Choose at least one time slot you can join.');
      const result = await api('/api/responses', { name: values.name, gm: values.gm, preferences: picks, availability, ...(playerToken ? { token: playerToken } : {}) });
      playerToken = result.token;
      const remembered = storageSet(`tabletop-response-${data.event.id}`, playerToken);
      savedResponse = { name: values.name, gm: values.gm, preferences: picks, availability }; playerName = values.name; submitted = true; renderPlayer();
      toast(remembered ? 'Your preferences are saved. See you at the table!' : 'Saved. Browser storage is unavailable, so ask the organizers for future changes.'); window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (error) { if (errorElement) { errorElement.textContent = error.message; errorElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toast(error.message, true); }
  finally { if (submit) submit.disabled = false; }
});
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1); if (playerMode || !data?.responses || !pages[next]) return;
  page = next; renderOrganizer(); $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0);
});
$('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) $('#modal').close(); });
try {
  if (playerMode) await loadPlayer();
  else { const auth = await api('/api/auth'); if (auth.authenticated) { data = await api('/api/admin'); renderOrganizer(); } else renderLogin(); }
} catch (error) {
  $('#app').innerHTML = `<main id="main" class="loading"><h1>We couldn’t reach the table.</h1><p>${esc(error.message)}</p><a class="button" href="${playerMode ? '/play' : '/organizer'}">Try again</a></main>`;
}
