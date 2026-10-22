// Villager behaviour (no rendering): wander the plaza by day, go home at night, flee danger,
// face and greet nearby players, stand still while someone talks to them.
import { moveBody } from '../physics.js';
import { pick } from './npcdata.js';

export function makeVillager(data, village) {
  return {
    id: data.id, kind: 'folk', data, village,
    x: village.x + (Math.random() - 0.5) * 6 + 0.5, y: village.y + 0.1, z: village.z + (Math.random() - 0.5) * 6 + 0.5,
    vx: 0, vy: 0, vz: 0, w: 0.3, h: 1.6, yaw: Math.random() * 6, path: [], idleT: Math.random() * 3,
    atHome: false, goingHome: false, fleeing: false, talkingTo: null, talkT: 0, wave: 0, greeted: new Set(), speedNow: 0, say: null,
  };
}

const goTo = (v, pts) => { v.path = pts.map(p => ({ x: p[0] + 0.5, z: p[2] + 0.5 })); };

// ctx: { world, players, night, hostileNear(x,y,z,r), greet(player, villager), shout(villager, text) }
export function updateVillager(v, dt, ctx) {
  const d = v.data;
  let speed = 0, face = null;
  v.wave = Math.max(0, v.wave - dt);
  if (v.talkingTo) { v.talkT -= dt; if (v.talkT <= 0) v.talkingTo = null; }
  // nearest player
  let p = null, pd = 1e9;
  for (const q of ctx.players) { const dd = Math.hypot(q.x - v.x, q.z - v.z); if (dd < pd) { pd = dd; p = q; } }

  const danger = ctx.hostileNear(v.x, v.y, v.z, 9);
  if (v.talkingTo) { face = ctx.players.find(q => q.id === v.talkingTo) || null; v.path = []; }
  else if (danger) {
    if (!v.fleeing) { v.fleeing = true; ctx.shout(v, pick(['Eek!', 'Run!', 'Help!', 'Not again!'])); goTo(v, [d.out, d.door, d.home]); }
  } else if (ctx.night && !v.atHome) {
    if (!v.goingHome) { v.goingHome = true; goTo(v, [d.out, d.door, d.home]); }
  } else if (!ctx.night && v.atHome) {
    v.atHome = false; v.goingHome = false; goTo(v, [d.door, d.out]);
  } else if (!v.path.length) {
    v.fleeing = false;
    v.idleT -= dt;
    if (v.idleT <= 0 && !ctx.night) {
      v.idleT = 3 + Math.random() * 6;
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 10;
      v.path = [{ x: v.village.x + Math.cos(a) * r, z: v.village.z + Math.sin(a) * r }];
    }
    if (p && pd < 5 && !ctx.night) face = p;
  }
  if (v.path.length) {
    const t = v.path[0];
    const dx = t.x - v.x, dz = t.z - v.z, dd = Math.hypot(dx, dz);
    if (dd < 0.4) {
      v.path.shift();
      if (!v.path.length && (v.goingHome || v.fleeing)) { v.atHome = true; v.goingHome = false; v.fleeing = false; }
    } else { v.yaw = Math.atan2(dx, dz); speed = v.fleeing ? 3.6 : 1.5; }
    v.stuck = (v.stuck || 0) + (speed && Math.hypot(v.vx, v.vz) < 0.2 ? dt : -dt);
    if (v.stuck > 3) { v.path.shift(); v.stuck = 0; }
  }
  if (face) {
    const target = Math.atan2(face.x - v.x, face.z - v.z);
    let dy = target - v.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    v.yaw += dy * Math.min(1, dt * 5);
  }
  v.vx = Math.sin(v.yaw) * speed; v.vz = Math.cos(v.yaw) * speed;
  v.vy -= 26 * dt;
  moveBody(ctx.world, v, dt);
  if (v.hitWall && v.ground && speed) v.vy = 7.4;
  v.speedNow = speed;

  // greet each player once as they walk up
  for (const q of ctx.players) {
    const dd = Math.hypot(q.x - v.x, q.z - v.z);
    if (dd < 5 && !v.greeted.has(q.id) && !ctx.night && v.talkingTo !== q.id) { v.greeted.add(q.id); v.wave = 1.6; ctx.greet(q, v); }
    else if (dd > 10) v.greeted.delete(q.id);
  }
}

export function hitVillager(v, ctx, from) {
  v.fleeing = true;
  goTo(v, [v.data.out, v.data.door, v.data.home]);
  ctx.shout(v, 'Ow! What was that for?');
}
