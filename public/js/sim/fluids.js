// Flowing water and lava. Sources stay put; flowing cells carry a level (water 7..1, lava 6/4/2)
// that drops by one step per block sideways and resets when the liquid falls. Cells are only
// re-checked when something near them changes, so still oceans cost nothing.
import { B, KIND, LIQ_TYPE, LIQ_LEVEL, WATERY, IS_SOLID, waterFlowId, lavaFlowId } from '../blocks.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y, z) => x + ',' + y + ',' + z;

export class Fluids {
  // set(x, y, z, block) must apply and broadcast the change
  constructor(world, set) {
    this.world = world; this.set = set;
    this.water = new Map(); this.lava = new Map();
    this.tw = 0; this.tl = 0;
    this.enabled = true;
  }

  // something changed at (x, y, z): look at it and its neighbours soon
  notify(x, y, z) {
    if (!this.enabled) return;
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const px = x + dx, py = y + dy, pz = z + dz;
      const id = this.world.get(px, py, pz);
      const k = key(px, py, pz);
      // queue on both: an empty cell may be filled by either liquid
      if (LIQ_TYPE[id] !== 2) this.water.set(k, [px, py, pz]);
      if (LIQ_TYPE[id] !== 1 || id === 0) this.lava.set(k, [px, py, pz]);
    }
  }

  tick(dt) {
    if (!this.enabled) { this.water.clear(); this.lava.clear(); return; }
    this.tw += dt; this.tl += dt;
    if (this.tw >= 0.25) { this.tw = 0; this.step(1, this.water, 500); }
    if (this.tl >= 1.0) { this.tl = 0; this.step(2, this.lava, 200); }
  }

  // which liquid level should (x, y, z) hold, judged from its neighbours
  wanted(type, x, y, z) {
    const w = this.world;
    const above = w.get(x, y + 1, z);
    if (LIQ_TYPE[above] === type || (type === 1 && WATERY[above])) return type === 1 ? 7 : 6;
    let best = 0;
    for (const [dx, dz] of N4) {
      const n = w.get(x + dx, y, z + dz);
      const isType = type === 1 ? (LIQ_TYPE[n] === 1 || WATERY[n]) : LIQ_TYPE[n] === 2;
      if (!isType) continue;
      const lvl = LIQ_LEVEL[n] || 8;
      // liquid only spreads sideways from a cell that rests on something
      const under = w.get(x + dx, y - 1, z + dz);
      if (lvl < 8 && !IS_SOLID[under] && !(LIQ_TYPE[under] || WATERY[under])) continue;
      best = Math.max(best, lvl);
    }
    return Math.max(0, best - (type === 1 ? 1 : 2));
  }

  step(type, queue, budget) {
    const w = this.world;
    const cells = [...queue.values()].slice(0, budget);
    for (const c of cells) queue.delete(key(...c));
    for (const [x, y, z] of cells) {
      if (y < 1 || y > 126 || !w.loaded(x, z)) continue;
      const id = w.get(x, y, z);
      // lava touching water hardens
      if (LIQ_TYPE[id] === 2) {
        let wet = WATERY[w.get(x, y + 1, z)];
        for (const [dx, dz] of N4) if (WATERY[w.get(x + dx, y, z + dz)]) wet = 1;
        if (wet) { this.change(x, y, z, LIQ_LEVEL[id] === 8 ? B.OBSIDIAN : B.BASALT); continue; }
      }
      if (type === 1 && id === B.WATER) { this.spreadFrom(type, x, y, z); continue; }
      if (type === 2 && id === B.LAVA) { this.spreadFrom(type, x, y, z); continue; }
      const flowing = LIQ_TYPE[id] === type && LIQ_LEVEL[id] < 8;
      const replaceable = id === 0 || (KIND[id] === 4 && !WATERY[id] && id !== B.GLOW_ORB);
      if (!flowing && !replaceable) continue;
      const lvl = this.wanted(type, x, y, z);
      const want = lvl <= 0 ? 0 : type === 1 ? waterFlowId(lvl) : lavaFlowId(lvl / 2);
      if (flowing && want === id) { this.spreadFrom(type, x, y, z); continue; }
      if (!flowing && !want) continue;
      // flowing lava meeting water nearby turns to stone instead of spreading into it
      this.change(x, y, z, want);
    }
  }

  desiredId(type, x, y, z) {
    const lvl = this.wanted(type, x, y, z);
    return lvl <= 0 ? 0 : type === 1 ? waterFlowId(lvl) : lavaFlowId(lvl / 2);
  }

  // a stable liquid cell: wake up neighbours that would change (so settled pools go quiet)
  spreadFrom(type, x, y, z) {
    const w = this.world, q = type === 1 ? this.water : this.lava;
    const open = id => id === 0 || (KIND[id] === 4 && !WATERY[id] && id !== B.GLOW_ORB) || (LIQ_TYPE[id] === type && LIQ_LEVEL[id] < 8);
    const consider = (px, py, pz) => {
      if (!w.loaded(px, pz)) return;
      const n = w.get(px, py, pz);
      if (!open(n)) return;
      const want = this.desiredId(type, px, py, pz);
      if (want !== n && !(n !== 0 && KIND[n] === 4 && !want)) q.set(key(px, py, pz), [px, py, pz]);
    };
    consider(x, y - 1, z);
    for (const [dx, dz] of N4) consider(x + dx, y, z + dz);
  }

  change(x, y, z, id) {
    this.set(x, y, z, id);
    this.notify(x, y, z);
  }
}
