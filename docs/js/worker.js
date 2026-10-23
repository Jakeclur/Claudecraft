// Background worker: generates chunks and builds their light + meshes.
import { Terrain } from './terrain.js';
import { generateChunk } from './gen.js';
import { lightAndMesh } from './mesher.js';

let terrain = null;

self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'init') { terrain = new Terrain(m.seed); return; }
    if (m.type === 'gen') {
      const r = generateChunk(terrain, m.cx, m.cz);
      self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, ...r }, [r.blocks.buffer, r.height.buffer, r.top.buffer, r.biome.buffer]);
      return;
    }
    if (m.type === 'mesh') {
      const r = lightAndMesh(m.nb);
      const tr = [r.light.buffer, r.glow.buffer];
      for (const k of ['solid', 'water']) if (r[k]) tr.push(r[k].pos.buffer, r[k].uv.buffer, r[k].light.buffer, r[k].index.buffer);
      self.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, version: m.version, ...r }, tr);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
  }
};
