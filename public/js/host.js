// How the game talks to the world brain. Both hosts accept the same messages and emit the
// same events, so the rest of the game doesn't care whether it is online or not.
//   LocalHost  - single-player: runs the Sim inside this page
//   RemoteHost - online: talks to a Cave Craft server over a WebSocket
import { Sim } from './sim/sim.js';
import { newProfile, levelFromXp } from './sim/progression.js';

const ID_KEY = 'cave-craft-identity';
const PROFILE_KEY = 'cave-craft-profile';

export function identity() {
  let id = null;
  try { id = JSON.parse(localStorage.getItem(ID_KEY)); } catch { /* storage blocked */ }
  if (!id || !id.id || !id.secret) {
    const rnd = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    id = { id: rnd(), secret: rnd() + rnd() };
    try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch { /* storage blocked */ }
  }
  return id;
}
export function resetIdentity() { try { localStorage.removeItem(ID_KEY); } catch { /* storage blocked */ } }

// single-player progression is stored in this browser
export function localProfile(name) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { /* storage blocked */ }
  if (!p) p = newProfile('local', name);
  p.name = name;
  return p;
}
export function saveLocalProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

class Emitter {
  constructor() { this.h = {}; }
  on(t, fn) { this.h[t] = fn; }
  emit(m) {
    if (this.held) { this.held.push(m); return; }
    const f = this.h[m.t]; if (f) f(m); else this.h['*']?.(m);
  }
  // keep messages until the game is ready for them (while a world is loading)
  hold() { this.held = this.held || []; }
  release() { const q = this.held || []; this.held = null; for (const m of q) this.emit(m); }
}

/* ------------------------------------------------------------------ */
export class LocalHost extends Emitter {
  constructor(world, { seed, mode, rules, spawn, saved, name, avatar }) {
    super();
    this.local = true;
    this.profile = localProfile(name);
    this.sim = new Sim(world, {
      seed, mode, rules, spawn, saved, local: true,
      host: { saveProfile: p => saveLocalProfile(p), audit: () => {} },
    });
    this.queue = [];
    this.player = null;
    this.name = name; this.avatar = avatar;
  }
  start() {
    // messages to the player are delivered on the next frame, like a network would
    this.player = this.sim.join({ id: 'me', profileId: 'local', name: this.name, profile: this.profile, avatar: this.avatar, role: 'owner', send: m => this.queue.push(m) });
    return this.flush();
  }
  flush() { const q = this.queue; this.queue = []; let welcome = null; for (const m of q) { if (m.t === 'welcome') welcome = m; else this.emit(m); } return welcome; }
  send(m) { if (this.player) this.sim.handle(this.player, m); }
  tick(dt) { this.sim.tick(dt); this.flush(); }
  onChunk(meta) { this.sim.onChunk(meta); }
  serialize() { return this.sim.serialize(); }
  close() {}
}

/* ------------------------------------------------------------------ */
export class RemoteHost extends Emitter {
  constructor(base = '') {
    super();
    this.local = false;
    this.base = base; // '' = this page's server, or 'http://other:3000'
    this.ws = null; this.room = null; this.welcome = null;
    this.waiters = {}; this.chunkWait = new Map();
  }
  url() {
    const b = this.base ? new URL(this.base) : location;
    return `${b.protocol === 'https:' ? 'wss' : 'ws'}://${b.host}/ws`;
  }

  // connect and identify; resolves with the player's server profile
  connect(name, avatar) {
    this.name = name; this.avatar = avatar;
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = msg => { if (!done) { done = true; reject(new Error(msg)); } };
      setTimeout(() => fail('The server did not answer.'), 6000);
      try { this.ws = new WebSocket(this.url()); } catch { fail('Could not open a connection.'); return; }
      this.ws.onopen = () => { const id = identity(); this.raw({ t: 'hello', profileId: id.id, secret: id.secret, name, avatar }); };
      this.ws.onerror = () => fail('Could not reach the server.');
      this.ws.onclose = () => { this.onClosed(); fail('Connection closed.'); };
      this.ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'hello') { done = true; this.profile = m.profile; this.serverName = m.server; resolve(m); return; }
        if (m.t === 'error' && m.code === 'identity') { resetIdentity(); fail(m.message + ' A fresh profile was made for you; please try again.'); return; }
        this.dispatch(m);
      };
    });
  }

  dispatch(m) {
    if (m.t === 'chunk') { const k = m.cx + ',' + m.cz; const w = this.chunkWait.get(k); if (w) { this.chunkWait.delete(k); w(m.data ? b64(m.data) : null); } return; }
    const w = this.waiters[m.t];
    if (w) { delete this.waiters[m.t]; w(m); return; }
    if (m.t === 'error' && this.waiters.error) { this.waiters.error(m); return; }
    this.emit(m);
  }
  wait(t, ms = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { delete this.waiters[t]; delete this.waiters.error; reject(new Error('The server took too long to answer.')); }, ms);
      this.waiters[t] = m => { clearTimeout(timer); delete this.waiters.error; resolve(m); };
      this.waiters.error = m => { clearTimeout(timer); delete this.waiters[t]; delete this.waiters.error; reject(new Error(m.message)); };
    });
  }
  raw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  send(m) { this.raw(m); }

  async listRooms() { this.raw({ t: 'rooms' }); return (await this.wait('rooms')).rooms; }
  async createRoom(opts) { this.raw({ t: 'create', ...opts }); return (await this.wait('created')).room; }
  async join(room, invite) {
    const pw = this.wait('welcome', 20000), pi = this.wait('roomInfo', 20000);
    this.raw({ t: 'join', room, invite });
    const [welcome, info] = await Promise.all([pw, pi]);
    this.room = info.room; this.welcome = welcome; this.joinArgs = { room: info.room.id, invite };
    return { welcome, info };
  }
  leave() { this.raw({ t: 'leaveRoom' }); this.room = null; }
  chunk(cx, cz) {
    return new Promise(resolve => {
      const k = cx + ',' + cz;
      this.chunkWait.set(k, resolve);
      this.raw({ t: 'chunk', cx, cz });
      setTimeout(() => { if (this.chunkWait.get(k) === resolve) { this.chunkWait.delete(k); resolve(null); } }, 8000);
    });
  }
  tick() {}
  onChunk() {}
  onClosed() { if (this.closing) return; this.emit({ t: 'disconnected' }); }
  close() { this.closing = true; try { this.ws?.close(); } catch { /* already closed */ } }
}

function b64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

// look at another server's public world list (servers allow this from any page)
export async function fetchRooms(base) {
  const url = new URL('/api/rooms', base).href;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('That server did not answer.');
  return r.json();
}

export { levelFromXp };
