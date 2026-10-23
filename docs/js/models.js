// Creature models (what they look like). Their behaviour lives in sim/mobs.js.
// Ground walkers: Mossback, Crystal Golem, Cinder Beetle, Crag Strider, Frostling.
// Flyers: Sky Serpent (open sky), Lumoth (glowing caverns). Swimmer: Glassfin (reefs and seas).
import * as THREE from '../vendor/three.module.js';
import { B, I, BLOCKS, TILE, ATLAS_TILES } from './blocks.js';
import { BIOME, SEA } from './consts.js';

function part(group, w, h, d, x, y, z, color, glow = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  m.userData = { base: new THREE.Color(color), glow };
  m.layers.enable(2);
  group.add(m);
  return m;
}
function limb(group, w, h, d, x, y, z, color) {
  const p = new THREE.Group(); p.position.set(x, y, z); group.add(p);
  part(p, w, h, d, 0, -h / 2, 0, color);
  return p;
}
const RED = new THREE.Color(1, 0.15, 0.15);
function tintModel(root, light, hurt) {
  root.traverse(o => {
    if (!o.isMesh || !o.userData.base) return;
    o.material.color.copy(o.userData.base).multiplyScalar(o.userData.glow ? 1 : light);
    if (hurt > 0) o.material.color.lerp(RED, 0.6);
  });
}

/*
  move: 'walk' | 'sky' (open-air flyer) | 'cave' (cave flyer) | 'swim'
  hostile(ctx, e): attacks the player when true
*/
const TYPES = {
  mossback: {
    name: 'Mossback', biomes: [BIOME.FOREST, BIOME.SKY], move: 'walk', w: 0.45, h: 0.95, hp: 10, speed: 1.4, flee: 4.2, cap: 6, hostile: () => false,
    drops: () => [[I.MEAT, 1 + (Math.random() < 0.5 ? 1 : 0)], ...(Math.random() < 0.3 ? [[I.HIDE, 1]] : [])], color: 0x6a9a4a,
    build(g, e) {
      part(g, 0.85, 0.55, 1.2, 0, 0.62, 0, 0x7b5a3a);
      part(g, 0.95, 0.25, 1.3, 0, 0.98, 0, 0x5fae4a);
      for (const [x, z] of [[-0.25, -0.3], [0.2, 0.1], [-0.1, 0.4], [0.3, -0.35]]) part(g, 0.12, 0.3, 0.12, x, 1.22, z, 0x8fe06a);
      part(g, 0.5, 0.45, 0.45, 0, 0.8, 0.78, 0x8a6a48);
      part(g, 0.08, 0.08, 0.02, -0.14, 0.88, 1.01, 0x111111); part(g, 0.08, 0.08, 0.02, 0.14, 0.88, 1.01, 0x111111);
      part(g, 0.18, 0.1, 0.1, 0, 0.66, 1.03, 0xe8b8a0);
      e.legs = [[-0.28, 0.4], [0.28, 0.4], [-0.28, -0.4], [0.28, -0.4]].map(([x, z]) => limb(g, 0.2, 0.4, 0.2, x, 0.42, z, 0x5a4028));
    },
  },
  golem: {
    name: 'Crystal Golem', biomes: [BIOME.DESERT], move: 'walk', w: 0.55, h: 2.1, hp: 30, speed: 1.2, chase: 2.7, dmg: 5, reach: 1.9, cap: 3,
    hostile: (ctx, e) => ctx.night || e.angry > 0, drops: () => [[I.SHARD, 2 + Math.floor(Math.random() * 3)], ...(Math.random() < 0.5 ? [[I.CORE, 1]] : [])],
    color: 0xd79fe0,
    build(g, e) {
      part(g, 1.2, 1.0, 0.75, 0, 1.45, 0, 0xc490d0);
      part(g, 0.6, 0.5, 0.55, 0, 2.18, 0.05, 0xb07cc0);
      part(g, 0.12, 0.08, 0.04, -0.14, 2.22, 0.34, 0x9ffaff, true); part(g, 0.12, 0.08, 0.04, 0.14, 2.22, 0.34, 0x9ffaff, true);
      part(g, 0.25, 0.6, 0.25, -0.45, 2.05, -0.15, 0x5ff2ff, true).rotation.z = 0.4;
      part(g, 0.2, 0.45, 0.2, 0.5, 2.0, -0.1, 0x9ffaff, true).rotation.z = -0.5;
      part(g, 0.22, 0.5, 0.22, 0.05, 1.95, -0.42, 0x5ff2ff, true).rotation.x = -0.5;
      e.arms = [limb(g, 0.35, 1.2, 0.35, -0.8, 1.9, 0, 0xa070b0), limb(g, 0.35, 1.2, 0.35, 0.8, 1.9, 0, 0xa070b0)];
      e.legs = [limb(g, 0.4, 0.95, 0.4, -0.3, 0.95, 0, 0x8c5ca0), limb(g, 0.4, 0.95, 0.4, 0.3, 0.95, 0, 0x8c5ca0)];
    },
  },
  beetle: {
    name: 'Cinder Beetle', biomes: [BIOME.VOLCANIC], move: 'walk', w: 0.45, h: 0.6, hp: 12, speed: 1.6, chase: 3.3, dmg: 3, reach: 1.3, cap: 4,
    hostile: () => true, drops: () => [[I.EMBER, 1 + Math.floor(Math.random() * 2)]], color: 0xff6a1a, fireproof: true,
    build(g, e) {
      part(g, 0.85, 0.4, 1.1, 0, 0.42, 0, 0x2a2228);
      part(g, 0.06, 0.42, 1.0, 0, 0.44, 0, 0xff7a2a, true);
      part(g, 0.7, 0.06, 0.06, 0, 0.62, 0.15, 0xff9a3a, true);
      part(g, 0.5, 0.3, 0.35, 0, 0.38, 0.68, 0x3a2e34);
      part(g, 0.08, 0.06, 0.02, -0.13, 0.44, 0.86, 0xffd040, true); part(g, 0.08, 0.06, 0.02, 0.13, 0.44, 0.86, 0xffd040, true);
      e.legs = [];
      for (const z of [-0.3, 0.05, 0.4]) for (const x of [-0.48, 0.48]) { const l = limb(g, 0.08, 0.35, 0.08, x, 0.35, z, 0x1a1418); l.rotation.z = x < 0 ? -0.5 : 0.5; e.legs.push(l); }
    },
  },
  strider: {
    name: 'Crag Strider', biomes: [BIOME.CLIFFS], move: 'walk', w: 0.4, h: 1.7, hp: 16, speed: 2, chase: 4, dmg: 4, reach: 1.6, cap: 4, jumpy: true,
    hostile: (ctx, e) => e.angry > 0, drops: () => [[I.HIDE, 1 + Math.floor(Math.random() * 2)], [I.MEAT, 1]], color: 0xd2a070,
    build(g, e) {
      part(g, 0.6, 0.5, 1.0, 0, 1.25, 0, 0xd8b48a);
      part(g, 0.62, 0.2, 1.02, 0, 1.5, 0, 0xb5543a);
      part(g, 0.36, 0.4, 0.45, 0, 1.6, 0.62, 0xe8cca0);
      part(g, 0.07, 0.3, 0.07, -0.15, 1.9, 0.55, 0xf4e6c8).rotation.x = -0.6; part(g, 0.07, 0.3, 0.07, 0.15, 1.9, 0.55, 0xf4e6c8).rotation.x = -0.6;
      part(g, 0.06, 0.06, 0.02, -0.1, 1.68, 0.85, 0x1a1a1a); part(g, 0.06, 0.06, 0.02, 0.1, 1.68, 0.85, 0x1a1a1a);
      e.legs = [[-0.2, 0.35], [0.2, 0.35], [-0.2, -0.35], [0.2, -0.35]].map(([x, z]) => limb(g, 0.12, 1.0, 0.12, x, 1.02, z, 0xa07850));
    },
  },
  frostling: {
    name: 'Frostling', biomes: [BIOME.TUNDRA], move: 'walk', w: 0.35, h: 1.1, hp: 14, speed: 1.5, chase: 3.6, dmg: 3, reach: 1.3, cap: 4,
    hostile: (ctx, e) => ctx.night || ctx.storm || e.angry > 0, drops: () => [...(Math.random() < 0.4 ? [[I.FROST_CORE, 1]] : []), [B.SNOW, 2]], color: 0xbfe8ff,
    build(g, e) {
      part(g, 0.6, 0.6, 0.6, 0, 0.55, 0, 0xe8f4ff);
      part(g, 0.5, 0.45, 0.5, 0, 1.05, 0, 0xf4faff);
      for (let i = 0; i < 4; i++) part(g, 0.1, 0.3, 0.1, -0.15 + i * 0.1, 1.38, -0.05 + (i % 2) * 0.08, 0x9fe0ff, true).rotation.z = (i - 1.5) * 0.3;
      part(g, 0.1, 0.1, 0.02, -0.11, 1.08, 0.26, 0x3a9aff, true); part(g, 0.1, 0.1, 0.02, 0.11, 1.08, 0.26, 0x3a9aff, true);
      e.arms = [limb(g, 0.14, 0.5, 0.14, -0.38, 0.8, 0, 0xbfe8ff), limb(g, 0.14, 0.5, 0.14, 0.38, 0.8, 0, 0xbfe8ff)];
      e.legs = [limb(g, 0.18, 0.3, 0.18, -0.15, 0.3, 0, 0xd0e8f8), limb(g, 0.18, 0.3, 0.18, 0.15, 0.3, 0, 0xd0e8f8)];
    },
  },
  serpent: {
    name: 'Sky Serpent', biomes: [BIOME.SKY], move: 'sky', w: 0.5, h: 0.8, hp: 26, speed: 4, chase: 9, dmg: 5, reach: 1.6, cap: 2,
    hostile: (ctx, e) => ctx.night || ctx.storm || e.angry > 0, drops: () => [[I.SCALE, 1 + Math.floor(Math.random() * 3)], [I.MEAT, 2]], color: 0x58b6d8,
    build(g, e) {
      const head = new THREE.Group(); g.add(head);
      part(head, 0.7, 0.55, 1.0, 0, 0, 0.1, 0x3f9ec4);
      part(head, 0.6, 0.15, 0.6, 0, -0.32, 0.3, 0xf2d27a);
      part(head, 0.1, 0.1, 0.04, -0.22, 0.12, 0.6, 0xffe680, true); part(head, 0.1, 0.1, 0.04, 0.22, 0.12, 0.6, 0xffe680, true);
      part(head, 0.08, 0.35, 0.08, -0.2, 0.42, -0.15, 0xf2d27a).rotation.x = -0.6;
      part(head, 0.08, 0.35, 0.08, 0.2, 0.42, -0.15, 0xf2d27a).rotation.x = -0.6;
      e.segs = [];
      for (let i = 0; i < 12; i++) {
        const s = new THREE.Group(), sz = 0.62 - i * 0.035;
        part(s, sz, sz * 0.85, 0.7, 0, 0, 0, i % 2 ? 0x3f9ec4 : 0x58b6d8);
        part(s, sz * 0.7, 0.08, 0.5, 0, -sz * 0.45, 0, 0xf2d27a);
        if (i % 3 === 1) part(s, 0.9, 0.05, 0.3, 0, 0.1, 0, 0x9fe8ff, true);
        e.segs.push(s);
      }
    },
  },
  lumoth: {
    name: 'Lumoth', biomes: [BIOME.LUMEN], move: 'cave', w: 0.35, h: 0.5, hp: 6, speed: 2, cap: 5, hostile: () => false,
    drops: () => [[I.LUMEN_DUST, 1 + Math.floor(Math.random() * 2)]], color: 0xc8a8ff,
    build(g, e) {
      part(g, 0.18, 0.18, 0.5, 0, 0.25, 0, 0x6a4aa0);
      part(g, 0.14, 0.14, 0.14, 0, 0.3, 0.3, 0xe0d0ff, true);
      e.wings = [];
      for (const s of [-1, 1]) {
        const p = new THREE.Group(); p.position.set(0.08 * s, 0.3, 0); g.add(p);
        part(p, 0.6, 0.03, 0.45, 0.3 * s, 0, 0, 0xb898ff, true);
        part(p, 0.2, 0.035, 0.18, 0.38 * s, 0, 0.02, 0xffffff, true);
        e.wings.push(p);
      }
    },
  },
  glassfin: {
    name: 'Glassfin', biomes: [BIOME.REEF, BIOME.OCEAN], move: 'swim', w: 0.3, h: 0.4, hp: 4, speed: 1.6, cap: 7, hostile: () => false,
    drops: () => [[I.FISH, 1 + (Math.random() < 0.3 ? 1 : 0)]], color: 0x9fe0ff,
    build(g, e) {
      const hue = [0x9fe0ff, 0xffb070, 0xff8ac8, 0xa0ffb0][Math.floor(Math.random() * 4)];
      part(g, 0.18, 0.3, 0.55, 0, 0.2, 0, hue);
      part(g, 0.02, 0.24, 0.25, 0, 0.2, -0.36, hue);
      part(g, 0.04, 0.06, 0.06, -0.09, 0.26, 0.2, 0x1a1a2a); part(g, 0.04, 0.06, 0.06, 0.09, 0.26, 0.2, 0x1a1a2a);
      part(g, 0.2, 0.04, 0.3, 0, 0.37, -0.02, 0xffffff, true);
    },
  },
};

export const CREATURE_TYPES = Object.keys(TYPES);
export const CREATURE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.name]));


const blockMatCache = new Map();
export function blockMaterial(id, atlas) {
  if (blockMatCache.has(id)) return blockMatCache.get(id);
  const c = document.createElement('canvas'); c.width = c.height = TILE;
  const t = BLOCKS[id].tex[1];
  c.getContext('2d').drawImage(atlas, (t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE, TILE, TILE, 0, 0, TILE, TILE);
  const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
  const m = new THREE.MeshBasicMaterial({ map: tex });
  blockMatCache.set(id, m);
  return m;
}

export { TYPES as MOB_MODELS, tintModel, part, limb };
