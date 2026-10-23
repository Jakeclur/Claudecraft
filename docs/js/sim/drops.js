// What a block drops when broken, given the tool used.
import { B, I, BLOCKS, ITEMS } from '../blocks.js';

const ORES = new Set([B.COAL_ORE, B.COPPER_ORE, B.IRON_ORE, B.LUMEN_ORE, B.AETHER_ORE, B.CRYSTAL]);
export const isOre = id => ORES.has(id);

// why a block gave nothing, for a helpful message (or null if it drops fine)
export function needsBetterTool(id, tool) {
  const d = BLOCKS[id];
  if (!d || !d.needsTool) return null;
  if (!tool || tool.type !== d.tool) return `Needs a ${d.tool === 'pick' ? 'pickaxe' : d.tool} to drop anything`;
  if (tool.tier < d.minTier) return `Needs a ${['', 'wood', 'stone', 'iron', 'crystal', 'aether'][d.minTier]} ${d.tool === 'pick' ? 'pickaxe' : d.tool} or better`;
  return null;
}

// returns [[itemId, count], ...]; luck: extra chance for a second ore drop
export function dropFor(id, tool, luck = 0) {
  const d = BLOCKS[id];
  if (!d || d.hard < 0) return [];
  if (needsBetterTool(id, tool)) return [];
  if (d.minTier > 1 && (!tool || tool.tier < d.minTier)) return [];
  const r = Math.random();
  let out;
  switch (d.drop) {
    case 'none': out = []; break;
    case 'grass': out = r < 0.35 ? [[id, 1]] : []; break;
    case 'leaves': out = r < 0.12 ? [[I.STICK, 1]] : r < 0.4 ? [[id, 1]] : []; break;
    case 'blossom': out = r < 0.25 ? [[I.SKYFRUIT, 1]] : r < 0.5 ? [[id, 1]] : []; break;
    case 'berries': out = [[I.BERRIES, 2 + (r < 0.4 ? 1 : 0)]]; break;
    case 'crystal': out = [[I.SHARD, 2 + (r < 0.5 ? 1 : 0)]]; break;
    case 'coal': out = [[I.COAL, 1]]; break;
    case 'lumen': out = [[I.LUMEN_DUST, 2 + (r < 0.5 ? 1 : 0)]]; break;
    case 'lumencap': out = [[B.LUMEN_CAP, 1], ...(r < 0.3 ? [[I.LUMEN_DUST, 1]] : [])]; break;
    case 'anemone': out = r < 0.35 ? [[I.PEARL, 1]] : []; break;
    case 'stick': out = [[I.STICK, 1 + (r < 0.5 ? 1 : 0)]]; break;
    default: out = ITEMS[d.drop] ? [[d.drop, 1]] : [];
  }
  if (luck > 0 && ORES.has(id) && out.length && Math.random() < luck) out = out.map(([i, n]) => [i, n * 2]);
  return out;
}
