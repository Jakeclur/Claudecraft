// The shared world brain. One Sim runs per world: on the server for online worlds, or inside
// the page for single-player. It owns creatures, villagers, dropped items, falling blocks,
// flowing liquids, machines, time and weather, competitive rounds, progression, permissions
// and anti-cheat. Players talk to it only through messages, so every player sees the same thing.
import { B, I, BLOCKS, ITEMS, KIND, IS_SOLID, WATERY, LIQ_TYPE } from '../blocks.js';
import { CHUNK, WH, BIOME, BIOME_NAMES } from '../consts.js';
import { Machines } from '../machines.js';
import { SMELT } from '../inventory.js';
import { moveBody } from '../physics.js';
import { Fluids } from './fluids.js';
import { dropFor, isOre, needsBetterTool } from './drops.js';
import { MOB_TYPES, makeMob, updateMob, damageMob, spawnNear, mobBox } from './mobs.js';
import { makeVillager, updateVillager, hitVillager } from './villagers.js';
import { makeVillage } from './npcdata.js';
import { Modes } from './modes.js';
import { MODES, defaultRules, RULES, ROLE_NAMES, canBuild, canModerate, canUseMachines, atLeast } from './rules.js';
import { record, XP, skillEffects, sanitizeAvatar, canLearn, SKILLS } from './progression.js';

export const DAY_LENGTH = 720;
const VIEW = 72;            // entity interest radius
const SNAP = 0.1;           // entity snapshots per player, seconds
const REACH = 7.5;

const r2 = n => Math.round(n * 100) / 100;

export class Sim {
  /*
    world: block access (client World or ServerWorld)
    opts: { seed, mode, rules, spawn, local, host, saved }
    host: { kick(p, reason), ban(p, reason, by), unban(name, by), saveProfile(profile), audit(line),
            roleOf(profileId), setRole(profileId, role, name), invite(byP, name), meta }
  */
  constructor(world, opts) {
    this.world = world;
    this.seed = opts.seed;
    this.mode = opts.mode || 'survival';
    this.rules = { ...defaultRules(this.mode), ...(opts.rules || {}) };
    this.local = !!opts.local;
    this.host = opts.host || {};
    this.saved = opts.saved || {};
    this.spawn = opts.spawn || { x: 0, y: 64, z: 0 };
    this.players = new Map();
    this.ents = new Map();
    this.nextId = 1;
    this.time = this.saved.time ?? 0.3;
    this.weather = 'clear'; this.weatherT = 200;
    this.edits = [];
    this.villages = new Map();
    this.ruins = new Map();
    this.spawnT = 0; this.envT = 0; this.exploreT = 0;
    this.fluids = new Fluids(world, (x, y, z, b) => this.setBlock(x, y, z, b, { fluid: true }));
    this.fluids.enabled = this.rules.fluids;
    this.viewers = new Map(); // machine key -> Set(player ids)
    this.machines = new Machines(world, {
      setBlock: (x, y, z, b) => this.setBlock(x, y, z, b),
      dropFor: (id, tool) => dropFor(id, tool),
      particles: () => {},
      changed: m => this.machineChanged(m),
    });
    this.machines.load(this.saved.machines);
    this.playerStates = this.saved.players || {}; // profileId -> saved per-world state
    this.modes = MODES[this.mode]?.kind === 'event' ? new Modes(this, this.mode) : null;
  }

  get creativeWorld() { return this.mode === 'creative'; }

  /* ================================================================ */
  /* Players                                                          */
  /* ================================================================ */
  join(conn) {
    // conn: { id, profileId, name, profile, role, send(msg), ip }
    const st = this.playerStates[conn.profileId] || null;
    const p = {
      ...conn, x: st?.x ?? this.spawn.x, y: st?.y ?? this.spawn.y, z: st?.z ?? this.spawn.z, yaw: 0, pitch: 0,
      avatar: sanitizeAvatar(conn.avatar || {}, conn.profile), known: new Set(), snapT: 0, viol: [], tpUntil: Date.now() + 15000,
      lastPosT: Date.now(), okPos: null, airT: 0, chat: [], digT: 0, digs: [], places: [], hitT: 0, dead: false,
      creative: this.creativeWorld, explore: new Set(st?.explored || []), freeze: false, mutedUntil: conn.mutedUntil || 0,
    };
    this.players.set(p.id, p);
    const others = [...this.players.values()].filter(o => o !== p).map(o => this.publicInfo(o));
    this.send(p, {
      t: 'welcome', id: p.id, seed: this.seed, mode: this.mode, rules: this.rules, role: p.role, time: this.time, weather: this.weather,
      players: others, state: st, spawn: this.spawn, profile: this.profileView(p),
    });
    this.broadcast({ t: 'join', ...this.publicInfo(p) }, p);
    this.sysAll(`${p.name} joined the world.`, p);
    if (this.players.size >= 4) for (const q of this.players.values()) this.award(q, { stat: 'company', max: 1 });
    return p;
  }

  publicInfo(p) { return { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, avatar: p.avatar, role: p.role, level: p.profile?.level }; }

  leave(p) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.modes?.onLeave(p);
    for (const set of this.viewers.values()) set.delete(p.id);
    for (const e of this.ents.values()) if (e.kind === 'folk' && e.talkingTo === p.id) e.talkingTo = null;
    this.broadcast({ t: 'leave', id: p.id, name: p.name });
    this.sysAll(`${p.name} left the world.`);
  }

  send(p, msg) { try { p.send(msg); } catch { /* connection gone */ } }
  broadcast(msg, except) { for (const p of this.players.values()) if (p !== except) this.send(p, msg); }
  sysAll(text, except) { this.broadcast({ t: 'sys', text }, except); }
  sys(p, text) { this.send(p, { t: 'sys', text }); }
  byName(name) {
    if (!name) return null;
    const n = name.toLowerCase();
    return [...this.players.values()].find(p => p.name.toLowerCase() === n) || [...this.players.values()].find(p => p.name.toLowerCase().startsWith(n)) || null;
  }

  teleport(p, x, y, z, freeze = false) {
    p.x = x; p.y = y; p.z = z; p.okPos = { x, y, z }; p.tpUntil = Date.now() + 3000; p.airT = 0;
    this.send(p, { t: 'tpto', x, y, z, freeze });
  }
  give(p, item, count, dur) { this.send(p, { t: 'give', item, count, dur }); }
  surfaceAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (this.world.loaded(x, z)) return this.world.surfaceY(x, z);
    return this.world.terrain.column(x, z).h + 1;
  }

  /* ================================================================ */
  /* Progression                                                      */
  /* ================================================================ */
  award(p, what) {
    if (!p.profile) return;
    const events = record(p.profile, what);
    if (events.length) {
      this.send(p, { t: 'profile', profile: this.profileView(p), events });
      for (const e of events) if (e.type === 'achievement') this.sysAll(`${p.name} earned “${e.name}”!`, p);
      this.host.saveProfile?.(p.profile);
    }
  }
  profileView(p) {
    const pr = p.profile || {};
    return { id: pr.id, name: pr.name, xp: pr.xp || 0, skills: pr.skills || {}, achievements: pr.achievements || {}, stats: pr.stats || {} };
  }
  fx(p) { return skillEffects(p.profile, this.modes?.mode === 'arena' && this.modes.isPlaying(p)); }

  /* ================================================================ */
  /* Blocks                                                           */
  /* ================================================================ */
  setBlock(x, y, z, b, o = {}) {
    if (!this.world.set(x, y, z, b, { remote: false })) return false;
    this.edits.push([x, y, z, b]);
    if (!o.fluid) this.fluids.notify(x, y, z);
    else this.fluids.notify(x, y, z);
    return true;
  }
  // build even where no player has loaded the chunk yet
  setStructure(x, y, z, b) {
    if (this.world.loaded(x, z)) return this.setBlock(x, y, z, b);
    if (this.world.ensure) { this.world.ensure(Math.floor(x / CHUNK), Math.floor(z / CHUNK)); return this.setBlock(x, y, z, b); }
    if (this.world.queueEdit) this.world.queueEdit(x, y, z, b);
    return true;
  }
  fix(p, x, y, z) { this.send(p, { t: 'fix', x, y, z, b: this.world.get(x, y, z) }); }

  near(p, x, y, z, reach = REACH) { return Math.hypot(p.x - (x + 0.5), p.y + 1.6 - (y + 0.5), p.z - (z + 0.5)) <= reach; }

  mayBuild(p, x, z) { return p.creative && this.local ? true : canBuild(p.role, this.rules, x, z, this.spawn); }

  dig(p, m) {
    const { x, y, z } = m;
    const id = this.world.get(x, y, z);
    const def = BLOCKS[id];
    if (!this.mayBuild(p, x, z)) { this.sys(p, 'You don\'t have permission to build here.'); return this.fix(p, x, y, z); }
    if (!id || !def || def.hard < 0 || y < 1 || !this.near(p, x, y, z, p.creative ? 11 : REACH)) return this.fix(p, x, y, z);
    // rate and speed checks (anti-cheat): breaking faster than any tool allows is refused
    const now = Date.now();
    p.digs = p.digs.filter(t => now - t < 1000);
    if (p.digs.length >= (p.creative ? 30 : 15)) { this.flag(p, 'digging too fast'); return this.fix(p, x, y, z); }
    if (!p.creative && def.hard > 0) {
      const fastest = def.hard * 0.5 / (16 * this.fx(p).digSpeed);
      if ((now - p.digT) / 1000 < fastest * 0.7) { this.flag(p, 'instant mining'); return this.fix(p, x, y, z); }
    }
    p.digs.push(now); p.digT = now;
    const tool = ITEMS[m.tool]?.tool || null;
    const contents = def.machine ? this.machines.remove(x, y, z) : [];
    if (def.machine) this.viewers.delete(`${x},${y},${z}`);
    this.setBlock(x, y, z, WATERY[id] ? B.WATER : B.AIR);
    if (!p.creative) {
      const drops = dropFor(id, tool, this.fx(p).oreLuck);
      for (const [item, n] of drops) this.spawnItem(item, n, x + 0.5, y + 0.3, z + 0.5, null, p);
      for (const s of contents) this.spawnItem(s.id, s.count, x + 0.5, y + 0.5, z + 0.5, s.dur);
      if (!drops.length) { const why = needsBetterTool(id, tool); if (why) this.sys(p, why + '.'); }
      const xp = id === B.AETHER_ORE ? XP.rare : isOre(id) ? XP.ore : XP.break;
      this.award(p, { stat: 'broken', add: 1, xp });
      if (id === B.LOG || id === B.PINE_LOG) this.award(p, { stat: 'logs', add: 1 });
    }
    if (id === B.WAYSTONE) this.broadcast({ t: 'waystoneGone', x, y, z });
    this.supportCheck(x, y, z, p);
  }

  place(p, m) {
    const { x, y, z, b } = m;
    const def = BLOCKS[b];
    const here = this.world.get(x, y, z);
    if (!def || !ITEMS[b] || y < 1 || y >= WH - 2) return this.fix(p, x, y, z);
    if (!this.mayBuild(p, x, z)) { this.sys(p, 'You don\'t have permission to build here.'); return this.fix(p, x, y, z); }
    if (!this.near(p, x, y, z, p.creative ? 11 : REACH)) return this.fix(p, x, y, z);
    if (here !== 0 && KIND[here] !== 3 && KIND[here] !== 4 && !WATERY[here]) return this.fix(p, x, y, z);
    if ((b === B.WATER || b === B.LAVA || b === B.TRAIL_BEACON || b === B.ARENA_STONE || b === B.BEDROCK) && !p.creative) return this.fix(p, x, y, z);
    const now = Date.now();
    p.places = p.places.filter(t => now - t < 1000);
    if (p.places.length >= (p.creative ? 30 : 15)) { this.flag(p, 'placing too fast'); return this.fix(p, x, y, z); }
    // blocks attach to something (glow orbs float by magic)
    if (b !== B.GLOW_ORB && !p.creative) {
      let touching = false;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = this.world.get(x + dx, y + dy, z + dz);
        if (n && KIND[n] !== 4 && !(KIND[n] === 3 && !WATERY[n] && !LIQ_TYPE[n])) touching = true;
      }
      if (!touching) return this.fix(p, x, y, z);
    }
    p.places.push(now);
    for (const e of this.ents.values()) {
      if (def.solid && (e.kind === 'mob' && e.T.move === 'walk' || e.kind === 'folk') && e.x + e.w > x && e.x - e.w < x + 1 && e.z + e.w > z && e.z - e.w < z + 1 && e.y < y + 1 && e.y + e.h > y) return this.fix(p, x, y, z);
    }
    if (!this.setBlock(x, y, z, b)) return;
    if (def.machine) this.machines.get(x, y, z);
    this.award(p, { stat: 'placed', add: 1, xp: XP.place });
    this.supportCheck(x, y - 1, z, p);
  }

  // plants pop off unsupported, sand and gravel fall
  supportCheck(x, y, z, p) {
    const above = this.world.get(x, y + 1, z);
    if (KIND[above] === 4 && above !== B.GLOW_ORB && above !== B.GLOW_VINE && !IS_SOLID[this.world.get(x, y, z)]) {
      this.setBlock(x, y + 1, z, WATERY[above] ? B.WATER : B.AIR);
      if (p && !p.creative) for (const [item, n] of dropFor(above, null)) this.spawnItem(item, n, x + 0.5, y + 1.3, z + 0.5);
    }
    for (let yy = y + (KIND[above] === 4 ? 2 : 1); yy < WH; yy++) {
      const b = this.world.get(x, yy, z);
      if (!BLOCKS[b]?.gravity || this.world.solidAt(x, yy - 1, z)) break;
      this.setBlock(x, yy, z, B.AIR);
      this.addEnt({ kind: 'fall', b, x: x + 0.5, y: yy, z: z + 0.5, vy: 0, bx: x, bz: z });
    }
    const self = this.world.get(x, y, z);
    if (BLOCKS[self]?.gravity && !this.world.solidAt(x, y - 1, z)) {
      this.setBlock(x, y, z, B.AIR);
      this.addEnt({ kind: 'fall', b: self, x: x + 0.5, y, z: z + 0.5, vy: 0, bx: x, bz: z });
    }
  }

  /* ================================================================ */
  /* Entities                                                         */
  /* ================================================================ */
  addEnt(e) {
    e.id = e.id || `${e.kind[0]}${this.nextId++}`;
    this.ents.set(e.id, e);
    return e;
  }
  spawnItem(item, count, x, y, z, dur, toward = null) {
    if (!ITEMS[item] || count <= 0) return;
    const a = Math.random() * Math.PI * 2;
    this.addEnt({ kind: 'item', item, count, dur: dur ?? (ITEMS[item].durability || 0), x, y, z, vx: Math.cos(a) * 1.2, vy: 3.5, vz: Math.sin(a) * 1.2, age: 0, delay: 0.4 });
  }

  updateItems(dt) {
    const players = [...this.players.values()];
    for (const e of this.ents.values()) {
      if (e.kind === 'fall') {
        e.vy -= 24 * dt; e.y += e.vy * dt;
        const cell = Math.floor(e.y);
        if (cell <= 0 || this.world.solidAt(e.bx, cell, e.bz) || LIQ_TYPE[this.world.get(e.bx, cell, e.bz)] === 2) {
          e.dead = true;
          const here = this.world.get(e.bx, cell + 1, e.bz);
          if (here === 0 || KIND[here] === 3 || KIND[here] === 4) this.setBlock(e.bx, cell + 1, e.bz, e.b);
          else this.spawnItem(e.b, 1, e.x, cell + 1.5, e.z);
        }
        continue;
      }
      if (e.kind !== 'item') continue;
      e.age += dt; e.delay -= dt;
      if (e.age > 300) { e.dead = true; continue; }
      // simple physics: fall until resting on something solid, slide to a stop
      e.vy -= 18 * dt;
      e.vx *= Math.pow(0.1, dt); e.vz *= Math.pow(0.1, dt);
      const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
      if (!this.world.solidAt(Math.floor(nx), Math.floor(e.y), Math.floor(nz))) { e.x = nx; e.z = nz; } else { e.vx = e.vz = 0; }
      const ny = e.y + e.vy * dt;
      if (this.world.solidAt(Math.floor(e.x), Math.floor(ny - 0.15), Math.floor(e.z))) { e.y = Math.floor(ny - 0.15) + 1.15; e.vy = 0; }
      else e.y = ny;
      if (WATERY[this.world.get(e.x, e.y, e.z)]) e.vy = Math.max(e.vy, 0.6);
      if (e.y < -10) { e.dead = true; continue; }
      if (e.delay > 0) continue;
      // pick up
      for (const p of players) {
        if (p.dead || p.spectating) continue;
        // the player's body spans y..y+1.8: anything touching it (or a small margin) is picked up
        const h = Math.hypot(p.x - e.x, p.z - e.z), dyb = e.y < p.y ? p.y - e.y : e.y > p.y + 1.8 ? e.y - p.y - 1.8 : 0;
        const d = Math.hypot(h, dyb);
        if (d < 1.5) {
          e.dead = true;
          this.give(p, e.item, e.count, e.dur);
          this.send(p, { t: 'picked', item: e.item, count: e.count });
          this.modes?.onPickup(p, e.item, e.count);
          break;
        } else if (d < 3.2) { e.vx += (p.x - e.x) * dt * 6; e.vz += (p.z - e.z) * dt * 6; if (dyb > 0 && e.y < p.y) e.vy = Math.max(e.vy, 2); }
      }
    }
    // merge nearby stacks of the same item
    const items = [...this.ents.values()].filter(e => e.kind === 'item' && !e.dead);
    if (items.length > 1 && items.length < 300) {
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.dead || b.dead || a.item !== b.item || ITEMS[a.item].stack === 1) continue;
        if (Math.abs(a.x - b.x) < 0.8 && Math.abs(a.y - b.y) < 0.8 && Math.abs(a.z - b.z) < 0.8) { a.count += b.count; b.dead = true; }
      }
    }
  }

  spawnCreatures() {
    if (!this.rules.creatures) return;
    const capScale = Math.max(0.5, 1 / Math.sqrt(Math.max(1, this.players.size)));
    for (const p of this.players.values()) {
      const counts = {};
      let near = 0;
      for (const e of this.ents.values()) if (e.kind === 'mob' && Math.hypot(e.x - p.x, e.z - p.z) < 56) { counts[e.type] = (counts[e.type] || 0) + 1; near++; }
      if (near > 14) continue;
      for (let i = 0; i < 3; i++) {
        const s = spawnNear(this.world, p, counts, capScale, this.ctx);
        if (s) { const e = makeMob(null, ...s); e.id = `m${this.nextId++}`; this.ents.set(e.id, e); counts[s[0]] = (counts[s[0]] || 0) + 1; break; }
      }
    }
  }

  // villagers appear when a player is near their village
  updateVillages() {
    for (const v of this.villages.values()) {
      const near = [...this.players.values()].some(p => Math.hypot(p.x - v.x, p.z - v.z) < 80) && this.world.loaded(v.x, v.z);
      for (const d of v.folk) {
        const has = this.ents.get(d.id);
        if (near && !has && this.world.loaded(d.home[0], d.home[2])) {
          const e = makeVillager(d, v);
          if (v.state?.[d.id]?.atHome) { e.atHome = true; e.x = d.home[0] + 0.5; e.y = d.home[1]; e.z = d.home[2] + 0.5; }
          this.ents.set(d.id, e);
        } else if (!near && has) {
          v.state = v.state || {};
          v.state[d.id] = { atHome: has.atHome };
          this.ents.delete(d.id);
          for (const p of this.players.values()) if (p.known.has(d.id)) { p.known.delete(d.id); this.send(p, { t: 'entGone', ids: [d.id] }); }
        }
      }
    }
  }

  onChunk(meta) {
    for (const v of meta.villages || []) if (!this.villages.has(v.id)) this.villages.set(v.id, makeVillage(this.seed, v));
    for (const r of meta.ruins || []) this.ruins.set(r.id, r);
  }

  get ctx() {
    return {
      world: this.world, players: [...this.players.values()].filter(p => !p.dead), night: this.daylight() < 0.35, storm: this.weather === 'storm',
      hostilesOn: this.rules.hostiles,
      hurtPlayer: (p, dmg, mob) => this.hurtPlayer(p, dmg, mob.x, mob.z, `was knocked out by a ${mob.T.name}`),
      hostileNear: (x, y, z, r) => { for (const e of this.ents.values()) if (e.kind === 'mob' && e.T.dmg && Math.hypot(e.x - x, e.z - z) < r && e.T.hostile(this.ctxLite, e)) return e; return null; },
      greet: (p, v) => this.send(p, { t: 'greet', id: v.id }),
      shout: (v, text) => { for (const p of this.players.values()) if (Math.hypot(p.x - v.x, p.z - v.z) < 32) this.send(p, { t: 'say', id: v.id, text }); },
    };
  }
  get ctxLite() { return { night: this.daylight() < 0.35, storm: this.weather === 'storm' }; }

  hurtPlayer(p, dmg, fx, fz, cause) {
    if (p.creative || p.dead || (this.modes?.isPlaying(p) && this.modes.mode === 'arena')) return;
    this.send(p, { t: 'hurt', dmg, cause, fx, fz });
  }

  hitEntity(p, m) {
    const now = Date.now();
    if (now - p.hitT < 230) return;
    p.hitT = now;
    const e = this.ents.get(m.id);
    if (!e) return;
    const reach = e.kind === 'mob' && e.T.move === 'sky' ? 14 : 6;
    if (Math.hypot(p.x - e.x, p.y + 1 - e.y, p.z - e.z) > reach) { this.flag(p, 'hitting from too far away'); return; }
    if (e.kind === 'mob') {
      const dmg = Math.min(16, Math.max(1, +m.dmg || 1)) * this.fx(p).damage * (m.crit ? 1.5 : 1);
      damageMob(e, dmg, p);
      e.lastHitBy = p.id;
      if (e.dead === 'killed') this.killMob(e, p);
    } else if (e.kind === 'folk') {
      hitVillager(e, this.ctx, p);
      this.send(p, { t: 'favor', id: e.id, add: -15 });
    }
  }

  killMob(e, p) {
    for (const [item, n] of e.T.drops()) this.spawnItem(item, n, e.x, e.y + 0.6, e.z);
    this.broadcast({ t: 'fx', kind: 'poof', x: e.x, y: e.y + 0.6, z: e.z, color: e.T.color });
    if (p) {
      this.send(p, { t: 'kill', type: e.type });
      this.award(p, { stat: `kill_${e.type}`, add: 1 });
      this.award(p, { stat: 'kills', add: 1, xp: XP.kill[e.type] || 5 });
    }
  }

  pvp(p, m) {
    const t = this.players.get(m.target);
    if (!t || t === p || t.dead) return;
    const now = Date.now();
    if (now - p.hitT < 400) return;
    if (Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) > 5) { this.flag(p, 'hitting a player from too far away'); return; }
    p.hitT = now;
    if (this.modes?.arenaHit(p, t)) return;
    if (!this.rules.pvp) return;
    const dmg = Math.min(16, Math.max(1, +m.dmg || 1)) * this.fx(p).damage;
    this.send(t, { t: 'hurt', dmg, cause: `was knocked out by ${p.name}`, fx: p.x, fz: p.z, pvp: true });
  }

  storm(p, m) {
    if (Math.hypot(p.x - m.x, p.z - m.z) > 34) return;
    this.broadcast({ t: 'fx', kind: 'bolt', x: m.x, y: m.y, z: m.z });
    for (const e of this.ents.values()) if (e.kind === 'mob' && Math.hypot(e.x - m.x, e.y - m.y, e.z - m.z) < 3.5) {
      damageMob(e, 12, { x: m.x, z: m.z });
      if (e.dead === 'killed') this.killMob(e, p);
    }
  }

  /* ================================================================ */
  /* Machines                                                         */
  /* ================================================================ */
  machineChanged(m) {
    const key = `${m.x},${m.y},${m.z}`;
    const set = this.viewers.get(key);
    if (set) for (const id of set) { const p = this.players.get(id); if (p) this.send(p, { t: 'mstate', key, m: this.machineView(m) }); }
  }
  machineView(m) {
    if (m.type === 'chest') return { type: 'chest', x: m.x, y: m.y, z: m.z, slots: m.inv.slots };
    const { inv, ...rest } = m;
    return rest;
  }
  openMachine(p, m) {
    if (!canUseMachines(p.role, this.rules)) return this.sys(p, 'The owner hasn\'t let visitors use machines here.');
    if (!this.near(p, m.x, m.y, m.z, 9)) return;
    const mm = this.machines.get(m.x, m.y, m.z);
    if (!mm) return;
    const key = `${m.x},${m.y},${m.z}`;
    if (!this.viewers.has(key)) this.viewers.set(key, new Set());
    this.viewers.get(key).add(p.id);
    this.send(p, { t: 'mstate', key, m: this.machineView(mm) });
  }
  setMachine(p, m) {
    const [x, y, z] = m.key.split(',').map(Number);
    if (!canUseMachines(p.role, this.rules) || !this.near(p, x, y, z, 9)) return;
    const mm = this.machines.get(x, y, z);
    if (!mm) return;
    const st = m.stack && ITEMS[m.stack.id] ? { id: m.stack.id, count: Math.max(1, Math.min(ITEMS[m.stack.id].stack, m.stack.count | 0)), dur: m.stack.dur | 0 } : null;
    if (mm.type === 'chest') { if (m.slot >= 0 && m.slot < 27) mm.inv.slots[m.slot] = st; }
    else if (['input', 'fuel', 'output'].includes(m.field)) {
      if (m.field === 'output' && st && (!mm.output || mm.output.id !== st.id)) return;
      if (m.field === 'output' && mm.output && (!st || st.count < mm.output.count)) {
        if (SMELT && [I.COPPER_INGOT, I.IRON_INGOT].includes(mm.output.id)) this.award(p, { stat: 'ingots', add: 1, xp: 2 });
      }
      mm[m.field] = st;
      if (m.field === 'input' || m.field === 'fuel') mm.speed = this.fx(p).smelt;
    }
    this.machineChanged(mm);
  }

  /* ================================================================ */
  /* Anti-cheat                                                       */
  /* ================================================================ */
  flag(p, why) {
    const now = Date.now();
    p.viol = p.viol.filter(v => now - v.t < 60000);
    p.viol.push({ t: now, why });
    this.host.audit?.(`anti-cheat: ${p.name} ${why}`);
    if (p.viol.length >= 25 && !this.local) {
      this.host.kick?.(p, `Kicked by anti-cheat (${why}).`);
    }
  }

  checkMove(p, m) {
    const now = Date.now();
    const dt = Math.max(0.05, (now - p.lastPosT) / 1000);
    p.lastPosT = now;
    const free = now < p.tpUntil || p.creative || this.local;
    if (p.freeze && !this.local) {
      if (p.okPos && Math.hypot(m.x - p.okPos.x, m.z - p.okPos.z) > 1.5) { this.send(p, { t: 'tpto', ...p.okPos, freeze: true }); return false; }
    }
    if (!free && p.okPos) {
      const fx = this.fx(p);
      const horiz = Math.hypot(m.x - p.x, m.z - p.z);
      const allowed = 10 * fx.speed * dt + 1.5; // sprinting, knockback and jump pads with margin
      const rise = m.y - p.y;
      const onPad = this.world.get(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z)) === B.JUMP_PAD || this.world.get(Math.floor(m.x), Math.floor(m.y - 2), Math.floor(m.z)) === B.JUMP_PAD;
      if (horiz > allowed && p.blinkAllow && horiz <= allowed + p.blinkAllow && rise < 9) p.blinkAllow = 0;
      else if (horiz > allowed || (rise > 12 * dt + 1.6 && !onPad)) {
        this.flag(p, 'moving too fast');
        this.send(p, { t: 'tpto', ...p.okPos, freeze: false });
        return false;
      }
      // hovering in survival: nothing under you for a long time without falling
      const under = this.world.get(Math.floor(m.x), Math.floor(m.y - 0.2), Math.floor(m.z));
      const supported = IS_SOLID[under] || KIND[under] === 3 || WATERY[under] || this.world.get(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)) !== 0;
      if (!supported && m.y >= p.y - 0.05) p.airT += dt; else p.airT = 0;
      if (p.airT > 5 && this.world.loaded(m.x, m.z)) {
        p.airT = 0; this.flag(p, 'flying in survival');
        const gy = this.world.groundBelow(Math.floor(m.x), m.y, Math.floor(m.z)) ?? this.surfaceAt(m.x, m.z);
        this.teleport(p, m.x, gy, m.z);
        return false;
      }
    }
    return true;
  }

  /* ================================================================ */
  /* Messages from players                                            */
  /* ================================================================ */
  handle(p, m) {
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'pos': {
        if (![m.x, m.y, m.z].every(Number.isFinite)) return;
        if (!this.checkMove(p, m)) return;
        p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = +m.yaw || 0; p.pitch = +m.pitch || 0;
        if (!p.freeze) p.okPos = { x: p.x, y: p.y, z: p.z };
        this.broadcast({ t: 'pos', id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch) }, p);
        break;
      }
      case 'dig': if ([m.x, m.y, m.z].every(Number.isInteger)) this.dig(p, m); break;
      case 'place': if ([m.x, m.y, m.z, m.b].every(Number.isInteger)) this.place(p, m); break;
      case 'hit': this.hitEntity(p, m); break;
      case 'pvp': this.pvp(p, m); break;
      case 'storm': if ([m.x, m.y, m.z].every(Number.isFinite)) this.storm(p, m); break;
      case 'tp': {
        // a short hop (blink charm) is allowed once; long trips (waystones, home) at most every 8 s and never mid-round
        const now = Date.now();
        if (m.short) { p.blinkAllow = 9; break; }
        if (this.modes?.active && this.modes.isPlaying(p) && !this.local) break;
        if (now - (p.tpAsk || 0) > 8000) { p.tpAsk = now; p.tpUntil = now + 2500; }
        break;
      }
      case 'drop': {
        if (!ITEMS[m.item]) return;
        const c = Math.max(1, Math.min(ITEMS[m.item].stack, m.count | 0));
        const f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
        const e = this.addEnt({ kind: 'item', item: m.item, count: c, dur: m.dur | 0, x: p.x + f.x * 0.8, y: p.y + 1.3, z: p.z + f.z * 0.8, vx: f.x * 4, vy: 2, vz: f.z * 4, age: 0, delay: 1.5 });
        e.from = p.id;
        break;
      }
      case 'died': {
        p.dead = true;
        this.sysAll(`${p.name} ${String(m.cause || 'was knocked out').slice(0, 60)}.`);
        if (!this.rules.keepInventory && Array.isArray(m.items)) for (const s of m.items.slice(0, 40)) if (s && ITEMS[s.id]) this.spawnItem(s.id, Math.min(s.count | 0, ITEMS[s.id].stack), p.x, p.y + 1, p.z, s.dur);
        break;
      }
      case 'respawn': p.dead = false; p.tpUntil = Date.now() + 3000; break;
      case 'mopen': if ([m.x, m.y, m.z].every(Number.isInteger)) this.openMachine(p, m); break;
      case 'mclose': for (const set of this.viewers.values()) set.delete(p.id); break;
      case 'mset': if (typeof m.key === 'string') this.setMachine(p, m); break;
      case 'talk': { const v = this.ents.get(m.id); if (v?.kind === 'folk' && Math.hypot(v.x - p.x, v.z - p.z) < 8) { v.talkingTo = p.id; v.talkT = 30; } break; }
      case 'talkend': for (const e of this.ents.values()) if (e.kind === 'folk' && e.talkingTo === p.id) e.talkingTo = null; break;
      case 'chat': this.chat(p, String(m.text || '')); break;
      case 'emote': if (/^[a-z]{2,10}$/.test(m.name)) this.broadcast({ t: 'emote', id: p.id, name: m.name }, p); break;
      case 'avatar': p.avatar = sanitizeAvatar(m.cfg || {}, p.profile); this.broadcast({ t: 'avatar', id: p.id, cfg: p.avatar }, p); this.send(p, { t: 'avatarOk', cfg: p.avatar }); break;
      case 'ping': if ([m.x, m.y, m.z].every(Number.isFinite)) this.broadcast({ t: 'ping', id: p.id, name: p.name, x: m.x, y: m.y, z: m.z }); break;
      case 'state': this.saveState(p, m.state); break;
      case 'progress': this.clientProgress(p, m); break;
      case 'learn': if (canLearn(p.profile, m.skill)) { p.profile.skills[m.skill] = (p.profile.skills[m.skill] || 0) + 1; this.send(p, { t: 'profile', profile: this.profileView(p), events: [] }); this.host.saveProfile?.(p.profile); } break;
      case 'respec': if (p.profile) { p.profile.skills = {}; this.send(p, { t: 'profile', profile: this.profileView(p), events: [] }); this.host.saveProfile?.(p.profile); } break;
      case 'start': if (this.modes && (atLeast(p.role, 'mod') || this.local)) this.modes.start(p.name); break;
      case 'admin': this.admin(p, m); break;
    }
  }

  // things only the client can see (crafting, quests, friendships); capped so they can't be farmed
  clientProgress(p, m) {
    const allowed = { machines: [1, 10], artifacts: [1, 20], quests: [1, 30], waystones: [null, 0], bestFavor: [null, 0] };
    const a = allowed[m.stat];
    if (!a) return;
    const now = Date.now();
    p.progT = p.progT || {};
    if (now - (p.progT[m.stat] || 0) < 3000) return;
    p.progT[m.stat] = now;
    if (a[0]) this.award(p, { stat: m.stat, add: 1, xp: a[1] });
    else this.award(p, { stat: m.stat, max: Math.min(100, +m.value || 0) });
  }

  saveState(p, s) {
    if (!s || typeof s !== 'object') return;
    this.playerStates[p.profileId] = {
      x: p.x, y: p.y, z: p.z, inv: Array.isArray(s.inv) ? s.inv.slice(0, 36) : [], health: +s.health || 20, hunger: +s.hunger || 20,
      waystones: Array.isArray(s.waystones) ? s.waystones.slice(0, 200) : [], quests: Array.isArray(s.quests) ? s.quests.slice(0, 5) : [],
      social: s.social && typeof s.social === 'object' ? s.social : {}, spawn: s.spawn || null, villages: Array.isArray(s.villages) ? s.villages.slice(0, 200) : [],
      explored: [...p.explore].slice(-4000),
    };
  }

  /* ================================================================ */
  /* Chat and commands                                                */
  /* ================================================================ */
  chat(p, text) {
    text = text.replace(/[\u0000-\u001f]/g, '').slice(0, 160).trim();
    if (!text) return;
    if (text.startsWith('/')) return this.command(p, text);
    const now = Date.now();
    if (p.mutedUntil > now) return this.sys(p, `You are muted for ${Math.ceil((p.mutedUntil - now) / 60000)} more minute(s).`);
    p.chat = p.chat.filter(t => now - t < 5000);
    if (p.chat.length >= 5) return this.sys(p, 'Slow down a little: one message a second.');
    p.chat.push(now);
    this.broadcast({ t: 'chat', id: p.id, name: p.name, text, role: p.role, title: p.avatar?.title });
  }

  command(p, text) {
    const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest[0], tail = rest.slice(1).join(' ');
    const mod = canModerate(p.role) || this.local;
    const target = () => { const t = this.byName(arg); if (!t) this.sys(p, `No player called "${arg || ''}" is here.`); return t; };
    switch (cmd) {
      case 'help':
        return this.sys(p, 'Commands: /who, /msg name text, /tp name, /seed, /home, /spawnpoint' +
          (this.modes ? ', /start' : '') + (mod ? ' — moderators: /kick, /ban, /unban, /mute name [minutes], /unmute, /role name visitor|builder|mod, /invite [name], /set rule on|off, /time day|night, /weather clear|rain|storm' : ''));
      case 'who': return this.sys(p, [...this.players.values()].map(q => `${q.name} (${ROLE_NAMES[q.role]})`).join(', '));
      case 'msg': case 'w': {
        const t = target(); if (!t) return;
        if (p.mutedUntil > Date.now()) return this.sys(p, 'You are muted.');
        this.send(t, { t: 'chat', id: p.id, name: `${p.name} → you`, text: rest.slice(1).join(' ').slice(0, 160), whisper: true });
        return this.send(p, { t: 'chat', id: p.id, name: `you → ${t.name}`, text: rest.slice(1).join(' ').slice(0, 160), whisper: true });
      }
      case 'tp': {
        if (!this.rules.teleportToFriends && !mod) return this.sys(p, 'Teleporting to players is turned off in this world.');
        if (this.modes?.active && this.modes.isPlaying(p)) return this.sys(p, 'Not during a round!');
        const t = target(); if (!t) return;
        return this.teleport(p, t.x, t.y, t.z);
      }
      case 'start': return this.handle(p, { t: 'start' });
    }
    if (!mod) return this.sys(p, 'Unknown command, or you need to be a moderator. Try /help');
    switch (cmd) {
      case 'kick': { const t = target(); if (!t) return; if (atLeast(t.role, p.role) && !this.local) return this.sys(p, 'You can only kick people below your role.'); this.host.audit?.(`${p.name} kicked ${t.name}: ${tail}`); return this.host.kick?.(t, `Kicked by ${p.name}${tail ? `: ${tail}` : ''}`); }
      case 'ban': { const t = target(); if (!t) return; if (atLeast(t.role, p.role)) return this.sys(p, 'You can only ban people below your role.'); return this.host.ban?.(t, tail, p); }
      case 'unban': return this.host.unban?.(arg, p);
      case 'mute': {
        const t = target(); if (!t) return;
        const mins = Math.max(1, Math.min(1440, +rest[1] || 10));
        t.mutedUntil = Date.now() + mins * 60000;
        this.host.setMute?.(t, t.mutedUntil);
        this.sys(t, `You were muted for ${mins} minute(s) by ${p.name}.`);
        return this.sys(p, `Muted ${t.name} for ${mins} minute(s).`);
      }
      case 'unmute': { const t = target(); if (!t) return; t.mutedUntil = 0; this.host.setMute?.(t, 0); this.sys(t, 'You can chat again.'); return this.sys(p, `Unmuted ${t.name}.`); }
      case 'role': {
        const t = target(); const role = (rest[1] || '').toLowerCase();
        if (!t || !['visitor', 'builder', 'mod'].includes(role)) return this.sys(p, 'Usage: /role name visitor|builder|mod');
        if (role === 'mod' && p.role !== 'owner') return this.sys(p, 'Only the owner can make moderators.');
        if (atLeast(t.role, p.role) && p.role !== 'owner') return this.sys(p, 'You can\'t change that player\'s role.');
        return this.setRole(t, role, p);
      }
      case 'invite': return this.host.invite?.(p, arg);
      case 'set': {
        if (p.role !== 'owner' && !this.local) return this.sys(p, 'Only the owner can change the rules.');
        const rule = RULES.find(r => r.id.toLowerCase() === (arg || '').toLowerCase());
        if (!rule) return this.sys(p, `Rules: ${RULES.map(r => r.id).join(', ')}`);
        return this.setRules({ [rule.id]: /^(on|true|yes|1)$/i.test(rest[1] || '') }, p);
      }
      case 'time': if (arg === 'day' || arg === 'night') { this.time = arg === 'day' ? 0.25 : 0.75; this.sendEnv(); } return;
      case 'weather': if (['clear', 'rain', 'storm'].includes(arg)) { this.weather = arg; this.weatherT = 300; this.sendEnv(); } return;
      case 'summon': {
        if (!MOB_TYPES[arg]) return this.sys(p, `Creatures: ${Object.keys(MOB_TYPES).join(', ')}`);
        const x = p.x - Math.sin(p.yaw) * 4, z = p.z - Math.cos(p.yaw) * 4;
        const e = makeMob(null, arg, x, MOB_TYPES[arg].move === 'walk' ? this.world.surfaceY(x, z) : p.y + 1.5, z); e.id = `m${this.nextId++}`; this.ents.set(e.id, e);
        return;
      }
    }
    this.sys(p, 'Unknown command. Try /help');
  }

  setRole(t, role, by) {
    t.role = role;
    this.host.setRole?.(t.profileId, role, t.name);
    this.send(t, { t: 'role', role });
    this.broadcast({ t: 'roleOf', id: t.id, role });
    this.sysAll(`${t.name} is now a ${ROLE_NAMES[role]}${by ? ` (set by ${by.name})` : ''}.`);
  }
  setRules(changes, by) {
    for (const [k, v] of Object.entries(changes)) if (k in this.rules) this.rules[k] = !!v;
    this.fluids.enabled = this.rules.fluids;
    this.host.saveRules?.(this.rules);
    this.broadcast({ t: 'rules', rules: this.rules });
    if (by) this.sysAll(`${by.name} changed the world rules.`);
  }

  admin(p, m) {
    if (!canModerate(p.role)) return;
    const t = m.target ? this.players.get(m.target) : null;
    switch (m.op) {
      case 'kick': if (t && !atLeast(t.role, p.role)) this.host.kick?.(t, `Kicked by ${p.name}`); break;
      case 'ban': if (t && !atLeast(t.role, p.role)) this.host.ban?.(t, m.reason || '', p); break;
      case 'mute': if (t && !atLeast(t.role, p.role)) this.command(p, `/mute ${t.name} ${m.minutes || 10}`); break;
      case 'unmute': if (t) this.command(p, `/unmute ${t.name}`); break;
      case 'role': if (t && ['visitor', 'builder', 'mod'].includes(m.role) && (m.role !== 'mod' || p.role === 'owner') && !atLeast(t.role, p.role)) this.setRole(t, m.role, p); break;
      case 'rules': if (p.role === 'owner' && m.rules) this.setRules(m.rules, p); break;
    }
  }

  /* ================================================================ */
  /* Time                                                             */
  /* ================================================================ */
  daylight() {
    const s = Math.sin(this.time * Math.PI * 2);
    const t = Math.max(0, Math.min(1, (s + 0.18) / 0.48));
    return t * t * (3 - 2 * t);
  }
  sendEnv() { this.broadcast({ t: 'env', time: this.time, weather: this.rules.weather ? this.weather : 'clear' }); }

  tick(dt) {
    if (this.rules.daylight) this.time = (this.time + dt / DAY_LENGTH) % 1; else this.time = 0.25;
    this.weatherT -= dt;
    if (this.weatherT <= 0) { const r = Math.random(); this.weather = r < 0.55 ? 'clear' : r < 0.88 ? 'rain' : 'storm'; this.weatherT = 150 + Math.random() * 240; }
    this.envT -= dt;
    if (this.envT <= 0) { this.envT = 3; this.sendEnv(); }

    const ctx = this.ctx;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 1; this.spawnCreatures(); this.updateVillages(); }
    for (const e of this.ents.values()) {
      if (e.kind === 'mob') {
        if (!this.world.loaded(e.x, e.z)) { e.dead = true; continue; }
        if (![...this.players.values()].some(p => Math.hypot(p.x - e.x, p.z - e.z) < 90)) { e.dead = true; continue; }
        if (!this.rules.creatures) { e.dead = true; continue; }
        updateMob(e, dt, ctx);
        if (e.dead === 'killed') this.killMob(e, this.players.get(e.lastHitBy));
      } else if (e.kind === 'folk') {
        if (this.world.loaded(e.x, e.z)) updateVillager(e, dt, ctx);
      }
    }
    this.updateItems(dt);
    for (const [id, e] of this.ents) if (e.dead) this.ents.delete(id);
    this.fluids.tick(dt);
    this.machines.tick(dt);
    this.modes?.tick(dt);

    // exploration progress, checked by the world (not reported by the player)
    this.exploreT -= dt;
    if (this.exploreT <= 0) { this.exploreT = 2; for (const p of this.players.values()) this.explore(p); }

    // send block changes and nearby entities
    if (this.edits.length) {
      if (!this.local) this.broadcast({ t: 'edits', list: this.edits });
      this.edits = [];
    }
    for (const p of this.players.values()) {
      p.snapT -= dt;
      if (p.snapT <= 0) { p.snapT = SNAP; this.snapshot(p); }
    }
    // smelters and drills tick: refresh open panels twice a second
    this.mT = (this.mT || 0) - dt;
    if (this.mT <= 0) {
      this.mT = 0.5;
      for (const [key, set] of this.viewers) {
        if (!set.size) continue;
        const [x, y, z] = key.split(',').map(Number);
        const mm = this.machines.map.get(key);
        if (mm && mm.type !== 'chest') for (const id of set) { const q = this.players.get(id); if (q) this.send(q, { t: 'mstate', key, m: this.machineView(mm) }); }
      }
    }
  }

  explore(p) {
    if (p.dead) return;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const col = this.world.terrain.column(x, z);
    let biome = this.world.biomeAt(x, z);
    if (p.y < Math.min(50, col.h - 6) && col.lumen > 0.2) biome = BIOME.LUMEN;
    const prof = p.profile;
    if (!prof) return;
    prof.visited = prof.visited || {};
    if (!prof.visited[biome]) {
      prof.visited[biome] = 1;
      this.award(p, { stat: `biome${biome}`, max: 1 });
      this.award(p, { stat: 'biomes', max: Object.keys(prof.visited).length });
    }
    if (p.y < 20) this.award(p, { stat: 'deep', max: 1 });
    if (col.islandTop && p.y > col.islandTop - 1 && p.y < col.islandTop + 3) this.award(p, { stat: 'isle', max: 1 });
    const ck = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    if (!p.explore.has(ck) && p.explore.size < 20000) { p.explore.add(ck); this.award(p, { xp: XP.explore }); }
  }

  snapshot(p) {
    const list = [], fresh = [], seen = new Set();
    for (const e of this.ents.values()) {
      if (Math.abs(e.x - p.x) > VIEW || Math.abs(e.z - p.z) > VIEW) continue;
      seen.add(e.id);
      if (!p.known.has(e.id)) {
        p.known.add(e.id);
        if (e.kind === 'mob') fresh.push({ id: e.id, k: 'm', type: e.type, v: e.variant, max: e.T.hp });
        else if (e.kind === 'folk') fresh.push({ id: e.id, k: 'v', d: e.data });
        else if (e.kind === 'item') fresh.push({ id: e.id, k: 'i', item: e.item, count: e.count });
        else if (e.kind === 'fall') fresh.push({ id: e.id, k: 'f', b: e.b });
      }
      const flags = (e.hurt > 0 ? 1 : 0) | (e.swing > 0 ? 2 : 0) | (e.wave > 0 ? 4 : 0);
      list.push([e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw || 0), r2(e.pitch || 0), r2(e.speedNow || 0), flags, e.kind === 'mob' ? Math.max(0, Math.ceil(e.hp)) : (e.count || 0)]);
    }
    const gone = [];
    for (const id of p.known) if (!seen.has(id)) gone.push(id);
    for (const id of gone) p.known.delete(id);
    if (fresh.length) this.send(p, { t: 'entNew', list: fresh });
    if (gone.length) this.send(p, { t: 'entGone', ids: gone });
    if (list.length) this.send(p, { t: 'ents', list });
  }

  serialize() {
    for (const v of this.villages.values()) for (const d of v.folk) { const e = this.ents.get(d.id); if (e) { v.state = v.state || {}; v.state[d.id] = { atHome: e.atHome }; } }
    for (const p of this.players.values()) if (this.playerStates[p.profileId]) Object.assign(this.playerStates[p.profileId], { x: p.x, y: p.y, z: p.z, explored: [...p.explore].slice(-4000) });
    return { time: this.time, machines: this.machines.toJSON(), players: this.playerStates, arena: this.modes?.arena || null };
  }
}
