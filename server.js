// Cave Craft server: serves the game, hosts many worlds ("rooms") at once, runs each world's
// simulation, stores player profiles and progression, and handles invites and moderation.
// Usage: npm install && npm start   (then open http://localhost:3000)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ServerWorld } from './server/serverworld.js';
import { Sim } from './public/js/sim/sim.js';
import { MODES, defaultRules, RULES } from './public/js/sim/rules.js';
import { newProfile, levelFromXp } from './public/js/sim/progression.js';
import { BIOME_NAMES } from './public/js/consts.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT) || 3000;
const SERVER_NAME = (process.env.SERVER_NAME || `${os.hostname()}'s Cave Craft server`).slice(0, 48);
const MAX_ROOMS = 50, ROOMS_PER_OWNER = 3;
fs.mkdirSync(path.join(DATA, 'rooms'), { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const code = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('');
const cleanName = n => String(n || 'Caver').replace(/[^\w \-]/g, '').trim().slice(0, 16) || 'Caver';
const cleanText = (t, n) => String(t || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const seedFrom = t => { t = String(t || '').trim(); if (!t) return crypto.randomInt(2 ** 31); if (/^-?\d+$/.test(t)) return Number(t) | 0; let h = 2166136261; for (const c of t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h | 0; };

/* ------------------------------------------------------------------ */
/* Profiles (progression lives here, shared by all worlds)            */
/* ------------------------------------------------------------------ */
const PROFILES_FILE = path.join(DATA, 'profiles.json');
const profiles = readJSON(PROFILES_FILE, {});
let profilesDirty = false;
function getProfile(id, secret, name) {
  if (typeof id !== 'string' || !/^[\w-]{8,64}$/.test(id) || typeof secret !== 'string' || secret.length < 16) return { error: 'Bad identity.' };
  let p = profiles[id];
  if (!p) { p = profiles[id] = { ...newProfile(id, name), secret: sha(secret) }; profilesDirty = true; }
  else if (p.secret !== sha(secret)) return { error: 'That profile belongs to someone else.' };
  p.name = name; p.lastSeen = Date.now(); profilesDirty = true;
  return { profile: p };
}

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */
const rooms = new Map(); // id -> { meta, sim, world, players: Map(conn -> p) }
const roomDir = id => path.join(DATA, 'rooms', id);

function surveyBiomes(seed) {
  // what a world looks like around spawn, for the browser's biome filter
  const ws = new ServerWorld(seed, path.join(os.tmpdir(), 'cc-survey'));
  const s = ws.terrain.findSpawn();
  const counts = {};
  for (let r = 0; r <= 900; r += 75) for (let a = 0; a < 12; a++) {
    const b = ws.terrain.column(Math.round(s.x + Math.cos(a / 12 * 6.28) * r), Math.round(s.z + Math.sin(a / 12 * 6.28) * r)).biome;
    counts[b] = (counts[b] || 0) + 1;
  }
  return { spawn: s, spawnBiome: ws.terrain.column(Math.floor(s.x), Math.floor(s.z)).biome, biomes: Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a]) };
}

function createRoom({ name, seed, mode, visibility, rules, owner, description, maxPlayers }) {
  const id = 'r' + Date.now().toString(36) + crypto.randomInt(1000);
  const s = seedFrom(seed);
  const survey = surveyBiomes(s);
  const meta = {
    id, name: cleanText(name, 32) || 'Unnamed world', description: cleanText(description, 120), seed: s, mode: MODES[mode] ? mode : 'survival',
    visibility: ['public', 'unlisted', 'private'].includes(visibility) ? visibility : 'public',
    rules: { ...defaultRules(mode), ...(rules || {}) }, ownerId: owner?.id || 'server', ownerName: owner?.name || 'Server',
    roles: owner ? { [owner.id]: 'owner' } : {}, names: owner ? { [owner.id]: owner.name } : {},
    bans: {}, ipBans: {}, invites: {}, whitelist: [], whitelistNames: [], mutes: {}, created: Date.now(),
    maxPlayers: Math.max(2, Math.min(32, maxPlayers | 0 || 16)), spawn: { x: survey.spawn.x, y: null, z: survey.spawn.z },
    spawnBiome: survey.spawnBiome, biomes: survey.biomes,
  };
  for (const k of Object.keys(meta.rules)) if (!RULES.find(r => r.id === k)) delete meta.rules[k];
  fs.mkdirSync(roomDir(id), { recursive: true });
  writeJSON(path.join(roomDir(id), 'meta.json'), meta);
  rooms.set(id, { meta, sim: null, world: null, players: new Map(), emptySince: Date.now() });
  return rooms.get(id);
}

function loadRooms() {
  for (const id of fs.readdirSync(path.join(DATA, 'rooms'))) {
    const meta = readJSON(path.join(roomDir(id), 'meta.json'), null);
    if (meta) rooms.set(id, { meta, sim: null, world: null, players: new Map(), emptySince: Date.now() });
  }
  if (!rooms.size) {
    const seed = process.env.SEED;
    createRoom({ name: 'The Commons', seed, mode: 'survival', visibility: 'public', description: 'A shared survival world for everyone on this server.' });
    createRoom({ name: 'Trail Grounds', mode: 'race', visibility: 'public', description: 'Sprint Trail races every few minutes.' });
    createRoom({ name: 'Rush Fields', mode: 'harvest', visibility: 'public', description: 'Gather Rush: grab the listed materials first.' });
    createRoom({ name: 'Glimmer Arena', mode: 'arena', visibility: 'public', description: 'Floating-platform battles. Last one standing wins.' });
    console.log('Created the starting worlds.');
  }
}

function saveMeta(room) { writeJSON(path.join(roomDir(room.meta.id), 'meta.json'), room.meta); }
function audit(room, line) { fs.appendFile(path.join(roomDir(room.meta.id), 'moderation.log'), `${new Date().toISOString()} ${line}\n`, () => {}); }

// start the simulation the first time someone joins
function wake(room) {
  if (room.sim) return;
  const meta = room.meta;
  const saved = readJSON(path.join(roomDir(meta.id), 'state.json'), {});
  const early = [];
  room.world = new ServerWorld(meta.seed, roomDir(meta.id), m => room.sim ? room.sim.onChunk(m) : early.push(m));
  const sp = meta.spawn;
  room.world.keepAround([sp], 2, 1e9);
  if (sp.y == null) { sp.y = room.world.surfaceY(sp.x, sp.z); saveMeta(room); }
  room.sim = new Sim(room.world, {
    seed: meta.seed, mode: meta.mode, rules: meta.rules, spawn: sp, saved, local: false,
    host: {
      kick: (p, reason) => kick(room, p, reason),
      ban: (p, reason, by) => ban(room, p, reason, by),
      unban: (name, by) => unban(room, name, by),
      saveProfile: () => { profilesDirty = true; },
      audit: line => audit(room, line),
      setRole: (pid, role, name) => { room.meta.roles[pid] = role; room.meta.names[pid] = name; saveMeta(room); },
      setMute: (p, until) => { room.meta.mutes[p.profileId] = until; saveMeta(room); },
      saveRules: rules => { room.meta.rules = { ...rules }; saveMeta(room); },
      invite: (p, name) => invite(room, p, name),
    },
  });
  // villages in chunks generated before the sim existed
  for (const m of early) room.sim.onChunk(m);
  console.log(`Started world "${meta.name}" (${meta.mode}).`);
}

function sleepRoom(room) {
  if (!room.sim) return;
  saveRoom(room);
  room.sim = null; room.world = null;
}

function saveRoom(room) {
  if (!room.sim) return;
  room.world.save();
  writeJSON(path.join(roomDir(room.meta.id), 'state.json'), room.sim.serialize());
}

function roleOf(room, pid) { return room.meta.roles[pid] || 'visitor'; }

function canEnter(room, conn, invite) {
  const m = room.meta, pid = conn.profile.id;
  if (m.bans[pid] || m.ipBans[conn.ip]) return 'You are banned from this world.';
  const role = roleOf(room, pid);
  if (room.players.size >= m.maxPlayers && role === 'visitor') return 'This world is full.';
  if (m.visibility === 'private' && role === 'visitor' && !m.whitelist.includes(pid)) {
    if (invite && m.invites[invite]) { m.invites[invite].uses = (m.invites[invite].uses || 0) + 1; m.whitelist.push(pid); saveMeta(room); return null; }
    if (m.whitelistNames.includes(conn.profile.name.toLowerCase())) { m.whitelist.push(pid); saveMeta(room); return null; }
    return 'This world is invite-only. Ask the owner for an invite code.';
  }
  return null;
}

function kick(room, p, reason) {
  const conn = [...room.players.keys()].find(c => c.player === p);
  if (!conn) return;
  send(conn, { t: 'kicked', reason });
  leaveRoom(conn);
  room.sim?.sysAll(`${p.name} was removed from the world.`);
}
function ban(room, p, reason, by) {
  room.meta.bans[p.profileId] = { name: p.name, reason: cleanText(reason, 80), by: by?.name, at: Date.now() };
  const conn = [...room.players.keys()].find(c => c.player === p);
  if (conn) room.meta.ipBans[conn.ip] = p.profileId;
  saveMeta(room);
  audit(room, `${by?.name} banned ${p.name}: ${reason}`);
  kick(room, p, `Banned by ${by?.name || 'a moderator'}${reason ? `: ${reason}` : ''}`);
}
function unban(room, name, by) {
  const m = room.meta;
  const entry = Object.entries(m.bans).find(([, b]) => b.name.toLowerCase() === String(name || '').toLowerCase());
  const p = by && room.sim?.players.get(by.id);
  if (!entry) { if (p) room.sim.sys(p, `Nobody called "${name}" is banned.`); return; }
  delete m.bans[entry[0]];
  for (const [ip, pid] of Object.entries(m.ipBans)) if (pid === entry[0]) delete m.ipBans[ip];
  saveMeta(room);
  audit(room, `${by?.name} unbanned ${entry[1].name}`);
  if (p) room.sim.sys(p, `${entry[1].name} can join again.`);
}
function invite(room, p, name) {
  const c = code();
  room.meta.invites[c] = { by: p.name, at: Date.now(), uses: 0 };
  if (name) room.meta.whitelistNames.push(name.toLowerCase());
  saveMeta(room);
  room.sim.sys(p, `Invite code ${c}${name ? ` (and ${name} can now join by name)` : ''}. Share the link from World settings, or tell friends to enter the code in the server browser.`);
  room.sim.send(p, { t: 'invite', code: c, room: room.meta.id });
}

function roomListing(room, forProfile) {
  const m = room.meta;
  return {
    id: m.id, name: m.name, description: m.description, mode: m.mode, modeName: MODES[m.mode].name, visibility: m.visibility,
    players: room.players.size, max: m.maxPlayers, owner: m.ownerName, biomes: m.biomes, spawnBiome: m.spawnBiome,
    biomeNames: m.biomes.map(b => BIOME_NAMES[b]), rules: { pvp: m.rules.pvp, hostiles: m.rules.hostiles, visitorsBuild: m.rules.visitorsBuild },
    yours: forProfile ? m.roles[forProfile] === 'owner' : false, created: m.created,
  };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
function wrapPage(src) {
  const cut = src.indexOf('<canvas');
  return `<!doctype html>\n<html lang="en"><head>\n${cut > 0 ? src.slice(0, cut) : ''}</head><body>\n${cut > 0 ? src.slice(cut) : src}</body></html>`;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ game: 'cave-craft', version: 3, name: SERVER_NAME, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.players.size, 0) }));
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    const list = [...rooms.values()].filter(r => r.meta.visibility === 'public').map(r => roomListing(r));
    res.end(JSON.stringify({ server: SERVER_NAME, rooms: list }));
    return;
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    if (ext === '.html' && !/^\s*<!doctype/i.test(data.toString('utf8', 0, 20))) res.end(wrapPage(data.toString('utf8')));
    else res.end(data);
  });
});

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024, perMessageDeflate: { threshold: 1024 } });
let nextConn = 1;
const send = (conn, m) => { if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(m)); };

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const conn = { id: `p${nextConn++}`, ws, ip, profile: null, room: null, player: null, rate: 0, rateT: Date.now(), chunkReqs: 0 };
  ws.on('message', raw => {
    // flood protection
    const now = Date.now();
    if (now - conn.rateT > 1000) { conn.rateT = now; conn.rate = 0; conn.chunkReqs = Math.max(0, conn.chunkReqs - 8); }
    if (++conn.rate > 250) { send(conn, { t: 'kicked', reason: 'Too many messages.' }); ws.close(); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(conn, m); } catch (err) { console.error('message error', err); }
  });
  ws.on('close', () => leaveRoom(conn));
});

function handle(conn, m) {
  if (m.t === 'hello') {
    const r = getProfile(m.profileId, m.secret, cleanName(m.name));
    if (r.error) { send(conn, { t: 'error', code: 'identity', message: r.error }); return; }
    conn.profile = r.profile; conn.name = r.profile.name; conn.avatar = m.avatar;
    send(conn, { t: 'hello', server: SERVER_NAME, profile: publicProfile(r.profile) });
    return;
  }
  if (!conn.profile) return;
  switch (m.t) {
    case 'rooms': {
      const list = [...rooms.values()].filter(r => r.meta.visibility === 'public' || r.meta.roles[conn.profile.id] || r.meta.whitelist.includes(conn.profile.id)).map(r => roomListing(r, conn.profile.id));
      send(conn, { t: 'rooms', rooms: list, server: SERVER_NAME });
      return;
    }
    case 'create': {
      const owned = [...rooms.values()].filter(r => r.meta.ownerId === conn.profile.id).length;
      if (owned >= ROOMS_PER_OWNER) return send(conn, { t: 'error', message: `You can own up to ${ROOMS_PER_OWNER} worlds on this server.` });
      if (rooms.size >= MAX_ROOMS) return send(conn, { t: 'error', message: 'This server has no room for more worlds.' });
      const room = createRoom({ ...m, owner: { id: conn.profile.id, name: conn.profile.name } });
      send(conn, { t: 'created', room: roomListing(room, conn.profile.id) });
      return;
    }
    case 'join': {
      const room = rooms.get(m.room) || (m.invite ? [...rooms.values()].find(r => r.meta.invites[String(m.invite).toUpperCase()]) : null);
      if (!room) return send(conn, { t: 'error', message: 'That world doesn\'t exist (any more).' });
      const why = canEnter(room, conn, m.invite && String(m.invite).toUpperCase());
      if (why) return send(conn, { t: 'error', message: why });
      leaveRoom(conn);
      wake(room);
      conn.room = room;
      room.meta.names[conn.profile.id] = conn.profile.name;
      const p = room.sim.join({
        id: conn.id, profileId: conn.profile.id, name: conn.profile.name, profile: conn.profile, avatar: conn.avatar,
        role: roleOf(room, conn.profile.id), mutedUntil: room.meta.mutes[conn.profile.id] || 0, ip: conn.ip,
        send: msg => send(conn, msg),
      });
      conn.player = p;
      room.players.set(conn, p);
      room.emptySince = 0;
      send(conn, { t: 'roomInfo', room: roomListing(room, conn.profile.id), modified: [...room.world.modified], admin: adminView(room, p) });
      return;
    }
    case 'leaveRoom': leaveRoom(conn); send(conn, { t: 'left' }); return;
    case 'chunk': {
      if (!conn.room || ++conn.chunkReqs > 400) return;
      const { cx, cz } = m;
      if (!Number.isInteger(cx) || !Number.isInteger(cz)) return;
      const data = conn.room.world.chunkData(cx, cz);
      send(conn, { t: 'chunk', cx, cz, data: data ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64') : null });
      return;
    }
    case 'roomAdmin': return roomAdmin(conn, m);
  }
  if (conn.room && conn.player) conn.room.sim.handle(conn.player, m);
}

function publicProfile(p) {
  return { id: p.id, name: p.name, xp: p.xp, skills: p.skills, achievements: p.achievements, stats: p.stats, level: levelFromXp(p.xp || 0).level };
}

function adminView(room, p) {
  if (!['owner', 'mod'].includes(p.role)) return null;
  const m = room.meta;
  return {
    visibility: m.visibility, rules: m.rules, maxPlayers: m.maxPlayers, name: m.name, description: m.description,
    invites: Object.entries(m.invites).map(([c, v]) => ({ code: c, ...v })),
    bans: Object.entries(m.bans).map(([id, b]) => ({ id, ...b })),
    roles: Object.entries(m.roles).map(([id, role]) => ({ id, role, name: m.names[id] || id })),
    owner: p.role === 'owner',
  };
}

function roomAdmin(conn, m) {
  const room = conn.room, p = conn.player;
  if (!room || !p || !['owner', 'mod'].includes(p.role)) return;
  const meta = room.meta, owner = p.role === 'owner';
  switch (m.op) {
    case 'invite': invite(room, p, m.name ? cleanName(m.name) : null); break;
    case 'revoke': delete meta.invites[m.code]; break;
    case 'unban': unban(room, m.name, p); break;
    case 'visibility': if (owner && ['public', 'unlisted', 'private'].includes(m.value)) meta.visibility = m.value; break;
    case 'rename': if (owner) { meta.name = cleanText(m.name, 32) || meta.name; meta.description = cleanText(m.description, 120); } break;
    case 'max': if (owner) meta.maxPlayers = Math.max(2, Math.min(32, m.value | 0)); break;
    case 'rules': if (owner) room.sim.setRules(m.rules || {}, p); break;
    case 'role': {
      const role = m.role;
      if (!['visitor', 'builder', 'mod'].includes(role) || (role === 'mod' && !owner)) break;
      if (meta.roles[m.id] === 'owner' || (meta.roles[m.id] === 'mod' && !owner)) break;
      if (role === 'visitor') delete meta.roles[m.id]; else meta.roles[m.id] = role;
      const live = [...room.sim.players.values()].find(q => q.profileId === m.id);
      if (live) room.sim.setRole(live, role, p);
      break;
    }
    case 'delete': {
      if (!owner) break;
      for (const c of [...room.players.keys()]) { send(c, { t: 'kicked', reason: 'The owner deleted this world.' }); leaveRoom(c); }
      rooms.delete(meta.id);
      fs.rmSync(roomDir(meta.id), { recursive: true, force: true });
      send(conn, { t: 'left' });
      return;
    }
  }
  saveMeta(room);
  for (const [c, q] of room.players) { const v = adminView(room, q); if (v) send(c, { t: 'admin', admin: v, room: roomListing(room, c.profile.id) }); }
}

function leaveRoom(conn) {
  const room = conn.room;
  if (!room) return;
  room.sim?.leave(conn.player);
  room.players.delete(conn);
  conn.room = null; conn.player = null;
  if (!room.players.size) room.emptySince = Date.now();
}

/* ------------------------------------------------------------------ */
/* Simulation loop and saving                                          */
/* ------------------------------------------------------------------ */
let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const room of rooms.values()) {
    if (!room.sim) continue;
    if (!room.players.size) { if (now - room.emptySince > 120000) sleepRoom(room); continue; }
    // one broken world must never stop the others
    try {
      const pts = [...room.sim.players.values()];
      room.world.keepAround(pts, 4, 20);
      room.sim.tick(dt);
    } catch (err) {
      room.errors = (room.errors || 0) + 1;
      if (room.errors < 5 || room.errors % 1000 === 0) console.error(`world "${room.meta.name}" error:`, err);
    }
  }
}, 50);

function saveAll() {
  for (const room of rooms.values()) saveRoom(room);
  if (profilesDirty) { writeJSON(PROFILES_FILE, profiles); profilesDirty = false; }
}
setInterval(saveAll, 30000);
function shutdown() { saveAll(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

loadRooms();
server.listen(PORT, () => {
  console.log(`\n${SERVER_NAME} is running with ${rooms.size} world(s).`);
  console.log(`  This computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  Same network:   http://${a.address}:${PORT}`);
  }
  console.log(`Data is stored in ${DATA}. Press Ctrl+C to stop (everything is saved).\n`);
});

