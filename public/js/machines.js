// Block entities: chests, smelters, auto drills and waystones.
import { B, BLOCKS, ITEMS } from './blocks.js';
import { Inventory, SMELT, FUEL } from './inventory.js';

const k = (x, y, z) => `${x},${y},${z}`;
const ADJ = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];

export class Machines {
  // hooks: { setBlock(x,y,z,b), dropFor(id, tool), particles(x,y,z,color), changed() }
  constructor(world, hooks) {
    this.world = world; this.hooks = hooks;
    this.map = new Map();
    this.t = 0;
  }

  type(x, y, z) { return BLOCKS[this.world.get(x, y, z)]?.machine || null; }

  get(x, y, z) {
    const key = k(x, y, z);
    let m = this.map.get(key);
    const type = this.type(x, y, z);
    if (!type) return null;
    if (!m || m.type !== type) {
      m = this.create(type, x, y, z);
      this.map.set(key, m);
    }
    return m;
  }

  create(type, x, y, z) {
    const base = { type, x, y, z };
    if (type === 'chest') { base.inv = new Inventory(27); return base; }
    if (type === 'smelter') return { ...base, input: null, fuel: null, output: null, burn: 0, burnMax: 1, progress: 0 };
    if (type === 'drill') return { ...base, fuel: null, burn: 0, depth: 1, t: 0, status: 'Add fuel to start drilling.' };
    if (type === 'waystone') return { ...base, name: '' };
    return base;
  }

  // items to give back when a machine block is broken
  remove(x, y, z) {
    const key = k(x, y, z), m = this.map.get(key);
    this.map.delete(key);
    if (!m) return [];
    const out = [];
    if (m.type === 'chest') for (const s of m.inv.slots) if (s) out.push(s);
    for (const s of [m.input, m.fuel, m.output]) if (s) out.push(s);
    return out;
  }

  tick(dt) {
    for (const m of this.map.values()) {
      const id = this.world.get(m.x, m.y, m.z);
      if (!id) { if (this.world.loaded(m.x, m.z)) this.map.delete(k(m.x, m.y, m.z)); continue; }
      if (m.type === 'smelter') this.tickSmelter(m, dt, id);
      else if (m.type === 'drill') this.tickDrill(m, dt);
    }
  }

  refuel(m) {
    if (!m.fuel) return false;
    const f = FUEL.get(m.fuel.id);
    if (!f) return false;
    m.fuel.count--;
    if (m.fuel.count <= 0) m.fuel = null;
    m.burn = m.burnMax = f;
    return true;
  }

  tickSmelter(m, dt, id) {
    const recipe = m.input ? SMELT.get(m.input.id) : null;
    const fits = recipe && (!m.output || (m.output.id === recipe.out && m.output.count + recipe.n <= (ITEMS[recipe.out]?.stack || 64)));
    if (m.burn <= 0 && fits) this.refuel(m);
    const lit = m.burn > 0;
    if (lit) m.burn = Math.max(0, m.burn - dt / 4); // one fuel unit smelts one item (4s)
    if (lit && fits) {
      m.progress += dt * (m.speed || 1) / recipe.time;
      if (m.progress >= 1) {
        m.progress = 0;
        m.input.count--; if (m.input.count <= 0) m.input = null;
        if (m.output) m.output.count += recipe.n; else m.output = { id: recipe.out, count: recipe.n, dur: 0 };
        this.hooks.changed?.(m);
      }
    } else if (!fits) m.progress = 0;
    // swap the block so the window glows while burning
    const want = m.burn > 0 ? B.SMELTER_ON : B.SMELTER;
    if (id !== want) this.hooks.setBlock(m.x, m.y, m.z, want);
  }

  tickDrill(m, dt) {
    m.t += dt;
    if (m.t < 1.4) return;
    m.t = 0;
    const chest = this.adjacentChest(m);
    if (!chest) { m.status = 'Place a chest next to the drill to collect what it digs.'; return; }
    // find the next diggable block below
    let y = m.y - m.depth;
    while (y > 1) {
      const id = this.world.get(m.x, y, m.z);
      if (id && BLOCKS[id].hard >= 0 && BLOCKS[id].kind !== 'liquid') break;
      if (id === B.BEDROCK) break;
      y--; m.depth++;
    }
    const id = this.world.get(m.x, y, m.z);
    if (y <= 1 || id === B.BEDROCK || !id) { m.status = 'Reached bedrock. All done!'; return; }
    if (m.burn <= 0 && !this.refuel(m)) { m.status = 'Out of fuel. Add coal, charcoal or embers.'; return; }
    m.burn -= 1 / 8; // one coal = eight blocks
    const drops = this.hooks.dropFor(id, { type: 'pick', tier: 3 });
    for (const [item, n] of drops) {
      if (chest.inv.add(item, n) > 0) { m.status = 'The chest is full.'; return; }
    }
    this.hooks.setBlock(m.x, y, m.z, B.AIR);
    this.hooks.particles?.(m.x + 0.5, y + 0.5, m.z + 0.5, BLOCKS[id].color);
    m.depth = m.y - y + 1;
    m.status = `Drilling at depth ${m.y - y}. Last dug: ${BLOCKS[id].name}.`;
    this.hooks.changed?.(m);
  }

  adjacentChest(m) {
    for (const [dx, dy, dz] of ADJ) {
      if (this.world.get(m.x + dx, m.y + dy, m.z + dz) === B.CHEST) return this.get(m.x + dx, m.y + dy, m.z + dz);
    }
    return null;
  }

  toJSON() {
    const out = [];
    for (const m of this.map.values()) {
      const o = { ...m };
      if (m.inv) o.inv = m.inv.toJSON();
      out.push(o);
    }
    return out;
  }
  load(list) {
    this.map.clear();
    for (const o of list || []) {
      const m = { ...o };
      if (o.type === 'chest') { m.inv = new Inventory(27); m.inv.load(o.inv); }
      this.map.set(k(o.x, o.y, o.z), m);
    }
  }
}
