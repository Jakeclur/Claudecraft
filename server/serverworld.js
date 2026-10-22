// The server's copy of a world: generates chunks with the same code the browser uses,
// keeps the ones near players in memory, and saves changed chunks to disk.
import fs from 'node:fs';
import path from 'node:path';
import { Terrain } from '../public/js/terrain.js';
import { generateChunk } from '../public/js/gen.js';
import { IS_SOLID, IS_OPAQUE, KIND } from '../public/js/blocks.js';
import { CHUNK, WH, CHUNK_VOL } from '../public/js/consts.js';

const key = (cx, cz) => cx + ',' + cz;
const fdiv = (a, b) => Math.floor(a / b);

export class ServerWorld {
  constructor(seed, dir, onChunk = () => {}) {
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.dir = path.join(dir, 'chunks');
    fs.mkdirSync(this.dir, { recursive: true });
    this.chunks = new Map();
    this.onChunk = onChunk;
    // chunks that differ from freshly generated ones (on disk or in memory)
    this.modified = new Set(fs.readdirSync(this.dir).filter(f => f.endsWith('.bin')).map(f => f.slice(0, -4).replace('_', ',')));
  }

  file(k) { return path.join(this.dir, k.replace(',', '_') + '.bin'); }

  ensure(cx, cz) {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    const g = generateChunk(this.terrain, cx, cz);
    let blocks = g.blocks;
    if (this.modified.has(k)) {
      try { const buf = fs.readFileSync(this.file(k)); if (buf.length === CHUNK_VOL) blocks = new Uint8Array(buf); } catch { /* missing file: use generated */ }
    }
    c = { cx, cz, key: k, blocks, dirty: false, used: Date.now() };
    this.chunks.set(k, c);
    this.onChunk(g.meta);
    return c;
  }

  chunkAt(x, z) { return this.chunks.get(key(fdiv(Math.floor(x), CHUNK), fdiv(Math.floor(z), CHUNK))); }
  loaded(x, z) { return !!this.chunkAt(x, z); }
  get(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.blocks[(x - c.cx * CHUNK) + CHUNK * ((z - c.cz * CHUNK) + CHUNK * y)];
  }
  set(x, y, z, b) {
    if (y < 1 || y >= WH - 1) return false;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const c = this.chunkAt(x, z) || this.ensure(fdiv(x, CHUNK), fdiv(z, CHUNK));
    const i = (x - c.cx * CHUNK) + CHUNK * ((z - c.cz * CHUNK) + CHUNK * y);
    if (c.blocks[i] === b) return false;
    c.blocks[i] = b; c.dirty = true; c.used = Date.now();
    this.modified.add(c.key);
    return true;
  }
  solidAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return true;
    if (y >= WH) return false;
    if (!this.loaded(x, z)) return true;
    return IS_SOLID[this.get(x, y, z)] === 1;
  }
  biomeAt(x, z) { return this.terrain.column(Math.floor(x), Math.floor(z)).biome; }
  surfaceY(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.loaded(x, z)) return this.terrain.column(x, z).h + 1;
    for (let y = WH - 2; y > 0; y--) { const b = this.get(x, y, z); if (IS_SOLID[b] || KIND[b] === 3) return y + 1; }
    return 1;
  }
  groundBelow(x, y, z) {
    for (let yy = Math.min(WH - 2, Math.floor(y)); yy > 0; yy--) if (IS_SOLID[this.get(x, yy - 1, z)]) return yy;
    return null;
  }
  // the server has no light map; "open sky above" is a good enough stand-in
  lightAt(x, y, z) {
    x = Math.floor(x); z = Math.floor(z);
    for (let yy = Math.floor(y) + 1; yy < Math.min(WH, y + 40); yy++) if (IS_OPAQUE[this.get(x, yy, z)]) return { sky: 0, blk: 0 };
    return { sky: 15, blk: 0 };
  }

  // keep chunks near these points loaded; generate at most `budget` ms per call
  keepAround(points, r = 4, budget = 25) {
    const t0 = Date.now();
    const want = new Set();
    for (const p of points) {
      const pcx = fdiv(Math.floor(p.x), CHUNK), pcz = fdiv(Math.floor(p.z), CHUNK);
      const ring = [];
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) ring.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
      ring.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of ring) {
        const k = key(cx, cz);
        want.add(k);
        if (!this.chunks.has(k) && Date.now() - t0 < budget) this.ensure(cx, cz);
        else if (this.chunks.has(k)) this.chunks.get(k).used = Date.now();
      }
    }
    // drop chunks nobody has needed for a while
    for (const [k, c] of this.chunks) {
      if (!want.has(k) && Date.now() - c.used > 30000) { if (c.dirty) this.saveChunk(c); this.chunks.delete(k); }
    }
  }

  // full block data of a changed chunk, for players who load it
  chunkData(cx, cz) {
    const k = key(cx, cz);
    if (!this.modified.has(k)) return null;
    return this.ensure(cx, cz).blocks;
  }

  saveChunk(c) { fs.writeFileSync(this.file(c.key), Buffer.from(c.blocks.buffer, c.blocks.byteOffset, c.blocks.byteLength)); c.dirty = false; }
  save() { for (const c of this.chunks.values()) if (c.dirty) this.saveChunk(c); }
}
