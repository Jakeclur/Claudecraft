// Draws what the world brain says exists: creatures, villagers, dropped items and falling
// blocks. Positions arrive about ten times a second and are smoothed between updates.
import * as THREE from '../vendor/three.module.js';
import { MOB_MODELS, tintModel, blockMaterial } from './models.js';
import { buildFolk, bubbleSprite } from './npc.js';
import { BLOCKS, ITEMS, itemIcon } from './blocks.js';
import { rayBox } from './physics.js';

const tmp = new THREE.Vector3();
const cube = new THREE.BoxGeometry(1, 1, 1);
const spriteMats = new Map();

function itemSprite(id, atlas) {
  if (!spriteMats.has(id)) {
    const img = new Image();
    const tex = new THREE.Texture(img);
    tex.magFilter = THREE.NearestFilter;
    img.onload = () => { tex.needsUpdate = true; };
    img.src = itemIcon(id, atlas);
    spriteMats.set(id, new THREE.SpriteMaterial({ map: tex, alphaTest: 0.4 }));
  }
  const s = new THREE.Sprite(spriteMats.get(id));
  s.scale.set(0.45, 0.45, 1);
  return s;
}

class View {
  constructor(scene, info, atlas) {
    this.scene = scene; this.id = info.id; this.k = info.k; this.info = info;
    this.group = new THREE.Group();
    this.cur = null; this.tgt = null; this.walk = 0; this.bubble = null; this.bubbleT = 0; this.waveT = 0;
    scene.add(this.group);
    if (info.k === 'm') {
      this.T = MOB_MODELS[info.type];
      this.T.build(this.group, this);
      if (this.segs) this.segs.forEach(s => scene.add(s));
      this.max = info.max; this.hp = info.max;
    } else if (info.k === 'v') {
      this.data = info.d;
      const m = buildFolk(info.d);
      this.group.add(m.g); this.parts = m.parts;
    } else if (info.k === 'i') {
      const it = ITEMS[info.item];
      if (it?.block && BLOCKS[it.block].kind !== 'cross') {
        const mesh = new THREE.Mesh(cube, blockMaterial(it.block, atlas).clone());
        mesh.scale.setScalar(0.3); mesh.userData.item = true;
        this.group.add(mesh); this.spin = mesh;
      } else { this.spin = itemSprite(info.item, atlas); this.group.add(this.spin); }
      this.count = info.count;
    } else if (info.k === 'f') {
      const mesh = new THREE.Mesh(cube, blockMaterial(info.b, atlas).clone());
      this.group.add(mesh); this.box = mesh;
    }
    this.group.traverse(o => o.layers.enable(2));
  }
  set(a) {
    const s = { x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5], s: a[6], f: a[7] };
    if (this.k === 'm') this.hp = a[8];
    if (this.k === 'i') this.count = a[8];
    this.tgt = s;
    if (!this.cur) { this.cur = { ...s }; if (this.segs) this.segs.forEach((g, i) => g.position.set(s.x, s.y, s.z + (i + 1) * 0.55)); }
  }
  say(text, sec = 4) {
    if (this.bubble) { this.group.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble.material.dispose(); }
    this.bubble = bubbleSprite(text); this.bubble.position.y = 2.35; this.group.add(this.bubble); this.bubbleT = sec;
  }
  wave() { this.waveT = 1.6; }
  get x() { return this.cur?.x ?? 0; } get y() { return this.cur?.y ?? 0; } get z() { return this.cur?.z ?? 0; }

  frame(dt, lightFn, now) {
    if (!this.tgt) return;
    const c = this.cur, t = this.tgt, k = Math.min(1, dt * 12);
    c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
    let dy = t.yaw - c.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * k; c.pitch += (t.pitch - c.pitch) * k;
    const hurt = t.f & 1, speed = t.s;
    const light = lightFn(c.x, c.y + 0.5, c.z);
    this.group.position.set(c.x, c.y, c.z);
    if (this.k === 'm') {
      if (this.T.move === 'sky') {
        this.group.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
        let prev = this.group.position;
        this.segs.forEach((s, i) => {
          tmp.subVectors(s.position, prev);
          const len = tmp.length() || 1, gap = i === 0 ? 0.75 : 0.55;
          if (len > gap) s.position.copy(prev).addScaledVector(tmp, gap / len);
          s.lookAt(prev); prev = s.position;
          tintModel(s, light, hurt);
        });
      } else {
        this.group.rotation.set(0, c.yaw, this.T.move === 'swim' ? Math.sin(now / 200 + c.x) * 0.15 : 0);
        this.walk += dt * speed * 3;
        const sw = Math.sin(this.walk) * Math.min(1, speed) * 0.7;
        if (this.legs) this.legs.forEach((l, i) => { l.rotation.x = (i % 2 ? sw : -sw); });
        if (this.arms) this.arms.forEach((a, i) => { a.rotation.x = (i ? -sw : sw) * 0.6 - (t.f & 2 ? 1.6 : 0); });
        if (this.wings) { const f = Math.sin(now / 70 + c.x) * 0.7; this.wings[0].rotation.z = f; this.wings[1].rotation.z = -f; }
      }
      tintModel(this.group, light, hurt);
    } else if (this.k === 'v') {
      this.group.rotation.y = c.yaw;
      this.walk += dt * speed * 3.2;
      const sw = Math.sin(this.walk) * Math.min(1, speed) * 0.7, P = this.parts;
      P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
      P.armL.rotation.x = -sw * 0.6; P.armR.rotation.set(sw * 0.6, 0, 0);
      if (this.waveT > 0 || t.f & 4) { this.waveT = Math.max(0, this.waveT - dt); P.armR.rotation.set(0, 0, -2.5 + Math.sin(now / 70) * 0.3); }
      P.head.position.y = 1.0 + Math.sin(now / 400 + c.x) * 0.02;
      this.group.traverse(o => { if (o.isMesh && o.userData.base) o.material.color.copy(o.userData.base).multiplyScalar(o.userData.glow ? 1 : light); });
    } else if (this.k === 'i') {
      this.spin.position.y = 0.15 + Math.sin(now / 400 + c.x * 3) * 0.08;
      if (this.spin.isMesh) { this.spin.rotation.y = now / 600; this.spin.material.color.setScalar(light); }
      else this.spin.material.color.setScalar(light);
    } else if (this.k === 'f') {
      this.box.material.color.setScalar(light);
    }
    if (this.bubbleT > 0) { this.bubbleT -= dt; if (this.bubbleT <= 0 && this.bubble) { this.group.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble.material.dispose(); this.bubble = null; } }
  }
  boxes() {
    const c = this.cur; if (!c) return [];
    if (this.k === 'v') return [[[c.x - 0.4, c.y, c.z - 0.4], [c.x + 0.4, c.y + 1.9, c.z + 0.4]]];
    if (this.k !== 'm') return [];
    if (this.segs) {
      const out = [[[c.x - 0.5, c.y - 0.4, c.z - 0.5], [c.x + 0.5, c.y + 0.4, c.z + 0.5]]];
      for (const s of this.segs) { const p = s.position; out.push([[p.x - 0.35, p.y - 0.35, p.z - 0.35], [p.x + 0.35, p.y + 0.35, p.z + 0.35]]); }
      return out;
    }
    const w = this.T.w, lift = this.T.move === 'walk' ? 0 : -0.1;
    return [[[c.x - w, c.y + lift, c.z - w], [c.x + w, c.y + this.T.h, c.z + w]]];
  }
  dispose() {
    this.scene.remove(this.group);
    if (this.segs) this.segs.forEach(s => this.scene.remove(s));
    const kill = o => o.traverse(m => { if (m.isMesh && !m.userData.item) { if (m.geometry !== cube) m.geometry.dispose(); m.material.map?.dispose?.(); m.material.dispose(); } });
    if (this.k === 'm' || this.k === 'v') { kill(this.group); if (this.segs) this.segs.forEach(kill); }
    if (this.bubble) { this.bubble.material.map.dispose(); this.bubble.material.dispose(); }
  }
}

export class EntityViews {
  constructor(scene, atlas) { this.scene = scene; this.atlas = atlas; this.map = new Map(); }
  add(list) { for (const info of list) { this.map.get(info.id)?.dispose(); this.map.set(info.id, new View(this.scene, info, this.atlas)); } }
  remove(ids) { for (const id of ids) { this.map.get(id)?.dispose(); this.map.delete(id); } }
  update(list) { for (const a of list) this.map.get(a[0])?.set(a); }
  get(id) { return this.map.get(id); }
  clear() { for (const v of this.map.values()) v.dispose(); this.map.clear(); }
  frame(dt, lightFn) { const now = performance.now(); for (const v of this.map.values()) v.frame(dt, lightFn, now); }
  raycast(o, d, maxDist) {
    let best = null, bd = maxDist;
    for (const v of this.map.values()) for (const [mn, mx] of v.boxes()) {
      const t = rayBox(o, d, mn, mx);
      if (t >= 0 && t < bd) { bd = t; best = v; }
    }
    return best ? { view: best, dist: bd } : null;
  }
  count(k) { let n = 0; for (const v of this.map.values()) if (v.k === k) n++; return n; }
}
