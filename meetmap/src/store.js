/**
 * MeetMap client state: identity, REST calls, WebSocket wiring.
 * The store is framework-free; UI subscribes via a simple render hook.
 */
const WS_PATH = '/api/ws';
const API = {
  create: (body) => fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  join: (code, body) => fetch(`/api/rooms/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  destination: (code, body) => fetch(`/api/rooms/${code}/destination`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  status: (code, body) => fetch(`/api/rooms/${code}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  leave: (code, body) => fetch(`/api/rooms/${code}/leave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  kick: (code, body) => fetch(`/api/rooms/${code}/kick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
};

const LS = {
  identity: 'meetmap.identity.v1',
  session: 'meetmap.session.v1',
};

export function loadIdentity() {
  try { return JSON.parse(localStorage.getItem(LS.identity)); } catch { return null; }
}
export function saveIdentity(identity) {
  try { localStorage.setItem(LS.identity, JSON.stringify(identity)); } catch { /* noop */ }
}
export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(LS.session)); } catch { return null; }
}
export function saveSession(session) {
  try { sessionStorage.setItem(LS.session, JSON.stringify(session)); } catch { /* noop */ }
}
export function clearSession() {
  try { sessionStorage.removeItem(LS.session); } catch { /* noop */ }
}

export class MeetMapClient {
  constructor({ onState, onConnection, onToast }) {
    this.onState = onState ?? (() => {});
    this.onConnection = onConnection ?? (() => {});
    this.onToast = onToast ?? (() => {});
    this.ws = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.state = { room: null, members: [], messages: [], destination: null };
  }

  // ------------------------------------------------------------------ REST
  async createRoom({ profile, shareOn }) {
    return this.#joinFlow(await API.create({ name: 'Meetup', profile, shareOn }));
  }

  async joinRoom(code, { profile, shareOn }) {
    return this.#joinFlow(await API.join(code, { profile, shareOn }));
  }

  async #joinFlow(res) {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    const data = await res.json();
    saveSession({ code: data.code, token: data.token, memberId: data.memberId });
    this.session = { code: data.code, token: data.token, memberId: data.memberId };
    this.#connect();
    return data;
  }

  async setDestination({ lat, lng, name, mode }) {
    const r = this.session;
    return API.destination(r.code, { token: r.token, lat, lng, name, mode });
  }
  async clearDestination() {
    const r = this.session;
    return API.destination(r.code, { token: r.token, clear: true });
  }
  async setStatus(kind) {
    const r = this.session;
    return API.status(r.code, { token: r.token, kind });
  }
  async sendChat(text) {
    const r = this.session;
    return API.chat ? API.chat(r.code, { token: r.token, text }) : this.#wsSend({ type: 'chat', text });
  }
  async kickMember(memberId) {
    const r = this.session;
    return API.kick(r.code, { token: r.token, memberId });
  }

  // --------------------------------------------------------------------- WS
  #connect() {
    const r = this.session;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${WS_PATH}?code=${r.code}&token=${r.token}`;
    try { this.ws?.close(); } catch { /* noop */ }
    this.#setConnection('connecting', 'connecting…');

    const ws = this.ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      this.#setConnection('online', 'live');
      this.requestShare?.(this.shareOn ?? true);
      this.#startHeartbeat();
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.type === 'state') {
        this.state = { roomName: msg.name, code: msg.code, members: msg.members, messages: msg.messages, destination: msg.destination };
        this.onState(this.state);
      } else if (msg.type === 'pong') {
        /* liveness */
      }
    });
    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws) return;
      this.#stopHeartbeat();
      if (ev.code === 4000 || ev.code === 4002) {
        this.#setConnection('closed', ev.code === 4000 ? 'you left' : 'room closed');
        this.session = null;
        this.onState(this.state);
      } else {
        this.#setConnection('offline', 'reconnecting…');
        this.websocketDown = true;
        this.reconnectTimer = setTimeout(() => this.#connect(), 2000);
      }
    });
    ws.addEventListener('error', () => { /* close handler retries */ });
  }

  #wsSend(obj) {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  setSharing(on) {
    this.shareOn = on;
    return this.#wsSend({ type: 'share', on });
  }
  pushLocation(fix) {
    return this.#wsSend({ type: 'loc', ...fix });
  }
  setState(kind) {
    return API.status?.(this.session?.code, { token: this.session?.token, kind }) && true;
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.#wsSend({ type: 'ping' }), 25_000);
  }
  #stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }
  #setConnection(kind, text) {
    this.onConnection({ kind, text });
  }

  async leave() {
    const r = this.session;
    clearInterval(this.reconnectTimer);
    try { await API.leave(r?.code, { token: r?.token }); } catch { /* noop */ }
    try { this.ws?.close(); } catch { /* noop */ }
    this.session = null;
    clearSession();
  }
}
