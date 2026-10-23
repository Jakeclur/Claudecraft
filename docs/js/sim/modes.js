// Competitive rounds: Sprint Trail (race through beacons), Gather Rush (collect materials),
// Glimmer Arena (last one standing on a floating platform). Rounds repeat:
// lobby -> countdown -> active -> results.
import { B, I, toolId } from '../blocks.js';
import { MODES } from './rules.js';
import { WH } from '../consts.js';

const LOBBY = 30, COUNTDOWN = 8, RESULTS = 10;
const LIMIT = { race: 300, harvest: 240, arena: 180 };
const MIN_PLAYERS = { race: 1, harvest: 1, arena: 2 };
const TARGETS = [
  { name: 'Logs', ids: [B.LOG, B.PINE_LOG], n: 10 },
  { name: 'Cobblestone', ids: [B.COBBLE], n: 16 },
  { name: 'Dirt', ids: [B.DIRT], n: 16 },
  { name: 'Sand', ids: [B.SAND, B.CSAND], n: 10 },
  { name: 'Coal', ids: [I.COAL], n: 4 },
  { name: 'Copper Ore', ids: [B.COPPER_ORE], n: 2 },
  { name: 'Plant fibres', ids: [B.TALLGRASS, B.FERN], n: 6 },
  { name: 'Glowshrooms', ids: [B.GLOWSHROOM], n: 2 },
];

export class Modes {
  constructor(sim, mode) {
    this.sim = sim; this.mode = mode;
    this.phase = 'lobby'; this.t = LOBBY; this.round = 0;
    this.players = new Map(); // id -> round record
    this.built = [];          // blocks placed for the course, removed afterwards
    this.sendT = 0;
    this.arena = sim.saved?.arena || null;
  }

  get active() { return this.phase === 'active'; }
  isPlaying(p) { return this.players.has(p.id) && !this.players.get(p.id).out; }

  start(byName) {
    if (this.phase !== 'lobby') return false;
    if (this.sim.players.size < MIN_PLAYERS[this.mode]) { this.sim.sysAll(`${MODES[this.mode].name} needs at least ${MIN_PLAYERS[this.mode]} players.`); return false; }
    this.begin();
    if (byName) this.sim.sysAll(`${byName} started the round.`);
    return true;
  }

  tick(dt) {
    this.t -= dt;
    this.sendT -= dt;
    const n = this.sim.players.size;
    if (this.phase === 'lobby') {
      if (n < MIN_PLAYERS[this.mode]) this.t = LOBBY;
      else if (this.t <= 0) this.begin();
    } else if (this.phase === 'countdown') {
      if (this.t <= 0) this.go();
    } else if (this.phase === 'active') {
      this.update(dt);
      if (this.t <= 0 || this.over()) this.finish();
    } else if (this.phase === 'results' && this.t <= 0) {
      this.cleanup();
      this.phase = 'lobby'; this.t = LOBBY;
    }
    if (this.sendT <= 0) { this.sendT = 1; this.broadcast(); }
  }

  /* ---------------- phases ---------------- */
  begin() {
    this.round++;
    this.phase = 'countdown'; this.t = COUNTDOWN;
    this.players.clear();
    for (const p of this.sim.players.values()) this.players.set(p.id, { id: p.id, name: p.name, cp: 0, done: null, got: {}, hp: 20, kos: 0, out: false });
    const sp = this.sim.spawn;
    if (this.mode === 'race') this.buildCourse(sp);
    if (this.mode === 'harvest') {
      const pool = [...TARGETS].sort(() => Math.random() - 0.5);
      this.targets = pool.slice(0, 3).map(t => ({ ...t }));
    }
    if (this.mode === 'arena') this.buildArena(sp);
    // everyone to the start, frozen until the countdown ends
    let k = 0;
    for (const p of this.sim.players.values()) {
      const a = (k++ / Math.max(1, this.players.size)) * Math.PI * 2;
      if (this.mode === 'arena') this.sim.teleport(p, this.arena.x + Math.cos(a) * 6 + 0.5, this.arena.y + 1, this.arena.z + Math.sin(a) * 6 + 0.5, true);
      else this.sim.teleport(p, sp.x + Math.cos(a) * 2, this.sim.surfaceAt(sp.x, sp.z) + 0.1, sp.z + Math.sin(a) * 2, true);
      if (this.mode === 'harvest') for (const t of ['pick', 'axe', 'shovel']) this.sim.give(p, toolId('stone', t), 1);
      if (this.mode === 'arena') this.sim.send(p, { t: 'hp', hp: 20, max: 20, arena: true });
    }
    this.sim.sysAll(`${MODES[this.mode].name}: round ${this.round} starts in ${COUNTDOWN} seconds!`);
  }

  go() {
    this.phase = 'active'; this.t = LIMIT[this.mode];
    this.startedAt = Date.now();
    for (const p of this.sim.players.values()) if (this.players.has(p.id)) this.sim.send(p, { t: 'freeze', on: false });
    this.sim.sysAll('Go!');
  }

  over() {
    const rec = [...this.players.values()];
    if (rec.every(r => r.left)) return true;
    if (this.mode === 'race') return rec.length && rec.every(r => r.done || r.out) || (this.firstDone && Date.now() - this.firstDone > 20000);
    if (this.mode === 'harvest') return rec.some(r => r.done);
    if (this.mode === 'arena') return rec.filter(r => !r.out).length <= 1;
    return false;
  }

  standings() {
    const rec = [...this.players.values()];
    if (this.mode === 'race') return rec.sort((a, b) => (a.done ?? 1e12) - (b.done ?? 1e12) || b.cp - a.cp);
    if (this.mode === 'harvest') return rec.sort((a, b) => (a.done ?? 1e12) - (b.done ?? 1e12) || this.score(b) - this.score(a));
    return rec.sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || b.kos - a.kos || b.hp - a.hp);
  }

  finish() {
    this.phase = 'results'; this.t = RESULTS;
    const s = this.standings();
    const winner = s.find(r => !r.left && (this.mode !== 'harvest' || r.done || this.score(r) > 0)) || null;
    const winStat = { race: 'win_race', harvest: 'win_harvest', arena: 'win_arena' }[this.mode];
    for (const r of s) {
      const p = this.sim.players.get(r.id);
      if (!p) continue;
      this.sim.award(p, { stat: 'rounds', add: 1, xp: 20 });
      if (r === winner && (this.mode !== 'arena' || s.length > 1)) this.sim.award(p, { stat: winStat, add: 1, xp: 100 });
      this.sim.send(p, { t: 'freeze', on: false });
      if (this.mode === 'arena') { this.sim.send(p, { t: 'hp', arena: false }); this.sim.teleport(p, this.sim.spawn.x + 0.5, this.sim.surfaceAt(this.sim.spawn.x, this.sim.spawn.z) + 0.1, this.sim.spawn.z + 0.5); }
    }
    this.sim.sysAll(winner ? `${winner.name} wins the ${MODES[this.mode].name}!` : 'Round over.');
    this.broadcast();
  }

  cleanup() {
    for (const [x, y, z, was] of this.built) this.sim.setStructure(x, y, z, was);
    this.built = [];
    this.course = null; this.targets = null;
  }

  /* ---------------- per-mode logic ---------------- */
  update(dt) {
    for (const r of this.players.values()) {
      const p = this.sim.players.get(r.id);
      if (!p) { r.out = true; continue; }
      if (this.mode === 'race' && !r.done && this.course) {
        const c = this.course[r.cp];
        if (c && Math.hypot(p.x - c.x - 0.5, p.z - c.z - 0.5) < 3.5 && Math.abs(p.y - c.y) < 9) {
          r.cp++;
          if (r.cp >= this.course.length) {
            r.done = Date.now() - this.startedAt;
            if (!this.firstDone) this.firstDone = Date.now();
            this.sim.sysAll(`${p.name} finished the trail in ${(r.done / 1000).toFixed(1)} s!`);
          } else this.sim.send(p, { t: 'sys', text: `Checkpoint ${r.cp}/${this.course.length}` });
        }
      }
      if (this.mode === 'arena' && !r.out && p.y < this.arena.y - 4) this.knockOut(r, null, 'fell off the arena');
    }
  }

  // leaving counts as dropping out, so nobody waits for them
  onLeave(p) {
    const r = this.players.get(p.id);
    if (r && !r.done) { r.out = true; r.left = true; }
  }

  onPickup(p, item, count) {
    if (this.mode !== 'harvest' || !this.active || !this.targets) return;
    const r = this.players.get(p.id);
    if (!r || r.done) return;
    for (const t of this.targets) if (t.ids.includes(item)) r.got[t.name] = (r.got[t.name] || 0) + count;
    if (this.targets.every(t => (r.got[t.name] || 0) >= t.n)) {
      r.done = Date.now() - this.startedAt;
      this.sim.sysAll(`${p.name} gathered everything in ${(r.done / 1000).toFixed(1)} s!`);
    }
  }
  score(r) { return this.targets ? this.targets.reduce((a, t) => a + Math.min(1, (r.got[t.name] || 0) / t.n), 0) : 0; }

  // arena hits are decided here so every player hits equally hard
  arenaHit(attacker, target) {
    if (this.mode !== 'arena' || !this.active) return false;
    const ra = this.players.get(attacker.id), rt = this.players.get(target.id);
    if (!ra || !rt || ra.out || rt.out) return false;
    rt.hp -= 3;
    this.sim.send(target, { t: 'hurt', dmg: 0, arena: true, cause: `was knocked out by ${attacker.name}`, fx: attacker.x, fz: attacker.z });
    this.sim.send(target, { t: 'hp', hp: Math.max(0, rt.hp), max: 20, arena: true });
    if (rt.hp <= 0) { ra.kos++; this.knockOut(rt, attacker, `was knocked out by ${attacker.name}`); }
    return true;
  }
  knockOut(r, by, why) {
    r.out = true;
    const p = this.sim.players.get(r.id);
    this.sim.sysAll(`${r.name} ${why}.`);
    if (p) { this.sim.send(p, { t: 'hp', arena: false }); this.sim.teleport(p, this.sim.spawn.x + 0.5, this.sim.surfaceAt(this.sim.spawn.x, this.sim.spawn.z) + 0.1, this.sim.spawn.z + 0.5); }
  }

  /* ---------------- building ---------------- */
  place(x, y, z, b) {
    const was = this.sim.world.get(x, y, z);
    this.built.push([x, y, z, was]);
    this.sim.setStructure(x, y, z, b);
  }

  buildCourse(sp) {
    this.course = [];
    let ang = Math.random() * Math.PI * 2, x = sp.x, z = sp.z;
    for (let k = 0; k < 5; k++) {
      ang += (Math.random() - 0.5) * 1.2;
      const d = 40 + Math.random() * 20;
      x = Math.round(x + Math.cos(ang) * d); z = Math.round(z + Math.sin(ang) * d);
      const y = this.sim.surfaceAt(x, z);
      for (let h = 0; h < 5; h++) this.place(x, y + h, z, B.TRAIL_BEACON);
      this.course.push({ x, y, z });
    }
  }

  buildArena(sp) {
    if (this.arena) return;
    let top = 0;
    for (let dz = -12; dz <= 12; dz += 4) for (let dx = -12; dx <= 12; dx += 4) top = Math.max(top, this.sim.surfaceAt(sp.x + dx, sp.z + dz));
    const y = Math.min(WH - 12, top + 22);
    const cx = Math.floor(sp.x), cz = Math.floor(sp.z);
    for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
      this.sim.setStructure(cx + dx, y, cz + dz, B.ARENA_STONE);
      const edge = Math.abs(dx) === 10 || Math.abs(dz) === 10;
      if (edge) {
        this.sim.setStructure(cx + dx, y + 1, cz + dz, B.ARENA_STONE);
        if ((Math.abs(dx) === 10 && Math.abs(dz) === 10)) for (let h = 2; h <= 3; h++) this.sim.setStructure(cx + dx, y + h, cz + dz, h === 3 ? B.LANTERN : B.ARENA_STONE);
      }
    }
    this.arena = { x: cx, y, z: cz };
  }

  /* ---------------- telling players ---------------- */
  broadcast() {
    const s = this.standings().slice(0, 8);
    const base = {
      t: 'round', mode: this.mode, name: MODES[this.mode].name, phase: this.phase, left: Math.max(0, Math.ceil(this.t)), round: this.round,
      targets: this.targets ? this.targets.map(t => ({ name: t.name, n: t.n, icon: t.ids[0] })) : null,
      course: this.course ? this.course.length : 0,
      board: s.map(r => ({ name: r.name, cp: r.cp, done: r.done, kos: r.kos, hp: Math.max(0, r.hp), out: r.out, score: this.mode === 'harvest' ? Math.round(this.score(r) * 100) : undefined })),
    };
    for (const p of this.sim.players.values()) {
      const r = this.players.get(p.id);
      const you = r ? { cp: r.cp, done: r.done, got: r.got, out: r.out, next: this.course?.[r.cp] || null, playing: true } : { playing: false };
      this.sim.send(p, { ...base, you });
    }
  }
}
