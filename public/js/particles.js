// Small pooled particle system: block debris, hit sparks, embers and crystal sparkles.
import * as THREE from '../vendor/three.module.js';
import { B } from './blocks.js';

export class Particles {
  constructor(scene, max = 2500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(1, 1, 6, 6);
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, map: tex, alphaTest: 0.5 }));
    this.points.frustumCulled = false;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
    scene.add(this.points);
    this.ambientT = 0;
  }

  spawn(x, y, z, vx, vy, vz, color, life, grav = 18) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    const c = new THREE.Color(color);
    this.col[k] = c.r; this.col[k + 1] = c.g; this.col[k + 2] = c.b;
    this.life[i] = life; this.grav[i] = grav;
  }

  burst(x, y, z, color, n = 18, speed = 3) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + Math.random() - 0.5, y + Math.random() - 0.5, z + Math.random() - 0.5,
        (Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed,
        color, 0.5 + Math.random() * 0.5);
    }
  }

  // emitters: [{ ox, oz, list: Int16Array [lx,y,lz,block,...] }] from nearby chunks
  ambient(dt, emitters, cam, rate = 1) {
    if (!emitters.length) return;
    this.ambientT += dt * rate;
    while (this.ambientT > 0.03) {
      this.ambientT -= 0.03;
      const e = emitters[Math.floor(Math.random() * emitters.length)];
      const list = e.list;
      if (!list || !list.length) continue;
      const j = Math.floor(Math.random() * (list.length / 4)) * 4;
      const x = list[j] + e.ox, y = list[j + 1], z = list[j + 2] + e.oz, b = list[j + 3];
      if (Math.abs(x - cam.x) > 24 || Math.abs(z - cam.z) > 24) continue;
      if (b === B.LAVA) this.spawn(x + Math.random(), y + 1, z + Math.random(), (Math.random() - .5) * .6, 1.5 + Math.random() * 2, (Math.random() - .5) * .6, Math.random() < .5 ? 0xffb030 : 0xff5a1a, 1.2, -0.5);
      else if (b === B.TORCH) this.spawn(x + 0.5, y + 0.9, z + 0.5, (Math.random() - .5) * .2, 0.8, (Math.random() - .5) * .2, 0xffd060, 0.5, -0.5);
      else if (b === B.CRYSTAL || b === B.CLAMP) this.spawn(x + Math.random(), y + 1 + Math.random() * 0.5, z + Math.random(), 0, 0.4, 0, Math.random() < .5 ? 0x9ffaff : 0xffffff, 1.4, -0.2);
      else if (b === B.GLOWSHROOM) this.spawn(x + 0.5 + (Math.random() - .5) * .6, y + 0.6, z + 0.5 + (Math.random() - .5) * .6, 0, 0.3, 0, 0x7dffd0, 1.6, -0.1);
      else if (b === B.ANEMONE || b === B.GLOW_VINE || b === B.GLOWMOSS) this.spawn(x + Math.random(), y + 0.5 + Math.random(), z + Math.random(), (Math.random() - .5) * .3, 0.25, (Math.random() - .5) * .3, b === B.ANEMONE ? 0xff9ad8 : 0x8affe0, 2, -0.05);
      else if (b === B.LUMEN_CAP || b === B.LUMEN_ORE) this.spawn(x + Math.random(), y - 0.2, z + Math.random(), 0, -0.3, 0, Math.random() < .5 ? 0xc8a8ff : 0xffffff, 2.5, -0.02);
      else if (b === B.WAYSTONE || b === B.AETHER_ORE || b === B.AETHER_BLOCK) this.spawn(x + 0.5 + (Math.random() - .5), y + 1, z + 0.5 + (Math.random() - .5), 0, 0.6, 0, b === B.WAYSTONE ? 0x8cfff0 : 0xff9af4, 1.5, -0.1);
      else if (b === B.MAGMA) this.spawn(x + Math.random(), y + 1, z + Math.random(), 0, 1, 0, 0xff7a2a, 0.8, -0.3);
    }
  }

  update(dt) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { p[k + 1] = -9999; continue; }
      v[k + 1] -= this.grav[i] * dt;
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
