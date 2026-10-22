// Day/night cycle, sun, moon, stars, clouds, weather particles and lightning.
import * as THREE from '../vendor/three.module.js';
import { BIOME } from './consts.js';

export const DAY_LENGTH = 720; // seconds for a full day

const C = {
  day: [0.53, 0.81, 1.0], dusk: [1.0, 0.58, 0.42], night: [0.035, 0.05, 0.14], storm: [0.36, 0.4, 0.48],
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function glowTexture(inner, outer, size = 64, square = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  g.fillStyle = inner;
  if (square) g.fillRect(size * 0.3, size * 0.3, size * 0.4, size * 0.4);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

function dotTexture(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

const PARTICLE_TEX = {
  rain: () => dotTexture(g => { g.fillStyle = 'rgba(170,200,255,0.85)'; g.fillRect(7, 0, 2, 16); }),
  ash: () => dotTexture(g => { g.fillStyle = '#5c5654'; g.fillRect(5, 5, 6, 6); g.fillStyle = '#ff8a3a'; g.fillRect(7, 7, 2, 2); }),
  glitter: () => dotTexture(g => { g.fillStyle = '#ffffff'; g.fillRect(7, 2, 2, 12); g.fillRect(2, 7, 12, 2); g.fillStyle = '#9ffaff'; g.fillRect(6, 6, 4, 4); }),
  snow: () => dotTexture(g => { g.fillStyle = '#ffffff'; g.fillRect(5, 5, 6, 6); }),
};

export class Sky {
  constructor(scene, mats) {
    this.scene = scene; this.mats = mats;
    this.time = 0.3;            // 0 sunrise, .25 noon, .5 sunset, .75 midnight
    this.weather = 'clear';     // clear | rain | storm
    this.wetness = 0;           // eased 0..1 toward weather
    this.flash = 0;
    this.nextBolt = 5;
    this.authority = true;      // false when the server drives time & weather
    this.weatherTimer = 120 + Math.random() * 180;
    this.onThunder = () => {};

    const sunMat = new THREE.SpriteMaterial({ map: glowTexture('#fff6c8', 'rgba(255,220,120,0.9)'), fog: false, depthWrite: false });
    this.sun = new THREE.Sprite(sunMat); this.sun.scale.set(46, 46, 1);
    const moonMat = new THREE.SpriteMaterial({ map: glowTexture('#e8eeff', 'rgba(160,180,255,0.6)'), fog: false, depthWrite: false });
    this.moon = new THREE.Sprite(moonMat); this.moon.scale.set(30, 30, 1);
    scene.add(this.sun, this.moon);

    // stars
    const sp = [];
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp.push(r * Math.cos(a) * 180, Math.abs(u) * 180, r * Math.sin(a) * 180);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    scene.add(this.stars);

    // clouds: one merged geometry of flat boxes
    const boxes = [];
    for (let i = 0; i < 70; i++) {
      const w = 8 + Math.random() * 22, d = 6 + Math.random() * 16;
      const g = new THREE.BoxGeometry(w, 2.5, d);
      g.translate(Math.random() * 420 - 210, 0, Math.random() * 420 - 210);
      boxes.push(g);
    }
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false, depthWrite: false });
    this.clouds = new THREE.Mesh(mergeBoxes(boxes), this.cloudMat);
    scene.add(this.clouds);

    // weather particles
    this.N = 2600;
    const pp = new Float32Array(this.N * 3);
    this.pv = new Float32Array(this.N); // per-particle speed jitter
    for (let i = 0; i < this.N; i++) { pp[i * 3] = Math.random() * 60 - 30; pp[i * 3 + 1] = Math.random() * 40 - 10; pp[i * 3 + 2] = Math.random() * 60 - 30; this.pv[i] = 0.7 + Math.random() * 0.6; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.pTex = {};
    for (const k in PARTICLE_TEX) this.pTex[k] = PARTICLE_TEX[k]();
    this.pMat = new THREE.PointsMaterial({ size: 0.35, map: this.pTex.rain, transparent: true, depthWrite: false, alphaTest: 0.1 });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pType = 'rain';
  }

  setEnv(time, weather) { this.time = time; this.weather = weather; }

  info() {
    const h = (this.time * 24 + 6) % 24;
    const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
    return { clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, night: this.daylight < 0.35 };
  }

  update(dt, cam, biome, world) {
    // the world brain sends the real time every few seconds; keep the sun moving in between
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    if (this.authority) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        const r = Math.random();
        this.weather = r < 0.55 ? 'clear' : r < 0.88 ? 'rain' : 'storm';
        this.weatherTimer = 150 + Math.random() * 240;
      }
    }
    const target = this.weather === 'clear' ? 0 : this.weather === 'rain' ? 0.7 : 1;
    this.wetness += (target - this.wetness) * Math.min(1, dt * 0.25);

    const ang = this.time * Math.PI * 2;
    const sunH = Math.sin(ang);
    const day = smooth(-0.18, 0.3, sunH);
    const duskAmt = Math.max(0, 1 - Math.abs(sunH) / 0.35);
    let col = lerp3(C.night, C.day, day);
    col = lerp3(col, C.dusk, duskAmt * 0.55);
    col = lerp3(col, lerp3(C.night, C.storm, day), this.wetness * 0.75);
    // under the floating isles / at night in volcanic regions add a warm haze
    if (biome === BIOME.VOLCANIC) col = lerp3(col, [0.55, 0.32, 0.28], 0.25);
    if (biome === BIOME.DESERT) col = lerp3(col, [0.85, 0.7, 0.95], 0.18 * day);
    this.daylight = day * (1 - this.wetness * 0.4);

    const u = this.mats.shared;
    u.uDay.value = this.daylight;
    const tint = lerp3([1, 1, 1], [1.0, 0.75, 0.6], duskAmt * 0.6);
    u.uSkyTint.value.set(tint[0], tint[1], tint[2]);
    u.uFogColor.value.set(col[0], col[1], col[2]);
    const fogBase = this.fogScale ?? 1;
    u.uFogDensity.value = (0.0075 + this.wetness * 0.009) * fogBase;
    // morning mist and rain make fog settle in valleys
    const morning = Math.max(0, 1 - Math.abs(this.time - 0.03) / 0.08);
    u.uHeightFog.value = (0.08 + morning * 0.35 + this.wetness * 0.25) * fogBase;
    // direct light comes from the sun by day and the moon by night
    const sd = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.3).normalize();
    if (sunH > -0.06) {
      const warmth = smooth(0.0, 0.45, sunH);
      const sc = lerp3([1.0, 0.58, 0.32], [1.0, 0.96, 0.88], warmth);
      u.uSunDir.value.copy(sd);
      u.uSunColor.value.set(sc[0], sc[1], sc[2]);
      u.uSunInt.value = 0.62 * smooth(-0.06, 0.2, sunH) * (1 - this.wetness * 0.75);
    } else {
      u.uSunDir.value.copy(sd).negate();
      u.uSunColor.value.set(0.55, 0.65, 1.0);
      u.uSunInt.value = 0.14 * smooth(0.06, 0.3, -sunH) * (1 - this.wetness * 0.8);
    }
    this.sunDir = u.uSunDir.value;
    if (!this.bg) { this.bg = new THREE.Color(); this.scene.background = this.bg; }
    this.bg.setRGB(col[0], col[1], col[2]);

    // sun and moon orbit around the player
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    this.sun.position.copy(cam).addScaledVector(dir, 160);
    this.moon.position.copy(cam).addScaledVector(dir, -160);
    this.sun.material.opacity = 1 - this.wetness * 0.8;
    this.moon.material.opacity = (1 - day) * (1 - this.wetness * 0.8);
    this.stars.position.copy(cam);
    this.stars.rotation.z = ang;
    this.stars.material.opacity = Math.max(0, 1 - day * 1.6) * (1 - this.wetness);

    // clouds drift but stay centred on the player
    this.cloudDrift = ((this.cloudDrift || 0) + dt * 1.4) % 420;
    this.clouds.position.set(Math.round((cam.x - this.cloudDrift) / 420) * 420 + this.cloudDrift, 132, Math.round(cam.z / 420) * 420);
    const cc = lerp3([0.2, 0.22, 0.3], [1, 1, 1], day);
    const sc = lerp3(cc, [0.45, 0.47, 0.52], this.wetness);
    this.cloudMat.color.setRGB(sc[0], sc[1], sc[2]);
    this.cloudMat.opacity = 0.75 + this.wetness * 0.2;

    // lightning
    if (this.weather === 'storm' && this.wetness > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 4 + Math.random() * 12; setTimeout(() => this.onThunder(), 300 + Math.random() * 1200); }
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    u.uFlash.value = this.flash > 0.5 || (this.flash > 0.2 && this.flash < 0.35) ? this.flash : 0;

    this.updateParticles(dt, cam, biome, world);
  }

  updateParticles(dt, cam, biome, world) {
    let type = 'rain', amount = this.wetness;
    if (biome === BIOME.VOLCANIC) { type = 'ash'; amount = 0.25 + this.wetness * 0.6; }
    else if (biome === BIOME.DESERT) { type = 'glitter'; amount = 0.08 + this.wetness * 0.7; }
    else if (biome === BIOME.TUNDRA || (cam.y > 90 && biome !== BIOME.SKY)) { type = 'snow'; amount = Math.max(amount, biome === BIOME.TUNDRA ? 0.15 : 0); }
    if (type !== this.pType) {
      this.pType = type; this.pMat.map = this.pTex[type]; this.pMat.needsUpdate = true;
      this.pMat.size = type === 'rain' ? 0.5 : type === 'glitter' ? 0.25 : 0.2;
    }
    const active = Math.floor(this.N * Math.min(1, amount));
    this.points.visible = active > 0;
    if (!active) return;
    // simulate in `sim`, write what should be drawn into the geometry
    if (!this.sim) {
      this.sim = new Float32Array(this.N * 3);
      for (let i = 0; i < this.N; i++) { this.sim[i * 3] = cam.x + Math.random() * 60 - 30; this.sim[i * 3 + 1] = cam.y + Math.random() * 36 - 12; this.sim[i * 3 + 2] = cam.z + Math.random() * 60 - 30; }
    }
    const sim = this.sim, pos = this.points.geometry.attributes.position.array;
    const fall = type === 'rain' ? 22 : type === 'snow' ? 2.2 : type === 'ash' ? 1.4 : 0.6;
    const drift = type === 'glitter' ? 3.5 : type === 'ash' ? 0.8 : 0.4;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.N; i++) {
      const k = i * 3;
      if (i >= active) { pos[k + 1] = -1000; continue; }
      let x = sim[k], y = sim[k + 1], z = sim[k + 2];
      y -= fall * this.pv[i] * dt;
      x += Math.sin(t * 0.7 + i) * drift * dt + (type === 'glitter' ? drift * dt : 0);
      z += Math.cos(t * 0.5 + i * 1.3) * drift * dt;
      // wrap around the camera
      if (x < cam.x - 30) x += 60; else if (x > cam.x + 30) x -= 60;
      if (z < cam.z - 30) z += 60; else if (z > cam.z + 30) z -= 60;
      if (y < cam.y - 12) y += 36; else if (y > cam.y + 24) y -= 36;
      sim[k] = x; sim[k + 1] = y; sim[k + 2] = z;
      // no rain under roofs or inside caves
      const sheltered = type !== 'glitter' && world.lightAt(x, y, z).sky < 14;
      pos[k] = x; pos[k + 1] = sheltered ? -1000 : y; pos[k + 2] = z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

function mergeBoxes(geos) {
  const pos = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, ix = g.index.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.length / 3;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setIndex(idx);
  return m;
}
