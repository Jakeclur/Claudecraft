// Lighting and meshing for one chunk, given the blocks of its 3x3 neighbourhood.
// Light is flooded over the whole 48-wide area so values at the centre chunk are exact
// (no light travels further than 15 blocks), then the centre chunk is meshed with smooth
// per-vertex light and ambient occlusion into compact typed arrays.
import { BLOCKS, IS_OPAQUE, KIND, EMIT, B, WATERY, LIQ_TYPE, LIQ_LEVEL, tileUV } from './blocks.js';
import { CHUNK, WH } from './consts.js';

const PW = CHUNK * 3;           // padded width
const L = PW * PW;              // one horizontal layer
const DIM = new Uint8Array(256);
DIM[B.LEAVES] = 1; DIM[B.PINE_LEAVES] = 1; DIM[B.BLOSSOM] = 1; DIM[B.WATER] = 1; DIM[B.LAVA] = 2;
DIM[B.KELP] = 1; DIM[B.SEA_FAN] = 1; DIM[B.ANEMONE] = 1; DIM[B.ICE] = 0;

const CURVE = new Float32Array(16);
for (let i = 0; i < 16; i++) CURVE[i] = Math.pow(0.82, 15 - i);
const AO = [0.45, 0.64, 0.83, 1.0];

const FACES = [
  { n: [1, 0, 0], shade: 0.86, side: 1, c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], shade: 0.86, side: 1, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 0, 1], shade: 0.74, side: 1, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], shade: 0.74, side: 1, c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 1, 0], shade: 1.0, side: 0, c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], shade: 0.6, side: 2, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
];
for (const f of FACES) {
  const axes = [0, 1, 2].filter(a => f.n[a] === 0);
  f.t = f.c.map(c => axes.map(a => { const v = [0, 0, 0]; v[a] = c[a] ? 1 : -1; return v; }));
  f.d = f.n[0] + f.n[2] * PW + f.n[1] * L;
  f.td = f.t.map(([a, b]) => [a[0] + a[2] * PW + a[1] * L, b[0] + b[2] * PW + b[1] * L]);
}
const UVC = [[0, 0], [1, 0], [1, 1], [0, 1]];

// growable vertex buffer in the compact format
class Buf {
  constructor(cap = 4096) { this.alloc(cap); this.n = 0; this.ni = 0; }
  alloc(cap) {
    const pos = new Int16Array(cap * 3), uv = new Uint16Array(cap * 2), light = new Uint8Array(cap * 4), idx = new Uint32Array(cap * 1.5);
    if (this.pos) { pos.set(this.pos); uv.set(this.uv); light.set(this.light); idx.set(this.idx); }
    this.pos = pos; this.uv = uv; this.light = light; this.idx = idx; this.cap = cap;
  }
  quad(P, U, LT, nrm, flip) {
    if (this.n + 4 > this.cap) this.alloc(this.cap * 2);
    const n = this.n;
    for (let k = 0; k < 4; k++) {
      const v = n + k;
      this.pos[v * 3] = Math.round(P[k][0] * 16); this.pos[v * 3 + 1] = Math.round(P[k][1] * 16); this.pos[v * 3 + 2] = Math.round(P[k][2] * 16);
      this.uv[v * 2] = Math.round(U[k][0] * 65535); this.uv[v * 2 + 1] = Math.round(U[k][1] * 65535);
      this.light[v * 4] = LT[k][0] * 255; this.light[v * 4 + 1] = LT[k][1] * 255; this.light[v * 4 + 2] = LT[k][2] * 255; this.light[v * 4 + 3] = nrm * 40;
    }
    const i = this.ni;
    if (flip) { this.idx[i] = n + 1; this.idx[i + 1] = n + 2; this.idx[i + 2] = n + 3; this.idx[i + 3] = n + 1; this.idx[i + 4] = n + 3; this.idx[i + 5] = n; }
    else { this.idx[i] = n; this.idx[i + 1] = n + 1; this.idx[i + 2] = n + 2; this.idx[i + 3] = n; this.idx[i + 4] = n + 2; this.idx[i + 5] = n + 3; }
    this.n += 4; this.ni += 6;
  }
  out() {
    if (!this.n) return null;
    const index = this.n < 65536 ? Uint16Array.from(this.idx.subarray(0, this.ni)) : this.idx.slice(0, this.ni);
    return { pos: this.pos.slice(0, this.n * 3), uv: this.uv.slice(0, this.n * 2), light: this.light.slice(0, this.n * 4), index };
  }
}

// neighbours: 9 Uint8Arrays (row-major dz,dx from -1..1), centre at [4]
export function lightAndMesh(neighbours) {
  const P = new Uint8Array(PW * PW * WH);
  let maxY = 0;
  for (let nz = 0; nz < 3; nz++) for (let nx = 0; nx < 3; nx++) {
    const src = neighbours[nx + nz * 3];
    if (!src) continue;
    for (let y = 0; y < WH; y++) for (let z = 0; z < CHUNK; z++) {
      const so = CHUNK * (z + CHUNK * y), dO = nx * CHUNK + PW * (nz * CHUNK + z) + L * y;
      P.set(src.subarray(so, so + CHUNK), dO);
    }
  }
  for (let i = P.length - 1; i >= 0; i--) if (P[i]) { maxY = Math.floor(i / L); break; }
  const top = Math.min(WH - 1, maxY + 1);

  /* ---------------- light ---------------- */
  const sky = new Uint8Array(P.length), blk = new Uint8Array(P.length);
  for (let z = 0; z < PW; z++) for (let x = 0; x < PW; x++) {
    let l = 15;
    for (let y = WH - 1; y >= 0; y--) {
      const i = x + PW * z + L * y, b = P[i];
      if (IS_OPAQUE[b]) l = 0; else if (DIM[b]) l = Math.max(0, l - DIM[b]);
      sky[i] = l; blk[i] = EMIT[b];
    }
  }
  const queue = new Int32Array(P.length);
  const flood = arr => {
    let head = 0, tail = 0;
    for (let y = 0; y <= top; y++) for (let z = 0; z < PW; z++) for (let x = 0; x < PW; x++) {
      const i = x + PW * z + L * y, v = arr[i];
      if (v < 2) continue;
      const lim = v - 1;
      if ((x > 0 && arr[i - 1] < lim && !IS_OPAQUE[P[i - 1]]) || (x < PW - 1 && arr[i + 1] < lim && !IS_OPAQUE[P[i + 1]]) ||
          (z > 0 && arr[i - PW] < lim && !IS_OPAQUE[P[i - PW]]) || (z < PW - 1 && arr[i + PW] < lim && !IS_OPAQUE[P[i + PW]]) ||
          (y > 0 && arr[i - L] < lim && !IS_OPAQUE[P[i - L]]) || (y < WH - 1 && arr[i + L] < lim && !IS_OPAQUE[P[i + L]])) queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++], v = arr[i];
      if (v < 2) continue;
      const x = i % PW, z = Math.floor(i / PW) % PW, y = Math.floor(i / L);
      const go = j => {
        const b = P[j];
        if (IS_OPAQUE[b]) return;
        const nv = v - 1 - DIM[b];
        if (arr[j] < nv) { arr[j] = nv; queue[tail++] = j; }
      };
      if (x > 0) go(i - 1); if (x < PW - 1) go(i + 1);
      if (z > 0) go(i - PW); if (z < PW - 1) go(i + PW);
      if (y > 0) go(i - L); if (y < WH - 1) go(i + L);
    }
  };
  flood(sky); flood(blk);

  // packed light of the centre chunk (sky << 4 | block) for the main thread
  const light = new Uint8Array(CHUNK * CHUNK * WH);
  for (let y = 0; y < WH; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const i = (x + CHUNK) + PW * (z + CHUNK) + L * y;
    light[x + CHUNK * (z + CHUNK * y)] = (sky[i] << 4) | blk[i];
  }

  /* ---------------- mesh ---------------- */
  const solid = new Buf(8192), water = new Buf(1024);
  const glow = [];
  const Pq = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const Uq = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const LT = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const opq = j => j < 0 || j >= P.length ? 0 : IS_OPAQUE[P[j]];
  const lerpCurve = v => { const f = Math.floor(v), c = Math.min(15, f + 1); return CURVE[f] + (CURVE[c] - CURVE[f]) * (v - f); };

  for (let y = 0; y <= top; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const i = (lx + CHUNK) + PW * (lz + CHUNK) + L * y;
        const b = P[i];
        if (!b) continue;
        const kind = KIND[b], def = BLOCKS[b], emit = EMIT[b];
        if (emit >= 6 || b === B.CRYSTAL) { if (!IS_OPAQUE[P[i + L]]) glow.push(lx, y, lz, b); }

        if (kind === 4) { // cross plant
          const [u0, v0, u1, v1] = tileUV(def.tex[0]);
          const s = CURVE[sky[i]], k = emit ? 1 : CURVE[blk[i]];
          const h = b === B.TORCH ? 0.85 : 1;
          const jx = b === B.TORCH || b === B.GLOW_ORB ? 0 : ((lx * 7 + lz * 13 + y) % 5 - 2) * 0.04;
          for (const [a, c] of [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]]) {
            for (const rev of [false, true]) {
              const A = rev ? c : a, C = rev ? a : c;
              Pq[0] = [lx + A[0] + jx, y, lz + A[1]]; Pq[1] = [lx + C[0] + jx, y, lz + C[1]];
              Pq[2] = [lx + C[0] + jx, y + h, lz + C[1]]; Pq[3] = [lx + A[0] + jx, y + h, lz + A[1]];
              Uq[0] = [u0, v0]; Uq[1] = [u1, v0]; Uq[2] = [u1, v1]; Uq[3] = [u0, v1];
              for (let q = 0; q < 4; q++) LT[q] = [s, k, 0.92];
              solid.quad(Pq, Uq, LT, 6, false);
            }
          }
          if (!WATERY[b]) continue;
        }

        const isLiquid = kind === 3 || WATERY[b];
        const lt = WATERY[b] ? 1 : LIQ_TYPE[b];
        const liquidId = lt === 1 ? B.WATER : lt === 2 ? B.LAVA : b;
        const out = lt === 1 ? water : solid;
        const aboveB = P[i + L];
        const sameAbove = lt === 1 ? WATERY[aboveB] : lt === 2 ? LIQ_TYPE[aboveB] === 2 : aboveB === b;
        // flowing liquid is lower the further it has run
        const lvl = WATERY[b] && !LIQ_LEVEL[b] ? 8 : LIQ_LEVEL[b] || 8;
        const topH = isLiquid && !sameAbove ? Math.max(0.12, 0.875 * lvl / 8) : 1;
        const texB = liquidId;
        const tdef = BLOCKS[texB];

        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          if (y === 0 && f === 5) continue;
          const ni = i + F.d;
          if (ni >= P.length) continue;
          const nb = P[ni];
          if (IS_OPAQUE[nb]) continue;
          if (isLiquid) {
            if (lt === 1 ? WATERY[nb] : lt === 2 ? LIQ_TYPE[nb] === 2 : nb === b) continue;
            if (KIND[nb] === 2 && F.n[1] !== 1) continue;
          } else if (def.glass && nb === b) continue;
          const [u0, v0, u1, v1] = tileUV(tdef.tex[F.side]);
          let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
          for (let k = 0; k < 4; k++) {
            const c = F.c[k];
            Pq[k] = [lx + c[0], y + (isLiquid && c[1] === 1 ? topH : c[1]), lz + c[2]];
            Uq[k] = [UVC[k][0] ? u1 : u0, UVC[k][1] ? v1 : v0];
            if (isLiquid && F.side === 1 && c[1] === 1 && topH < 1) Uq[k][1] = v0 + (v1 - v0) * topH;
            const [d1, d2] = F.td[k];
            const s1 = opq(ni + d1), s2 = opq(ni + d2);
            const cr = (s1 && s2) ? 1 : opq(ni + d1 + d2);
            const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + cr);
            let ss = sky[ni], sb = blk[ni], cnt = 1;
            if (!s1) { ss += sky[ni + d1]; sb += blk[ni + d1]; cnt++; }
            if (!s2) { ss += sky[ni + d2]; sb += blk[ni + d2]; cnt++; }
            if (!cr) { ss += sky[ni + d1 + d2]; sb += blk[ni + d1 + d2]; cnt++; }
            const sv = lerpCurve(ss / cnt), bv = emit ? 1 : lerpCurve(sb / cnt);
            LT[k] = [sv, bv, (emit || isLiquid ? 1 : AO[ao]) * F.shade];
            if (k === 0) a0 = ao; else if (k === 1) a1 = ao; else if (k === 2) a2 = ao; else a3 = ao;
          }
          out.quad(Pq, Uq, LT, f, a0 + a2 < a1 + a3);
          if (liquidId === B.WATER && F.n[1] === 1) {
            out.quad([Pq[3], Pq[2], Pq[1], Pq[0]], [Uq[3], Uq[2], Uq[1], Uq[0]], [LT[3], LT[2], LT[1], LT[0]], 5, false);
          }
        }
      }
    }
  }
  return { light, solid: solid.out(), water: water.out(), glow: Int16Array.from(glow) };
}
