// Pure terrain functions: climate, biome blending, column heights, and where villages and ruins go.
// Every answer depends only on (seed, x, z), so any chunk can be generated on its own in any order.
import { Simplex, hash3 } from './noise.js';
import { BIOME, SEA, WH } from './consts.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// land biomes live in (temperature, humidity) space
const LAND = [
  { b: BIOME.FOREST, t: 0.0, m: 0.22 },
  { b: BIOME.DESERT, t: 0.34, m: -0.28 },
  { b: BIOME.VOLCANIC, t: 0.36, m: 0.26 },
  { b: BIOME.CLIFFS, t: -0.04, m: -0.3 },
  { b: BIOME.TUNDRA, t: -0.36, m: 0.02 },
];
const SIGMA2 = 0.011;

export const VILLAGE_CELL = 256;
export const RUIN_CELL = 160;
const VOLCANO_CELL = 220;

export class Terrain {
  constructor(seed) {
    this.seed = seed | 0;
    this.n = new Simplex(seed);
    this.n2 = new Simplex(seed + 101);
    this.n3 = new Simplex(seed + 202);
    this.n4 = new Simplex(seed + 303);
    this.villages = new Map();
    this.ruins = new Map();
  }

  // ridged multifractal, 0..1, used for the fractal cliffs
  ridged(x, z, oct = 5) {
    let sum = 0, amp = 0.5, freq = 1, weight = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      let s = 1 - Math.abs(this.n4.noise2(x * freq, z * freq));
      s *= s; s *= weight;
      weight = Math.min(1, Math.max(0, s * 2));
      sum += s * amp; norm += amp;
      amp *= 0.5; freq *= 2.03;
    }
    return sum / norm;
  }

  volcanoDist(x, z) {
    let best = 1e9;
    const ci = Math.floor(x / VOLCANO_CELL), cj = Math.floor(z / VOLCANO_CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (hash3(i, 91, j, this.seed) > 0.65) continue;
      const vx = i * VOLCANO_CELL + 50 + hash3(i, 92, j, this.seed) * 120, vz = j * VOLCANO_CELL + 50 + hash3(i, 93, j, this.seed) * 120;
      best = Math.min(best, Math.hypot(x - vx, z - vz));
    }
    return best;
  }

  // Everything known about one column without touching block data.
  column(x, z) {
    const n = this.n, n2 = this.n2;
    const wx = x + n.noise2(x / 300, z / 300) * 70, wz = z + n.noise2(x / 300 + 40, z / 300 - 40) * 70;
    const temp = n.fbm2(wx / 1100, wz / 1100, 3);
    const humid = n2.fbm2(wx / 900 + 31, wz / 900 - 17, 3);
    const cont = n2.fbm2(wx / 1500 + 71, wz / 1500 + 11, 4) + 0.12;
    const weird = n.fbm2(wx / 620 - 50, wz / 620 + 90, 3);

    // land biome weights
    let wsum = 0, best = BIOME.FOREST, bestW = -1;
    const w = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const L of LAND) {
      const d = (temp - L.t) ** 2 + (humid - L.m) ** 2;
      const v = Math.exp(-d / SIGMA2);
      w[L.b] = v; wsum += v;
      if (v > bestW) { bestW = v; best = L.b; }
    }
    if (wsum < 1e-6) { w[BIOME.FOREST] = 1; wsum = 1; }
    for (let i = 0; i < 8; i++) w[i] /= wsum;

    const landW = smooth(-0.1, 0.02, cont);
    const skyW = smooth(0.26, 0.36, weird) * (1 - w[BIOME.VOLCANIC]);
    const warm = smooth(0.0, 0.14, temp);

    // per-biome heights (only computed where they matter)
    let land = 0;
    let lavaTop = -1, cliff = 0;
    if (w[BIOME.FOREST] > 0.01) land += w[BIOME.FOREST] * (55 + n.fbm2(x / 90, z / 90, 4) * 11 + n2.noise2(x / 24, z / 24) * 2);
    if (w[BIOME.DESERT] > 0.01) land += w[BIOME.DESERT] * (52 + Math.abs(n2.noise2(x / 40, z / 70)) * 9 + n.fbm2(x / 120 + 9, z / 120, 3) * 4);
    if (w[BIOME.TUNDRA] > 0.01) land += w[BIOME.TUNDRA] * (53 + n.fbm2(x / 80 - 7, z / 80, 4) * 8);
    if (w[BIOME.VOLCANIC] > 0.01) {
      const ridge = Math.pow(1 - Math.abs(this.n3.fbm2(x / 70, z / 70, 4)), 2);
      const dv = this.volcanoDist(x, z);
      const cone = dv < 6 ? 36 - (6 - dv) * 1.3 : Math.max(0, 43 - dv * 1.15);
      const base = 54 + ridge * 22;
      land += w[BIOME.VOLCANIC] * (base + cone);
      if (dv < 6 && w[BIOME.VOLCANIC] > 0.8) lavaTop = Math.floor(base + 34);
    }
    if (w[BIOME.CLIFFS] > 0.01) {
      const r = this.ridged(x / 120, z / 120);
      const h0 = 50 + r * 58;
      const step = 7, t = h0 / step, f = t - Math.floor(t);
      const terr = (Math.floor(t) + smooth(0.35, 0.65, f)) * step;
      land += w[BIOME.CLIFFS] * terr;
      cliff = w[BIOME.CLIFFS];
    }
    // floating-isle regions have low ground: a shallow sea dotted with islets
    if (skyW > 0) land = land * (1 - skyW) + skyW * (45 + n.fbm2(x / 50 + 30, z / 50, 3) * 6);

    const reef = warm * smooth(-0.32, -0.2, cont);
    const sea = (26 + n.fbm2(x / 80, z / 80, 3) * 6) * (1 - reef) + reef * (41 + n2.fbm2(x / 50, z / 50, 3) * 5);
    let h = sea + (land - sea) * landW;
    h = Math.max(4, Math.min(WH - 10, Math.floor(h)));

    let biome;
    if (landW < 0.5) biome = reef > 0.5 ? BIOME.REEF : BIOME.OCEAN;
    else if (skyW > 0.5) biome = BIOME.SKY;
    else biome = best;

    // floating island above this column?
    let islandTop = 0, islandBottom = 0;
    if (skyW > 0.3) {
      const m = n.fbm2(x / 45 + 200, z / 45 + 200, 3);
      const t = 0.12 + (1 - skyW) * 0.6;
      if (m > t) {
        const k = m - t;
        islandTop = Math.min(WH - 8, Math.floor(88 + n2.noise2(x / 60, z / 60) * 8 + k * 14));
        islandBottom = islandTop - Math.floor(2 + k * 44 + n.noise2(x / 7, z / 7) * 2);
        if (islandTop <= h + 8) islandTop = 0;
      }
    }

    // underground glowing caverns
    const lumen = smooth(0.18, 0.3, this.n3.fbm2(x / 360 + 500, z / 360, 3));

    return { h, biome, w, landW, skyW, temp, humid, lavaTop, cliff, islandTop, islandBottom, lumen, reef };
  }

  /* ---------------- villages ---------------- */
  village(ci, cj) {
    const key = ci + ',' + cj;
    if (this.villages.has(key)) return this.villages.get(key);
    let v = null;
    if (hash3(ci, 501, cj, this.seed) < 0.55) {
      const cx = ci * VILLAGE_CELL + 48 + Math.floor(hash3(ci, 502, cj, this.seed) * 160);
      const cz = cj * VILLAGE_CELL + 48 + Math.floor(hash3(ci, 503, cj, this.seed) * 160);
      const col = this.column(cx, cz);
      const ok = col.landW > 0.95 && col.skyW < 0.2 && col.w[BIOME.VOLCANIC] < 0.3 && col.h > SEA + 1 && col.h < 92 &&
        [BIOME.FOREST, BIOME.DESERT, BIOME.TUNDRA, BIOME.CLIFFS].includes(col.biome);
      if (ok) {
        const id = `v${ci}_${cj}`;
        const nh = 4 + Math.floor(hash3(ci, 504, cj, this.seed) * 3);
        const huts = [];
        const a0 = hash3(ci, 505, cj, this.seed) * Math.PI * 2;
        for (let k = 0; k < nh; k++) {
          const a = a0 + (k / nh) * Math.PI * 2 + (hash3(ci, 510 + k, cj, this.seed) - 0.5) * 0.4;
          const r = 12 + hash3(ci, 520 + k, cj, this.seed) * 5;
          const hx = Math.round(cx + Math.cos(a) * r), hz = Math.round(cz + Math.sin(a) * r);
          const size = hash3(ci, 530 + k, cj, this.seed) < 0.4 ? 3 : 2; // half-size: 5x5 or 7x7
          // door faces the plaza: pick the side closest to the centre
          const dx = cx - hx, dz = cz - hz;
          const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n');
          const floor = this.column(hx, hz).h + 1;
          huts.push({ x: hx, z: hz, s: size, side, floor, role: k });
        }
        // villages need fairly level ground, or huts end up perched on stilts
        const flat = huts.every(h => Math.abs(h.floor - (col.h + 1)) <= 5);
        if (flat) v = { id, x: cx, z: cz, y: col.h + 1, biome: col.biome, huts };
      }
    }
    this.villages.set(key, v);
    return v;
  }

  villageNear(x, z, pad = 30) {
    const v = this.village(Math.floor(x / VILLAGE_CELL), Math.floor(z / VILLAGE_CELL));
    if (v && Math.abs(x - v.x) < pad && Math.abs(z - v.z) < pad) return v;
    return null;
  }

  /* ---------------- waystone ruins ---------------- */
  ruin(ci, cj) {
    const key = ci + ',' + cj;
    if (this.ruins.has(key)) return this.ruins.get(key);
    let r = null;
    if (hash3(ci, 601, cj, this.seed) < 0.4) {
      const x = ci * RUIN_CELL + 20 + Math.floor(hash3(ci, 602, cj, this.seed) * 120);
      const z = cj * RUIN_CELL + 20 + Math.floor(hash3(ci, 603, cj, this.seed) * 120);
      const col = this.column(x, z);
      if (col.landW > 0.9 && col.h > SEA && col.h < 100 && !this.villageNear(x, z, 40)) r = { x, z, y: col.h + 1, id: `w${ci}_${cj}` };
    }
    this.ruins.set(key, r);
    return r;
  }

  ruinNear(x, z, pad = 6) {
    const r = this.ruin(Math.floor(x / RUIN_CELL), Math.floor(z / RUIN_CELL));
    if (r && Math.abs(x - r.x) <= pad && Math.abs(z - r.z) <= pad) return r;
    return null;
  }

  // Search outward for the nearest column of a biome (used by villager rumours and quests)
  findBiome(x, z, biome, maxR = 1200) {
    for (let r = 64; r <= maxR; r += 64) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const px = Math.round(x + Math.cos(ang) * r), pz = Math.round(z + Math.sin(ang) * r);
        if (this.column(px, pz).biome === biome) return { x: px, z: pz, dist: r };
      }
    }
    return null;
  }

  findSpawn() {
    // start within sight of the nearest village so there's someone to meet
    let best = null;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const v = this.village(i, j);
      if (v && (!best || Math.hypot(v.x, v.z) < Math.hypot(best.x, best.z))) best = v;
    }
    if (best) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(best.x + Math.cos(a / 16 * Math.PI * 2) * 34), z = Math.round(best.z + Math.sin(a / 16 * Math.PI * 2) * 34);
        const c = this.column(x, z);
        if (c.h > SEA + 1 && c.landW > 0.9 && Math.abs(c.h - best.y) < 10) return { x: x + 0.5, z: z + 0.5 };
      }
    }
    for (let r = 0; r < 4000; r += 32) {
      for (let a = 0; a < 12; a++) {
        const x = Math.round(Math.cos(a / 12 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 12 * Math.PI * 2) * r);
        const c = this.column(x, z);
        if (c.biome === BIOME.FOREST && c.h > SEA + 2 && c.h < 75) return { x: x + 0.5, z: z + 0.5 };
      }
    }
    return { x: 0.5, z: 0.5 };
  }
}
