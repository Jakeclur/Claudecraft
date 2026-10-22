// Explored-world map: per-chunk pixel tiles painted into 512px region canvases,
// drawn as a minimap and a pannable full-screen map with markers.
import { B } from './blocks.js';
import { CHUNK } from './consts.js';

const REGION = 32; // chunks per region side
const RPX = REGION * CHUNK;

export class WorldMap {
  constructor(colors) {
    this.colors = colors;       // Uint32Array block id -> 0xRRGGBB
    this.tiles = new Map();     // chunk key -> Uint8ClampedArray RGBA 16x16
    this.regions = new Map();
    this.dirty = new Set();     // tiles not yet saved
  }

  clear() { this.tiles.clear(); this.regions.clear(); this.dirty.clear(); }

  tileFrom(chunk) {
    const px = new Uint8ClampedArray(CHUNK * CHUNK * 4);
    const { top, height } = chunk;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const i = x + z * CHUNK, id = top[i], h = height[i];
      let c = this.colors[id] || 0x000000;
      let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      if (id === B.WATER) {
        // estimate depth from how far the sea floor sits under the surface
        let floor = h; const blocks = chunk.blocks;
        if (blocks) { floor = h; while (floor > 0 && blocks[x + CHUNK * (z + CHUNK * floor)] === B.WATER) floor--; }
        const depth = Math.min(1, (h - floor) / 18);
        r = r * (1 - depth * 0.6); g = g * (1 - depth * 0.5); b = b * (1 - depth * 0.3);
      } else {
        const hn = z > 0 ? height[x + (z - 1) * CHUNK] : h;
        const k = h > hn ? 1.14 : h < hn ? 0.84 : 1;
        r *= k; g *= k; b *= k;
      }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    return px;
  }

  update(chunk) {
    const px = this.tileFrom(chunk);
    this.setTile(chunk.key, px);
    this.dirty.add(chunk.key);
  }

  setTile(key, px) {
    this.tiles.set(key, px);
    const [cx, cz] = key.split(',').map(Number);
    const rx = Math.floor(cx / REGION), rz = Math.floor(cz / REGION);
    const rk = rx + ',' + rz;
    let reg = this.regions.get(rk);
    if (!reg) {
      const c = document.createElement('canvas'); c.width = c.height = RPX;
      reg = { c, ctx: c.getContext('2d'), rx, rz };
      this.regions.set(rk, reg);
    }
    reg.ctx.putImageData(new ImageData(px, CHUNK, CHUNK), (cx - rx * REGION) * CHUNK, (cz - rz * REGION) * CHUNK);
  }

  takeDirty() {
    const out = [];
    for (const k of this.dirty) { const t = this.tiles.get(k); if (t) out.push([k, t]); }
    this.dirty.clear();
    return out;
  }

  explored(x, z) { return this.tiles.has(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK)); }

  // draw a view centred on (x, z), `scale` screen px per block
  draw(ctx, w, h, x, z, scale) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#120f1c';
    ctx.fillRect(0, 0, w, h);
    const left = x - w / 2 / scale, top = z - h / 2 / scale;
    const right = x + w / 2 / scale, bottom = z + h / 2 / scale;
    for (const reg of this.regions.values()) {
      const wx = reg.rx * RPX, wz = reg.rz * RPX;
      if (wx > right || wx + RPX < left || wz > bottom || wz + RPX < top) continue;
      ctx.drawImage(reg.c, Math.floor((wx - left) * scale), Math.floor((wz - top) * scale), Math.ceil(RPX * scale), Math.ceil(RPX * scale));
    }
    return { toScreen: (px, pz) => [(px - left) * scale, (pz - top) * scale], toWorld: (sx, sy) => [left + sx / scale, top + sy / scale] };
  }
}

// markers: [{ x, z, kind: 'player'|'other'|'village'|'waystone'|'quest'|'spawn'|'death', label, yaw }]
export function drawMarkers(ctx, view, markers, small = false) {
  for (const m of markers) {
    const [sx, sy] = view.toScreen(m.x, m.z);
    ctx.save();
    ctx.translate(sx, sy);
    const s = small ? 0.8 : 1.2;
    ctx.scale(s, s);
    switch (m.kind) {
      case 'player':
      case 'other':
        ctx.rotate(-m.yaw);
        ctx.fillStyle = m.kind === 'player' ? '#ffffff' : '#7ff3ff';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.stroke(); ctx.fill();
        break;
      case 'village':
        ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(7, 7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.stroke(); ctx.fill();
        break;
      case 'waystone':
        ctx.fillStyle = m.active ? '#8cfff0' : '#5a7a80'; ctx.strokeStyle = '#0a2a2a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.lineTo(-6, 0); ctx.closePath(); ctx.stroke(); ctx.fill();
        break;
      case 'quest':
        ctx.fillStyle = '#ff8ac8'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText('!', 0, 0); ctx.fillText('!', 0, 0);
        break;
      case 'spawn':
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'ping':
        ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'goal':
        ctx.fillStyle = '#78ff9c'; ctx.strokeStyle = '#0a3018'; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 3.5 : 8, a = i * Math.PI / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.stroke(); ctx.fill();
        break;
      case 'death':
        ctx.strokeStyle = '#ff5a6a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
        break;
    }
    ctx.restore();
    if (m.label && !small) {
      ctx.font = '600 12px "Nunito", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(m.label, sx, sy + 20);
      ctx.fillStyle = '#fff'; ctx.fillText(m.label, sx, sy + 20);
    }
  }
}
