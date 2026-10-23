// World saves in IndexedDB: one record per world, one per changed chunk, map tiles and game state.
// Falls back to memory (nothing persists) when the browser blocks storage.
const DB_NAME = 'cave-craft-v2';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['worlds', 'chunks', 'maps', 'state']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

const mem = { worlds: new Map(), chunks: new Map(), maps: new Map(), state: new Map() };

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, mem[store]);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s, null)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const range = id => IDBKeyRange.bound(`${id}|`, `${id}|￿`);

export const storage = {
  async available() { return !!(await open()); },

  async listWorlds() {
    return tx('worlds', 'readonly', async (s, m) => {
      const all = s ? await req(s.getAll()) : [...m.values()];
      return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    });
  },
  async putWorld(meta) { return tx('worlds', 'readwrite', (s, m) => s ? req(s.put(meta, meta.id)) : m.set(meta.id, meta)); },
  async deleteWorld(id) {
    await tx('worlds', 'readwrite', (s, m) => s ? req(s.delete(id)) : m.delete(id));
    for (const store of ['chunks', 'maps']) {
      await tx(store, 'readwrite', (s, m) => {
        if (s) return req(s.delete(range(id)));
        for (const k of [...m.keys()]) if (k.startsWith(id + '|')) m.delete(k);
      });
    }
    await tx('state', 'readwrite', (s, m) => s ? req(s.delete(id)) : m.delete(id));
  },

  async chunkKeys(id) {
    return tx('chunks', 'readonly', async (s, m) => {
      const keys = s ? await req(s.getAllKeys(range(id))) : [...m.keys()].filter(k => k.startsWith(id + '|'));
      return keys.map(k => k.slice(id.length + 1));
    });
  },
  async loadChunk(id, key) { return tx('chunks', 'readonly', (s, m) => s ? req(s.get(`${id}|${key}`)) : m.get(`${id}|${key}`)); },
  async saveChunks(id, list) {
    if (!list.length) return;
    return tx('chunks', 'readwrite', (s, m) => { for (const [k, blocks] of list) s ? s.put(blocks, `${id}|${k}`) : m.set(`${id}|${k}`, blocks); });
  },

  async loadMaps(id) {
    return tx('maps', 'readonly', async (s, m) => {
      if (!s) return [...m.entries()].filter(([k]) => k.startsWith(id + '|')).map(([k, v]) => [k.slice(id.length + 1), v]);
      const [keys, vals] = await Promise.all([req(s.getAllKeys(range(id))), req(s.getAll(range(id)))]);
      return keys.map((k, i) => [k.slice(id.length + 1), vals[i]]);
    });
  },
  async saveMaps(id, list) {
    if (!list.length) return;
    return tx('maps', 'readwrite', (s, m) => { for (const [k, px] of list) s ? s.put(px, `${id}|${k}`) : m.set(`${id}|${k}`, px); });
  },

  async loadState(id) { return tx('state', 'readonly', (s, m) => s ? req(s.get(id)) : m.get(id)); },
  async saveState(id, state) { return tx('state', 'readwrite', (s, m) => s ? req(s.put(state, id)) : m.set(id, state)); },

  // whole world as one JSON-friendly object (chunks as base64)
  async exportWorld(id) {
    const worlds = await this.listWorlds();
    const meta = worlds.find(w => w.id === id);
    const keys = await this.chunkKeys(id);
    const chunks = {};
    for (const k of keys) chunks[k] = toB64(await this.loadChunk(id, k));
    return { format: 'cave-craft-world', version: 2, meta, state: await this.loadState(id), chunks };
  },
  async importWorld(data) {
    if (!data || data.format !== 'cave-craft-world') throw new Error('That file is not a Cave Craft world.');
    const id = 'w' + Date.now().toString(36);
    const meta = { ...data.meta, id, name: (data.meta?.name || 'Imported world') + ' (imported)', lastPlayed: Date.now() };
    await this.putWorld(meta);
    await this.saveChunks(id, Object.entries(data.chunks || {}).map(([k, b]) => [k, fromB64(b)]));
    if (data.state) await this.saveState(id, data.state);
    return meta;
  },
};

function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
