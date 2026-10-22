// Villagers on the player's side: their look, speech bubbles, the dialogue window, trading,
// quests and friendships. Where villagers walk is decided by the world (sim/villagers.js).
import * as THREE from '../vendor/three.module.js';
import { B, I, itemName, itemIcon } from './blocks.js';
import { mulberry32 } from './noise.js';
import { BIOME, BIOME_NAMES } from './consts.js';
import { RUIN_CELL } from './terrain.js';
import { MOB_NAMES as CREATURE_NAMES } from './sim/mobs.js';
import { FOLK_ROLES as ROLES, PERSONALITIES, TRADES, GATHER, HUNT, CRAFT, EXPLORE, compass, fill, pick, hashStr, makeVillage } from './sim/npcdata.js';

export { ROLES, PERSONALITIES };

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */
function part(g, w, h, d, x, y, z, color, glow = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z); m.userData = { base: new THREE.Color(color), glow }; m.layers.enable(2); g.add(m); return m;
}
export function buildFolk(data) {
  const R = ROLES[data.role], P = PERSONALITIES[data.personality];
  const g = new THREE.Group(), parts = {};
  const skin = data.skin;
  parts.legL = new THREE.Group(); parts.legL.position.set(-0.12, 0.4, 0); g.add(parts.legL); part(parts.legL, 0.2, 0.4, 0.22, 0, -0.2, 0, 0x4a3a30);
  parts.legR = new THREE.Group(); parts.legR.position.set(0.12, 0.4, 0); g.add(parts.legR); part(parts.legR, 0.2, 0.4, 0.22, 0, -0.2, 0, 0x4a3a30);
  part(g, 0.56, 0.6, 0.4, 0, 0.7, 0, R.cloth);
  part(g, 0.58, 0.08, 0.42, 0, 0.5, 0, R.trim);
  parts.armL = new THREE.Group(); parts.armL.position.set(-0.35, 0.95, 0); g.add(parts.armL); part(parts.armL, 0.16, 0.5, 0.18, 0, -0.22, 0, R.cloth); part(parts.armL, 0.16, 0.1, 0.18, 0, -0.5, 0, skin);
  parts.armR = new THREE.Group(); parts.armR.position.set(0.35, 0.95, 0); g.add(parts.armR); part(parts.armR, 0.16, 0.5, 0.18, 0, -0.22, 0, R.cloth); part(parts.armR, 0.16, 0.1, 0.18, 0, -0.5, 0, skin);
  const head = new THREE.Group(); head.position.set(0, 1.0, 0); g.add(head); parts.head = head;
  part(head, 0.7, 0.62, 0.62, 0, 0.31, 0, skin);
  // big round eyes and brows that show personality
  for (const s of [-1, 1]) {
    part(head, 0.16, 0.18, 0.02, 0.15 * s, 0.34, 0.315, 0xffffff);
    part(head, 0.08, 0.1, 0.02, 0.15 * s, 0.32, 0.322, 0x1e1e2a);
    const brow = part(head, 0.16, 0.04, 0.02, 0.15 * s, 0.47, 0.32, 0x3a2a20);
    brow.rotation.z = -P.brow * s;
  }
  part(head, 0.12, 0.04, 0.02, 0, 0.17, 0.315, data.personality === 'grumpy' ? 0x5a2a2a : 0xc05a5a);
  // glowing sprout
  part(head, 0.05, 0.22, 0.05, 0, 0.72, 0, 0x5a8a4a);
  part(head, 0.16, 0.12, 0.16, 0, 0.86, 0, R.sprout, true);
  if (data.role === 'elder') part(head, 0.4, 0.3, 0.06, 0, 0.0, 0.32, 0xf4f0e8);
  if (data.role === 'cook') { part(head, 0.5, 0.12, 0.5, 0, 0.66, 0, 0xffffff); part(head, 0.36, 0.3, 0.36, 0, 0.84, 0, 0xffffff); }
  if (data.role === 'mystic') { part(head, 0.78, 0.08, 0.7, 0, 0.62, -0.02, R.cloth); part(head, 0.74, 0.4, 0.12, 0, 0.42, -0.34, R.cloth); }
  if (data.role === 'smith') part(g, 0.5, 0.5, 0.04, 0, 0.66, 0.22, 0x5a3a28);
  if (data.role === 'merchant') { part(g, 0.2, 0.26, 0.12, 0.3, 0.55, 0.12, 0x8a5a30); }
  return { g, parts };
}

export function bubbleSprite(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '600 28px "Nunito", system-ui, sans-serif';
  // wrap into at most two lines
  const words = text.split(' '), lines = [''];
  for (const w of words) { const t = (lines[lines.length - 1] + ' ' + w).trim(); if (ctx.measureText(t).width > 460 && lines.length < 2) lines.push(w); else lines[lines.length - 1] = t; }
  const w = Math.min(500, Math.max(...lines.map(l => ctx.measureText(l).width)) + 36);
  const h = 22 + lines.length * 36;
  ctx.fillStyle = 'rgba(255,252,240,0.95)';
  ctx.strokeStyle = '#3d3456'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.rect((512 - w) / 2, 4, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a2236'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 256, 16 + i * 36));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(3.2, 0.8, 1);
  return s;
}


export class Npcs {
  /*
    game: { world, player, inv, ui, sfx, atlas, host, playerName(), day(), weather(), isNight(), sel(), toast(), onChange(), fx(), progress(stat, value) }
  */
  constructor(game) {
    this.game = game;
    this.villages = new Map();   // id -> { id, name, x, y, z, biome, folk: [static data] }
    this.social = {};            // villager id -> { favor, met, talks, nextQuestDay, lastTalkDay } for this player
    this.discovered = new Set();
    this.quests = [];            // player's active quests
    this.talking = null;         // the villager view we're talking to
    this.el = document.getElementById('dialogue');
  }

  register(meta) {
    if (this.villages.has(meta.id)) return;
    this.villages.set(meta.id, makeVillage(this.game.world.seed, meta));
  }
  villageOf(data) { return this.villages.get(data.village); }
  soc(d) {
    return this.social[d.id] || (this.social[d.id] = { favor: 0, met: false, talks: 0, nextQuestDay: 0, lastTalkDay: -1 });
  }
  addFavor(id, n) {
    const s = this.social[id] || (this.social[id] = { favor: 0, met: false, talks: 0, nextQuestDay: 0, lastTalkDay: -1 });
    s.favor = Math.max(-100, Math.min(100, s.favor + n));
    this.game.progress('bestFavor', Math.max(0, ...Object.values(this.social).map(x => x.favor)));
  }

  update(dt, ctx) {
    const p = this.game.player;
    for (const v of this.villages.values()) {
      if (!this.discovered.has(v.id) && Math.hypot(v.x - p.x, v.z - p.z) < 72) {
        this.discovered.add(v.id); this.game.toast(`You found the village of ${v.name}!`, 'good'); this.game.onChange?.();
      }
    }
    const biome = ctx.currentBiome;
    for (const q of this.quests) if (q.type === 'explore' && q.status === 'active' && q.target === biome) { q.progress = 1; q.status = 'ready'; this.game.toast(`Quest ready: report back to ${q.giverName}.`, 'good'); }
  }

  // the world says this villager just noticed us
  greet(view) { if (view && view.data) { view.wave(); view.say(this.greeting(view), 4); } }

  vars(v) {
    const d = v.data, vil = this.villageOf(d);
    return { player: this.game.playerName(), name: d.name, role: ROLES[d.role].title.toLowerCase(), village: vil?.name || 'here' };
  }

  greeting(v) {
    const d = v.data, P = PERSONALITIES[d.personality];
    if (!P) return 'Hello!';
    if (this.soc(d).favor <= -30) return P.low;
    if (!this.soc(d).met) return fill(P.first[0], this.vars(v));
    return fill(pick(P.hello), this.vars(v));
  }

  // what the villager knows about the world beyond the village
  rumour(v) {
    const T = this.game.world.terrain, vil = this.villageOf(v.data);
    const r = Math.random();
    if (r < 0.55) {
      const options = EXPLORE.filter(b => b !== vil.biome && b !== BIOME.LUMEN);
      const b = pick(options);
      const f = T.findBiome(vil.x, vil.z, b, 1500);
      if (f) return `Folk say the ${BIOME_NAMES[b]} lies about ${Math.round(f.dist / 50) * 50} blocks to the ${compass(f.x - vil.x, f.z - vil.z)}.`;
    }
    if (r < 0.8) {
      let best = null;
      const ci = Math.floor(vil.x / RUIN_CELL), cj = Math.floor(vil.z / RUIN_CELL);
      for (let j = cj - 3; j <= cj + 3; j++) for (let i = ci - 3; i <= ci + 3; i++) {
        const ru = T.ruin(i, j); if (!ru) continue;
        const dd = Math.hypot(ru.x - vil.x, ru.z - vil.z);
        if (dd > 20 && (!best || dd < best.d)) best = { ...ru, d: dd };
      }
      if (best) return `There's an old waystone ${Math.round(best.d / 10) * 10} blocks ${compass(best.x - vil.x, best.z - vil.z)} of here. Touch it and you can travel back to it from any other waystone.`;
    }
    const col = T.column(Math.floor(vil.x), Math.floor(vil.z));
    if (col.lumen > 0.1) return 'The ground under this village hums. Dig deep and you\'ll find caverns that glow like a festival.';
    return 'Smelters turn copper and iron ore into ingots. With ingots you can build machines, even a drill that digs by itself.';
  }

  /* ---------------- dialogue ---------------- */
  open(v) {
    this.talking = v;
    this.game.host.send({ t: 'talk', id: v.id });
    const d = v.data;
    const day = this.game.day();
    if (!this.soc(d).met) { this.soc(d).met = true; this.addFavor(d.id, 2); }
    if (this.soc(d).lastTalkDay !== day) { this.soc(d).lastTalkDay = day; this.soc(d).favor = Math.min(100, this.soc(d).favor + 1); }
    this.soc(d).talks++;
    this.checkTalkQuests(d);
    this.render(this.greeting(v));
    this.game.ui.showPanel('dialogue');
  }
  close() {
    if (this.talking) this.game.host.send({ t: 'talkend' });
    this.talking = null;
    this.game.ui.hidePanel('dialogue');
  }

  render(line, mode = 'talk') {
    const v = this.talking; if (!v) return;
    const d = v.data, P = PERSONALITIES[d.personality], R = ROLES[d.role];
    const mood = this.soc(d).favor >= 40 ? 'Friend' : this.soc(d).favor >= 10 ? 'Friendly' : this.soc(d).favor <= -20 ? 'Wary' : 'Neutral';
    const glimmer = this.game.inv.count(I.GLIMMER);
    let body = '';
    if (mode === 'talk') {
      const q = this.quests.find(q => q.giver === d.id);
      const actions = [
        `<button data-a="chat">Chat</button>`,
        `<button data-a="rumour">Any news?</button>`,
        `<button data-a="trade">Trade</button>`,
        q ? `<button data-a="turnin" ${q.status === 'ready' || this.canFinish(q) ? '' : 'disabled'}>${q.status === 'ready' || this.canFinish(q) ? 'Hand in quest' : 'Quest in progress'}</button>`
          : `<button data-a="quest">Need any help?</button>`,
        `<button data-a="gift">Give a gift</button>`,
        `<button data-a="bye">Goodbye</button>`,
      ];
      body = `<p class="line">${escapeHtml(line)}</p><div class="choices">${actions.join('')}</div>`;
    } else if (mode === 'trade') {
      const t = this.trades(d);
      const row = (it, side) => `<div class="trade ${side}"><img src="${itemIcon(it.id, this.game.atlas)}" alt=""><span>${itemName(it.id)} ×${it.n}</span>
        <button data-a="${side}" data-i="${it.i}" ${side === 'buy' ? (glimmer >= it.price ? '' : 'disabled') : (this.game.inv.count(it.id) >= it.n ? '' : 'disabled')}>${side === 'buy' ? 'Buy' : 'Sell'} · ${it.price}</button></div>`;
      body = `<p class="line">${escapeHtml(line)}</p>
        <div class="tradecols"><div><h4>${d.name} sells</h4>${t.sell.map(it => row(it, 'buy')).join('')}</div>
        <div><h4>${d.name} buys</h4>${t.buy.map(it => row(it, 'sell')).join('')}</div></div>
        <div class="choices"><button data-a="back">Back</button></div>`;
    } else if (mode === 'quest') {
      body = `<p class="line">${escapeHtml(line)}</p><div class="choices"><button data-a="accept">I'll do it</button><button data-a="back">Maybe later</button></div>`;
    } else if (mode === 'gift') {
      const s = this.game.inv.slots[this.game.sel()];
      body = `<p class="line">${escapeHtml(line)}</p><p class="hint">You'd give: <b>${s ? `${itemName(s.id)}` : 'nothing (select an item in your hotbar)'}</b></p>
        <div class="choices"><button data-a="givegift" ${s ? '' : 'disabled'}>Give it</button><button data-a="back">Back</button></div>`;
    }
    this.el.innerHTML = `
      <div class="who"><canvas id="portrait" width="96" height="96"></canvas>
        <div><h3>${d.name}</h3><p>${R.title} of ${escapeHtml(this.villageOf(d)?.name || '')} · ${P.label} · <span class="mood">${mood}</span></p>
        <p class="coins"><img src="${itemIcon(I.GLIMMER, this.game.atlas)}" alt=""> ${glimmer} Glimmer</p></div></div>
      ${body}`;
    drawPortrait(this.el.querySelector('#portrait'), d);
    this.el.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', () => this.action(b.dataset.a, b.dataset.i)));
  }

  action(a, i) {
    const v = this.talking; if (!v) return;
    const d = v.data, P = PERSONALITIES[d.personality];
    const night = this.game.isNight(), w = this.game.weather();
    if (a === 'chat') {
      const lines = [...P.small, P.weather[night ? 'night' : w] || P.weather.clear];
      if (this.soc(d).favor >= 40) lines.push(`You know, {player}, you're one of my favourite people in ${this.villageOf(d).name}.`);
      this.render(fill(pick(lines), this.vars(v)));
    } else if (a === 'rumour') this.render(this.rumour(v));
    else if (a === 'trade') this.render(this.soc(d).favor <= -20 ? P.low : 'Take a look.', 'trade');
    else if (a === 'buy' || a === 'sell') this.trade(v, a, +i);
    else if (a === 'quest') {
      if (this.quests.length >= 5) return this.render('You already have plenty on your plate. Come back when your quest log is lighter.');
      if (this.game.day() < this.soc(d).nextQuestDay) return this.render('Nothing right now. Come back tomorrow?');
      this.offer = this.makeQuest(d);
      this.render(this.offer.text, 'quest');
    } else if (a === 'accept') {
      if (this.offer) { this.quests.push(this.offer); this.game.toast(`New quest: ${this.offer.title}`, 'good'); this.offer = null; this.game.onChange?.(); }
      this.render('Wonderful. I\'ll be here.');
    } else if (a === 'turnin') this.turnIn(v);
    else if (a === 'gift') this.render('A gift? For me?', 'gift');
    else if (a === 'givegift') this.gift(v);
    else if (a === 'back') this.render(fill(pick(P.hello), this.vars(v)));
    else if (a === 'bye') { v.say(pick(P.bye), 3); this.close(); }
  }

  trades(d) {
    const P = PERSONALITIES[d.personality];
    const T = TRADES[d.role];
    const discount = (1 - Math.max(-0.2, Math.min(0.2, this.soc(d).favor / 250))) * this.game.fx().prices;
    const r = mulberry32(hashStr(d.id) + this.game.day());
    // a few offers each day, not the whole list
    const take = (list, n) => list.map((t, i) => ({ t, i, k: r() })).sort((a, b) => a.k - b.k).slice(0, n).sort((a, b) => a.i - b.i);
    return {
      sell: take(T.sell, 5).map(({ t, i }) => ({ id: t[0], n: t[1], price: Math.max(1, Math.round(t[2] * P.price * discount)), i })),
      buy: take(T.buy, 4).map(({ t, i }) => ({ id: t[0], n: t[1], price: Math.max(1, Math.round(t[2] / P.price / discount)), i })),
    };
  }

  trade(v, side, i) {
    const d = v.data, inv = this.game.inv, T = TRADES[d.role];
    const list = side === 'buy' ? T.sell : T.buy;
    const offer = this.trades(d)[side === 'buy' ? 'sell' : 'buy'].find(o => o.i === i);
    if (!offer || !list[i]) return;
    if (side === 'buy') {
      if (inv.count(I.GLIMMER) < offer.price) return;
      inv.remove(I.GLIMMER, offer.price); inv.add(offer.id, offer.n);
      this.game.toast(`Bought ${itemName(offer.id)} ×${offer.n}`);
    } else {
      if (inv.count(offer.id) < offer.n) return;
      inv.remove(offer.id, offer.n); inv.add(I.GLIMMER, offer.price);
      this.game.toast(`Sold for ${offer.price} Glimmer`);
    }
    this.addFavor(d.id, 1);
    this.game.sfx.pickup();
    this.render(pick(['Pleasure doing business.', 'A fine trade!', 'Hm, fair enough.', 'Come again!']), 'trade');
  }

  gift(v) {
    const d = v.data, inv = this.game.inv, slot = this.game.sel(), s = inv.slots[slot];
    if (!s) return;
    const liked = { cook: [I.SKYFRUIT, I.BERRIES, I.FISH, B.FLOWER_RED], smith: [I.IRON_INGOT, I.EMBER, I.COAL], mystic: [I.PEARL, I.LUMEN_DUST, I.CORE, I.AETHER_SHARD], merchant: [I.GLIMMER, B.CGLASS, I.HIDE], elder: [B.FLOWER_BLUE, B.MOSAIC, I.SKYFRUIT] }[d.role];
    const love = liked.includes(s.id);
    inv.takeOne(slot);
    this.addFavor(d.id, love ? 10 : 3);
    this.game.sfx.craft();
    this.render(love ? `Oh! ${itemName(s.id)}! How did you know? Thank you!` : 'For me? That\'s thoughtful. Thank you.');
  }

  /* ---------------- quests ---------------- */
  makeQuest(d) {
    const r = Math.random;
    const vil = this.villageOf(d);
    const base = { id: `${d.id}-${Date.now()}`, giver: d.id, giverName: d.name, village: vil.name, vx: vil.x, vz: vil.z, progress: 0, status: 'active' };
    const roll = r();
    const others = vil.folk.filter(o => o.id !== d.id);
    if (roll < 0.4) {
      const [item, n] = pick(GATHER[d.role]);
      return { ...base, type: 'gather', target: item, count: n, reward: 6 + n, title: `Bring ${n} ${itemName(item)} to ${d.name}`,
        text: `Could you bring me ${n} ${itemName(item)}? I'll pay you well for them.` };
    }
    if (roll < 0.6 && HUNT[d.role]) {
      const [type, n] = pick(HUNT[d.role]);
      return { ...base, type: 'hunt', target: type, count: n, reward: 14 + n * 8, title: `Defeat ${n} ${CREATURE_NAMES[type]}${n > 1 ? 's' : ''}`,
        text: `${CREATURE_NAMES[type]}s have been causing trouble. Could you deal with ${n} of them?` };
    }
    if (roll < 0.72 && CRAFT[d.role]) {
      const item = pick(CRAFT[d.role]);
      return { ...base, type: 'craft', target: item, count: 1, reward: 18, title: `Make a ${itemName(item)} for ${d.name}`,
        text: `I need a ${itemName(item)}, but my hands are full. Could you make one and bring it here?` };
    }
    if (roll < 0.86 && others.length) {
      const o = pick(others);
      return { ...base, type: 'talk', target: o.id, targetName: o.name, count: 1, reward: 8, title: `Carry a message to ${o.name}`,
        text: `Would you tell ${o.name} the ${ROLES[o.role].title.toLowerCase()} that I said ${pick(['dinner is at sundown', 'thank you for the ladder', 'the well needs fixing', 'I found their lost spoon'])}?` };
    }
    const b = pick(EXPLORE.filter(x => x !== vil.biome));
    const f = this.game.world.terrain.findBiome(vil.x, vil.z, b === BIOME.LUMEN ? BIOME.FOREST : b, 1500);
    const where = b === BIOME.LUMEN ? 'deep underground, where the caves glow' : f ? `about ${Math.round(f.dist / 50) * 50} blocks ${compass(f.x - vil.x, f.z - vil.z)}` : 'somewhere far away';
    return { ...base, type: 'explore', target: b, count: 1, reward: 40, title: `Visit the ${BIOME_NAMES[b]}`, hint: f ? { x: f.x, z: f.z } : null,
      text: `I've always wondered what the ${BIOME_NAMES[b]} is like. It's ${where}. Would you go there and tell me about it?` };
  }

  canFinish(q) {
    if (q.type === 'gather' || q.type === 'craft') return this.game.inv.count(q.target) >= q.count;
    return q.status === 'ready';
  }

  progressText(q) {
    if (q.type === 'gather' || q.type === 'craft') return `${Math.min(q.count, this.game.inv.count(q.target))}/${q.count}`;
    if (q.type === 'hunt') return `${q.progress}/${q.count}`;
    return q.status === 'ready' ? 'Done — report back' : 'Not yet';
  }

  turnIn(v) {
    const d = v.data, P = PERSONALITIES[d.personality];
    const q = this.quests.find(q => q.giver === d.id);
    if (!q || !this.canFinish(q)) return;
    if (q.type === 'gather' || q.type === 'craft') this.game.inv.remove(q.target, q.count);
    const reward = Math.round(q.reward * (1 + Math.max(0, this.soc(d).favor) / 200));
    this.game.inv.add(I.GLIMMER, reward);
    const bonus = pick({ elder: [[B.WAYSTONE, 1], [I.AETHER_SHARD, 1]], merchant: [[B.TORCH, 8], [B.CHEST, 1]], smith: [[I.IRON_INGOT, 2], [I.GEAR, 1]], mystic: [[I.LUMEN_DUST, 2], [I.PEARL, 1]], cook: [[I.MUSHROOM_STEW, 1], [I.COOKED_FISH, 3]] }[d.role]);
    this.game.inv.add(bonus[0], bonus[1]);
    this.addFavor(d.id, 15);
    this.soc(d).nextQuestDay = this.game.day() + 1;
    this.game.progress('quests');
    this.quests = this.quests.filter(x => x !== q);
    this.game.toast(`Quest complete! +${reward} Glimmer, +${bonus[1]} ${itemName(bonus[0])}`, 'good');
    this.game.sfx.craft();
    this.game.onChange?.();
    this.render(fill(P.thanks, this.vars(v)));
  }

  checkTalkQuests(d) {
    for (const q of this.quests) {
      if (q.type === 'talk' && q.target === d.id && q.status === 'active') {
        q.status = 'ready'; q.progress = 1;
        this.game.toast(`${d.name} got the message. Return to ${q.giverName}.`, 'good');
      }
    }
  }

  onKill(type) {
    for (const q of this.quests) {
      if (q.type === 'hunt' && q.target === type && q.status === 'active') {
        q.progress++;
        if (q.progress >= q.count) { q.status = 'ready'; this.game.toast(`Quest ready: report back to ${q.giverName}.`, 'good'); }
      }
    }
  }

  abandon(id) { this.quests = this.quests.filter(q => q.id !== id); this.game.onChange?.(); }

  toJSON() { return { quests: this.quests, social: this.social, discovered: [...this.discovered] }; }
  load(o) {
    this.quests = Array.isArray(o?.quests) ? o.quests : [];
    this.social = o?.social && typeof o.social === 'object' ? o.social : {};
    this.discovered = new Set(o?.discovered || []);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// a flat, friendly portrait for the dialogue panel
function drawPortrait(c, d) {
  const g = c.getContext('2d'), R = ROLES[d.role], P = PERSONALITIES[d.personality];
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = '#2a2440'; g.fillRect(0, 0, 96, 96);
  g.fillStyle = hex(R.cloth); g.fillRect(16, 72, 64, 24);
  g.fillStyle = d.skin; g.fillRect(18, 18, 60, 54);
  g.fillStyle = '#5a8a4a'; g.fillRect(46, 4, 4, 14);
  g.fillStyle = hex(R.sprout); g.fillRect(40, 0, 16, 10);
  for (const s of [-1, 1]) {
    g.fillStyle = '#fff'; g.fillRect(48 + s * 13 - 7, 36, 14, 16);
    g.fillStyle = '#1e1e2a'; g.fillRect(48 + s * 13 - 3, 40, 7, 9);
    g.save(); g.translate(48 + s * 13, 30); g.rotate(-P.brow * s); g.fillStyle = '#3a2a20'; g.fillRect(-8, -2, 16, 4); g.restore();
  }
  g.fillStyle = d.personality === 'grumpy' ? '#5a2a2a' : '#c05a5a'; g.fillRect(40, 60, 16, 4);
}
