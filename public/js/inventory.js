// Inventory storage, crafting recipes and smelting.
import { B, I, ITEMS, toolId } from './blocks.js';

export const SLOTS = 36; // 0..8 are the hotbar

export class Inventory {
  constructor(size = SLOTS) { this.size = size; this.slots = new Array(size).fill(null); this.onChange = () => {}; }

  stackSize(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }

  add(id, count = 1, dur) {
    const max = this.stackSize(id);
    for (let pass = 0; pass < 2 && count > 0; pass++) {
      for (let i = 0; i < this.size && count > 0; i++) {
        const s = this.slots[i];
        if (pass === 0 && s && s.id === id && s.count < max) {
          const n = Math.min(count, max - s.count); s.count += n; count -= n;
        } else if (pass === 1 && !s) {
          const n = Math.min(count, max);
          this.slots[i] = { id, count: n, dur: dur ?? (ITEMS[id]?.durability || 0) };
          count -= n;
        }
      }
    }
    this.onChange();
    return count;
  }

  count(id) { return this.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0); }
  has(id) { return this.slots.some(s => s && s.id === id); }

  remove(id, count) {
    for (let i = this.size - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(count, s.count);
      s.count -= n; count -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.onChange();
  }

  takeOne(slot) {
    const s = this.slots[slot];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[slot] = null;
    this.onChange();
  }

  // wear down a tool; returns true if it broke
  wear(slot, n = 1) {
    const s = this.slots[slot];
    if (!s || !ITEMS[s.id]?.durability) return false;
    s.dur -= n;
    if (s.dur <= 0) { this.slots[slot] = null; this.onChange(); return true; }
    this.onChange();
    return false;
  }

  clear() { this.slots.fill(null); this.onChange(); }
  toJSON() { return this.slots; }
  load(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < this.size; i++) {
      const s = arr[i];
      this.slots[i] = s && ITEMS[s.id] ? { id: s.id, count: s.count | 0, dur: s.dur | 0, ...(s.max ? { max: s.max | 0 } : {}) } : null;
    }
    this.onChange();
  }
}

/* ------------------------------------------------------------------ */
/* Recipes. bench: needs a Workbench within reach                      */
/* ------------------------------------------------------------------ */
const R = (out, n, ins, bench = false) => ({ out, n, in: ins, bench });
const tools = (tier, mat, extra = []) => [
  R(toolId(tier, 'pick'), 1, [[mat, 3], [I.STICK, 2], ...extra], true),
  R(toolId(tier, 'axe'), 1, [[mat, 3], [I.STICK, 2], ...extra], true),
  R(toolId(tier, 'shovel'), 1, [[mat, 1], [I.STICK, 2], ...extra], true),
  R(toolId(tier, 'sword'), 1, [[mat, 2], [I.STICK, 1], ...extra], true),
];

export const RECIPES = [
  // basics
  R(B.PLANKS, 4, [[B.LOG, 1]]),
  R(B.PLANKS, 4, [[B.PINE_LOG, 1]]),
  R(I.STICK, 4, [[B.PLANKS, 2]]),
  R(B.WORKBENCH, 1, [[B.PLANKS, 4]]),
  R(B.TORCH, 4, [[I.STICK, 1], [I.COAL, 1]]),
  R(B.TORCH, 4, [[I.STICK, 1], [I.CHARCOAL, 1]]),
  R(B.TORCH, 4, [[I.STICK, 1], [I.EMBER, 1]]),
  R(B.CSANDSTONE, 1, [[B.CSAND, 4]]),
  R(I.COOKED_MEAT, 1, [[I.MEAT, 1], [I.COAL, 1]]),
  R(I.MUSHROOM_STEW, 1, [[B.LUMEN_CAP, 1], [I.BERRIES, 2], [B.GLOWSHROOM, 1]]),
  // tools
  ...tools('wood', B.PLANKS),
  ...tools('stone', B.COBBLE),
  ...tools('iron', I.IRON_INGOT),
  ...tools('crystal', I.SHARD, [[I.IRON_INGOT, 1]]),
  ...tools('aether', I.AETHER_SHARD, [[I.SHARD, 2]]),
  R(I.SERPENT_BLADE, 1, [[I.SCALE, 4], [I.SHARD, 2], [I.CORE, 1]], true),
  // machines
  R(B.CHEST, 1, [[B.PLANKS, 8]], true),
  R(B.SMELTER, 1, [[B.COBBLE, 8], [I.COAL, 1]], true),
  R(I.GEAR, 2, [[I.COPPER_INGOT, 2]], true),
  R(B.DRILL, 1, [[I.IRON_INGOT, 4], [I.GEAR, 2], [I.COPPER_INGOT, 2]], true),
  R(B.JUMP_PAD, 1, [[I.COPPER_INGOT, 2], [I.GEAR, 1], [I.LUMEN_DUST, 2]], true),
  R(B.WAYSTONE, 1, [[B.BRICKS, 4], [I.AETHER_SHARD, 1], [I.LUMEN_DUST, 2]], true),
  R(B.LANTERN, 2, [[I.IRON_INGOT, 1], [B.TORCH, 1]], true),
  // magic
  R(I.LUMEN_STAFF, 1, [[I.STICK, 1], [I.LUMEN_DUST, 4], [I.SHARD, 2]], true),
  R(I.BLINK_CHARM, 1, [[I.AETHER_SHARD, 2], [I.PEARL, 1], [I.COPPER_INGOT, 1]], true),
  R(I.FEATHER_CLOAK, 1, [[I.HIDE, 3], [I.SCALE, 2]], true),
  R(I.TIDE_AMULET, 1, [[I.PEARL, 3], [I.COPPER_INGOT, 2], [B.KELP, 4]], true),
  R(I.EMBER_HEART, 1, [[I.EMBER, 6], [I.CORE, 1], [I.AETHER_SHARD, 1]], true),
  R(I.HOME_COMPASS, 1, [[I.IRON_INGOT, 2], [I.LUMEN_DUST, 1], [I.SHARD, 1]], true),
  R(I.STORM_ROD, 1, [[I.FROST_CORE, 1], [I.COPPER_INGOT, 3], [I.AETHER_SHARD, 2]], true),
  // decor
  R(B.BRICKS, 4, [[B.COBBLE, 4]], true),
  R(B.MOSSY_COBBLE, 4, [[B.COBBLE, 4], [B.LEAVES, 1]], true),
  R(B.CGLASS, 4, [[B.CSAND, 4], [I.SHARD, 1]], true),
  R(B.ROSEGLASS, 4, [[B.CGLASS, 4], [B.FLOWER_RED, 1]], true),
  R(B.SEAGLASS, 4, [[B.CGLASS, 4], [B.KELP, 1]], true),
  R(B.CLAMP, 2, [[I.SHARD, 3], [B.CGLASS, 1]], true),
  R(B.TILE_WHITE, 4, [[B.STRATA_CREAM, 4]], true),
  R(B.TILE_WHITE, 4, [[B.SAND, 4], [B.COBBLE, 1]], true),
  R(B.TILE_TEAL, 4, [[B.TILE_WHITE, 4], [B.KELP, 1]], true),
  R(B.TILE_ROSE, 4, [[B.TILE_WHITE, 4], [B.FLOWER_RED, 1]], true),
  R(B.CHECKER, 4, [[B.TILE_WHITE, 2], [B.BASALT, 2]], true),
  R(B.MOSAIC, 4, [[B.TILE_WHITE, 1], [B.TILE_TEAL, 1], [B.TILE_ROSE, 1], [I.SHARD, 1]], true),
  R(B.BOOKSHELF, 1, [[B.PLANKS, 6], [I.HIDE, 1]], true),
  R(B.PLANTER, 2, [[B.PLANKS, 2], [B.DIRT, 1], [B.FLOWER_BLUE, 1]], true),
  R(B.POLISHED_BASALT, 4, [[B.BASALT, 4]], true),
  R(B.COPPER_BLOCK, 4, [[I.COPPER_INGOT, 4]], true),
  R(B.CARVED_STRATA, 4, [[B.STRATA_RED, 4]], true),
  R(B.PAPER_LANTERN, 2, [[B.BLOSSOM, 2], [B.TORCH, 1], [I.STICK, 2]], true),
  R(B.IRON_BLOCK, 1, [[I.IRON_INGOT, 9]], true),
  R(B.AETHER_BLOCK, 1, [[I.AETHER_SHARD, 9]], true),
  R(B.THATCH, 4, [[B.TALLGRASS, 4]], true),
];
for (const r of RECIPES) r.cat = ITEMS[r.out]?.cat || 'Materials';

export const CATEGORIES = ['All', 'Tools', 'Machines', 'Magic', 'Decor', 'Food', 'Blocks', 'Materials'];

export function canCraft(inv, r, nearBench) {
  if (r.bench && !nearBench) return false;
  return r.in.every(([id, n]) => inv.count(id) >= n);
}

// fx: skill effects (Tempered makes tools last longer, Thrifty Hands may refund an ingredient)
export function craft(inv, r, nearBench, fx = null) {
  if (!canCraft(inv, r, nearBench)) return false;
  for (const [id, n] of r.in) inv.remove(id, n);
  const base = ITEMS[r.out]?.durability;
  let left;
  if (base && fx && fx.toolLife > 1) {
    const max = Math.round(base * fx.toolLife);
    left = inv.add(r.out, r.n, max);
    const s = inv.slots.find(s => s && s.id === r.out && s.dur === max && !s.max);
    if (s) s.max = max;
  } else left = inv.add(r.out, r.n);
  if (fx && fx.refund && Math.random() < fx.refund) { const [id] = r.in[Math.floor(Math.random() * r.in.length)]; inv.add(id, 1); r.refunded = id; } else r.refunded = null;
  return left === 0 ? true : 'full';
}

/* ------------------------------------------------------------------ */
/* Smelting: input -> output, seconds per item; fuel burns in items    */
/* ------------------------------------------------------------------ */
export const SMELT = new Map([
  [B.COPPER_ORE, { out: I.COPPER_INGOT, n: 1, time: 4 }],
  [B.IRON_ORE, { out: I.IRON_INGOT, n: 1, time: 5 }],
  [B.AETHER_ORE, { out: I.AETHER_SHARD, n: 2, time: 8 }],
  [B.SAND, { out: B.CGLASS, n: 1, time: 3 }],
  [B.CSAND, { out: B.CGLASS, n: 1, time: 3 }],
  [B.COBBLE, { out: B.STONE, n: 1, time: 3 }],
  [B.BASALT, { out: B.POLISHED_BASALT, n: 1, time: 3 }],
  [I.MEAT, { out: I.COOKED_MEAT, n: 1, time: 3 }],
  [I.FISH, { out: I.COOKED_FISH, n: 1, time: 3 }],
  [B.LOG, { out: I.CHARCOAL, n: 1, time: 4 }],
  [B.PINE_LOG, { out: I.CHARCOAL, n: 1, time: 4 }],
]);
export const FUEL = new Map([
  [I.COAL, 8], [I.CHARCOAL, 8], [I.EMBER, 12], [B.PLANKS, 1.5], [B.LOG, 1.5], [B.PINE_LOG, 1.5], [I.STICK, 0.5],
]);
