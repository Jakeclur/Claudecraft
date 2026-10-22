// Chunk generation: terrain fill, cliffs, caves, glowing caverns, ores, plants, trees, coral, villages and ruins.
import { B, IS_SOLID, IS_OPAQUE } from './blocks.js';
import { hash3, mulberry32 } from './noise.js';
import { CHUNK, WH, SEA, CHUNK_VOL, BIOME } from './consts.js';
import { VILLAGE_CELL, RUIN_CELL } from './terrain.js';

const M = 3;                // margin of neighbouring columns we look at for trees
const SPAN = CHUNK + M * 2;

export function generateChunk(T, cx, cz) {
  const seed = T.seed;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const blocks = new Uint8Array(CHUNK_VOL);
  const n = T.n, n2 = T.n2, n3 = T.n3;
  const idx = (x, y, z) => x + CHUNK * (z + CHUNK * y);
  const inChunk = (lx, y, lz) => lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK && y >= 0 && y < WH;
  const get = (lx, y, lz) => inChunk(lx, y, lz) ? blocks[idx(lx, y, lz)] : 0;
  const set = (lx, y, lz, b) => { if (inChunk(lx, y, lz)) blocks[idx(lx, y, lz)] = b; };
  // world-coordinate helpers that clip to this chunk
  const put = (x, y, z, b, onlyAir = true) => {
    const lx = x - x0, lz = z - z0;
    if (!inChunk(lx, y, lz)) return;
    const i = idx(lx, y, lz);
    if (onlyAir && blocks[i] !== 0 && blocks[i] !== B.TALLGRASS && blocks[i] !== B.SNOW) return;
    blocks[i] = b;
  };
  const putW = (x, y, z, b) => put(x, y, z, b, false);
  const getW = (x, y, z) => get(x - x0, y, z - z0);

  // column info for this chunk plus a margin
  const cols = new Array(SPAN * SPAN);
  for (let dz = 0; dz < SPAN; dz++) for (let dx = 0; dx < SPAN; dx++) cols[dx + dz * SPAN] = T.column(x0 + dx - M, z0 + dz - M);
  const colAt = (x, z) => {
    const dx = x - x0 + M, dz = z - z0 + M;
    return dx >= 0 && dz >= 0 && dx < SPAN && dz < SPAN ? cols[dx + dz * SPAN] : T.column(x, z);
  };

  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ seed);

  /* ---------------- terrain fill ---------------- */
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz;
    const c = colAt(x, z);
    const { h, biome } = c;
    set(lx, 0, lz, B.BEDROCK);
    if (hash3(x, 1, z, seed) < 0.5) set(lx, 1, lz, B.BEDROCK);

    // slope (for cliffs: grassy plateaus, bare faces)
    let slope = 0;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) slope = Math.max(slope, Math.abs(colAt(x + ox, z + oz).h - h));

    const strata = y => {
      const band = Math.floor((y + n.noise2(x / 30, z / 30) * 3) / 3);
      return [B.STRATA_RED, B.STRATA_OCHRE, B.STRATA_CREAM, B.STRATA_OCHRE][((band % 4) + 4) % 4];
    };
    const layer = (y, depth) => {
      if (biome === BIOME.DESERT) return depth < 4 ? B.CSAND : depth < 10 ? B.CSANDSTONE : B.STONE;
      if (biome === BIOME.VOLCANIC) {
        if (depth === 0) return c.lavaTop > 0 ? B.OBSIDIAN : (n.noise2(x / 9, z / 9) > 0.3 ? B.ASH : (hash3(x, y, z, seed) < 0.05 ? B.MAGMA : B.BASALT));
        return depth < 8 ? B.BASALT : B.STONE;
      }
      if (biome === BIOME.OCEAN) return depth < 3 ? (n2.noise2(x / 12, z / 12) > 0 ? B.GRAVEL : B.SAND) : B.STONE;
      if (biome === BIOME.REEF) return depth < 4 ? B.SAND : B.STONE;
      if (biome === BIOME.CLIFFS && h > SEA + 1) {
        if (depth === 0 && slope <= 1) return B.GRASS;
        if (depth < 3 && slope <= 1) return B.DIRT;
        return depth < 40 ? strata(y) : B.STONE;
      }
      if (biome === BIOME.TUNDRA) {
        if (h <= SEA + 1) return depth < 3 ? B.GRAVEL : B.STONE;
        return depth === 0 ? B.SNOWGRASS : depth < 4 ? B.DIRT : B.STONE;
      }
      // forest and sky lowlands
      if (h <= SEA + 1) return depth < 4 ? B.SAND : B.STONE;
      if (h > 84) return depth === 0 && h > 90 ? B.SNOW : B.STONE;
      return depth === 0 ? B.GRASS : depth < 4 ? B.DIRT : B.STONE;
    };
    for (let y = 2; y <= h; y++) set(lx, y, lz, layer(y, h - y));

    // fractal cliffs: carve alcoves and grow overhangs around the surface
    if (c.cliff > 0.35 && h > SEA + 3) {
      const amp = 9 * c.cliff;
      for (let y = Math.max(SEA + 1, h - 12); y <= Math.min(WH - 12, h + 10); y++) {
        const d = (h - y) + n3.noise3(x / 14, y / 9, z / 14) * amp;
        if (d > 0 && y > h) set(lx, y, lz, strata(y));
        else if (d <= 0 && y <= h && y > h - 12) set(lx, y, lz, 0);
      }
    }

    // fluids
    if (c.lavaTop > 0) for (let y = h + 1; y <= c.lavaTop; y++) set(lx, y, lz, B.LAVA);
    else for (let y = h + 1; y <= SEA; y++) if (!get(lx, y, lz)) set(lx, y, lz, B.WATER);
    if (biome === BIOME.TUNDRA && h < SEA && get(lx, SEA, lz) === B.WATER) set(lx, SEA, lz, B.ICE);

    // caves
    const lowCol = h <= SEA + 2;
    for (let y = 3; y < h - 1; y++) {
      if (lowCol && y > h - 6) continue;
      if (y > h - 4 && c.cliff > 0.3) continue;
      const bi = idx(lx, y, lz);
      if (!blocks[bi]) continue;
      let carve = false;
      if (c.lumen > 0.05 && y >= 10 && y <= 44) {
        // big open caverns, taller toward the middle of the glowing region
        const d = n3.noise3(x / 40, y / 22, z / 40) + c.lumen * 0.55 - 0.42 - Math.abs(y - 27) / 60;
        if (d > 0) carve = true;
      }
      if (!carve) {
        const a = n3.noise3(x / 32, y / 18, z / 32);
        if (a > -0.075 && a < 0.075) {
          const b2 = n2.noise3(x / 32 + 40, y / 18, z / 32 - 40);
          if (b2 > -0.075 && b2 < 0.075) carve = true;
        }
      }
      if (!carve && y < 40 && n.noise3(x / 60, y / 26, z / 60) > 0.62) carve = true;
      if (carve) blocks[bi] = (y <= 6 && c.lumen < 0.1) ? B.LAVA : 0;
    }

    // floating island
    if (c.islandTop) {
      for (let y = Math.max(c.islandBottom, h + 6); y < c.islandTop; y++) set(lx, y, lz, hash3(x, y, z, seed) < 0.004 ? B.AETHER_ORE : B.SKYSTONE);
      set(lx, c.islandTop, lz, B.SKYGRASS);
    }
  }

  /* ---------------- ores ---------------- */
  const blob = (lx, y, lz, b, size, hosts) => {
    for (let i = 0; i < size; i++) {
      if (inChunk(lx, y, lz) && hosts.includes(blocks[idx(lx, y, lz)])) blocks[idx(lx, y, lz)] = b;
      const d = Math.floor(rng() * 6);
      if (d === 0) lx++; else if (d === 1) lx--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) lz++; else lz--;
    }
  };
  const centre = colAt(x0 + 8, z0 + 8);
  const ores = [
    [B.COAL_ORE, 12, 20, 90, 8], [B.COPPER_ORE, 7, 15, 70, 7], [B.IRON_ORE, 6, 5, 50, 6],
    [B.LUMEN_ORE, centre.lumen > 0.2 ? 6 : 2, 6, 40, 5], [B.AETHER_ORE, 1, 3, 20, 3],
  ];
  if (centre.biome === BIOME.DESERT) ores.push([B.CRYSTAL, 5, 10, 60, 5]);
  if (centre.biome === BIOME.VOLCANIC) ores.push([B.MAGMA, 8, 10, 80, 6], [B.OBSIDIAN, 2, 4, 30, 4]);
  for (const [b, count, lo, hi, size] of ores) {
    for (let i = 0; i < count; i++) {
      blob(Math.floor(rng() * CHUNK), lo + Math.floor(rng() * (hi - lo)), Math.floor(rng() * CHUNK), b, size,
        [B.STONE, B.BASALT, B.CSANDSTONE, B.STRATA_RED, B.STRATA_OCHRE, B.STRATA_CREAM]);
    }
  }

  /* ---------------- cave life ---------------- */
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, c = colAt(x, z);
    for (let y = 4; y < Math.min(c.h - 3, 60); y++) {
      const i = idx(lx, y, lz);
      if (blocks[i] !== 0) continue;
      const below = blocks[idx(lx, y - 1, lz)], above = blocks[idx(lx, y + 1, lz)];
      const r = hash3(x, y, z, seed);
      if (c.lumen > 0.2) {
        if (IS_OPAQUE[below] && below !== B.LUMEN_ORE) {
          blocks[idx(lx, y - 1, lz)] = B.GLOWMOSS;
          if (r < 0.08) blocks[i] = B.GLOWSHROOM;
          else if (r < 0.12) blocks[i] = B.FERN;
        } else if (IS_OPAQUE[above] && r < 0.22) {
          const len = 1 + Math.floor(hash3(x, y + 1, z, seed) * 5);
          for (let k = 0; k < len && blocks[idx(lx, y - k, lz)] === 0; k++) blocks[idx(lx, y - k, lz)] = B.GLOW_VINE;
        }
      } else if (IS_OPAQUE[below] && r < 0.012) blocks[i] = B.GLOWSHROOM;
    }
  }
  // giant lumen mushrooms (kept inside the chunk so they never get cut)
  if (centre.lumen > 0.25) {
    for (let t = 0; t < 3; t++) {
      const lx = 3 + Math.floor(rng() * 10), lz = 3 + Math.floor(rng() * 10);
      let y = 44;
      while (y > 8 && !(blocks[idx(lx, y, lz)] === 0 && IS_OPAQUE[blocks[idx(lx, y - 1, lz)]] || blocks[idx(lx, y - 1, lz)] === B.GLOWMOSS)) y--;
      if (y <= 8) continue;
      const hgt = 4 + Math.floor(rng() * 4);
      let clear = true;
      for (let k = 0; k <= hgt + 1; k++) if (blocks[idx(lx, y + k, lz)] !== 0 && blocks[idx(lx, y + k, lz)] !== B.GLOW_VINE && blocks[idx(lx, y + k, lz)] !== B.GLOWSHROOM) clear = false;
      if (!clear) continue;
      for (let k = 0; k < hgt; k++) blocks[idx(lx, y + k, lz)] = B.LUMEN_STEM;
      const capY = y + hgt, rr = 2 + (rng() < 0.4 ? 1 : 0);
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dz * dz > rr * rr + 1) continue;
        set(lx + dx, capY, lz + dz, B.LUMEN_CAP);
        if (Math.abs(dx) === rr || Math.abs(dz) === rr) set(lx + dx, capY - 1, lz + dz, B.LUMEN_CAP);
      }
      set(lx, capY + 1, lz, B.LUMEN_CAP);
    }
  }

  /* ---------------- surface plants ---------------- */
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz, c = colAt(x, z), h = c.h;
    const top = get(lx, h, lz), above = get(lx, h + 1, lz);
    const r = hash3(x, 11, z, seed);
    if (above === 0) {
      if (top === B.GRASS) {
        if (r < 0.06) set(lx, h + 1, lz, B.TALLGRASS);
        else if (r < 0.068) set(lx, h + 1, lz, B.FLOWER_RED);
        else if (r < 0.075) set(lx, h + 1, lz, B.FLOWER_BLUE);
        else if (r < 0.08) set(lx, h + 1, lz, B.BERRYBUSH);
        else if (r < 0.09 && c.biome === BIOME.FOREST) set(lx, h + 1, lz, B.FERN);
      } else if (top === B.SNOWGRASS) {
        if (r < 0.02) set(lx, h + 1, lz, B.FERN);
        else if (r < 0.026) set(lx, h + 1, lz, B.BERRYBUSH);
      } else if (top === B.CSAND) {
        if (r < 0.006) {
          const th = 2 + Math.floor(hash3(x, 3, z, seed) * 5);
          for (let dy = 1; dy <= th; dy++) set(lx, h + dy, lz, B.CRYSTAL);
        } else if (r < 0.012) set(lx, h + 1, lz, B.DEADBUSH);
        else if (r < 0.014) set(lx, h + 1, lz, B.GLOWSHROOM);
      } else if (top === B.BASALT || top === B.ASH || top === B.MAGMA) {
        if (r < 0.004) { const th = 3 + Math.floor(hash3(x, 4, z, seed) * 4); for (let dy = 1; dy <= th; dy++) set(lx, h + dy, lz, B.BASALT); }
        else if (r < 0.012) set(lx, h + 1, lz, B.FLOWER_RED);
      } else if (top >= B.STRATA_RED && top <= B.STRATA_CREAM) {
        if (r < 0.01) set(lx, h + 1, lz, B.DEADBUSH);
      } else if (top === B.SAND && h > SEA) {
        if (r < 0.01) set(lx, h + 1, lz, B.TALLGRASS);
      }
    }
    // underwater life
    if (h < SEA - 1 && get(lx, h + 1, lz) === B.WATER) {
      if (c.biome === BIOME.REEF) {
        if (r < 0.16) {
          const corals = [B.CORAL_PINK, B.CORAL_ORANGE, B.CORAL_BLUE];
          const cb = corals[Math.floor(hash3(x, 12, z, seed) * 3)];
          const th = 1 + Math.floor(hash3(x, 13, z, seed) * 3);
          for (let dy = 1; dy <= th && h + dy < SEA - 1; dy++) set(lx, h + dy, lz, cb);
        } else if (r < 0.26) set(lx, h + 1, lz, B.SEA_FAN);
        else if (r < 0.3) set(lx, h + 1, lz, B.ANEMONE);
        else if (r < 0.31) set(lx, h + 1, lz, B.SEAGLASS);
        else if (r < 0.36) { const kh = 2 + Math.floor(hash3(x, 14, z, seed) * (SEA - h - 3)); for (let dy = 1; dy <= kh && h + dy < SEA - 1; dy++) set(lx, h + dy, lz, B.KELP); }
      } else if (c.biome === BIOME.OCEAN || h < SEA - 4) {
        if (r < 0.05) { const kh = 2 + Math.floor(hash3(x, 14, z, seed) * (SEA - h - 3)); for (let dy = 1; dy <= kh && h + dy < SEA - 1; dy++) set(lx, h + dy, lz, B.KELP); }
        else if (r < 0.055) set(lx, h + 1, lz, B.ANEMONE);
      }
    }
    // island flowers
    if (c.islandTop && get(lx, c.islandTop + 1, lz) === 0) {
      const ri = hash3(x, 9, z, seed);
      if (ri > 0.03 && ri < 0.09) set(lx, c.islandTop + 1, lz, B.FLOWER_BLUE);
      else if (ri > 0.09 && ri < 0.1) set(lx, c.islandTop + 1, lz, B.BERRYBUSH);
      else if (ri > 0.1 && ri < 0.18) set(lx, c.islandTop + 1, lz, B.TALLGRASS);
    }
  }

  /* ---------------- trees (anchors may sit in neighbouring chunks) ---------------- */
  const roundTree = (x, y, z, log, leaf, th, r) => {
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const rr = dy >= th ? r - 1 : r;
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dz * dz > rr * rr + 1) continue;
        if (Math.abs(dx) === rr && Math.abs(dz) === rr && hash3(x + dx, y + dy, z + dz, seed) < 0.5) continue;
        put(x + dx, y + dy, z + dz, leaf);
      }
    }
    for (let dy = 1; dy <= th; dy++) putW(x, y + dy, z, log);
  };
  const pineTree = (x, y, z, th) => {
    for (let dy = 3; dy <= th + 1; dy++) {
      const rr = Math.max(0, Math.round((th + 1 - dy) / 2.2));
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > rr + (rr > 1 ? 1 : 0)) continue;
        put(x + dx, y + dy, z + dz, B.PINE_LEAVES);
      }
    }
    put(x, y + th + 2, z, B.PINE_LEAVES);
    for (let dy = 1; dy <= th; dy++) putW(x, y + dy, z, B.PINE_LOG);
  };
  for (let ax = x0 - M; ax < x0 + CHUNK + M; ax++) for (let az = z0 - M; az < z0 + CHUNK + M; az++) {
    const c = colAt(ax, az);
    const r = hash3(ax, 7, az, seed);
    if (r > 0.06) continue;
    if (T.villageNear(ax, az, 28) || T.ruinNear(ax, az, 6)) continue;
    const h = c.h;
    // trees grow on dry, fairly flat ground
    if (h <= SEA + 1) {
      // islands may still carry trees
    } else {
      let flat = true;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = colAt(ax + ox, az + oz);
        if (Math.abs(o.h - h) > 1) flat = false;
      }
      const big = hash3(ax, 2, az, seed) < 0.15;
      const th = 4 + Math.floor(hash3(ax, 1, az, seed) * 3);
      if (flat && c.cliff < 0.6 || (flat && c.biome === BIOME.CLIFFS)) {
        if (c.biome === BIOME.FOREST) {
          const dens = 0.012 + Math.max(0, n.noise2(ax / 40, az / 40)) * 0.05;
          if (r < dens) { if (h > 72) pineTree(ax, h, az, th + 3); else roundTree(ax, h, az, B.LOG, B.LEAVES, th, big ? 3 : 2); }
        } else if (c.biome === BIOME.TUNDRA) {
          if (r < 0.03) pineTree(ax, h, az, th + 2 + Math.floor(hash3(ax, 3, az, seed) * 3));
        } else if (c.biome === BIOME.CLIFFS) {
          if (r < 0.008) roundTree(ax, h, az, B.LOG, B.LEAVES, 3, 1);
        } else if (c.biome === BIOME.SKY) {
          if (r < 0.006) roundTree(ax, h, az, B.LOG, B.LEAVES, th, 2);
        }
      }
    }
    if (c.islandTop && r < 0.03) roundTree(ax, c.islandTop, az, B.LOG, B.BLOSSOM, 4 + Math.floor(hash3(ax, 5, az, seed) * 2), 3);
  }

  /* ---------------- villages ---------------- */
  const meta = { villages: [], ruins: [] };
  const vci = Math.floor((x0 + 8) / VILLAGE_CELL), vcj = Math.floor((z0 + 8) / VILLAGE_CELL);
  for (let j = vcj - 1; j <= vcj + 1; j++) for (let i = vci - 1; i <= vci + 1; i++) {
    const v = T.village(i, j);
    if (!v) continue;
    if (v.x + 30 < x0 || v.x - 30 >= x0 + CHUNK || v.z + 30 < z0 || v.z - 30 >= z0 + CHUNK) continue;
    const info = buildVillage(v);
    if (v.x >= x0 && v.x < x0 + CHUNK && v.z >= z0 && v.z < z0 + CHUNK) meta.villages.push(info);
  }
  function surfaceAt(x, z) {
    // top solid block of the generated column (or terrain height if outside the chunk)
    const lx = x - x0, lz = z - z0;
    if (lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK) {
      for (let y = Math.min(WH - 1, T.column(x, z).h + 12); y > 0; y--) { const b = blocks[idx(lx, y, lz)]; if (IS_SOLID[b] && b !== B.LEAVES && b !== B.PINE_LEAVES) return y; }
    }
    return T.column(x, z).h;
  }
  function buildVillage(v) {
    const mats = {
      [BIOME.FOREST]: { wall: B.PLANKS, corner: B.LOG, roof: B.THATCH, floor: B.PLANKS, glass: B.CGLASS },
      [BIOME.DESERT]: { wall: B.CSANDSTONE, corner: B.CSANDSTONE, roof: B.TILE_TEAL, floor: B.TILE_WHITE, glass: B.ROSEGLASS },
      [BIOME.TUNDRA]: { wall: B.PLANKS, corner: B.PINE_LOG, roof: B.SNOW, floor: B.PLANKS, glass: B.CGLASS },
      [BIOME.CLIFFS]: { wall: B.STRATA_CREAM, corner: B.CARVED_STRATA, roof: B.THATCH, floor: B.PLANKS, glass: B.CGLASS },
    }[v.biome] || { wall: B.PLANKS, corner: B.LOG, roof: B.THATCH, floor: B.PLANKS, glass: B.CGLASS };
    // plaza + well
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dz * dz > 26) continue;
      const x = v.x + dx, z = v.z + dz;
      if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
      for (let y = v.y; y < v.y + 8; y++) putW(x, y, z, 0);
      for (let y = v.y - 1; y > v.y - 6 && !IS_SOLID[getW(x, y, z)]; y--) putW(x, y, z, B.DIRT);
      putW(x, v.y - 1, z, B.PATH);
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
      if (edge) { putW(v.x + dx, v.y, v.z + dz, B.COBBLE); putW(v.x + dx, v.y - 1, v.z + dz, B.COBBLE); }
      else { putW(v.x, v.y - 1, v.z, B.WATER); putW(v.x, v.y - 2, v.z, B.WATER); putW(v.x, v.y - 3, v.z, B.COBBLE); }
    }
    for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) {
      putW(v.x + dx, v.y, v.z + dz, B.COBBLE); putW(v.x + dx, v.y + 1, v.z + dz, B.COBBLE); putW(v.x + dx, v.y + 2, v.z + dz, B.LANTERN);
    }
    const huts = [];
    for (const hut of v.huts) {
      const { x: hx, z: hz, s, side, floor: F } = hut;
      const doorOff = { e: [s, 0], w: [-s, 0], s: [0, s], n: [0, -s] }[side];
      const outOff = { e: [s + 1, 0], w: [-s - 1, 0], s: [0, s + 1], n: [0, -s - 1] }[side];
      // path from the plaza to the door
      const ex = hx + outOff[0], ez = hz + outOff[1];
      const steps = Math.max(Math.abs(ex - v.x), Math.abs(ez - v.z));
      for (let k = 0; k <= steps; k++) {
        const px = Math.round(v.x + (ex - v.x) * k / steps), pz = Math.round(v.z + (ez - v.z) * k / steps);
        if (Math.hypot(px - v.x, pz - v.z) < 5) continue;
        for (const [ox, oz] of [[0, 0], [1, 0], [0, 1]]) {
          const qx = px + ox, qz = pz + oz;
          if (qx < x0 || qx >= x0 + CHUNK || qz < z0 || qz >= z0 + CHUNK) continue;
          const sy = surfaceAt(qx, qz);
          const tb = getW(qx, sy, qz);
          if (tb === B.WATER || tb === B.LAVA) continue;
          for (let y = sy + 1; y < sy + 4; y++) if (!IS_SOLID[getW(qx, y, qz)] || getW(qx, y, qz) === B.LEAVES) putW(qx, y, qz, 0);
          putW(qx, sy, qz, B.PATH);
        }
      }
      // footprint
      for (let dz = -s - 1; dz <= s + 1; dz++) for (let dx = -s - 1; dx <= s + 1; dx++) {
        const x = hx + dx, z = hz + dz;
        for (let y = F; y < F + s + 8; y++) putW(x, y, z, 0);
        if (Math.abs(dx) <= s && Math.abs(dz) <= s) {
          for (let y = F - 1; y > F - 12 && (y === F - 1 || !IS_SOLID[getW(x, y, z)]); y--) putW(x, y, z, y === F - 1 ? mats.floor : B.COBBLE);
        }
      }
      // walls
      for (let y = F; y < F + 4; y++) for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) {
        const edgeX = Math.abs(dx) === s, edgeZ = Math.abs(dz) === s;
        if (!edgeX && !edgeZ) continue;
        let b = edgeX && edgeZ ? mats.corner : mats.wall;
        const mid = (edgeX && dz === 0) || (edgeZ && dx === 0);
        if (mid && (y === F + 1 || y === F + 2) && !(dx === doorOff[0] && dz === doorOff[1])) b = mats.glass;
        if (dx === doorOff[0] && dz === doorOff[1] && y < F + 2) b = 0;
        putW(hx + dx, y, hz + dz, b);
      }
      // roof
      for (let k = 0; k <= s + 1; k++) {
        const rr = s + 1 - k;
        for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) putW(hx + dx, F + 4 + k, hz + dz, mats.roof);
      }
      putW(hx, F + 3, hz, B.LANTERN);
      // furniture depends on who lives here
      const back = [-doorOff[0], -doorOff[1]].map(v => Math.sign(v) * (s - 1));
      const role = ['elder', 'merchant', 'smith', 'mystic', 'cook', 'merchant'][hut.role % 6];
      const fx = hx + back[0], fz = hz + back[1];
      if (role === 'smith') { putW(fx, F, fz, B.SMELTER); putW(fx + (back[1] ? 1 : 0), F, fz + (back[0] ? 1 : 0), B.WORKBENCH); }
      else if (role === 'elder' || role === 'mystic') { putW(fx, F, fz, B.BOOKSHELF); putW(fx, F + 1, fz, B.BOOKSHELF); if (role === 'mystic') putW(fx + (back[1] ? 1 : 0), F, fz + (back[0] ? 1 : 0), B.CLAMP); }
      else if (role === 'cook') { putW(fx, F, fz, B.PLANTER); putW(fx + (back[1] ? 1 : 0), F, fz + (back[0] ? 1 : 0), B.WORKBENCH); }
      else putW(fx, F, fz, B.CHEST);
      huts.push({ role, door: [hx + doorOff[0], F, hz + doorOff[1]], home: [hx, F, hz], out: [ex, F, ez] });
    }
    return { id: v.id, x: v.x, y: v.y, z: v.z, biome: v.biome, huts };
  }

  /* ---------------- waystone ruins ---------------- */
  const rci = Math.floor((x0 + 8) / RUIN_CELL), rcj = Math.floor((z0 + 8) / RUIN_CELL);
  for (let j = rcj - 1; j <= rcj + 1; j++) for (let i = rci - 1; i <= rci + 1; i++) {
    const r = T.ruin(i, j);
    if (!r || r.x + 5 < x0 || r.x - 5 >= x0 + CHUNK || r.z + 5 < z0 || r.z - 5 >= z0 + CHUNK) continue;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > 17) continue;
      const x = r.x + dx, z = r.z + dz;
      for (let y = r.y; y < r.y + 6; y++) putW(x, y, z, 0);
      for (let y = r.y - 1; y > r.y - 8 && (y === r.y - 1 || !IS_SOLID[getW(x, y, z)]); y--) putW(x, y, z, y === r.y - 1 ? B.BRICKS : B.COBBLE);
      if (d2 >= 10) {
        const hgt = Math.floor(hash3(x, 77, z, seed) * 3);
        for (let y = 0; y < hgt; y++) putW(x, r.y + y, z, hash3(x, y, z, seed) < 0.5 ? B.MOSSY_COBBLE : B.BRICKS);
      }
    }
    putW(r.x, r.y, r.z, B.BRICKS);
    putW(r.x, r.y + 1, r.z, B.WAYSTONE);
    if (r.x >= x0 && r.x < x0 + CHUNK && r.z >= z0 && r.z < z0 + CHUNK) meta.ruins.push({ id: r.id, x: r.x, y: r.y + 1, z: r.z });
  }

  return { blocks, meta, ...surfaceInfo(blocks, cols) };

  function surfaceInfo(bl, cls) {
    const height = new Uint8Array(CHUNK * CHUNK), top = new Uint8Array(CHUNK * CHUNK), biome = new Uint8Array(CHUNK * CHUNK);
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const c = cls[(lx + M) + (lz + M) * SPAN];
      biome[lx + lz * CHUNK] = c.biome;
      for (let y = WH - 1; y >= 0; y--) {
        const b = bl[idx(lx, y, lz)];
        if (b && b !== B.TALLGRASS && b !== B.FERN) { height[lx + lz * CHUNK] = y; top[lx + lz * CHUNK] = b; break; }
      }
    }
    return { height, top, biome };
  }
}

// recompute one column of the map summary after an edit
export function columnTop(blocks, lx, lz) {
  for (let y = WH - 1; y >= 0; y--) {
    const b = blocks[lx + CHUNK * (lz + CHUNK * y)];
    if (b && b !== B.TALLGRASS && b !== B.FERN) return [y, b];
  }
  return [0, 0];
}
