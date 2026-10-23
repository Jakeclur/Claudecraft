// Axis-separated AABB vs voxel collision shared by the player and creatures.
import { B, KIND, WATERY, LIQ_TYPE } from './blocks.js';

// body: { x, y, z (feet centre), vx, vy, vz, w (half width), h (height) }
function overlap(world, b) {
  const x0 = Math.floor(b.x - b.w), x1 = Math.floor(b.x + b.w - 1e-6);
  const y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h - 1e-6);
  const z0 = Math.floor(b.z - b.w), z1 = Math.floor(b.z + b.w - 1e-6);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
    if (world.solidAt(x, y, z)) return [x, y, z];
  return null;
}

function axis(world, b, a, amt) {
  if (!amt) return;
  b[a] += amt;
  const hit = overlap(world, b);
  if (!hit) return;
  if (a === 'x') { b.x = amt > 0 ? hit[0] - b.w - 1e-3 : hit[0] + 1 + b.w + 1e-3; b.vx = 0; b.hitWall = true; }
  else if (a === 'z') { b.z = amt > 0 ? hit[2] - b.w - 1e-3 : hit[2] + 1 + b.w + 1e-3; b.vz = 0; b.hitWall = true; }
  else {
    if (amt > 0) b.y = hit[1] - b.h - 1e-3;
    else { b.y = hit[1] + 1; b.ground = true; }
    b.vy = 0;
  }
}

export function moveBody(world, b, dt) {
  b.ground = false; b.hitWall = false;
  const fastest = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
  const steps = Math.max(1, Math.ceil(fastest / 0.35));
  const s = dt / steps;
  for (let i = 0; i < steps; i++) {
    axis(world, b, 'y', b.vy * s);
    axis(world, b, 'x', b.vx * s);
    axis(world, b, 'z', b.vz * s);
  }
  // what is the body touching?
  b.inWater = false; b.inLava = false; b.headInWater = false;
  const x0 = Math.floor(b.x - b.w), x1 = Math.floor(b.x + b.w);
  const z0 = Math.floor(b.z - b.w), z1 = Math.floor(b.z + b.w);
  for (let y = Math.floor(b.y); y <= Math.floor(b.y + b.h); y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.get(x, y, z);
    if (WATERY[id]) b.inWater = true;
    if (LIQ_TYPE[id] === 2) b.inLava = true;
  }
  b.headInWater = WATERY[world.get(Math.floor(b.x), Math.floor(b.y + b.h * 0.9), Math.floor(b.z))] === 1;
  const under = world.get(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z));
  b.onBlock = b.ground ? under : 0;
}

export function overlapsBox(b, x, y, z) {
  return x + 1 > b.x - b.w && x < b.x + b.w && z + 1 > b.z - b.w && z < b.z + b.w && y + 1 > b.y && y < b.y + b.h;
}

// Ray vs axis-aligned box (min/max arrays). Returns distance or -1.
export function rayBox(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    if (Math.abs(da) < 1e-9) { if (oa < min[a] || oa > max[a]) return -1; continue; }
    let t1 = (min[a] - oa) / da, t2 = (max[a] - oa) / da;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Voxel DDA: first non-air, non-liquid block along a ray.
export function raycastBlock(world, o, d, maxDist) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
  let tx = d.x ? (sx > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
  let ty = d.y ? (sy > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity;
  let tz = d.z ? (sz > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
  let px = x, py = y, pz = z, t = 0;
  while (t <= maxDist) {
    const id = world.get(x, y, z);
    if (id && KIND[id] !== 3) return { x, y, z, px, py, pz, id, dist: t };
    px = x; py = y; pz = z;
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}
