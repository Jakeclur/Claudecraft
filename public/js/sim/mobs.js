// Creature behaviour (no rendering). Runs on the server, or in the browser for single-player.
import { moveBody } from '../physics.js';
import { B, I, BLOCKS, IS_SOLID, WATERY } from '../blocks.js';
import { BIOME, SEA } from '../consts.js';

/*
  move: 'walk' | 'sky' (open-air flyer) | 'cave' (cave flyer) | 'swim'
  hostile(ctx, mob): attacks players when true
*/
export const MOB_TYPES = {
  mossback: { name: 'Mossback', biomes: [BIOME.FOREST, BIOME.SKY], move: 'walk', w: 0.45, h: 0.95, hp: 10, speed: 1.4, flee: 4.2, cap: 6, hostile: () => false,
    drops: () => [[I.MEAT, 1 + (Math.random() < 0.5 ? 1 : 0)], ...(Math.random() < 0.3 ? [[I.HIDE, 1]] : [])], color: 0x6a9a4a },
  golem: { name: 'Crystal Golem', biomes: [BIOME.DESERT], move: 'walk', w: 0.55, h: 2.1, hp: 30, speed: 1.2, chase: 2.7, dmg: 5, reach: 1.9, cap: 3,
    hostile: (ctx, e) => ctx.night || e.angry > 0, drops: () => [[I.SHARD, 2 + Math.floor(Math.random() * 3)], ...(Math.random() < 0.5 ? [[I.CORE, 1]] : [])], color: 0xd79fe0 },
  beetle: { name: 'Cinder Beetle', biomes: [BIOME.VOLCANIC], move: 'walk', w: 0.45, h: 0.6, hp: 12, speed: 1.6, chase: 3.3, dmg: 3, reach: 1.3, cap: 4,
    hostile: () => true, drops: () => [[I.EMBER, 1 + Math.floor(Math.random() * 2)]], color: 0xff6a1a, fireproof: true },
  strider: { name: 'Crag Strider', biomes: [BIOME.CLIFFS], move: 'walk', w: 0.4, h: 1.7, hp: 16, speed: 2, chase: 4, dmg: 4, reach: 1.6, cap: 4, jumpy: true,
    hostile: (ctx, e) => e.angry > 0, drops: () => [[I.HIDE, 1 + Math.floor(Math.random() * 2)], [I.MEAT, 1]], color: 0xd2a070 },
  frostling: { name: 'Frostling', biomes: [BIOME.TUNDRA], move: 'walk', w: 0.35, h: 1.1, hp: 14, speed: 1.5, chase: 3.6, dmg: 3, reach: 1.3, cap: 4,
    hostile: (ctx, e) => ctx.night || ctx.storm || e.angry > 0, drops: () => [...(Math.random() < 0.4 ? [[I.FROST_CORE, 1]] : []), [B.SNOW, 2]], color: 0xbfe8ff },
  serpent: { name: 'Sky Serpent', biomes: [BIOME.SKY], move: 'sky', w: 0.5, h: 0.8, hp: 26, speed: 4, chase: 9, dmg: 5, reach: 1.6, cap: 2,
    hostile: (ctx, e) => ctx.night || ctx.storm || e.angry > 0, drops: () => [[I.SCALE, 1 + Math.floor(Math.random() * 3)], [I.MEAT, 2]], color: 0x58b6d8 },
  lumoth: { name: 'Lumoth', biomes: [BIOME.LUMEN], move: 'cave', w: 0.35, h: 0.5, hp: 6, speed: 2, cap: 5, hostile: () => false,
    drops: () => [[I.LUMEN_DUST, 1 + Math.floor(Math.random() * 2)]], color: 0xc8a8ff },
  glassfin: { name: 'Glassfin', biomes: [BIOME.REEF, BIOME.OCEAN], move: 'swim', w: 0.3, h: 0.4, hp: 4, speed: 1.6, cap: 7, hostile: () => false,
    drops: () => [[I.FISH, 1 + (Math.random() < 0.3 ? 1 : 0)]], color: 0x9fe0ff },
};
export const MOB_NAMES = Object.fromEntries(Object.entries(MOB_TYPES).map(([k, v]) => [k, v.name]));

export function makeMob(id, type, x, y, z) {
  const T = MOB_TYPES[type];
  return {
    id, kind: 'mob', type, T, x, y, z, vx: 0, vy: 0, vz: 0, w: T.w, h: T.h, ground: false, hp: T.hp,
    yaw: Math.random() * Math.PI * 2, pitch: 0, wanderT: 0, angry: 0, flee: 0, hurt: 0, cool: 0, knock: 0, swing: 0, speedNow: 0,
    home: { x, y, z }, goal: null, dead: false, variant: Math.floor(Math.random() * 4),
  };
}

// ctx: { world, players: [...], night, storm, hostilesOn, hurtPlayer(p, dmg, mob) }
export function updateMob(e, dt, ctx) {
  const T = e.T;
  e.hurt = Math.max(0, e.hurt - dt); e.cool = Math.max(0, e.cool - dt);
  e.angry = Math.max(0, e.angry - dt); e.flee = Math.max(0, e.flee - dt); e.swing = Math.max(0, e.swing - dt);
  // nearest living, non-creative player
  let p = null, pd = 1e9;
  for (const q of ctx.players) {
    if (q.dead || q.spectating) continue;
    const d = Math.hypot(q.x - e.x, q.z - e.z);
    if (d < pd) { pd = d; p = q; }
  }
  const hostile = !!p && !p.creative && ctx.hostilesOn && T.hostile(ctx, e) && pd < (T.move === 'sky' ? 30 : 16);
  if (T.move === 'sky') return updateSky(e, dt, ctx, hostile, p);
  if (T.move === 'cave' || T.move === 'swim') return updateFloater(e, dt, ctx, p);

  let speed = 0;
  const dx = p ? p.x - e.x : 0, dz = p ? p.z - e.z : 0;
  if (e.flee > 0 && p) { e.yaw = Math.atan2(-dx, -dz); speed = T.flee || T.speed * 2; }
  else if (hostile) {
    e.yaw = Math.atan2(dx, dz); speed = pd > T.reach * 0.8 ? T.chase : 0;
    if (pd < T.reach && Math.abs(p.y - e.y) < 1.8 && e.cool <= 0) { e.cool = 1.3; e.swing = 0.4; ctx.hurtPlayer(p, T.dmg, e); }
  } else {
    e.wanderT -= dt;
    if (e.wanderT <= 0) { e.wanderT = 2 + Math.random() * 4; e.moving = Math.random() < 0.6; e.yaw += (Math.random() - 0.5) * 2.5; }
    speed = e.moving ? T.speed : 0;
  }
  e.vx = Math.sin(e.yaw) * speed; e.vz = Math.cos(e.yaw) * speed;
  if (e.knock > 0) { e.knock -= dt; e.vx = e.kx * 6; e.vz = e.kz * 6; }
  e.vy -= 26 * dt;
  if (e.inWater) { e.vy = Math.max(e.vy, -2); if (Math.random() < 0.1) e.vy = 3; }
  if (!hostile && speed > 0 && e.ground) {
    const ax = Math.floor(e.x + Math.sin(e.yaw)), az = Math.floor(e.z + Math.cos(e.yaw));
    const gb = ctx.world.groundBelow(ax, e.y + 1, az);
    if (gb === null || e.y - gb > 3) { e.vx = e.vz = 0; e.yaw += Math.PI * 0.6; }
  }
  moveBody(ctx.world, e, dt);
  if (e.hitWall && e.ground && speed > 0) e.vy = T.jumpy ? 9.5 : 7.6;
  if (e.inLava && !T.fireproof) damageMob(e, 8 * dt, null);
  if (e.y < -10) e.dead = true;
  e.speedNow = Math.hypot(e.vx, e.vz);
}

function updateFloater(e, dt, ctx, p) {
  const swim = e.T.move === 'swim';
  const ok = (x, y, z) => {
    const b = ctx.world.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return swim ? WATERY[b] === 1 : (b === 0 || (!IS_SOLID[b] && !WATERY[b] && BLOCKS[b].kind !== 'liquid'));
  };
  if (e.flee > 0 || !e.goal || Math.hypot(e.goal.x - e.x, e.goal.y - e.y, e.goal.z - e.z) < 0.6 || Math.random() < dt * 0.15) {
    for (let tries = 0; tries < 8; tries++) {
      let gx = e.home.x + (Math.random() - 0.5) * 12, gy = e.home.y + (Math.random() - 0.5) * 5, gz = e.home.z + (Math.random() - 0.5) * 12;
      if (e.flee > 0 && p) { gx = e.x + (e.x - p.x) * 2; gy = e.y + (Math.random() - 0.3) * 3; gz = e.z + (e.z - p.z) * 2; }
      if (ok(gx, gy, gz)) { e.goal = { x: gx, y: gy, z: gz }; break; }
    }
  }
  if (e.goal) {
    const ax = e.goal.x - e.x, ay = e.goal.y - e.y, az = e.goal.z - e.z, d = Math.hypot(ax, ay, az) || 1;
    const sp = e.T.speed * (e.flee > 0 ? 2.5 : 1), turn = Math.min(1, dt * 3);
    e.vx += (ax / d * sp - e.vx) * turn; e.vy += (ay / d * sp - e.vy) * turn; e.vz += (az / d * sp - e.vz) * turn;
  }
  const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt, nz = e.z + e.vz * dt;
  if (ok(nx, ny + 0.2, nz)) { e.x = nx; e.y = ny; e.z = nz; }
  else { e.goal = null; e.vx *= -0.5; e.vy *= -0.5; e.vz *= -0.5; }
  if (Math.abs(e.vx) + Math.abs(e.vz) > 0.05) e.yaw = Math.atan2(e.vx, e.vz);
  e.speedNow = Math.hypot(e.vx, e.vz);
}

function updateSky(e, dt, ctx, hostile, p) {
  const T = e.T, t = Date.now() / 1000 + e.id * 10;
  let tx, ty, tz, speed;
  if (e.flee > 0 && p) { tx = e.x - (p.x - e.x); ty = e.home.y + 6; tz = e.z - (p.z - e.z); speed = T.chase; }
  else if (hostile && e.cool <= 0.6) { tx = p.x; ty = p.y + 1; tz = p.z; speed = T.chase; }
  else {
    tx = e.home.x + Math.cos(t * 0.3) * 18; tz = e.home.z + Math.sin(t * 0.37) * 18;
    ty = e.home.y + Math.sin(t * 0.8) * 3 + (hostile ? 6 : 0); speed = T.speed;
  }
  const ax = tx - e.x, ay = ty - e.y, az = tz - e.z, d = Math.hypot(ax, ay, az) || 1, turn = Math.min(1, dt * 2.2);
  e.vx += ((ax / d) * speed - e.vx) * turn; e.vy += ((ay / d) * speed - e.vy) * turn; e.vz += ((az / d) * speed - e.vz) * turn;
  e.vy += Math.sin(t * 3) * 6 * dt;
  e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
  e.y = Math.max(e.y, ctx.world.surfaceY(e.x, e.z) + 1.5);
  if (hostile && e.cool <= 0 && Math.hypot(p.x - e.x, p.y + 1 - e.y, p.z - e.z) < T.reach) { ctx.hurtPlayer(p, T.dmg, e); e.cool = 2.4; }
  e.yaw = Math.atan2(e.vx, e.vz);
  e.pitch = -Math.atan2(e.vy, Math.hypot(e.vx, e.vz));
  e.speedNow = Math.hypot(e.vx, e.vz);
}

export function damageMob(e, n, from) {
  e.hp -= n; e.hurt = 0.25;
  if (!e.T.dmg) e.flee = 5; else e.angry = 30;
  if (from && e.T.move === 'walk') {
    const dx = e.x - from.x, dz = e.z - from.z, d = Math.hypot(dx, dz) || 1;
    e.vy = 5; e.kx = dx / d; e.kz = dz / d; e.knock = 0.25;
  }
  if (e.T.move === 'sky') e.flee = 1.2;
  if (e.hp <= 0) e.dead = 'killed';
}

// pick a creature to spawn near a player, or null
export function spawnNear(world, p, counts, capScale, ctx) {
  const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 28;
  const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
  if (!world.loaded(x, z)) return null;
  const biome = world.biomeAt(x, z);
  const col = world.terrain.column(Math.floor(x), Math.floor(z));
  const capOf = k => Math.round(MOB_TYPES[k].cap * capScale * (k === 'golem' && ctx.night ? 1.5 : 1));
  if (col.lumen > 0.2 && p.y < 50 && (counts.lumoth || 0) < capOf('lumoth')) {
    for (let y = Math.min(44, Math.floor(p.y) + 8); y > 10; y--) {
      if (world.get(x, y, z) === 0 && world.get(x, y + 1, z) === 0 && world.lightAt(x, y, z).sky < 4) return ['lumoth', x, y + 0.5, z];
    }
  }
  const type = Object.keys(MOB_TYPES).find(k => MOB_TYPES[k].biomes.includes(biome) && (counts[k] || 0) < capOf(k) && MOB_TYPES[k].move !== 'cave' &&
    (k !== 'mossback' || biome === BIOME.FOREST || Math.random() < 0.4));
  if (!type) return null;
  const T = MOB_TYPES[type];
  let y;
  if (T.move === 'sky') { if (Math.random() < 0.6) return null; y = Math.max(world.surfaceY(x, z), SEA) + 12 + Math.random() * 8; }
  else if (T.move === 'swim') { y = SEA - 1 - Math.random() * 4; if (!WATERY[world.get(x, y, z)]) return null; }
  else {
    y = world.surfaceY(x, z);
    const below = world.get(x, y - 1, z);
    if (!BLOCKS[below] || !BLOCKS[below].solid || BLOCKS[below].kind === 'cutout') return null;
    if (world.get(x, y, z) && BLOCKS[world.get(x, y, z)].kind !== 'cross') return null;
    if (IS_SOLID[world.get(x, y + 1, z)]) return null;
  }
  return [type, Math.floor(x) + 0.5, y, Math.floor(z) + 0.5];
}

// creature boxes for hit tests
export function mobBox(e) {
  const lift = e.T.move === 'walk' ? 0 : -0.1;
  if (e.T.move === 'sky') return [[e.x - 0.6, e.y - 0.5, e.z - 0.6], [e.x + 0.6, e.y + 0.5, e.z + 0.6]];
  return [[e.x - e.w, e.y + lift, e.z - e.w], [e.x + e.w, e.y + e.h, e.z + e.w]];
}
