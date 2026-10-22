// Block + item registry, procedural pixel textures and item icons.
// Works in both the main thread and workers (texture functions need a DOM canvas or OffscreenCanvas).
import { mulberry32 } from './noise.js';

export const TILE = 16;
export const ATLAS_TILES = 16; // 16 x 16 tiles in a 256px atlas

/* ------------------------------------------------------------------ */
/* Block ids                                                           */
/* ------------------------------------------------------------------ */
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, WATER: 6, LOG: 7, LEAVES: 8, PLANKS: 9,
  CSAND: 10, CSANDSTONE: 11, CRYSTAL: 12, BASALT: 13, OBSIDIAN: 14, LAVA: 15, ASH: 16,
  SKYGRASS: 17, SKYSTONE: 18, BLOSSOM: 19, WORKBENCH: 20, TORCH: 21, CGLASS: 22, BRICKS: 23,
  SNOW: 24, BEDROCK: 25, BERRYBUSH: 26, TALLGRASS: 27, FLOWER_RED: 28, FLOWER_BLUE: 29,
  COAL_ORE: 30, CLAMP: 31, GLOWSHROOM: 32, MAGMA: 33,
  ICE: 34, PINE_LOG: 35, PINE_LEAVES: 36, SNOWGRASS: 37, CORAL_PINK: 38, CORAL_ORANGE: 39, CORAL_BLUE: 40,
  SEA_FAN: 41, KELP: 42, ANEMONE: 43, SEAGLASS: 44, STRATA_RED: 45, STRATA_OCHRE: 46, STRATA_CREAM: 47,
  GLOWMOSS: 48, LUMEN_CAP: 49, LUMEN_STEM: 50, GLOW_VINE: 51, LUMEN_ORE: 52, COPPER_ORE: 53, IRON_ORE: 54,
  AETHER_ORE: 55, GRAVEL: 56, PATH: 57, THATCH: 58, LANTERN: 59, TILE_WHITE: 60, TILE_TEAL: 61, TILE_ROSE: 62,
  MOSAIC: 63, BOOKSHELF: 64, PLANTER: 65, ROSEGLASS: 66, POLISHED_BASALT: 67, COPPER_BLOCK: 68, CARVED_STRATA: 69,
  PAPER_LANTERN: 70, CHECKER: 71, CHEST: 72, SMELTER: 73, SMELTER_ON: 74, DRILL: 75, JUMP_PAD: 76, WAYSTONE: 77,
  GLOW_ORB: 78, DEADBUSH: 79, FERN: 80, IRON_BLOCK: 81, AETHER_BLOCK: 82, MOSSY_COBBLE: 83,
  WATER_FLOW: 84, // 84..90 = flowing water, level 7 down to 1
  LAVA_FLOW: 91,  // 91..93 = flowing lava, level 3 down to 1
  TRAIL_BEACON: 94, ARENA_STONE: 95,
};

// tile painters are registered by name; indices are assigned in order
const TILES = [];
const T = {};
function tile(name, paint) { T[name] = TILES.length; TILES.push(paint); }

/*
  kind: 'solid'  opaque cube, culls neighbours
        'cutout' cube with see-through pixels (leaves, glass, lanterns)
        'liquid' water / lava, not solid
        'cross'  two crossed quads (plants, torches), not solid
  wet: plant that lives in water (counts as water for swimming and meshing)
*/
const DEFS = [];
function def(id, name, kind, tex, o = {}) { DEFS.push([id, name, kind, tex, o]); }

/* ------------------------------------------------------------------ */
/* Pixel helpers                                                       */
/* ------------------------------------------------------------------ */
function hexToRgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function scale(c, k) { return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; }
const H = hexToRgb;

function painter(ctx, ox, oy, seed) {
  const r = mulberry32(seed * 7919 + 13);
  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    ctx.fillStyle = typeof c === 'string' ? c : rgb(c);
    ctx.fillRect(ox + x, oy + y, 1, 1);
  };
  const clear = (x, y) => ctx.clearRect(ox + x, oy + y, 1, 1);
  const clearAll = () => ctx.clearRect(ox, oy, TILE, TILE);
  const fill = (base, amt = 0.15) => {
    const c = typeof base === 'number' ? H(base) : base;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, scale(c, 1 + (r() - 0.5) * 2 * amt));
  };
  const speck = (n, col) => { for (let i = 0; i < n; i++) px(r() * 16 | 0, r() * 16 | 0, typeof col === 'number' ? H(col) : col); };
  const each = fn => { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const c = fn(x, y); if (c === null) clear(x, y); else if (c) px(x, y, c); } };
  const frame = (col, w = 1) => { for (let i = 0; i < 16; i++) for (let k = 0; k < w; k++) { px(i, k, col); px(i, 15 - k, col); px(k, i, col); px(15 - k, i, col); } };
  return { r, px, fill, clear, clearAll, speck, each, frame };
}

// common painters
const noisy = (base, amt = 0.12, specks = []) => p => { p.fill(base, amt); for (const [n, c] of specks) p.speck(n, c); };
const ore = (spot, glow) => p => {
  p.fill(0x8e95a3, 0.08);
  for (let i = 0; i < 6; i++) {
    const x = 1 + p.r() * 13 | 0, y = 1 + p.r() * 13 | 0;
    p.px(x, y, H(spot)); p.px(x + 1, y, scale(H(spot), 0.8)); p.px(x, y + 1, scale(H(spot), 0.8));
    if (glow) p.px(x + 1, y + 1, H(glow));
  }
};
const bands = cols => p => p.each((x, y) => scale(H(cols[(y >> 2) % cols.length]), 1 + (p.r() - .5) * .08));
const planks = (base, seam) => p => p.each((x, y) => (y % 4 === 3 || x === ((y >> 2) % 2 ? 5 : 12)) ? H(seam) : scale(H(base), 1 + (p.r() - .5) * .14));
const leaves = (base, holes = 0.16, sparkle = null) => p => p.each(() => p.r() < holes ? null : (sparkle && p.r() < 0.08 ? H(sparkle) : scale(H(base), 0.75 + p.r() * 0.5)));
const cross = draw => p => { p.clearAll(); draw(p); };
const tiles = (a, b, grout) => p => p.each((x, y) => (x % 8 === 0 || y % 8 === 0) ? H(grout) : (((x >> 3) + (y >> 3)) % 2 ? scale(H(a), 1 + (p.r() - .5) * .05) : scale(H(b), 1 + (p.r() - .5) * .05)));
const glass = (edge, streak) => p => p.each((x, y) => {
  if (x === 0 || y === 0 || x === 15 || y === 15) return H(edge);
  if (x === y + 3 || x === y + 4) return H(streak);
  return null;
});

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */
tile('grass_top', p => { p.fill(0x6cc24a, 0.12); for (let i = 0; i < 26; i++) p.px(p.r() * 16 | 0, p.r() * 16 | 0, p.r() < .5 ? [92, 170, 60] : [130, 214, 92]); });
tile('grass_side', p => { p.fill(0x8b5a3c, 0.16); for (let x = 0; x < 16; x++) { const h = 3 + (p.r() * 3 | 0); for (let y = 0; y < h; y++) p.px(x, y, scale([108, 194, 74], 1 + (p.r() - .5) * .25)); } });
tile('dirt', noisy(0x8b5a3c, 0.16, [[10, 0x6e462e]]));
tile('stone', p => { p.fill(0x8e95a3, 0.08); for (let i = 0; i < 8; i++) { const x = p.r() * 15 | 0, y = p.r() * 15 | 0; p.px(x, y, [112, 118, 130]); p.px(x + 1, y, [112, 118, 130]); } });
tile('cobble', p => p.each((x, y) => { const cx = (x + (y >> 2) * 3) % 6, cy = y % 4; return cx === 0 || cy === 0 ? [88, 92, 102] : scale([140, 146, 158], 1 + (p.r() - .5) * .2); }));
tile('sand', noisy(0xf0dc9b, 0.06));
tile('water', p => p.each((x, y) => mix([46, 140, 222], [96, 190, 250], (Math.sin((x + y * 0.5) * 0.8) * 0.5 + 0.5) * 0.6 + p.r() * 0.15)));
tile('log_side', p => p.each(x => scale((x % 5 === 0) || p.r() < 0.06 ? [92, 58, 32] : [122, 79, 44], 1 + (p.r() - .5) * .15)));
tile('log_top', p => p.each((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.5 ? [92, 58, 32] : (Math.floor(d) % 2 ? [190, 145, 92] : [214, 172, 112]); }));
tile('leaves', leaves(0x3fa34d));
tile('planks', planks(0xc8955a, 0x8c6034));
tile('csand', noisy(0xe7b8f0, 0.07, [[7, 0xffffff], [5, 0x78f0ff]]));
tile('csandstone_side', bands([0xd79fe0, 0xc488d2, 0xe4b4ec, 0xb878c8]));
tile('csandstone_top', p => { p.fill(0xdca6e6, 0.06); for (let i = 0; i < 16; i++) { p.px(i, 0, [184, 120, 200]); p.px(0, i, [184, 120, 200]); } });
tile('crystal', p => p.each((x, y) => { let c = mix([40, 190, 230], [150, 255, 255], ((x * 3 + y * 5) % 11) / 11); if ((x + y) % 7 === 0) c = [230, 255, 255]; return scale(c, 0.9 + p.r() * 0.15); }));
tile('basalt_side', p => p.each(x => scale(x % 4 === 0 ? [44, 42, 50] : [72, 70, 80], 1 + (p.r() - .5) * .14)));
tile('basalt_top', p => p.each((x, y) => scale(x % 4 === 0 || y % 4 === 0 ? [44, 42, 50] : [80, 78, 88], 1 + (p.r() - .5) * .1)));
tile('obsidian', noisy(0x2a1840, 0.15, [[9, 0x7846be]]));
tile('lava', p => p.each((x, y) => mix([240, 70, 20], [255, 214, 60], (Math.sin(x * 0.9 + Math.cos(y * 0.7) * 2) * 0.5 + 0.5) * 0.8 + p.r() * 0.2)));
tile('ash', noisy(0x6e6a6a, 0.12, [[6, 0xff7832]]));
tile('skygrass_top', noisy(0x5fe0b8, 0.1, [[8, 0xffffff], [8, 0x46c8aa]]));
tile('skygrass_side', p => { p.fill(0xd9e4f5, 0.06); for (let x = 0; x < 16; x++) { const h = 2 + (p.r() * 4 | 0); for (let y = 0; y < h; y++) p.px(x, y, scale([95, 224, 184], 1 + (p.r() - .5) * .2)); } });
tile('skystone', p => { p.fill(0xd9e4f5, 0.05); let x = p.r() * 16 | 0; for (let y = 0; y < 16; y++) { x = (x + (p.r() < .5 ? 1 : 15)) % 16; p.px(x, y, [140, 180, 255]); } });
tile('blossom', leaves(0xff9ccf, 0.14, 0xfff0f8));
tile('bench_top', p => p.each((x, y) => x % 5 === 0 || y % 5 === 0 ? [110, 70, 36] : scale([200, 149, 90], 1 + (p.r() - .5) * .1)));
tile('bench_side', p => p.each((x, y) => {
  if (y < 3) return [200, 149, 90];
  if (y === 3) return [110, 70, 36];
  if ((x === 3 || x === 12) && y > 5 && y < 13) return [150, 160, 175];
  if (y === 6 && x > 1 && x < 6) return [150, 160, 175];
  return scale([170, 116, 64], 1 + (p.r() - .5) * .12);
}));
tile('torch', cross(p => { for (let y = 6; y < 16; y++) { p.px(7, y, [122, 79, 44]); p.px(8, y, [100, 64, 36]); } p.px(7, 4, [255, 230, 120]); p.px(8, 4, [255, 200, 80]); p.px(7, 5, [255, 160, 40]); p.px(8, 5, [255, 200, 80]); p.px(7, 3, [255, 250, 200]); p.px(8, 3, [255, 220, 120]); }));
tile('cglass', glass([170, 240, 255], [235, 255, 255]));
tile('bricks', p => p.each((x, y) => { const row = y >> 3; return y % 8 === 7 || ((x + row * 4) % 8 === 7) ? [100, 104, 114] : scale([154, 160, 171], 1 + (p.r() - .5) * .1); }));
tile('snow', noisy(0xf4f8ff, 0.03));
tile('bedrock', p => p.each(() => p.r() < .5 ? [40, 40, 44] : [86, 86, 92]));
tile('berrybush', p => { p.each((x, y) => (Math.hypot(x - 7.5, y - 10) > 6.5 || y < 4) ? null : scale([52, 140, 70], 0.8 + p.r() * 0.4)); for (const [x, y] of [[4, 8], [9, 7], [11, 11], [6, 12], [8, 10]]) { p.px(x, y, [255, 70, 110]); p.px(x + 1, y, [220, 40, 80]); p.px(x, y - 1, [255, 160, 190]); } });
tile('tallgrass', cross(p => { for (let i = 0; i < 7; i++) { const x = 1 + i * 2 + (p.r() * 2 | 0), h = 6 + (p.r() * 9 | 0); for (let y = 16 - h; y < 16; y++) p.px(x + ((y < 16 - h / 2 && i % 2) ? 1 : 0), y, scale([123, 211, 90], 0.75 + (y / 16) * .3)); } }));
tile('flower_red', cross(p => { for (let y = 8; y < 16; y++) p.px(7, y, [70, 160, 60]); p.px(6, 11, [70, 160, 60]); p.px(5, 10, [70, 160, 60]); for (const [x, y] of [[6, 5], [8, 5], [7, 4], [7, 6], [6, 6], [8, 6], [6, 4], [8, 4]]) p.px(x, y, [255, 77, 94]); p.px(7, 5, [255, 210, 80]); }));
tile('flower_blue', cross(p => { for (let y = 6; y < 16; y++) p.px(8, y, [70, 160, 60]); for (const [x, y] of [[7, 6], [9, 6], [7, 7], [8, 7], [9, 7], [6, 8], [10, 8], [8, 5]]) p.px(x, y, [111, 140, 255]); p.px(8, 6, [220, 230, 255]); }));
tile('coal_ore', ore(0x1e1e24));
tile('clamp', p => p.each((x, y) => (x < 2 || y < 2 || x > 13 || y > 13) ? [120, 90, 160] : mix([255, 255, 255], [90, 230, 255], Math.min(1, Math.hypot(x - 7.5, y - 7.5) / 7))));
tile('glowshroom', cross(p => { for (let y = 9; y < 16; y++) { p.px(7, y, [220, 240, 230]); p.px(8, y, [200, 220, 210]); } for (let x = 3; x < 13; x++) for (let y = 4; y < 9; y++) if (Math.hypot((x - 7.5) / 5, (y - 8) / 4) <= 1) p.px(x, y, (x + y) % 4 === 0 ? [230, 255, 245] : [125, 255, 208]); }));
tile('magma', p => p.each((x, y) => Math.abs(Math.sin(x * 0.7 + y * 0.4) + Math.cos(y * 0.9 - x * 0.3)) < 0.18 ? [255, 150, 40] : scale([90, 34, 26], 0.8 + p.r() * 0.4)));
// --- new natural tiles ---
tile('ice', p => { p.fill(0xa8d8f8, 0.04); for (let i = 0; i < 4; i++) { let x = p.r() * 16 | 0, y = p.r() * 16 | 0; for (let k = 0; k < 6; k++) { p.px(x, y, [235, 250, 255]); x++; y += p.r() < .5 ? 1 : 0; } } });
tile('pine_side', p => p.each(x => scale(x % 3 === 0 ? [62, 40, 28] : [86, 58, 40], 1 + (p.r() - .5) * .18)));
tile('pine_top', p => p.each((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.5 ? [62, 40, 28] : (Math.floor(d) % 2 ? [150, 110, 70] : [176, 134, 88]); }));
tile('pine_leaves', leaves(0x2d6b4a, 0.12, 0xe8f4ff));
tile('snowgrass_top', noisy(0xf4f8ff, 0.03, [[6, 0xd8e6f4]]));
tile('snowgrass_side', p => { p.fill(0x8b5a3c, 0.16); for (let x = 0; x < 16; x++) { const h = 3 + (p.r() * 3 | 0); for (let y = 0; y < h; y++) p.px(x, y, scale([240, 246, 255], 1 - p.r() * .05)); } });
tile('coral_pink', p => p.each((x, y) => ((x * 7 + y * 3) % 5 === 0) ? [255, 200, 225] : scale([236, 92, 150], 0.85 + p.r() * 0.3)));
tile('coral_orange', p => p.each((x, y) => (Math.sin(x * 1.1) + Math.cos(y * 1.3 + x * .4)) > 0.6 ? [255, 210, 120] : scale([240, 130, 50], 0.85 + p.r() * 0.25)));
tile('coral_blue', p => p.each((x, y) => (x % 4 === 1 && y % 3 === 0) ? [190, 230, 255] : scale([60, 110, 230], 0.85 + p.r() * 0.3)));
tile('sea_fan', cross(p => { for (let i = 0; i < 40; i++) { const a = -Math.PI / 2 + (p.r() - .5) * 2.2, d = p.r() * 9; p.px(Math.round(8 + Math.cos(a) * d), Math.round(15 + Math.sin(a) * d), p.r() < .3 ? [255, 160, 255] : [190, 70, 220]); } for (let y = 12; y < 16; y++) p.px(8, y, [150, 50, 180]); }));
tile('kelp', cross(p => { for (let y = 0; y < 16; y++) { const x = 7 + Math.round(Math.sin(y * 0.6) * 1.5); p.px(x, y, [50, 140, 70]); p.px(x + 1, y, [70, 170, 90]); if (y % 4 === 1) { p.px(x + 2, y, [90, 190, 100]); p.px(x - 1, y + 1, [90, 190, 100]); } } }));
tile('anemone', cross(p => { for (let i = 0; i < 9; i++) { const x = 3 + i; const h = 5 + (p.r() * 5 | 0); for (let y = 16 - h; y < 16; y++) p.px(x, y, y < 16 - h + 2 ? [255, 255, 200] : [255, 120, 200]); } }));
tile('seaglass', glass([120, 230, 200], [210, 255, 240]));
tile('strata_red', bands([0xb5543a, 0xc9683f, 0xa44a34, 0xd27a4d]));
tile('strata_ochre', bands([0xd7a248, 0xc8923c, 0xe2b45e, 0xbc8536]));
tile('strata_cream', bands([0xeedcb8, 0xe2cba2, 0xf4e6c8, 0xd8bf94]));
tile('glowmoss_top', p => p.each(() => p.r() < 0.12 ? [200, 255, 250] : scale([60, 200, 190], 0.8 + p.r() * 0.4)));
tile('glowmoss_side', p => { p.fill(0x6e7484, 0.08); for (let x = 0; x < 16; x++) { const h = 2 + (p.r() * 4 | 0); for (let y = 0; y < h; y++) p.px(x, y, scale([60, 200, 190], 0.8 + p.r() * .4)); } });
tile('lumen_cap', p => p.each((x, y) => Math.hypot((x % 8) - 4, (y % 8) - 4) < 1.6 ? [240, 255, 255] : scale([150, 90, 255], 0.85 + p.r() * 0.3)));
tile('lumen_stem', p => p.each(x => scale(x % 5 === 0 ? [190, 200, 220] : [228, 232, 245], 1 + (p.r() - .5) * .08)));
tile('glow_vine', cross(p => { for (let y = 0; y < 16; y++) { const x = 7 + Math.round(Math.sin(y * 0.8)); p.px(x, y, [60, 150, 120]); if (y % 3 === 2) p.px(x + 1, y, [160, 255, 230]); } }));
tile('lumen_ore', ore(0x7a5cff, 0xd8ccff));
tile('copper_ore', ore(0xd8783c, 0x64d8b0));
tile('iron_ore', ore(0xd6b8a0));
tile('aether_ore', ore(0xff7af0, 0xffffff));
tile('gravel', p => p.each(() => scale(p.r() < .3 ? [110, 108, 112] : p.r() < .5 ? [160, 156, 150] : [132, 130, 134], 1 + (p.r() - .5) * .1)));
tile('path_top', p => p.each(() => scale([176, 142, 92], 0.85 + p.r() * 0.25)));
tile('thatch', p => p.each((x, y) => scale((x + (y % 3)) % 3 === 0 ? [170, 140, 60] : [214, 182, 92], 0.85 + p.r() * 0.25)));
tile('lantern', p => p.each((x, y) => {
  if (x < 3 || x > 12) return null;
  if (y < 2 || y > 13) return y === 0 || y === 15 ? null : [60, 50, 40];
  if (x === 3 || x === 12 || y === 2 || y === 13) return [70, 60, 50];
  return mix([255, 240, 160], [255, 170, 60], Math.hypot(x - 7.5, y - 7.5) / 6);
}));
tile('tile_white', tiles(0xf2f0ea, 0xe4e1d8, 0xb8b4aa));
tile('tile_teal', tiles(0x3cb4a8, 0x2e9890, 0x1d5e5a));
tile('tile_rose', tiles(0xe88aa4, 0xd47090, 0x8a3a54));
tile('mosaic', p => p.each((x, y) => { if (x % 4 === 0 || y % 4 === 0) return [230, 220, 200]; const k = ((x >> 2) * 3 + (y >> 2) * 5) % 4; return H([0x3fb4e0, 0xf0b040, 0xe05a6a, 0x7ad060][k]); }));
tile('bookshelf', p => p.each((x, y) => { if (y === 0 || y === 15 || y === 7 || y === 8) return [140, 96, 52]; const k = (x * 7 + (y > 8 ? 3 : 0)) % 5; return scale(H([0xb83c3c, 0x3c6ab8, 0x3c9a5a, 0xd8b048, 0x7a4ab0][k]), y % 7 === 1 ? 1.2 : 0.9); }));
tile('planter_side', p => p.each((x, y) => y < 3 ? [70, 160, 60] : (y === 3 ? [110, 70, 36] : scale([180, 110, 70], 1 + (p.r() - .5) * .1))));
tile('planter_top', p => p.each(() => p.r() < 0.12 ? H([0xff4d5e, 0xffd34d, 0x6f8cff][p.r() * 3 | 0]) : scale([80, 170, 70], 0.8 + p.r() * .4)));
tile('roseglass', glass([255, 140, 190], [255, 220, 236]));
tile('polished_basalt', p => p.each((x, y) => (x === 0 || y === 0) ? [40, 38, 46] : (x === 15 || y === 15) ? [96, 94, 106] : scale([70, 68, 78], 1 + (p.r() - .5) * .04)));
tile('copper_block', p => p.each((x, y) => (x % 8 === 0 || y % 8 === 0) ? [160, 82, 40] : scale((x + y) % 9 < 2 ? [120, 210, 180] : [214, 124, 70], 1 + (p.r() - .5) * .08)));
tile('carved_strata', p => p.each((x, y) => { const e = x < 2 || y < 2 || x > 13 || y > 13; const g = Math.abs(x - 7.5) + Math.abs(y - 7.5) < 4.5 && Math.abs(x - 7.5) + Math.abs(y - 7.5) > 2.5; return e ? [170, 80, 54] : g ? [250, 210, 120] : scale([210, 122, 77], 1 + (p.r() - .5) * .06); }));
tile('paper_lantern', p => p.each((x, y) => (y < 2 || y > 13) ? [120, 30, 30] : (y % 4 === 1 ? [200, 80, 50] : mix([255, 230, 170], [255, 160, 90], Math.abs(x - 7.5) / 8))));
tile('checker', p => p.each((x, y) => ((x >> 2) + (y >> 2)) % 2 ? [36, 34, 42] : [236, 232, 222]));
tile('chest_top', p => p.each((x, y) => (x === 0 || y === 0 || x === 15 || y === 15) ? [90, 60, 30] : scale([180, 128, 64], 1 + (p.r() - .5) * .12)));
tile('chest_side', p => p.each((x, y) => { if (x === 0 || x === 15 || y === 0 || y === 15 || y === 6) return [90, 60, 30]; if (x >= 6 && x <= 9 && y >= 5 && y <= 8) return [220, 190, 80]; return scale([180, 128, 64], 1 + (p.r() - .5) * .12); }));
tile('smelter_side', p => p.each((x, y) => { if (x >= 4 && x <= 11 && y >= 7 && y <= 13) return (x === 4 || x === 11 || y === 7) ? [60, 60, 66] : [24, 22, 26]; return scale([120, 124, 134], 1 + (p.r() - .5) * .14) ; }));
tile('smelter_on', p => p.each((x, y) => { if (x >= 4 && x <= 11 && y >= 7 && y <= 13) return (x === 4 || x === 11 || y === 7) ? [60, 60, 66] : mix([255, 210, 80], [255, 90, 20], (y - 8) / 5 + p.r() * .2); return scale([120, 124, 134], 1 + (p.r() - .5) * .14); }));
tile('smelter_top', p => p.each((x, y) => (Math.hypot(x - 7.5, y - 7.5) < 3) ? [30, 28, 32] : scale([100, 104, 114], 1 + (p.r() - .5) * .14)));
tile('drill_side', p => p.each((x, y) => { if (y % 5 === 0) return [80, 70, 60]; if (x === 7 || x === 8) return [220, 180, 60]; return scale([214, 124, 70], 1 + (p.r() - .5) * .1); }));
tile('drill_top', p => p.each((x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return d < 2 ? [220, 220, 230] : d < 5 ? ((Math.atan2(y - 7.5, x - 7.5) * 3 | 0) % 2 ? [150, 150, 160] : [110, 110, 120]) : [214, 124, 70]; }));
tile('jump_top', p => p.each((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.5 ? [70, 70, 80] : (Math.floor(d) % 2 ? [120, 255, 160] : [60, 200, 120]); }));
tile('jump_side', p => p.each((x, y) => y < 3 ? [60, 200, 120] : (y % 3 === 0 ? [60, 60, 70] : [110, 110, 122])));
tile('waystone', p => p.each((x, y) => { if (x < 2 || x > 13) return scale([150, 156, 170], 1 + (p.r() - .5) * .1); const rune = (x === 7 || x === 8) && y % 4 !== 0 || (y === 7 && x > 4 && x < 11); return rune ? [140, 255, 240] : scale([110, 116, 130], 1 + (p.r() - .5) * .1); }));
tile('glow_orb', cross(p => { for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 4.6) p.px(x, y, mix([255, 255, 255], [160, 240, 255], d / 4.6)); } }));
tile('deadbush', cross(p => { for (let i = 0; i < 5; i++) { let x = 8, y = 15; const dx = (i - 2) * 0.5; for (let k = 0; k < 9; k++) { p.px(Math.round(x), y, [150, 110, 70]); x += dx; y--; } } }));
tile('fern', cross(p => { for (let i = 0; i < 4; i++) { const x0 = 3 + i * 3; for (let y = 4 + i % 2 * 2; y < 16; y++) { p.px(x0 + ((16 - y) >> 3), y, [60, 150, 70]); if (y % 2) p.px(x0 + 1 + ((16 - y) >> 3), y, [90, 190, 90]); } } }));
tile('iron_block', p => p.each((x, y) => (x === 0 || y === 0) ? [240, 240, 244] : (x === 15 || y === 15) ? [150, 150, 160] : scale([206, 206, 214], 1 + (p.r() - .5) * .04)));
tile('aether_block', p => p.each((x, y) => (x % 5 === 0 || y % 5 === 0) ? [255, 200, 250] : scale([230, 110, 220], 0.85 + p.r() * 0.3)));
tile('trail_beacon', p => p.each((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.5 ? [60, 40, 90] : (Math.floor(d + (y % 4) * 0.25) % 2 ? [255, 120, 220] : [255, 230, 120]); }));
tile('arena_stone', p => p.each((x, y) => (x % 8 === 0 || y % 8 === 0) ? [40, 34, 60] : (((x >> 3) + (y >> 3)) % 2 ? scale([96, 84, 140], 1 + (p.r() - .5) * .08) : scale([120, 106, 168], 1 + (p.r() - .5) * .08))));
tile('mossy_cobble', p => p.each((x, y) => { const cx = (x + (y >> 2) * 3) % 6, cy = y % 4; if (cx === 0 || cy === 0) return p.r() < .5 ? [70, 120, 60] : [88, 92, 102]; return p.r() < 0.25 ? [90, 150, 70] : scale([140, 146, 158], 1 + (p.r() - .5) * .2); }));

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */
def(B.GRASS, 'Grass', 'solid', [T.grass_top, T.grass_side, T.dirt], { hard: 0.9, tool: 'shovel', drop: B.DIRT, color: 0x6cc24a });
def(B.DIRT, 'Dirt', 'solid', T.dirt, { hard: 0.75, tool: 'shovel', color: 0x8b5a3c });
def(B.STONE, 'Stone', 'solid', T.stone, { hard: 6, tool: 'pick', needsTool: true, drop: B.COBBLE, color: 0x8e95a3 });
def(B.COBBLE, 'Cobblestone', 'solid', T.cobble, { hard: 7, tool: 'pick', needsTool: true, color: 0x7d838f });
def(B.SAND, 'Sand', 'solid', T.sand, { hard: 0.75, tool: 'shovel', gravity: true, color: 0xf0dc9b });
def(B.WATER, 'Water', 'liquid', T.water, { hard: -1, color: 0x3aa0e8 });
def(B.LOG, 'Log', 'solid', [T.log_top, T.log_side, T.log_top], { hard: 3, tool: 'axe', color: 0x7a4f2c });
def(B.LEAVES, 'Leaves', 'cutout', T.leaves, { hard: 0.3, color: 0x3fa34d, drop: 'leaves' });
def(B.PLANKS, 'Planks', 'solid', T.planks, { hard: 2.5, tool: 'axe', color: 0xc8955a });
def(B.CSAND, 'Crystal Sand', 'solid', T.csand, { hard: 0.75, tool: 'shovel', gravity: true, color: 0xe7b8f0 });
def(B.CSANDSTONE, 'Crystal Sandstone', 'solid', [T.csandstone_top, T.csandstone_side, T.csandstone_top], { hard: 4, tool: 'pick', needsTool: true, color: 0xd79fe0 });
def(B.CRYSTAL, 'Crystal', 'solid', T.crystal, { hard: 5, tool: 'pick', needsTool: true, light: 11, drop: 'crystal', color: 0x5ff2ff });
def(B.BASALT, 'Basalt', 'solid', [T.basalt_top, T.basalt_side, T.basalt_top], { hard: 6, tool: 'pick', needsTool: true, color: 0x45434c });
def(B.OBSIDIAN, 'Obsidian', 'solid', T.obsidian, { hard: 25, tool: 'pick', needsTool: true, minTier: 4, color: 0x2a1840 });
def(B.LAVA, 'Lava', 'liquid', T.lava, { hard: -1, light: 15, damage: 4, color: 0xff6a1a });
def(B.ASH, 'Ash', 'solid', T.ash, { hard: 0.6, tool: 'shovel', gravity: true, color: 0x6e6a6a });
def(B.SKYGRASS, 'Sky Grass', 'solid', [T.skygrass_top, T.skygrass_side, T.skystone], { hard: 0.9, tool: 'shovel', drop: B.SKYSTONE, color: 0x5fe0b8 });
def(B.SKYSTONE, 'Skystone', 'solid', T.skystone, { hard: 3, tool: 'pick', color: 0xd9e4f5 });
def(B.BLOSSOM, 'Blossom Leaves', 'cutout', T.blossom, { hard: 0.3, color: 0xff9ccf, drop: 'blossom' });
def(B.WORKBENCH, 'Workbench', 'solid', [T.bench_top, T.bench_side, T.planks], { hard: 2.5, tool: 'axe', color: 0xb07b45 });
def(B.TORCH, 'Torch', 'cross', T.torch, { hard: 0, light: 14, color: 0xffcc55 });
def(B.CGLASS, 'Crystal Glass', 'cutout', T.cglass, { hard: 0.4, color: 0xbff6ff, glass: true });
def(B.BRICKS, 'Stone Bricks', 'solid', T.bricks, { hard: 7, tool: 'pick', needsTool: true, color: 0x9aa0ab });
def(B.SNOW, 'Snow', 'solid', T.snow, { hard: 0.5, tool: 'shovel', color: 0xf4f8ff });
def(B.BEDROCK, 'Bedrock', 'solid', T.bedrock, { hard: -1, color: 0x333333 });
def(B.BERRYBUSH, 'Berry Bush', 'cross', T.berrybush, { hard: 0.1, drop: 'berries', color: 0xd8344e });
def(B.TALLGRASS, 'Tall Grass', 'cross', T.tallgrass, { hard: 0, drop: 'grass', color: 0x7bd35a });
def(B.FLOWER_RED, 'Ember Poppy', 'cross', T.flower_red, { hard: 0, color: 0xff4d5e });
def(B.FLOWER_BLUE, 'Skybell', 'cross', T.flower_blue, { hard: 0, color: 0x6f8cff });
def(B.COAL_ORE, 'Coal Ore', 'solid', T.coal_ore, { hard: 7, tool: 'pick', needsTool: true, drop: 'coal', color: 0x50555e });
def(B.CLAMP, 'Crystal Lamp', 'solid', T.clamp, { hard: 1, tool: 'pick', light: 15, color: 0x9ff8ff });
def(B.GLOWSHROOM, 'Glowshroom', 'cross', T.glowshroom, { hard: 0, light: 9, color: 0x7dffd0 });
def(B.MAGMA, 'Magma Rock', 'solid', T.magma, { hard: 6, tool: 'pick', needsTool: true, light: 7, color: 0x8a2f1c });
def(B.ICE, 'Ice', 'solid', T.ice, { hard: 1.2, tool: 'pick', color: 0xa8d8f8, slip: true });
def(B.PINE_LOG, 'Pine Log', 'solid', [T.pine_top, T.pine_side, T.pine_top], { hard: 3, tool: 'axe', color: 0x56392a });
def(B.PINE_LEAVES, 'Pine Needles', 'cutout', T.pine_leaves, { hard: 0.3, color: 0x2d6b4a, drop: 'leaves' });
def(B.SNOWGRASS, 'Snowy Grass', 'solid', [T.snowgrass_top, T.snowgrass_side, T.dirt], { hard: 0.9, tool: 'shovel', drop: B.DIRT, color: 0xf0f4fa });
def(B.CORAL_PINK, 'Tube Coral', 'solid', T.coral_pink, { hard: 1, tool: 'pick', color: 0xec5c96 });
def(B.CORAL_ORANGE, 'Brain Coral', 'solid', T.coral_orange, { hard: 1, tool: 'pick', color: 0xf08232 });
def(B.CORAL_BLUE, 'Star Coral', 'solid', T.coral_blue, { hard: 1, tool: 'pick', color: 0x3c6ee6 });
def(B.SEA_FAN, 'Sea Fan', 'cross', T.sea_fan, { hard: 0, wet: true, color: 0xbe46dc });
def(B.KELP, 'Kelp', 'cross', T.kelp, { hard: 0, wet: true, color: 0x46aa5a });
def(B.ANEMONE, 'Glow Anemone', 'cross', T.anemone, { hard: 0, wet: true, light: 8, drop: 'anemone', color: 0xff78c8 });
def(B.SEAGLASS, 'Sea Glass', 'cutout', T.seaglass, { hard: 0.4, color: 0x78e6c8, glass: true });
def(B.STRATA_RED, 'Rust Strata', 'solid', T.strata_red, { hard: 4, tool: 'pick', needsTool: true, color: 0xb5543a });
def(B.STRATA_OCHRE, 'Ochre Strata', 'solid', T.strata_ochre, { hard: 4, tool: 'pick', needsTool: true, color: 0xd7a248 });
def(B.STRATA_CREAM, 'Cream Strata', 'solid', T.strata_cream, { hard: 4, tool: 'pick', needsTool: true, color: 0xeedcb8 });
def(B.GLOWMOSS, 'Glowmoss', 'solid', [T.glowmoss_top, T.glowmoss_side, T.stone], { hard: 1.5, tool: 'shovel', light: 11, drop: B.COBBLE, color: 0x3cc8be });
def(B.LUMEN_CAP, 'Lumen Cap', 'solid', T.lumen_cap, { hard: 1, tool: 'axe', light: 12, drop: 'lumencap', color: 0x965aff });
def(B.LUMEN_STEM, 'Lumen Stem', 'solid', T.lumen_stem, { hard: 2, tool: 'axe', color: 0xe4e8f5 });
def(B.GLOW_VINE, 'Glow Vine', 'cross', T.glow_vine, { hard: 0, light: 7, color: 0x5ae6be });
def(B.LUMEN_ORE, 'Lumen Ore', 'solid', T.lumen_ore, { hard: 7, tool: 'pick', needsTool: true, minTier: 2, light: 9, drop: 'lumen', color: 0x7a5cff });
def(B.COPPER_ORE, 'Copper Ore', 'solid', T.copper_ore, { hard: 7, tool: 'pick', needsTool: true, minTier: 2, color: 0xd8783c });
def(B.IRON_ORE, 'Iron Ore', 'solid', T.iron_ore, { hard: 8, tool: 'pick', needsTool: true, minTier: 2, color: 0xd6b8a0 });
def(B.AETHER_ORE, 'Aether Ore', 'solid', T.aether_ore, { hard: 12, tool: 'pick', needsTool: true, minTier: 4, light: 5, color: 0xff7af0 });
def(B.GRAVEL, 'Gravel', 'solid', T.gravel, { hard: 0.9, tool: 'shovel', gravity: true, color: 0x8a888c });
def(B.PATH, 'Trail', 'solid', [T.path_top, T.dirt, T.dirt], { hard: 0.8, tool: 'shovel', drop: B.DIRT, color: 0xb08e5c });
def(B.THATCH, 'Thatch', 'solid', T.thatch, { hard: 0.6, tool: 'axe', color: 0xd6b65c });
def(B.LANTERN, 'Lantern', 'cutout', T.lantern, { hard: 0.5, tool: 'pick', light: 14, color: 0xffd080 });
def(B.TILE_WHITE, 'Chalk Tiles', 'solid', T.tile_white, { hard: 2, tool: 'pick', color: 0xf2f0ea });
def(B.TILE_TEAL, 'Lagoon Tiles', 'solid', T.tile_teal, { hard: 2, tool: 'pick', color: 0x3cb4a8 });
def(B.TILE_ROSE, 'Rose Tiles', 'solid', T.tile_rose, { hard: 2, tool: 'pick', color: 0xe88aa4 });
def(B.MOSAIC, 'Mosaic', 'solid', T.mosaic, { hard: 2, tool: 'pick', color: 0x3fb4e0 });
def(B.BOOKSHELF, 'Bookshelf', 'solid', [T.planks, T.bookshelf, T.planks], { hard: 1.5, tool: 'axe', color: 0xb83c3c });
def(B.PLANTER, 'Planter', 'solid', [T.planter_top, T.planter_side, T.planter_side], { hard: 1, tool: 'shovel', color: 0x50aa46 });
def(B.ROSEGLASS, 'Rose Glass', 'cutout', T.roseglass, { hard: 0.4, color: 0xff8cbe, glass: true });
def(B.POLISHED_BASALT, 'Polished Basalt', 'solid', T.polished_basalt, { hard: 6, tool: 'pick', needsTool: true, color: 0x46444e });
def(B.COPPER_BLOCK, 'Copper Panel', 'solid', T.copper_block, { hard: 5, tool: 'pick', needsTool: true, color: 0xd67c46 });
def(B.CARVED_STRATA, 'Carved Strata', 'solid', T.carved_strata, { hard: 4, tool: 'pick', needsTool: true, color: 0xd27a4d });
def(B.PAPER_LANTERN, 'Paper Lantern', 'solid', T.paper_lantern, { hard: 0.3, light: 13, color: 0xffa060 });
def(B.CHECKER, 'Checker Tiles', 'solid', T.checker, { hard: 2, tool: 'pick', color: 0x888888 });
def(B.CHEST, 'Chest', 'solid', [T.chest_top, T.chest_side, T.chest_top], { hard: 2, tool: 'axe', color: 0xb48040, machine: 'chest' });
def(B.SMELTER, 'Smelter', 'solid', [T.smelter_top, T.smelter_side, T.smelter_top], { hard: 6, tool: 'pick', needsTool: true, color: 0x7c808a, machine: 'smelter' });
def(B.SMELTER_ON, 'Smelter (lit)', 'solid', [T.smelter_top, T.smelter_on, T.smelter_top], { hard: 6, tool: 'pick', needsTool: true, light: 12, drop: B.SMELTER, color: 0xff8a3a, machine: 'smelter' });
def(B.DRILL, 'Auto Drill', 'solid', [T.drill_top, T.drill_side, T.drill_top], { hard: 4, tool: 'pick', color: 0xd67c46, machine: 'drill' });
def(B.JUMP_PAD, 'Jump Pad', 'solid', [T.jump_top, T.jump_side, T.jump_side], { hard: 2, tool: 'pick', color: 0x3cc878 });
def(B.WAYSTONE, 'Waystone', 'solid', T.waystone, { hard: 10, tool: 'pick', needsTool: true, light: 10, color: 0x8cfff0, machine: 'waystone' });
def(B.GLOW_ORB, 'Glow Orb', 'cross', T.glow_orb, { hard: 0, light: 15, drop: 'none', color: 0xc8f8ff });
def(B.DEADBUSH, 'Dry Bramble', 'cross', T.deadbush, { hard: 0, drop: 'stick', color: 0x966e46 });
def(B.FERN, 'Fern', 'cross', T.fern, { hard: 0, drop: 'grass', color: 0x3c9646 });
def(B.IRON_BLOCK, 'Iron Block', 'solid', T.iron_block, { hard: 8, tool: 'pick', needsTool: true, color: 0xceced6 });
def(B.AETHER_BLOCK, 'Aether Block', 'solid', T.aether_block, { hard: 8, tool: 'pick', needsTool: true, light: 8, color: 0xe66edc });
def(B.MOSSY_COBBLE, 'Mossy Cobblestone', 'solid', T.mossy_cobble, { hard: 7, tool: 'pick', needsTool: true, color: 0x6e8a62 });
for (let l = 7; l >= 1; l--) def(B.WATER_FLOW + (7 - l), 'Flowing Water', 'liquid', T.water, { hard: -1, color: 0x3aa0e8, flow: true });
for (let l = 3; l >= 1; l--) def(B.LAVA_FLOW + (3 - l), 'Flowing Lava', 'liquid', T.lava, { hard: -1, light: 15, damage: 4, color: 0xff6a1a, flow: true });
def(B.TRAIL_BEACON, 'Trail Beacon', 'solid', T.trail_beacon, { hard: -1, light: 15, color: 0xff78dc });
def(B.ARENA_STONE, 'Arena Stone', 'solid', T.arena_stone, { hard: -1, color: 0x786aa8 });

export const BLOCKS = [];
BLOCKS[0] = { id: 0, name: 'Air', kind: 'air', solid: false, opaque: false, light: 0, tex: [0, 0, 0] };
for (const [id, name, kind, tex, o] of DEFS) {
  const t = Array.isArray(tex) ? tex : [tex, tex, tex];
  BLOCKS[id] = {
    id, name, kind, tex: t,
    solid: kind === 'solid' || kind === 'cutout',
    opaque: kind === 'solid',
    light: o.light || 0,
    hard: o.hard, tool: o.tool || null, needsTool: !!o.needsTool, minTier: o.minTier || 1,
    gravity: !!o.gravity, damage: o.damage || 0, color: o.color, glass: !!o.glass, wet: !!o.wet,
    machine: o.machine || null, slip: !!o.slip, flow: !!o.flow,
    drop: o.drop ?? id,
  };
}
export const NUM_BLOCKS = BLOCKS.length;

// Typed lookup tables for the hot paths (meshing, lighting, physics)
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256);
export const EMIT = new Uint8Array(256);
export const KIND = new Uint8Array(256); // 0 air,1 solid,2 cutout,3 liquid,4 cross
export const WATERY = new Uint8Array(256); // water + water plants
export const LIQ_TYPE = new Uint8Array(256);  // 1 water, 2 lava
export const LIQ_LEVEL = new Uint8Array(256); // 8 = source, 7..1 flowing
const KIND_CODE = { air: 0, solid: 1, cutout: 2, liquid: 3, cross: 4 };
for (const b of BLOCKS) {
  if (!b) continue;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  EMIT[b.id] = b.light;
  KIND[b.id] = KIND_CODE[b.kind];
  WATERY[b.id] = b.id === B.WATER || b.wet ? 1 : 0;
}
LIQ_TYPE[B.WATER] = 1; LIQ_LEVEL[B.WATER] = 8;
LIQ_TYPE[B.LAVA] = 2; LIQ_LEVEL[B.LAVA] = 8;
for (let l = 7; l >= 1; l--) { const id = B.WATER_FLOW + (7 - l); LIQ_TYPE[id] = 1; LIQ_LEVEL[id] = l; WATERY[id] = 1; }
for (let l = 3; l >= 1; l--) { const id = B.LAVA_FLOW + (3 - l); LIQ_TYPE[id] = 2; LIQ_LEVEL[id] = l * 2; }
export const waterFlowId = level => B.WATER_FLOW + (7 - level);
export const lavaFlowId = level => B.LAVA_FLOW + (3 - Math.max(1, Math.min(3, level)));

/* ------------------------------------------------------------------ */
/* Items (ids >= 120). Block items share their block id.               */
/* ------------------------------------------------------------------ */
export const I = {
  STICK: 120, COAL: 121, SHARD: 122, EMBER: 123, SCALE: 124, CORE: 125, MEAT: 126, COOKED_MEAT: 127, BERRIES: 128,
  SKYFRUIT: 129, FISH: 130, COOKED_FISH: 131, COPPER_INGOT: 132, IRON_INGOT: 133, AETHER_SHARD: 134, LUMEN_DUST: 135,
  GLIMMER: 136, PEARL: 137, CHARCOAL: 138, FROST_CORE: 139, HIDE: 140, GEAR: 141, MUSHROOM_STEW: 142,
  SERPENT_BLADE: 170,
  LUMEN_STAFF: 180, BLINK_CHARM: 181, FEATHER_CLOAK: 182, TIDE_AMULET: 183, EMBER_HEART: 184, HOME_COMPASS: 185, STORM_ROD: 186,
};
export const TIERS = ['wood', 'stone', 'iron', 'crystal', 'aether'];
const TIER_STATS = [
  { speed: 2, dur: 60 }, { speed: 4, dur: 132 }, { speed: 6, dur: 250 }, { speed: 8, dur: 500 }, { speed: 12, dur: 1200 },
];
const TOOL_TYPES = ['pick', 'axe', 'shovel', 'sword'];
const TOOL_LABEL = { pick: 'Pickaxe', axe: 'Axe', shovel: 'Shovel', sword: 'Sword' };
export function toolId(tier, type) { return 150 + TIERS.indexOf(tier) * 4 + TOOL_TYPES.indexOf(type); }

export const ITEMS = [];
function addItem(id, name, extra = {}) { ITEMS[id] = { id, name, stack: 64, cat: 'Materials', ...extra }; }

const MACHINE_IDS = [B.CHEST, B.SMELTER, B.DRILL, B.JUMP_PAD, B.WAYSTONE, B.WORKBENCH];
const DECOR_IDS = [B.LANTERN, B.TILE_WHITE, B.TILE_TEAL, B.TILE_ROSE, B.MOSAIC, B.BOOKSHELF, B.PLANTER, B.ROSEGLASS, B.POLISHED_BASALT,
  B.COPPER_BLOCK, B.CARVED_STRATA, B.PAPER_LANTERN, B.CHECKER, B.CGLASS, B.BRICKS, B.CLAMP, B.IRON_BLOCK, B.AETHER_BLOCK, B.SEAGLASS, B.TORCH, B.MOSSY_COBBLE];
for (const b of BLOCKS) {
  if (!b || !b.id || b.id === B.SMELTER_ON || b.flow) continue;
  addItem(b.id, b.name, { block: b.id, cat: MACHINE_IDS.includes(b.id) ? 'Machines' : DECOR_IDS.includes(b.id) ? 'Decor' : 'Blocks' });
}
addItem(I.STICK, 'Stick');
addItem(I.COAL, 'Coal', { fuel: 8 });
addItem(I.CHARCOAL, 'Charcoal', { fuel: 8 });
addItem(I.SHARD, 'Crystal Shard');
addItem(I.EMBER, 'Ember', { fuel: 12 });
addItem(I.SCALE, 'Serpent Scale');
addItem(I.CORE, 'Golem Core');
addItem(I.FROST_CORE, 'Frost Core');
addItem(I.HIDE, 'Strider Hide');
addItem(I.PEARL, 'Glow Pearl');
addItem(I.COPPER_INGOT, 'Copper Ingot');
addItem(I.IRON_INGOT, 'Iron Ingot');
addItem(I.AETHER_SHARD, 'Aether Shard');
addItem(I.LUMEN_DUST, 'Lumen Dust');
addItem(I.GEAR, 'Copper Gear');
addItem(I.GLIMMER, 'Glimmer', { cat: 'Materials', stack: 999 });
addItem(I.MEAT, 'Raw Meat', { food: 3, cat: 'Food' });
addItem(I.COOKED_MEAT, 'Roast Meat', { food: 8, cat: 'Food' });
addItem(I.FISH, 'Raw Glassfin', { food: 2, cat: 'Food' });
addItem(I.COOKED_FISH, 'Grilled Glassfin', { food: 6, cat: 'Food' });
addItem(I.BERRIES, 'Glowberries', { food: 3, cat: 'Food' });
addItem(I.SKYFRUIT, 'Sky Fruit', { food: 5, cat: 'Food' });
addItem(I.MUSHROOM_STEW, 'Lumen Stew', { food: 10, cat: 'Food', stack: 8 });
TIERS.forEach((tier, ti) => {
  for (const type of TOOL_TYPES) {
    const st = TIER_STATS[ti];
    addItem(toolId(tier, type), `${tier[0].toUpperCase() + tier.slice(1)} ${TOOL_LABEL[type]}`, {
      stack: 1, cat: 'Tools', durability: st.dur,
      tool: { type, tier: ti + 1, speed: st.speed, damage: type === 'sword' ? 4 + ti * 2.5 : { pick: 2, axe: 3, shovel: 1.5 }[type] + ti },
    });
  }
});
addItem(I.SERPENT_BLADE, 'Serpent Blade', { stack: 1, cat: 'Tools', tool: { type: 'sword', tier: 4, speed: 1, damage: 16 }, durability: 800 });
// magical artifacts: use = right-click action, passive = works while carried
addItem(I.LUMEN_STAFF, 'Lumen Staff', { stack: 1, cat: 'Magic', durability: 120, use: 'orb', desc: 'Right-click to conjure a floating light.' });
addItem(I.BLINK_CHARM, 'Blink Charm', { stack: 1, cat: 'Magic', durability: 80, use: 'blink', desc: 'Right-click to blink 8 blocks forward.' });
addItem(I.STORM_ROD, 'Storm Rod', { stack: 1, cat: 'Magic', durability: 40, use: 'storm', desc: 'Right-click to call lightning where you look.' });
addItem(I.HOME_COMPASS, 'Homeward Compass', { stack: 1, cat: 'Magic', use: 'home', desc: 'Right-click to return to your spawn point.' });
addItem(I.FEATHER_CLOAK, 'Feather Cloak', { stack: 1, cat: 'Magic', passive: 'feather', desc: 'Carry it to fall gently and take no fall damage.' });
addItem(I.TIDE_AMULET, 'Tide Amulet', { stack: 1, cat: 'Magic', passive: 'tide', desc: 'Carry it to breathe and swim swiftly underwater.' });
addItem(I.EMBER_HEART, 'Ember Heart', { stack: 1, cat: 'Magic', passive: 'ember', desc: 'Carry it to shrug off lava and fire.' });

export function itemName(id) { return ITEMS[id] ? ITEMS[id].name : '?'; }

/* ------------------------------------------------------------------ */
/* Atlas                                                               */
/* ------------------------------------------------------------------ */
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

export function buildAtlas() {
  const c = makeCanvas(TILE * ATLAS_TILES, TILE * ATLAS_TILES);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  TILES.forEach((fn, t) => fn(painter(ctx, (t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE, t + 1)));
  return c;
}

// UV rectangle for a tile (with a tiny inset so neighbours never bleed)
export function tileUV(t) {
  const s = 1 / ATLAS_TILES, e = 0.0005;
  const u0 = (t % ATLAS_TILES) * s + e, v1 = 1 - Math.floor(t / ATLAS_TILES) * s - e;
  return [u0, v1 - s + 2 * e, u0 + s - 2 * e, v1];
}

// average colour of each block's top tile, used by the map
export function blockMapColors(atlas) {
  const ctx = atlas.getContext('2d');
  const out = new Uint32Array(256);
  for (const b of BLOCKS) {
    if (!b || !b.id) continue;
    const t = b.kind === 'cross' ? b.tex[0] : b.tex[0];
    const d = ctx.getImageData((t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE, TILE, TILE).data;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    out[b.id] = n ? ((r / n) << 16) | ((g / n) << 8) | (bl / n) : b.color;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Item icons (32px canvases -> data URLs)                             */
/* ------------------------------------------------------------------ */
const ICON_CACHE = new Map();

function drawCubeIcon(ctx, atlas, b) {
  const [top, side] = b.tex;
  const src = t => [(t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE];
  const face = (t, m, shadeA) => {
    ctx.setTransform(...m);
    const [sx, sy] = src(t);
    ctx.drawImage(atlas, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
    if (shadeA) { ctx.fillStyle = `rgba(0,0,0,${shadeA})`; ctx.fillRect(0, 0, TILE, TILE); }
  };
  face(top, [14 / 16, 7 / 16, -14 / 16, 7 / 16, 16, 1], 0);
  face(side, [14 / 16, 7 / 16, 0, 1, 2, 8], 0.18);
  face(side, [14 / 16, -7 / 16, 0, 1, 16, 15], 0.34);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function pixels(ctx, rows, palette) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || ch === ' ' || !palette[ch]) return;
    ctx.fillStyle = palette[ch];
    ctx.fillRect(x * 2, y * 2, 2, 2);
  }));
}

const SHAPES = {
  pick: ['................', '...hhhhhhhh.....', '..hHHHHHHHHh....', '.hH.....sHHh....', '.h.....s..hHh...', '......s....hH...', '.....s......h...', '....s...........', '...s............', '..s.............', '.s..............', 's...............'],
  axe: ['................', '......hhh.......', '.....hHHHh......', '....hHHHHs......', '....hHHHs.......', '.....hHs........', '......s.........', '.....s..........', '....s...........', '...s............', '..s.............', '.s..............', 's...............'],
  shovel: ['................', '..........hhh...', '.........hHHHh..', '.........hHHHh..', '..........hHh...', '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........', '....s...........', '...s............', '..ss............'],
  sword: ['..............hh', '.............hHh', '............hHh.', '...........hHh..', '..........hHh...', '.........hHh....', '........hHh.....', '...g...hHh......', '....g.hHh.......', '.....gHh........', '......g.........', '.....s.g........', '....s...g.......', '...s............', '..s.............'],
  stick: ['..............s.', '.............s..', '............s...', '...........s....', '..........s.....', '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........', '....s...........', '...s............', '..s.............'],
  lump: ['................', '................', '.....kkkk.......', '....kKKKKk......', '...kKwKKKKk.....', '...kKKKKkKk.....', '..kKKKKKKKKk....', '..kKkKKKKKKk....', '...kKKKKKkk.....', '....kkKKKk......', '......kkk.......'],
  gem: ['.........w......', '........wc......', '.......wcC......', '.......cCC......', '......wcCC......', '......cCCb......', '.....wcCCb......', '.....cCCbb......', '....wcCCb.......', '....cCCbb.......', '....cCbb........', '.....Cb.........'],
  ingot: ['................', '................', '................', '................', '.....kkkkkk.....', '....kwKKKKKk....', '...kwKKKKKKKk...', '..kKKKKKKKKKKk..', '..kkkkkkkkkkkk..', '................'],
  dust: ['................', '................', '........w.......', '.....K......w...', '...w....K.......', '.......K..K.....', '....KKKwKKK.....', '...KKwKKKKKKK...', '..KKKKKKKwKKKK..', '..kkkkkkkkkkkk..'],
  coin: ['................', '.....kkkkk......', '....kKKKKKk.....', '...kKwwKKKKk....', '...kKwKKKKKk....', '...kKKKKkKKk....', '...kKKKKkKKk....', '...kKKKKKKKk....', '....kKKKKKk.....', '.....kkkkk......'],
  orb: ['................', '................', '......kkkk......', '.....kKKKKk.....', '....kKwwKKKk....', '....kKwKKKKk....', '....kKKKKKKk....', '....kKKKKKKk....', '.....kKKKKk.....', '......kkkk......'],
  ember: ['................', '................', '.......y........', '......yo........', '.....yoo........', '.....oOoy.......', '....oOOOoy......', '....rOOOOo......', '....rrOOOo......', '.....rrrr.......'],
  scale: ['................', '................', '.....gggggg.....', '....gGGGGGGg....', '...gGlGGGGGGg...', '...gGGlGGGGGg...', '...gGGGGGGGGg...', '....gGGGGGGg....', '.....gGGGGg.....', '......gGGg......', '.......gg.......'],
  meat: ['................', '................', '......rrrr......', '....rRRRRRr.....', '...rRRpRRRRr....', '...rRRRRRRRr....', '...rRRRRpRRr....', '....rRRRRRr.....', '.....rrrrbw.....', '.........bww....', '..........ww....'],
  berries: ['................', '.......g........', '......gg........', '.....g..g.......', '....rr..rr......', '...rRwr.rRwr....', '...rRRr.rRRr....', '....rr...rr.....', '......rr........', '.....rRwr.......', '.....rRRr.......', '......rr........'],
  fruit: ['................', '........g.......', '.......gl.......', '.....pppp.......', '....pPPPPp......', '...pPPwPPPp.....', '...pPwPPPPp.....', '...pPPPPPPp.....', '...pPPPPPPp.....', '....pPPPPp......', '.....pppp.......'],
  fish: ['................', '................', '................', '.....kkkk....k..', '...kkKKKKk..kKk.', '..kwKKKlKKkkKk..', '..kKKKKlKKKKKk..', '...kkKKKKKkkKk..', '.....kkkk...kKk.', '.............k..'],
  bowl: ['................', '................', '.....p.P..p.....', '....pPPpPPpP....', '..wwwwwwwwwwww..', '..kKKKKKKKKKKk..', '...kKKKKKKKKk...', '....kKKKKKKk....', '.....kkkkkk.....'],
  gear: ['................', '.......kk.......', '...kk.kKKk.kk...', '...kKkKKKKkKk...', '....kKKKKKKk....', '..kkKKkkkKKKkk..', '..kKKKk..kKKKk..', '..kKKKk..kKKKk..', '..kkKKKkkKKKkk..', '....kKKKKKKk....', '...kKkKKKKkKk...', '...kk.kKKk.kk...', '.......kk.......'],
  hide: ['................', '...kk......kk...', '...kKkkkkkkKk...', '....kKKKKKKk....', '...kKKwKKKKKk...', '...kKKKKKKKKk...', '...kKKKKwKKKk...', '...kKKKKKKKKk...', '....kKKKKKKk....', '...kKkkkkkkKk...', '...kk......kk...'],
  staff: ['............wcw.', '...........cCCc.', '...........wCCw.', '..........s.c...', '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........', '....s...........', '...s............', '..s.............', '.s..............'],
  charm: ['......kkkk......', '.....k....k.....', '.....k....k.....', '......k..k......', '.......kk.......', '......cCCc......', '.....cCwCCc.....', '....cCwCCCCc....', '....cCCCCCCc....', '.....cCCCCc.....', '......cCCc......', '.......cc.......'],
  cloak: ['.....kkkkkk.....', '....kKKKKKKk....', '....kKwKKKKk....', '...kKKKKKKKKk...', '...kKKwKKKKKk...', '..kKKKKKKKKKKk..', '..kKKKKKwKKKKk..', '.kKKKKKKKKKKKKk.', '.kKwKKKKKKKKKKk.', '.kkkkkkkkkkkkkk.'],
  amulet: ['..kk........kk..', '...k........k...', '....k......k....', '.....k....k.....', '......kkkk......', '......cCCc......', '.....cCwCCc.....', '.....cCCCCc.....', '......cCCc......', '.......cc.......'],
  heart: ['................', '..rr....rr......', '.rOOr..rOOr.....', 'rOyOOrrOOOOr....', 'rOOOOOOOOOOr....', 'rOOOOOOOOOOr....', '.rOOOOOOOOr.....', '..rOOOOOOr......', '...rOOOOr.......', '....rOOr........', '.....rr.........'],
  compass: ['................', '.....kkkkkk.....', '....kwwwwwwk....', '...kwwwrwwwwk...', '...kwwwrrwwwk...', '...kwwwrKwwwk...', '...kwwwKKwwwk...', '...kwwwKwwwwk...', '....kwwwwwwk....', '.....kkkkkk.....'],
  rod: ['............yy..', '...........yYy..', '..........yYy...', '.........yy.....', '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........', '....s...........', '...s............', '..s.............'],
};

const TIER_COLORS = [
  { h: '#7a4f2c', H: '#c8955a' }, { h: '#5a5e68', H: '#a8afbd' }, { h: '#8a8a96', H: '#e8e8f0' },
  { h: '#2a90c0', H: '#8ff4ff' }, { h: '#b03aa8', H: '#ff9af4' },
];

const SIMPLE_ICONS = {
  [I.STICK]: ['stick', { s: '#8a5a30' }],
  [I.COAL]: ['lump', { k: '#16161c', K: '#3a3a44', w: '#55555f' }],
  [I.CHARCOAL]: ['lump', { k: '#24180f', K: '#4a3420', w: '#6a4c30' }],
  [I.SHARD]: ['gem', { w: '#ffffff', c: '#9ffaff', C: '#4fd8f0', b: '#2a90c0' }],
  [I.AETHER_SHARD]: ['gem', { w: '#ffffff', c: '#ffc8fa', C: '#ff7af0', b: '#a03aa0' }],
  [I.EMBER]: ['ember', { y: '#ffe680', o: '#ffa030', O: '#ff6020', r: '#a02810' }],
  [I.SCALE]: ['scale', { g: '#2b6e8f', G: '#58b6d8', l: '#c8f4ff' }],
  [I.CORE]: ['orb', { k: '#6a3ab0', K: '#b07cff', w: '#ffffff' }],
  [I.FROST_CORE]: ['orb', { k: '#3a7ab0', K: '#bfe8ff', w: '#ffffff' }],
  [I.PEARL]: ['orb', { k: '#b06090', K: '#ffd8f0', w: '#ffffff' }],
  [I.MEAT]: ['meat', { r: '#9a2a2a', R: '#e45a5a', p: '#ffb0b0', b: '#d8d0c0', w: '#ffffff' }],
  [I.COOKED_MEAT]: ['meat', { r: '#5a2e14', R: '#a8622e', p: '#d89a5a', b: '#d8d0c0', w: '#ffffff' }],
  [I.FISH]: ['fish', { k: '#3a7aa0', K: '#9fe0ff', w: '#ffffff', l: '#d8f4ff' }],
  [I.COOKED_FISH]: ['fish', { k: '#7a4a20', K: '#d8a060', w: '#ffffff', l: '#f0c890' }],
  [I.BERRIES]: ['berries', { g: '#3a8a40', r: '#b01840', R: '#ff4a7a', w: '#ffd0e0' }],
  [I.SKYFRUIT]: ['fruit', { g: '#3a8a40', l: '#7bd35a', p: '#c04890', P: '#ff9ccf', w: '#ffffff' }],
  [I.MUSHROOM_STEW]: ['bowl', { p: '#c8a0ff', P: '#965aff', w: '#e8dcc8', k: '#6a4020', K: '#a87040' }],
  [I.COPPER_INGOT]: ['ingot', { k: '#8a4420', K: '#e08a50', w: '#ffd0a8' }],
  [I.IRON_INGOT]: ['ingot', { k: '#6a6a74', K: '#d0d0d8', w: '#ffffff' }],
  [I.LUMEN_DUST]: ['dust', { k: '#4a30a0', K: '#9a80ff', w: '#ffffff' }],
  [I.GLIMMER]: ['coin', { k: '#a07010', K: '#ffd34d', w: '#fff6c0' }],
  [I.GEAR]: ['gear', { k: '#8a4420', K: '#e08a50' }],
  [I.HIDE]: ['hide', { k: '#6a4a30', K: '#b0885a', w: '#d8b888' }],
  [I.LUMEN_STAFF]: ['staff', { s: '#6a4a8a', w: '#ffffff', c: '#d8ccff', C: '#9a80ff' }],
  [I.BLINK_CHARM]: ['charm', { k: '#c8a040', w: '#ffffff', c: '#c8f8ff', C: '#5ae0ff' }],
  [I.FEATHER_CLOAK]: ['cloak', { k: '#2a5a7a', K: '#7ad0ff', w: '#ffffff' }],
  [I.TIDE_AMULET]: ['amulet', { k: '#c8a040', w: '#ffffff', c: '#a0f0e0', C: '#2ab0a0' }],
  [I.EMBER_HEART]: ['heart', { r: '#8a1810', O: '#ff6020', y: '#ffe680' }],
  [I.HOME_COMPASS]: ['compass', { k: '#c8a040', w: '#f4f0e0', r: '#e04040', K: '#404050' }],
  [I.STORM_ROD]: ['rod', { s: '#5a5e68', y: '#ffe680', Y: '#fff6c8' }],
};

export function itemIcon(id, atlas) {
  if (ICON_CACHE.has(id)) return ICON_CACHE.get(id);
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const it = ITEMS[id];
  if (it && it.block) {
    const b = BLOCKS[it.block];
    if (b.kind === 'cross') {
      const t = b.tex[0];
      ctx.drawImage(atlas, (t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE, TILE, TILE, 0, 0, 32, 32);
    } else drawCubeIcon(ctx, atlas, b);
  } else if (it && it.tool) {
    if (id === I.SERPENT_BLADE) pixels(ctx, SHAPES.sword, { h: '#1d5a78', H: '#6fe0ff', g: '#ffd34d', s: '#5a3a20' });
    else pixels(ctx, SHAPES[it.tool.type], { ...TIER_COLORS[it.tool.tier - 1], s: '#8a5a30', g: '#5a3a20' });
  } else if (SIMPLE_ICONS[id]) {
    pixels(ctx, SHAPES[SIMPLE_ICONS[id][0]], SIMPLE_ICONS[id][1]);
  }
  const url = c.toDataURL ? c.toDataURL() : '';
  ICON_CACHE.set(id, url);
  return url;
}
