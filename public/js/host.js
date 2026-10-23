// How the game talks to the world brain. Both hosts accept the same messages and emit the
// same events, so the rest of the game doesn't care whether it is online or not.
//   LocalHost  - single-player: runs the Sim inside this page (and can open the world to friends)
//   RemoteHost - online: talks to a Cave Craft server over a WebSocket
//   PeerHost   - joins a friend's browser-hosted world over WebRTC (peer to peer, no server)
import { Sim } from './sim/sim.js';
import { newProfile, levelFromXp } from './sim/progression.js';

const PEER_PREFIX = 'cavecraft3-';
const MAX_GUESTS = 7;

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
    this.guests = new Map(); // connection id -> { id, conn, profileId, player }
    this.bans = new Set(); this.roles = {};
    this.gn = 0; this.peer = null; this.code = null;
    this.sim = new Sim(world, {
      seed, mode, rules, spawn, saved, local: true,
      host: {
        audit: () => {},
        saveProfile: p => this.saveProfileFor(p),
        kick: (p, reason) => this.kickGuest(p, reason),
        ban: (p, reason, by) => { if (p.profileId) this.bans.add(p.profileId); this.kickGuest(p, `Banned by ${by?.name || 'the host'}${reason ? `: ${reason}` : ''}`); },
        setRole: (pid, role) => { this.roles[pid] = role; },
      },
    });
    this.queue = [];
    this.player = null;
    this.name = name; this.avatar = avatar;
  }
  saveProfileFor(p) {
    if (p.id === 'local') return saveLocalProfile(p);
    const g = [...this.guests.values()].find(x => x.profileId === p.id);
    if (g) this.sendTo(g, { t: 'saveProfile', profile: p });
  }
  start() {
    // messages to the player are delivered on the next frame, like a network would
    this.player = this.sim.join({ id: 'me', profileId: 'local', name: this.name, profile: this.profile, avatar: this.avatar, role: 'owner', exempt: true, send: m => this.queue.push(m) });
    return this.flush();
  }
  flush() { const q = this.queue; this.queue = []; let welcome = null; for (const m of q) { if (m.t === 'welcome') welcome = m; else this.emit(m); } return welcome; }
  send(m) { if (this.player) this.sim.handle(this.player, m); }
  tick(dt) { this.sim.tick(dt); this.flush(); }
  onChunk(meta) { this.sim.onChunk(meta); }
  serialize() { return this.sim.serialize(); }
  close() { this.closeRoom(); }

  /* ---- opening this world to friends ---- */
  // Resolves with the join code. Friends use it on the title screen (or open the link with ?join=CODE).
  async openRoom(roomName) {
    if (this.peer) return this.code;
    const Peer = window.Peer;
    if (!Peer) throw new Error('The peer-to-peer library did not load.');
    this.roomName = roomName || 'Friend world';
    for (let tries = 0; tries < 6; tries++) {
      const code = makeCode();
      try {
        await new Promise((resolve, reject) => {
          const peer = new Peer(PEER_PREFIX + code, peerOptions());
          const timer = setTimeout(() => { peer.destroy(); reject(new Error('The matchmaking service did not answer. Check your internet and try again.')); }, 12000);
          peer.on('open', () => { clearTimeout(timer); this.peer = peer; this.code = code; resolve(); });
          peer.on('error', e => { clearTimeout(timer); try { peer.destroy(); } catch { /* gone */ } e.type === 'unavailable-id' ? reject(Object.assign(new Error('taken'), { taken: true })) : reject(new Error(peerError(e))); });
        });
        break;
      } catch (e) { if (!e.taken) throw e; }
    }
    if (!this.peer) throw new Error('Could not reserve a code. Try again.');
    // guests can wander only as far as this page keeps the world loaded
    this.sim.local = false;
    this.sim.tetherId = 'me';
    this.sim.setRules({ spawnProtection: false });
    this.peer.on('connection', conn => this.onGuest(conn));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* closed */ } });
    return this.code;
  }
  closeRoom() {
    if (!this.peer) return;
    for (const g of this.guests.values()) { this.sendTo(g, { t: 'kicked', reason: 'The host closed the world.' }); }
    const peer = this.peer;
    this.peer = null; this.code = null;
    setTimeout(() => { for (const g of this.guests.values()) { try { g.conn.close(); } catch { /* gone */ } } this.guests.clear(); try { peer.destroy(); } catch { /* gone */ } }, 300);
    this.sim.local = true; this.sim.tetherId = null;
  }
  get hosting() { return !!this.peer; }
  sendTo(g, m) { try { if (g.conn.open) g.conn.send(m); } catch { /* connection gone */ } }
  kickGuest(p, reason) {
    const g = [...this.guests.values()].find(x => x.player === p);
    if (!g) return;
    this.sendTo(g, { t: 'kicked', reason });
    setTimeout(() => { try { g.conn.close(); } catch { /* gone */ } }, 200);
  }
  onGuest(conn) {
    const g = { id: 'g' + (++this.gn), conn, profileId: null, player: null, rate: 0, rateT: 0, name: '' };
    conn.on('data', m => {
      const now = Date.now();
      if (now - g.rateT > 1000) { g.rateT = now; g.rate = 0; }
      if (++g.rate > 300) { this.sendTo(g, { t: 'kicked', reason: 'Too many messages.' }); try { conn.close(); } catch { /* gone */ } return; }
      if (m && typeof m.t === 'string') { try { this.onGuestMessage(g, m); } catch (err) { console.error('guest message', err); } }
    });
    conn.on('close', () => this.dropGuest(g, 'closed'));
    conn.on('error', e => this.dropGuest(g, 'error ' + (e && (e.type || e.message))));
  }
  dropGuest(g, why) {
    if (why) console.warn('guest left:', g.name, why);
    if (g.player) this.sim.leave(g.player);
    g.player = null;
    this.guests.delete(g.id);
    this.emit({ t: 'guests', count: this.guests.size });
  }
  onGuestMessage(g, m) {
    switch (m.t) {
      case 'hello': {
        const pid = String(m.profileId || '');
        if (!/^[\w-]{8,64}$/.test(pid)) return this.sendTo(g, { t: 'error', message: 'Bad identity.' });
        if (this.bans.has(pid)) return this.sendTo(g, { t: 'error', message: 'You are banned from this world.' });
        if (this.guests.size >= MAX_GUESTS) return this.sendTo(g, { t: 'error', message: `This world is full (${MAX_GUESTS + 1} players).` });
        if ([...this.guests.values()].some(x => x !== g && x.profileId === pid)) return this.sendTo(g, { t: 'error', message: 'You are already in this world in another tab.' });
        g.profileId = pid;
        g.name = String(m.name || 'Guest').replace(/[^\w .'-]/g, '').slice(0, 16) || 'Guest';
        g.avatar = m.avatar; g.profile = saneProfile(m.profile, pid, g.name);
        this.guests.set(g.id, g);
        this.sendTo(g, { t: 'hello', server: this.roomName, profile: { ...g.profile, level: levelFromXp(g.profile.xp || 0).level } });
        return;
      }
      case 'join': {
        if (!g.profileId || g.player) return;
        const modified = this.modifiedList ? this.modifiedList() : [];
        this.sendTo(g, { t: 'roomInfo', room: { id: 'p2p', name: this.roomName, mode: this.sim.mode }, modified, admin: null });
        g.player = this.sim.join({
          id: g.id, profileId: g.profileId, name: g.name, profile: g.profile, avatar: g.avatar,
          role: this.roles[g.profileId] || 'visitor', send: msg => this.sendTo(g, msg),
        });
        this.emit({ t: 'guests', count: this.guests.size });
        return;
      }
      case 'leaveRoom': if (g.player) { this.sim.leave(g.player); g.player = null; } return;
      case 'chunk': {
        if (!g.player || !this.chunkProvider || !Number.isInteger(m.cx) || !Number.isInteger(m.cz)) return;
        g.chunkReqs = (g.chunkReqs || 0) + 1;
        if (g.chunkReqs > 600) return;
        this.chunkProvider(m.cx, m.cz).then(data => this.sendTo(g, { t: 'chunk', cx: m.cx, cz: m.cz, data: data ? toB64(data) : null })).catch(() => this.sendTo(g, { t: 'chunk', cx: m.cx, cz: m.cz, data: null }));
        return;
      }
      case 'roomAdmin': return;
    }
    if (g.player) this.sim.handle(g.player, m);
  }
}

function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = ''; const r = new Uint8Array(5); crypto.getRandomValues(r);
  for (const x of r) c += abc[x % abc.length];
  return c;
}
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
// never trust a guest's profile blindly: keep only the expected shapes
function saneProfile(p, id, name) {
  const base = newProfile(id, name);
  if (!p || typeof p !== 'object') return base;
  const num = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 200).map(([k, v]) => [String(k).slice(0, 32), Math.max(0, Math.min(1e9, +v || 0))]));
  return { ...base, xp: Math.max(0, Math.min(1e7, +p.xp || 0)), skills: num(p.skills), achievements: num(p.achievements), stats: num(p.stats), visited: num(p.visited) };
}
// matchmaking: PeerJS's free cloud by default; ?peerserver=host:port points at your own
function peerOptions() {
  let q = null;
  try { q = new URLSearchParams(location.search).get('peerserver'); } catch { /* no location */ }
  if (q) { const [host, port] = q.split(':'); return { host, port: +port || 9000, path: '/', secure: false, debug: 0 }; }
  return { debug: 0 };
}
function peerError(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return 'No world with that code is open right now. Check the code, and that your friend is still hosting.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the matchmaking service. Check your internet connection.';
  return 'Connection problem: ' + (t || 'unknown');
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
  clone() { return new RemoteHost(this.base); }
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

/* ------------------------------------------------------------------ */
// joins a friend's world: same messages as RemoteHost, carried over WebRTC
export class PeerHost extends RemoteHost {
  constructor(code) {
    super('');
    this.code = String(code || '').trim().toUpperCase();
    this.peer = null; this.conn = null; this.isPeer = true;
  }
  clone() { return new PeerHost(this.code); }
  connect(name, avatar) {
    this.name = name; this.avatar = avatar;
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = msg => { if (!done) { done = true; try { this.peer?.destroy(); } catch { /* gone */ } reject(new Error(msg)); } };
      const Peer = window.Peer;
      if (!Peer) return fail('The peer-to-peer library did not load.');
      if (!/^[A-Z0-9]{5}$/.test(this.code)) return fail('A world code has 5 letters and numbers.');
      const timer = setTimeout(() => fail('Could not reach that world. Check the code, that your friend is still hosting, and that your network allows it.'), 20000);
      const peer = this.peer = new Peer(undefined, peerOptions());
      peer.on('error', e => { clearTimeout(timer); if (!done) fail(peerError(e)); else if (!this.closing) this.onClosed(); });
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + this.code, { serialization: 'binary', reliable: true });
        conn.on('open', () => {
          this.conn = conn;
          const id = identity();
          conn.send({ t: 'hello', profileId: id.id, name, avatar, profile: localProfile(name) });
        });
        conn.on('data', m => {
          if (!m || typeof m.t !== 'string') return;
          if (m.t === 'hello' && !done) { done = true; clearTimeout(timer); this.profile = m.profile; this.serverName = m.server; resolve(m); return; }
          if (m.t === 'error' && !done) { clearTimeout(timer); fail(m.message); return; }
          if (m.t === 'saveProfile') { saveLocalProfile(m.profile); return; }
          this.dispatch(m);
        });
        conn.on('close', () => { clearTimeout(timer); if (!done) fail('The host closed the connection.'); else this.onClosed(); });
        conn.on('error', () => { if (!done) { clearTimeout(timer); fail('Connection problem.'); } });
      });
    });
  }
  raw(m) { try { if (this.conn && this.conn.open) this.conn.send(m); } catch { /* gone */ } }
  async listRooms() { return []; }
  close() { this.closing = true; try { this.conn?.close(); } catch { /* gone */ } try { this.peer?.destroy(); } catch { /* gone */ } }
}


export { levelFromXp };
