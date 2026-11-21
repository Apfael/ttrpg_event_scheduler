import { generateSchedule } from './scheduler.js';

const ACTIONS = {
  '/api/auth': 'status', '/api/setup': 'setup', '/api/login': 'login', '/api/logout': 'logout',
  '/api/event': 'event', '/api/response': 'my-response', '/api/responses': 'respond',
  '/api/admin': 'admin', '/api/admin/event': 'event-save', '/api/admin/game': 'game-save',
  '/api/admin/slot': 'slot-save', '/api/admin/delete': 'delete', '/api/admin/publish': 'publish', '/api/admin/new': 'new-event',
  '/api/admin/events': 'events', '/api/admin/create': 'event-create',
};
export class SharedPlanner {
  constructor(endpoint = 'api.php', transport = globalThis.fetch.bind(globalThis)) {
    this.endpoint = endpoint; this.transport = transport; this.csrf = null; this.state = null; this.event = null;
    this.eventId = new URLSearchParams(globalThis.location?.search || '').get('event');
  }
  async call(action, input, options = {}) {
    let response;
    const extraHeaders = { ...options.headers };
    if (extraHeaders.Authorization) { extraHeaders['X-Tabletop-Response'] = extraHeaders.Authorization; delete extraHeaders.Authorization; }
    try {
      const query = new URLSearchParams({ action });
      if (this.eventId) query.set('event', this.eventId);
      response = await this.transport(`${this.endpoint}?${query}`, {
        credentials: 'same-origin', cache: 'no-store', ...options,
        headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json', 'X-Tabletop-CSRF': this.csrf || '' }), ...extraHeaders },
        ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
      });
    } catch { throw new Error('Cannot reach the event server. Check your connection and try again.'); }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('This host is not running the PHP save handler. Upload the app to PHP-enabled web hosting.'); }
    if (!response.ok) { const error = new Error(result.error || 'The server could not save this change.'); error.status = response.status; throw error; }
    if (result.csrf) this.csrf = result.csrf;
    return result;
  }
  async request(path, input, options = {}) {
    if (!this.csrf && path !== '/api/auth') await this.call('status');
    if (path === '/api/admin/generate') {
      const state = await this.call('admin');
      if (state.event.acceptingResponses) throw new Error('Close preferences before generating a schedule.');
      const schedule = generateSchedule(state, state.event.assignmentMethod);
      this.state = await this.call('schedule-save', { schedule, expectedRevision: state.revision });
      return this.state;
    }
    const action = ACTIONS[path]; if (!action) throw new Error('Unknown app action.');
    let body = input;
    if (path.startsWith('/api/admin/') && input !== undefined) body = { ...input, expectedRevision: this.state?.revision ?? -1, expectedDefinitionRevision: this.state?.definitionRevision ?? -1 };
    if (path === '/api/responses') body = { ...input, eventId: this.event?.event.id, definitionRevision: this.event?.definitionRevision };
    const result = await this.call(action, body, options);
    if (path === '/api/admin/create') this.eventId = result.event.id;
    if (path === '/api/event') this.event = result;
    if (path === '/api/admin' || path.startsWith('/api/admin/')) this.state = result;
    return result;
  }
}
