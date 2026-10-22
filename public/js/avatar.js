// Customisable player avatars: body, hair, clothes, accessories, emotes and name tags.
import * as THREE from '../vendor/three.module.js';

export const AVATAR_OPTIONS = {
  skin: ['#f6d7bc', '#e8b998', '#c98f63', '#9a6440', '#62402c', '#a8d8a0', '#b8c8ff', '#e0b0e8'],
  hair: ['none', 'short', 'long', 'spiky', 'bun', 'crest', 'braids'],
  hairColor: ['#2a1c14', '#5a3820', '#a8642c', '#e8c068', '#f4f0e8', '#d84a3a', '#5ad0e0', '#9a6aff', '#ff8ac8', '#3a8a4a'],
  eyes: ['#2a2a3a', '#3a6ad0', '#3a9a5a', '#8a4a20', '#a03ad0', '#e0a020'],
  top: ['tee', 'hoodie', 'robe', 'vest'],
  bottom: ['pants', 'shorts', 'skirt'],
  colors: ['#e05a5a', '#f0a040', '#f0d050', '#5ab85a', '#3ab0b0', '#4a7ae0', '#8a5ae0', '#e070b0', '#f4f0e8', '#3a3a48', '#7a5a3a', '#2a4a7a'],
  hat: ['none', 'beanie', 'wizard', 'leafcrown', 'miner', 'tophat', 'bandana', 'horns', 'crown', 'halo'],
  face: ['none', 'goggles', 'glasses', 'mask', 'freckles'],
  back: ['none', 'backpack', 'cape', 'wings', 'scarf'],
  trail: ['none', 'sparkle', 'embers', 'snow', 'petals', 'lumen', 'stars', 'coins'],
  title: ['none', 'the Delver', 'Reefwalker', 'Champion', 'Pathfinder', 'Friend of the Folk', 'the Swift', 'Builder', 'Veteran'],
};
export const TRAIL_COLORS = { sparkle: [0xffffff, 0x9ffaff], embers: [0xff8a3a, 0xffd34d], snow: [0xffffff, 0xd8ecff], petals: [0xff9ccf, 0xfff0f8], lumen: [0xb898ff, 0x8affe0], stars: [0xfff6a0, 0xffffff], coins: [0xffd34d, 0xe0a020] };
export const EMOTES = ['wave', 'dance', 'cheer', 'sit', 'bow', 'point', 'clap', 'spin'];

export function defaultAvatar() {
  const r = a => a[Math.floor(Math.random() * a.length)];
  const O = AVATAR_OPTIONS;
  return {
    skin: r(O.skin.slice(0, 5)), hair: r(['short', 'long', 'spiky', 'bun']), hairColor: r(O.hairColor), eyes: r(O.eyes),
    top: r(O.top), topColor: r(O.colors), bottom: r(O.bottom), bottomColor: r(O.colors), shoes: '#3a3a48',
    hat: 'none', face: 'none', back: r(['none', 'backpack', 'scarf']), accent: r(O.colors), trail: 'none', title: 'none',
  };
}

function box(parent, w, h, d, x, y, z, color, opts = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: !!opts.alpha, opacity: opts.alpha || 1, side: opts.double ? THREE.DoubleSide : THREE.FrontSide });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.userData.base = new THREE.Color(color);
  m.userData.glow = !!opts.glow;
  m.layers.enable(2);
  parent.add(m);
  return m;
}
function pivot(parent, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; }

// Build the body parts into a fresh group. Returns references to the animated joints.
export function buildAvatar(cfg) {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
  const skin = cfg.skin;
  const parts = {};

  // legs
  const legColor = cfg.bottom === 'skirt' ? skin : cfg.bottomColor;
  parts.legL = pivot(body, -0.13, 0.75, 0); parts.legR = pivot(body, 0.13, 0.75, 0);
  for (const leg of [parts.legL, parts.legR]) {
    box(leg, 0.24, 0.6, 0.27, 0, -0.3, 0, cfg.bottom === 'shorts' ? skin : legColor);
    if (cfg.bottom === 'shorts') box(leg, 0.26, 0.26, 0.29, 0, -0.12, 0, cfg.bottomColor);
    box(leg, 0.26, 0.16, 0.32, 0, -0.67, 0.02, cfg.shoes || '#3a3a48');
  }
  // torso
  parts.torso = pivot(body, 0, 0.75, 0);
  box(parts.torso, 0.52, 0.72, 0.3, 0, 0.36, 0, cfg.topColor);
  if (cfg.bottom === 'skirt') box(parts.torso, 0.6, 0.34, 0.38, 0, -0.08, 0, cfg.bottomColor);
  else box(parts.torso, 0.53, 0.14, 0.31, 0, 0.02, 0, cfg.bottomColor);
  if (cfg.top === 'hoodie') { box(parts.torso, 0.5, 0.18, 0.12, 0, 0.62, -0.2, shade(cfg.topColor, 0.8)); box(parts.torso, 0.3, 0.16, 0.02, 0, 0.24, 0.16, shade(cfg.topColor, 0.85)); }
  if (cfg.top === 'robe') { box(parts.torso, 0.58, 0.6, 0.36, 0, -0.18, 0, cfg.topColor); box(parts.torso, 0.54, 0.06, 0.32, 0, 0.18, 0, cfg.accent || '#ffd34d'); }
  if (cfg.top === 'vest') { box(parts.torso, 0.18, 0.6, 0.02, -0.14, 0.38, 0.16, cfg.accent || '#7a5a3a'); box(parts.torso, 0.18, 0.6, 0.02, 0.14, 0.38, 0.16, cfg.accent || '#7a5a3a'); }
  if (cfg.top === 'tee') box(parts.torso, 0.14, 0.1, 0.02, 0, 0.5, 0.16, cfg.accent || '#ffffff');
  // arms
  parts.armL = pivot(parts.torso, -0.37, 0.68, 0); parts.armR = pivot(parts.torso, 0.37, 0.68, 0);
  for (const arm of [parts.armL, parts.armR]) {
    box(arm, 0.22, 0.32, 0.26, 0, -0.14, 0, cfg.top === 'vest' ? skin : cfg.topColor);
    box(arm, 0.2, 0.4, 0.24, 0, -0.48, 0, cfg.top === 'robe' || cfg.top === 'hoodie' ? cfg.topColor : skin);
    box(arm, 0.2, 0.12, 0.24, 0, -0.7, 0, skin);
  }
  // head
  parts.head = pivot(parts.torso, 0, 0.74, 0);
  const H = parts.head;
  box(H, 0.5, 0.5, 0.5, 0, 0.25, 0, skin);
  box(H, 0.1, 0.1, 0.02, -0.12, 0.27, 0.255, '#ffffff'); box(H, 0.1, 0.1, 0.02, 0.12, 0.27, 0.255, '#ffffff');
  box(H, 0.06, 0.08, 0.02, -0.11, 0.26, 0.262, cfg.eyes); box(H, 0.06, 0.08, 0.02, 0.13, 0.26, 0.262, cfg.eyes);
  box(H, 0.14, 0.04, 0.02, 0, 0.12, 0.255, shade(skin, 0.7));
  const hc = cfg.hairColor;
  switch (cfg.hair) {
    case 'short': box(H, 0.54, 0.16, 0.54, 0, 0.47, 0, hc); box(H, 0.54, 0.3, 0.12, 0, 0.32, -0.22, hc); break;
    case 'long': box(H, 0.54, 0.16, 0.54, 0, 0.47, 0, hc); box(H, 0.56, 0.62, 0.14, 0, 0.12, -0.23, hc); box(H, 0.08, 0.4, 0.4, -0.25, 0.22, -0.04, hc); box(H, 0.08, 0.4, 0.4, 0.25, 0.22, -0.04, hc); break;
    case 'spiky': box(H, 0.54, 0.12, 0.54, 0, 0.46, 0, hc); for (let i = 0; i < 5; i++) box(H, 0.12, 0.2, 0.12, -0.2 + i * 0.1, 0.58, -0.05 + (i % 2) * 0.1, hc).rotation.z = (i - 2) * 0.25; break;
    case 'bun': box(H, 0.54, 0.14, 0.54, 0, 0.47, 0, hc); box(H, 0.24, 0.22, 0.24, 0, 0.62, -0.12, hc); break;
    case 'crest': box(H, 0.12, 0.3, 0.56, 0, 0.6, 0, hc); break;
    case 'braids': box(H, 0.54, 0.14, 0.54, 0, 0.47, 0, hc); box(H, 0.12, 0.6, 0.12, -0.28, 0.05, -0.1, hc); box(H, 0.12, 0.6, 0.12, 0.28, 0.05, -0.1, hc); break;
  }
  const acc = cfg.accent || '#ffd34d';
  switch (cfg.hat) {
    case 'beanie': box(H, 0.56, 0.22, 0.56, 0, 0.52, 0, acc); box(H, 0.14, 0.12, 0.14, 0, 0.68, 0, '#f4f0e8'); break;
    case 'wizard': box(H, 0.8, 0.06, 0.8, 0, 0.5, 0, acc); box(H, 0.42, 0.3, 0.42, 0, 0.66, 0, acc); box(H, 0.26, 0.26, 0.26, 0.04, 0.9, -0.04, acc); box(H, 0.12, 0.2, 0.12, 0.1, 1.08, -0.1, acc); box(H, 0.08, 0.08, 0.02, 0, 0.7, 0.215, '#fff6a0', { glow: true }); break;
    case 'leafcrown': for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(H, 0.14, 0.12, 0.06, Math.sin(a) * 0.28, 0.54, Math.cos(a) * 0.28, i % 2 ? '#5ab85a' : '#8ae07a').rotation.y = a; } box(H, 0.1, 0.1, 0.06, 0, 0.6, 0.29, '#ff8ac8'); break;
    case 'miner': box(H, 0.58, 0.2, 0.58, 0, 0.52, 0, '#e0b030'); box(H, 0.12, 0.12, 0.06, 0, 0.52, 0.3, '#fffad0', { glow: true }); break;
    case 'tophat': box(H, 0.66, 0.04, 0.66, 0, 0.51, 0, '#2a2a34'); box(H, 0.42, 0.4, 0.42, 0, 0.73, 0, '#2a2a34'); box(H, 0.43, 0.06, 0.43, 0, 0.57, 0, acc); break;
    case 'bandana': box(H, 0.54, 0.12, 0.54, 0, 0.42, 0, acc); box(H, 0.1, 0.24, 0.04, 0.12, 0.3, -0.27, acc); break;
    case 'horns': box(H, 0.1, 0.24, 0.1, -0.2, 0.6, 0, '#f4f0e8').rotation.z = 0.4; box(H, 0.1, 0.24, 0.1, 0.2, 0.6, 0, '#f4f0e8').rotation.z = -0.4; break;
    case 'crown': box(H, 0.56, 0.12, 0.56, 0, 0.53, 0, '#ffd34d'); for (const [x, z] of [[-0.22, 0], [0.22, 0], [0, 0.22], [0, -0.22]]) box(H, 0.1, 0.14, 0.1, x, 0.65, z, '#ffd34d'); box(H, 0.08, 0.08, 0.02, 0, 0.55, 0.285, '#ff4d6a', { glow: true }); break;
    case 'halo': box(H, 0.5, 0.04, 0.08, 0, 0.78, 0.21, '#fff6c8', { glow: true }); box(H, 0.5, 0.04, 0.08, 0, 0.78, -0.21, '#fff6c8', { glow: true }); box(H, 0.08, 0.04, 0.34, 0.21, 0.78, 0, '#fff6c8', { glow: true }); box(H, 0.08, 0.04, 0.34, -0.21, 0.78, 0, '#fff6c8', { glow: true }); break;
  }
  switch (cfg.face) {
    case 'goggles': box(H, 0.52, 0.06, 0.52, 0, 0.3, 0, '#5a3a20'); box(H, 0.16, 0.14, 0.04, -0.12, 0.28, 0.27, '#9fe8ff', { alpha: 0.85 }); box(H, 0.16, 0.14, 0.04, 0.12, 0.28, 0.27, '#9fe8ff', { alpha: 0.85 }); break;
    case 'glasses': box(H, 0.14, 0.12, 0.02, -0.12, 0.27, 0.27, '#202028', { alpha: 0.7 }); box(H, 0.14, 0.12, 0.02, 0.12, 0.27, 0.27, '#202028', { alpha: 0.7 }); box(H, 0.1, 0.02, 0.02, 0, 0.3, 0.27, '#202028'); break;
    case 'mask': box(H, 0.5, 0.16, 0.04, 0, 0.12, 0.26, acc); break;
    case 'freckles': for (const [x, y] of [[-0.16, 0.18], [-0.1, 0.2], [0.1, 0.2], [0.16, 0.18]]) box(H, 0.03, 0.03, 0.02, x, y, 0.255, shade(skin, 0.6)); break;
  }
  switch (cfg.back) {
    case 'backpack': box(parts.torso, 0.4, 0.46, 0.18, 0, 0.36, -0.24, '#7a5a3a'); box(parts.torso, 0.3, 0.12, 0.06, 0, 0.22, -0.34, acc); break;
    case 'cape': parts.cape = pivot(parts.torso, 0, 0.7, -0.17); box(parts.cape, 0.54, 0.95, 0.04, 0, -0.48, 0, acc, { double: true }); break;
    case 'wings': parts.wingL = pivot(parts.torso, -0.1, 0.5, -0.17); parts.wingR = pivot(parts.torso, 0.1, 0.5, -0.17);
      box(parts.wingL, 0.6, 0.5, 0.02, -0.32, 0.1, 0, '#bff6ff', { alpha: 0.7, glow: true, double: true }); box(parts.wingR, 0.6, 0.5, 0.02, 0.32, 0.1, 0, '#bff6ff', { alpha: 0.7, glow: true, double: true }); break;
    case 'scarf': box(parts.torso, 0.56, 0.12, 0.34, 0, 0.66, 0, acc); box(parts.torso, 0.12, 0.36, 0.04, 0.14, 0.46, -0.18, acc); break;
  }
  root.userData.parts = parts;
  return { root, parts };
}

function nameSprite(text, title, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 320; c.height = 80;
  const g = c.getContext('2d');
  g.font = 'bold 26px "Nunito", system-ui, sans-serif';
  const w = Math.min(316, Math.max(g.measureText(text).width, title ? g.measureText(title).width * 0.8 : 0) + 20);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect((320 - w) / 2, title ? 2 : 22, w, title ? 76 : 44);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 160, title ? 26 : 44);
  if (title) { g.font = '600 20px "Nunito", system-ui, sans-serif'; g.fillStyle = '#ffd34d'; g.fillText(title, 160, 58); }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(3, 0.75, 1);
  return s;
}

export function tint(root, light) {
  root.traverse(o => {
    if (!o.isMesh || !o.userData.base) return;
    o.material.color.copy(o.userData.base).multiplyScalar(o.userData.glow ? 1 : light);
  });
}

export class Avatar {
  constructor(scene, cfg, name = null, level = 1) {
    this.level = level;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.name = name;
    this.emote = null; this.emoteT = 0; this.walk = 0;
    this.cur = null; this.target = null;
    this.setConfig(cfg);
  }
  setConfig(cfg) {
    this.cfg = { ...defaultAvatar(), ...cfg };
    if (this.model) { this.group.remove(this.model.root); disposeTree(this.model.root); }
    this.model = buildAvatar(this.cfg);
    this.group.add(this.model.root);
    if (this.name) {
      if (this.tag) { this.group.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
      const title = this.cfg.title && this.cfg.title !== 'none' ? this.cfg.title : '';
      const color = this.level >= 20 ? '#ffd34d' : this.level >= 10 ? '#9ffaff' : '#ffffff';
      this.tag = nameSprite(this.name, title, color); this.tag.position.y = 2.45; this.group.add(this.tag);
    }
  }
  playEmote(name) { this.emote = name; this.emoteT = 0; }
  // remote players: smooth toward network targets
  setTarget(s) { this.target = s; if (!this.cur) this.cur = { ...s }; }
  updateRemote(dt, lightFn) {
    if (!this.target) return;
    const c = this.cur, t = this.target, k = Math.min(1, dt * 10);
    const moved = Math.hypot(t.x - c.x, t.z - c.z);
    c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
    let dy = t.yaw - c.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * k; c.pitch += (t.pitch - c.pitch) * k;
    this.pose(dt, c.x, c.y, c.z, c.yaw, c.pitch, moved / Math.max(dt, 0.001), lightFn(c.x, c.y + 1, c.z));
  }
  // speed in blocks per second drives the walk cycle
  pose(dt, x, y, z, yaw, pitch, speed, light) {
    const P = this.model.parts;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw + Math.PI;
    if (speed > 0.3 && this.emote === 'sit') this.emote = null;
    this.walk += dt * Math.min(speed, 8) * 2.2;
    const sw = Math.sin(this.walk) * Math.min(0.9, speed / 4);
    P.legL.rotation.set(sw, 0, 0); P.legR.rotation.set(-sw, 0, 0);
    P.armL.rotation.set(-sw * 0.8, 0, 0.05); P.armR.rotation.set(sw * 0.8, 0, -0.05);
    P.head.rotation.set(-pitch * 0.7, 0, 0);
    P.torso.rotation.set(0, 0, 0); P.torso.position.y = 0.75;
    this.model.root.position.y = 0; this.model.root.rotation.set(0, 0, 0);
    if (P.cape) P.cape.rotation.x = 0.15 + Math.min(0.9, speed * 0.12) + Math.sin(this.walk * 0.7) * 0.05;
    const flap = Math.sin(performance.now() / 180) * 0.25;
    if (P.wingL) { P.wingL.rotation.y = 0.5 + flap; P.wingR.rotation.y = -0.5 - flap; }
    if (this.emote) this.animateEmote(dt, P);
    tint(this.model.root, light);
  }
  animateEmote(dt, P) {
    this.emoteT += dt;
    const t = this.emoteT;
    const len = { wave: 2, dance: 4, cheer: 2, sit: 1e9, bow: 1.6, point: 2, clap: 2, spin: 1.2 }[this.emote];
    if (t > len) { this.emote = null; return; }
    switch (this.emote) {
      case 'wave': P.armR.rotation.set(0, 0, -2.6 + Math.sin(t * 12) * 0.35); break;
      case 'dance':
        this.model.root.position.y = Math.abs(Math.sin(t * 8)) * 0.15;
        this.model.root.rotation.y = Math.sin(t * 4) * 0.5;
        P.armL.rotation.set(0, 0, 2.4 + Math.sin(t * 8) * 0.4); P.armR.rotation.set(0, 0, -2.4 + Math.sin(t * 8 + 1) * 0.4);
        P.legL.rotation.x = Math.sin(t * 8) * 0.5; P.legR.rotation.x = -Math.sin(t * 8) * 0.5; break;
      case 'cheer': P.armL.rotation.set(0, 0, 2.8); P.armR.rotation.set(0, 0, -2.8); this.model.root.position.y = Math.abs(Math.sin(t * 7)) * 0.3; break;
      case 'sit': this.model.root.position.y = -0.45; P.legL.rotation.x = -1.5; P.legR.rotation.x = -1.5; P.armL.rotation.x = -0.4; P.armR.rotation.x = -0.4; break;
      case 'bow': P.torso.rotation.x = 0.7 * Math.sin(Math.min(1, t / 1.6) * Math.PI); P.armR.rotation.x = -0.5; break;
      case 'point': P.armR.rotation.set(-1.55, 0, 0); break;
      case 'clap': P.armL.rotation.set(-1.3, 0, -0.5 + Math.abs(Math.sin(t * 10)) * 0.5); P.armR.rotation.set(-1.3, 0, 0.5 - Math.abs(Math.sin(t * 10)) * 0.5); break;
      case 'spin': this.model.root.rotation.y = t / 1.2 * Math.PI * 2; P.armL.rotation.z = 1.4; P.armR.rotation.z = -1.4; break;
    }
  }
  setVisible(v) { this.group.visible = v; }
  dispose() { this.scene.remove(this.group); disposeTree(this.group); }
}

export function disposeTree(o) {
  o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) { m.material.map?.dispose(); m.material.dispose(); } });
}
