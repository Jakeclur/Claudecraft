// Endless chunked world on the main thread: storage, block access, and a worker pool
// that generates, lights and meshes chunks around the player.
import { IS_SOLID, KIND, WATERY, B } from './blocks.js';
import { CHUNK, WH, SEA, CHUNK_VOL } from './consts.js';
import { Terrain } from './terrain.js';
import { columnTop } from './gen.js';

const key = (cx, cz) => cx + ',' + cz;
const fdiv = (a, b) => Math.floor(a / b);

export class World {
  /*
    hooks: {
      onMesh(chunk, data)       mesh data arrived for a chunk
      onUnload(chunk)           chunk dropped from memory
      onGenerated(chunk)        blocks ready (villages, ruins in chunk.meta)
      loadSaved(key)            Promise<Uint8Array|null> of a saved chunk
      hasSaved(key)             boolean
      saveChunk(chunk)          persist a modified chunk before unloading
    }
  */
  constructor(seed, hooks = {}) {
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.hooks = hooks;
    this.chunks = new Map();
    this.serverEdits = new Map(); // chunk key -> [[x,y,z,b]] from the multiplayer server
    this.radius = 6;
    this.pending = new Map();     // job id -> chunk key
    this.jobId = 1;
    this.urgent = new Set();
    this.lastCenter = '';
    this.stats = { gen: 0, mesh: 0 };
    this.startWorkers();
  }

  startWorkers() {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    this.workers = [];
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.busy = 0;
        w.onmessage = e => { w.busy--; this.onWorker(e.data); };
        w.onerror = e => { console.error('worker error', e.message); };
        w.postMessage({ type: 'init', seed: this.seed });
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('Workers unavailable, generating on the main thread', err);
      this.workers = [];
    }
    if (!this.workers.length) {
      // fallback: same code, run inline with a time budget
      this.inline = Promise.all([import('./gen.js'), import('./mesher.js')]).then(([g, m]) => { this.genFn = g.generateChunk; this.meshFn = m.lightAndMesh; });
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const c of this.chunks.values()) this.hooks.onUnload?.(c);
    this.chunks.clear();
  }

  /* ---------------- block access ---------------- */
  chunkAt(x, z) { return this.chunks.get(key(fdiv(x, CHUNK), fdiv(z, CHUNK))); }
  get(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const c = this.chunks.get(key(fdiv(x, CHUNK), fdiv(z, CHUNK)));
    if (!c || !c.blocks) return 0;
    return c.blocks[(x - c.cx * CHUNK) + CHUNK * ((z - c.cz * CHUNK) + CHUNK * y)];
  }
  loaded(x, z) { const c = this.chunkAt(Math.floor(x), Math.floor(z)); return !!(c && c.blocks); }
  solidAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return true;
    if (y >= WH) return false;
    const c = this.chunkAt(x, z);
    if (!c || !c.blocks) return true; // unloaded ground holds you up until it arrives
    return IS_SOLID[c.blocks[(x - c.cx * CHUNK) + CHUNK * ((z - c.cz * CHUNK) + CHUNK * y)]] === 1;
  }
  lightAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y >= WH) return { sky: 15, blk: 0 };
    if (y < 0) return { sky: 0, blk: 0 };
    const c = this.chunkAt(x, z);
    if (!c || !c.light) return { sky: 15, blk: 0 };
    const v = c.light[(x - c.cx * CHUNK) + CHUNK * ((z - c.cz * CHUNK) + CHUNK * y)];
    return { sky: v >> 4, blk: v & 15 };
  }
  biomeAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const c = this.chunkAt(x, z);
    if (c && c.biome) return c.biome[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK];
    return this.terrain.column(x, z).biome;
  }
  surfaceY(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const c = this.chunkAt(x, z);
    if (!c || !c.blocks) return this.terrain.column(x, z).h + 1;
    for (let y = WH - 2; y > 0; y--) {
      const b = this.get(x, y, z);
      if (IS_SOLID[b] || KIND[b] === 3) return y + 1;
    }
    return 1;
  }
  // stand-able ground under (x, y, z), searching downward
  groundBelow(x, y, z) {
    for (let yy = Math.min(WH - 2, Math.floor(y)); yy > 0; yy--) if (IS_SOLID[this.get(x, yy - 1, z)]) return yy;
    return null;
  }

  set(x, y, z, b, { remote = false } = {}) {
    if (y < 1 || y >= WH - 1) return false;
    const c = this.chunkAt(x, z);
    if (!c || !c.blocks) return false;
    const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
    const i = lx + CHUNK * (lz + CHUNK * y);
    if (c.blocks[i] === b) return false;
    c.blocks[i] = b;
    c.modified = true;
    c.version++;
    const [ty, tb] = columnTop(c.blocks, lx, lz);
    c.height[lx + lz * CHUNK] = ty; c.top[lx + lz * CHUNK] = tb;
    c.mapDirty = true;
    this.urgent.add(c.key);
    // light can change up to 15 blocks away, so neighbours get rebuilt too
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (n && n.blocks) n.version++;
    }
    // tell neighbours on the border immediately so faces close up
    if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
      for (const [ox, oz] of [[lx === 0 ? -1 : lx === 15 ? 1 : 0, 0], [0, lz === 0 ? -1 : lz === 15 ? 1 : 0]]) {
        if (!ox && !oz) continue;
        const n = this.chunks.get(key(c.cx + ox, c.cz + oz));
        if (n) this.urgent.add(n.key);
      }
    }
    return true;
  }

  /* ---------------- streaming ---------------- */
  setRadius(r) { this.radius = r; this.lastCenter = ''; }

  // called every frame
  update(px, pz) {
    const pcx = fdiv(Math.floor(px), CHUNK), pcz = fdiv(Math.floor(pz), CHUNK);
    const centre = pcx + ',' + pcz + ',' + this.radius;
    const R = this.radius;
    if (centre !== this.lastCenter) {
      this.lastCenter = centre;
      // create records for everything in range (+1 ring for neighbours), sorted by distance
      const want = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        if (dx * dx + dz * dz > (R + 1.5) * (R + 1.5)) continue;
        want.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
      }
      want.sort((a, b) => a[2] - b[2]);
      this.wantList = want;
      // unload far chunks
      for (const c of this.chunks.values()) {
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        if (d > R + 3 && c.state !== 'generating') {
          if (c.modified) this.hooks.saveChunk?.(c);
          this.hooks.onUnload?.(c);
          this.chunks.delete(c.key);
        }
      }
    }
    this.pump(pcx, pcz);
  }

  freeWorker() {
    let best = null;
    for (const w of this.workers) if (w.busy < 2 && (!best || w.busy < best.busy)) best = w;
    return best;
  }

  pump(pcx, pcz) {
    if (!this.workers.length) return this.pumpInline(pcx, pcz);
    // urgent remeshes first (edits), then generation and meshing by distance
    for (const k of this.urgent) {
      const c = this.chunks.get(k);
      if (!c || !c.blocks) { this.urgent.delete(k); continue; }
      if (c.meshing) continue; // the result will come back stale and re-queue itself
      const w = this.freeWorker();
      if (!w) return;
      this.requestMesh(c, w);
      this.urgent.delete(k);
    }
    if (!this.wantList) return;
    const R = this.radius;
    for (const [cx, cz, d2] of this.wantList) {
      const w = this.freeWorker();
      if (!w) return;
      const k = key(cx, cz);
      let c = this.chunks.get(k);
      if (!c) {
        c = { key: k, cx, cz, blocks: null, light: null, state: 'generating', version: 0, meshed: -1, meshing: false, modified: false };
        this.chunks.set(k, c);
        this.requestGen(c, w);
        continue;
      }
      if (d2 <= (R + 0.5) * (R + 0.5) && c.blocks && c.meshed !== c.version && !c.meshing) this.requestMesh(c, w);
    }
  }

  requestGen(c, w) {
    const id = this.jobId++;
    this.pending.set(id, c.key);
    w.busy++;
    w.postMessage({ type: 'gen', id, cx: c.cx, cz: c.cz });
  }

  neighbours(c) {
    const nb = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (!n || !n.blocks) return null;
      nb.push(n.blocks);
    }
    return nb;
  }

  requestMesh(c, w) {
    const nb = this.neighbours(c);
    if (!nb) return false;
    const id = this.jobId++;
    this.pending.set(id, c.key);
    c.meshing = true;
    w.busy++;
    // copies go to the worker; the originals stay here for physics and edits
    w.postMessage({ type: 'mesh', id, cx: c.cx, cz: c.cz, version: c.version, nb: nb.map(a => a.slice()) });
    return true;
  }

  async onWorker(m) {
    const k = this.pending.get(m.id);
    this.pending.delete(m.id);
    if (m.type === 'error') { console.error(m.message); const c = this.chunks.get(k); if (c) c.meshing = false; return; }
    const c = this.chunks.get(k);
    if (!c) return; // unloaded while working
    if (m.type === 'gen') await this.acceptGen(c, m);
    else if (m.type === 'mesh') {
      c.meshing = false;
      c.light = m.light;
      c.meshed = m.version;
      c.glow = m.glow;
      this.stats.mesh++;
      this.hooks.onMesh?.(c, m);
      if (m.version !== c.version) this.urgent.add(c.key);
    }
  }

  async acceptGen(c, m) {
    let blocks = m.blocks;
    if (this.hooks.hasSaved?.(c.key)) {
      const saved = await this.hooks.loadSaved(c.key);
      if (saved && saved.length === CHUNK_VOL) { blocks = saved; c.modified = true; }
    }
    if (!this.chunks.has(c.key)) return;
    c.blocks = blocks; c.height = m.height; c.top = m.top; c.biome = m.biome; c.meta = m.meta;
    const edits = this.serverEdits.get(c.key);
    if (edits) for (const [x, y, z, b] of edits) c.blocks[(x - c.cx * CHUNK) + CHUNK * ((z - c.cz * CHUNK) + CHUNK * y)] = b;
    if (edits || blocks !== m.blocks) {
      for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
        const [ty, tb] = columnTop(c.blocks, lx, lz); c.height[lx + lz * CHUNK] = ty; c.top[lx + lz * CHUNK] = tb;
      }
    }
    c.state = 'ready';
    c.mapDirty = true;
    this.stats.gen++;
    // neighbours that were waiting for this chunk can mesh now
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (n && n.blocks && (dx || dz) && n.meshed >= 0) n.version++;
    }
    this.hooks.onGenerated?.(c);
  }

  // used when workers are not available
  pumpInline(pcx, pcz) {
    if (!this.genFn || !this.wantList) return;
    const t0 = performance.now();
    const R = this.radius;
    for (const k of [...this.urgent]) {
      const c = this.chunks.get(k); this.urgent.delete(k);
      if (c && c.blocks) this.inlineMesh(c);
    }
    for (const [cx, cz, d2] of this.wantList) {
      if (performance.now() - t0 > 12) return;
      const k = key(cx, cz);
      let c = this.chunks.get(k);
      if (!c) {
        c = { key: k, cx, cz, blocks: null, light: null, state: 'generating', version: 0, meshed: -1, meshing: false, modified: false };
        this.chunks.set(k, c);
        const r = this.genFn(this.terrain, cx, cz);
        this.acceptGen(c, r);
        continue;
      }
      if (d2 <= (R + 0.5) * (R + 0.5) && c.blocks && c.meshed !== c.version) this.inlineMesh(c);
    }
  }
  inlineMesh(c) {
    const nb = this.neighbours(c);
    if (!nb) return;
    const r = this.meshFn(nb);
    c.light = r.light; c.meshed = c.version; c.glow = r.glow;
    this.hooks.onMesh?.(c, r);
  }

  // how many chunks around the player are ready (for the loading screen)
  readyAround(px, pz, r) {
    const pcx = fdiv(Math.floor(px), CHUNK), pcz = fdiv(Math.floor(pz), CHUNK);
    let ready = 0, total = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      total++;
      const c = this.chunks.get(key(pcx + dx, pcz + dz));
      if (c && c.meshed >= 0) ready++;
    }
    return ready / total;
  }

  allModified() { return [...this.chunks.values()].filter(c => c.modified && c.blocks); }
}

export { SEA, WH, CHUNK };
export function isWatery(id) { return WATERY[id] === 1; }
export { B };
