// HUD, bag + crafting + machine panels, quest log, waystones, emote wheel, chat and messages.
import { ITEMS, BLOCKS, I, itemIcon, itemName } from './blocks.js';
import { RECIPES, CATEGORIES, SMELT, FUEL, canCraft, craft } from './inventory.js';
import { EMOTES } from './avatar.js';

const $ = id => document.getElementById(id);
const PANEL_IDS = { dialogue: 'dialogue-wrap' };

function statIcon(kind, fill) {
  const c = document.createElement('canvas'); c.width = c.height = 18;
  const g = c.getContext('2d');
  const heart = ['.XX...XX.', 'XooX.XooX', 'XoooXoooX', 'XoooooooX', '.XoooooX.', '..XoooX..', '...XoX...', '....X....', '.........'];
  const leg = ['.....XX..', '....XooX.', '...XoooX.', '..XoooX..', '.XoooX...', '.XooX....', 'XwX......', 'Xw.......', '.........'];
  const shape = kind === 'heart' ? heart : leg;
  const full = kind === 'heart' ? '#ff3b55' : '#c8743a', empty = '#2a2228', outline = '#140c10';
  shape.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    let col = outline;
    if (ch === 'o') col = fill === 2 || (fill === 1 && x < 5) ? full : empty;
    if (ch === 'w') col = '#f2eadc';
    g.fillStyle = col; g.fillRect(x * 2, y * 2, 2, 2);
  }));
  return c.toDataURL();
}

// a container is anything with numbered slots
const invContainer = inv => ({ size: inv.size, get: i => inv.slots[i], set: (i, v) => { inv.slots[i] = v; }, changed: () => inv.onChange() });

export class UI {
  constructor(game) {
    this.g = game;
    this.atlas = game.atlas;
    this.held = null; this.heldFrom = null;
    this.open = false;
    this.tab = 'craft'; this.cat = 'All'; this.query = ''; this.onlyCraftable = false;
    this.machine = null;
    this.icons = {};
    for (const k of ['heart', 'food']) for (const f of [0, 1, 2]) this.icons[k + f] = statIcon(k === 'heart' ? 'heart' : 'food', f);

    // hotbar
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = this.slotEl();
      s.addEventListener('click', e => { e.stopPropagation(); this.g.select(i); });
      s.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); this.g.select(i); }, { passive: false });
      $('hotbar').appendChild(s); this.hotSlots.push(s);
    }
    for (let i = 0; i < 10; i++) { $('hearts').appendChild(new Image()); $('food').appendChild(new Image()); }

    // bag
    this.invSlots = [];
    const bag = { ...invContainer(game.inv), isBag: true };
    for (let i = 0; i < game.inv.size; i++) {
      const s = this.slotEl();
      this.bindSlot(s, () => bag, i);
      (i < 9 ? $('invHot') : $('invGrid')).appendChild(s);
      this.invSlots.push(s);
    }
    document.addEventListener('mousemove', e => {
      $('held').style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
      const tt = $('tooltip');
      if (!tt.hidden) tt.style.transform = `translate(${Math.min(innerWidth - 270, e.clientX + 16)}px, ${e.clientY + 16}px)`;
    });
    $('tabCraft').addEventListener('click', () => this.setTab('craft'));
    $('tabCreative').addEventListener('click', () => this.setTab('creative'));
    $('onlyCraftable').addEventListener('change', e => { this.onlyCraftable = e.target.checked; this.renderRecipes(); });
    $('search').addEventListener('input', e => { this.query = e.target.value.trim().toLowerCase(); this.renderRecipes(); });
    $('search').addEventListener('keydown', e => e.stopPropagation());
    const cats = $('cats');
    for (const c of CATEGORIES) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = c;
      b.addEventListener('click', () => { this.cat = c; [...cats.children].forEach(x => x.classList.toggle('on', x === b)); this.renderRecipes(); });
      if (c === 'All') b.classList.add('on');
      cats.appendChild(b);
    }
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.g.closePanel(b.dataset.close)));

    // chat
    this.chatInput = $('chatInput');
    this.chatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.chatInput.value.trim(); if (t) this.g.sendChat(t); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    });

    // emote wheel
    const ring = $('emoteRing');
    EMOTES.forEach((em, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const b = document.createElement('button'); b.type = 'button'; b.textContent = em;
      b.style.left = `${150 + Math.cos(a) * 110}px`; b.style.top = `${150 + Math.sin(a) * 110}px`;
      b.addEventListener('click', () => { this.g.emote(em); this.g.closePanel('emotes'); });
      ring.appendChild(b);
    });
    $('emotes').addEventListener('click', e => { if (e.target.id === 'emotes') this.g.closePanel('emotes'); });
  }

  /* ---------------- panels ---------------- */
  el(name) { return $(PANEL_IDS[name] || name); }
  showPanel(name) { this.el(name).hidden = false; }
  hidePanel(name) { this.el(name).hidden = true; }
  isOpen(name) { return !this.el(name).hidden; }

  /* ---------------- slots ---------------- */
  slotEl() {
    const s = document.createElement('div');
    s.className = 'slot';
    s.innerHTML = '<img alt=""><b></b><i></i>';
    return s;
  }
  bindSlot(el, getContainer, i, opts = {}) {
    el.addEventListener('mousedown', e => { e.preventDefault(); this.clickSlot(getContainer(), i, e.button === 2, e.shiftKey, opts); });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mouseenter', () => { const s = getContainer().get(i); this.tooltip(s ? s.id : null, s); });
    el.addEventListener('mouseleave', () => this.tooltip(null));
  }
  tooltip(id, stack = null) {
    const tt = $('tooltip');
    if (!id || !ITEMS[id]) { tt.hidden = true; return; }
    const it = ITEMS[id];
    const durText = it.durability && stack ? `<br><span class="dur">Durability ${stack.dur} / ${stack.max || it.durability}</span>` : it.durability ? `<br><span class="dur">Durability ${it.durability} uses</span>` : '';
    const extra = it.desc || (it.food ? `Food: restores ${it.food} hunger. Right-click to eat.` : it.tool ? `${it.tool.type === 'sword' ? 'Damage' : 'Speed'} ${it.tool.type === 'sword' ? it.tool.damage : it.tool.speed}` : SMELT.has(id) ? 'Can be smelted.' : FUEL.has(id) ? 'Burns as fuel.' : '');
    tt.innerHTML = `<strong>${it.name}</strong>${extra}${durText}`;
    tt.hidden = false;
  }
  fillSlot(el, st) {
    const img = el.firstChild, cnt = el.children[1], bar = el.children[2];
    if (!st) { img.removeAttribute('src'); img.style.visibility = 'hidden'; cnt.textContent = ''; bar.style.display = 'none'; return; }
    const src = itemIcon(st.id, this.atlas);
    if (img.getAttribute('src') !== src) img.src = src;
    img.style.visibility = 'visible';
    cnt.textContent = st.count > 1 ? st.count : '';
    const max = st.max || ITEMS[st.id]?.durability;
    if (max && st.dur < max) {
      bar.style.display = 'block';
      const f = st.dur / max;
      bar.style.width = `${Math.round(f * 80)}%`;
      bar.style.background = f > 0.5 ? '#5fe07a' : f > 0.2 ? '#ffd34d' : '#ff5a4a';
    } else bar.style.display = 'none';
  }

  clickSlot(c, i, right, shift, opts = {}) {
    const s = c.get(i);
    // shift-click moves stacks between the bag and the open machine
    if (shift && s && !this.held && this.machine) {
      const fromBag = c.isBag;
      if (fromBag) this.g.quickMoveToMachine(this.machine, s, () => { c.set(i, null); });
      else { const left = this.g.inv.add(s.id, s.count, s.dur); c.set(i, left ? { ...s, count: left } : null); }
      c.changed(); this.refreshAll(); return;
    }
    if (opts.takeOnly && this.held) return;
    if (!this.held) {
      if (!s) return;
      if (right && s.count > 1) { const half = Math.ceil(s.count / 2); this.held = { ...s, count: half }; s.count -= half; }
      else { this.held = s; c.set(i, null); }
    } else {
      if (opts.accept && !opts.accept(this.held)) return;
      const max = ITEMS[this.held.id]?.stack || 64;
      if (!s) {
        if (right) { c.set(i, { ...this.held, count: 1 }); this.held.count--; }
        else { c.set(i, this.held); this.held = null; }
      } else if (s.id === this.held.id && s.count < max) {
        const n = right ? 1 : Math.min(max - s.count, this.held.count);
        s.count += n; this.held.count -= n;
      } else { c.set(i, this.held); this.held = s; }
      if (this.held && this.held.count <= 0) this.held = null;
    }
    c.set(i, c.get(i) && c.get(i).count > 0 ? c.get(i) : null); // sync in-place changes (and tell the world for chests)
    c.changed();
    this.renderHeld();
    this.refreshAll();
  }

  renderHeld() { $('held').hidden = !this.held; if (this.held) this.fillSlot($('held'), this.held); }

  refreshAll() { this.renderHotbar(); if (this.open) { this.renderInventory(); this.renderMachine(); } }

  /* ---------------- HUD ---------------- */
  renderHotbar() {
    const inv = this.g.inv;
    for (let i = 0; i < 9; i++) { this.fillSlot(this.hotSlots[i], inv.slots[i]); this.hotSlots[i].classList.toggle('on', i === this.g.sel); }
  }
  renderStats() {
    const p = this.g.player;
    $('stats').hidden = p.creative;
    if (p.creative) return;
    for (let i = 0; i < 10; i++) {
      const hv = Math.max(0, Math.min(2, p.health - i * 2)), fv = Math.max(0, Math.min(2, p.hunger - i * 2));
      const h = $('hearts').children[i], f = $('food').children[i];
      if (h.dataset.v !== String(hv)) { h.src = this.icons['heart' + hv]; h.dataset.v = hv; }
      if (f.dataset.v !== String(fv)) { f.src = this.icons['food' + fv]; f.dataset.v = fv; }
    }
    $('hearts').classList.toggle('shake', p.health <= 4);
    const airMax = 10 * (p.fx?.breath || 1);
    $('bubbles').hidden = p.air >= airMax;
    $('bubbles').style.setProperty('--air', `${Math.max(0, p.air / airMax) * 100}%`);
    // extra hearts from the Sturdy skill
    const extra = Math.max(0, Math.ceil(((p.fx?.maxHealth || 20) - 20) / 2));
    $('hearts').dataset.extra = extra ? `+${Math.max(0, Math.ceil((p.health - 20) / 2))}/${extra}` : '';
  }
  setInfo(html) { $('info').innerHTML = html; }
  setBreak(p) { const r = $('breakRing'); r.hidden = p <= 0; r.style.setProperty('--p', `${Math.round(p * 360)}deg`); }
  setTarget(text) { const t = $('target'); t.hidden = !text; t.textContent = text || ''; }
  hurtFlash() { const v = $('vignette'); v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); }
  setUnderwater(v, lava) { $('waterTint').className = v ? 'on' : lava ? 'lava' : ''; }
  questTracker(quests, progressText) {
    $('questTracker').innerHTML = quests.slice(0, 3).map(q =>
      `<div class="${q.status === 'ready' ? 'ready' : ''}"><b>${esc(q.title)}</b><br>${esc(progressText(q))}</div>`).join('');
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    $('messages').appendChild(d);
    setTimeout(() => d.classList.add('fade'), 2400);
    setTimeout(() => d.remove(), 3100);
    while ($('messages').children.length > 4) $('messages').firstChild.remove();
  }
  chat(name, text, sys = false) {
    const d = document.createElement('div');
    d.className = sys ? 'sys' : '';
    if (sys) d.textContent = text;
    else { const b = document.createElement('b'); b.textContent = name + ': '; d.append(b, document.createTextNode(text)); }
    $('chatLog').appendChild(d);
    while ($('chatLog').children.length > 8) $('chatLog').firstChild.remove();
    $('chatLog').classList.add('show');
    clearTimeout(this.chatT); this.chatT = setTimeout(() => $('chatLog').classList.remove('show'), 8000);
  }
  openChat() { $('chatBox').hidden = false; this.chatInput.value = ''; this.chatInput.focus(); $('chatLog').classList.add('show'); }
  closeChat() { $('chatBox').hidden = true; this.chatInput.blur(); this.g.resumeAfterChat(); }
  chatOpen() { return !$('chatBox').hidden; }

  /* ---------------- inventory, crafting, machines ---------------- */
  setOpen(v, machine = null) {
    this.open = v;
    this.machine = v ? machine : null;
    $('inventory').hidden = !v;
    $('tabCreative').hidden = !this.g.player.creative;
    if (!this.g.player.creative && this.tab === 'creative') this.tab = 'craft';
    $('invTitle').textContent = machine ? { chest: 'Chest', smelter: 'Smelter', drill: 'Auto Drill' }[machine.type] + ' & Bag' : 'Bag & Crafting';
    if (v) { this.setTab(this.tab); this.renderInventory(); this.renderMachine(true); }
    else {
      if (this.held) { this.g.inv.add(this.held.id, this.held.count, this.held.dur); this.held = null; this.renderHeld(); }
      this.tooltip(null);
    }
  }
  setTab(t) {
    this.tab = t;
    $('tabCraft').classList.toggle('on', t === 'craft');
    $('tabCreative').classList.toggle('on', t === 'creative');
    $('craftControls').hidden = t !== 'craft';
    this.renderRecipes();
  }
  renderInventory() {
    const inv = this.g.inv;
    for (let i = 0; i < inv.size; i++) this.fillSlot(this.invSlots[i], inv.slots[i]);
    this.renderRecipes();
  }

  renderMachine(rebuild = false) {
    const box = $('machine'), m = this.machine;
    box.hidden = !m;
    if (!m) { box.dataset.key = ''; return; }
    const key = `${m.type}${m.x},${m.y},${m.z}`;
    if (rebuild || box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = '';
      this.mSlots = [];
      if (m.type === 'chest') {
        box.innerHTML = '<h3>Chest</h3>';
        const grid = document.createElement('div'); grid.className = 'grid';
        // the chest lives in the world: every change is sent, and other players see it too
        const mk = `${m.x},${m.y},${m.z}`;
        const c = { size: 27, get: i => this.machine?.slots[i] || null, set: (i, v) => { if (this.machine) { this.machine.slots[i] = v; this.g.machineSet(mk, { slot: i, stack: v }); } }, changed: () => {} };
        for (let i = 0; i < 27; i++) { const s = this.slotEl(); this.bindSlot(s, () => c, i); grid.appendChild(s); this.mSlots.push(s); }
        box.appendChild(grid);
      } else if (m.type === 'smelter' || m.type === 'drill') {
        const fields = m.type === 'smelter' ? ['input', 'fuel', 'output'] : ['fuel'];
        const mk = `${m.x},${m.y},${m.z}`;
        const c = { size: fields.length, get: i => this.machine?.[fields[i]] || null, set: (i, v) => { if (this.machine) { this.machine[fields[i]] = v; this.g.machineSet(mk, { field: fields[i], stack: v }); } }, changed: () => {} };
        box.innerHTML = `<h3>${m.type === 'smelter' ? 'Smelter' : 'Auto Drill'}</h3><div class="mrow"></div><p class="status"></p>`;
        const row = box.querySelector('.mrow');
        fields.forEach((f, i) => {
          const wrap = document.createElement('div');
          const s = this.slotEl();
          const accept = f === 'fuel' ? st => FUEL.has(st.id) : f === 'input' ? st => SMELT.has(st.id) : null;
          this.bindSlot(s, () => c, i, { accept, takeOnly: f === 'output' });
          wrap.appendChild(s);
          const lab = document.createElement('div'); lab.className = 'mlabel'; lab.textContent = f === 'input' ? 'Ore / food' : f === 'fuel' ? 'Fuel' : 'Result';
          wrap.appendChild(lab);
          row.appendChild(wrap);
          this.mSlots.push(s);
          if (f === 'fuel' && m.type === 'smelter') {
            const mid = document.createElement('div');
            mid.innerHTML = '<div class="flame"></div><div class="progress"><span></span></div>';
            row.insertBefore(mid, row.lastChild);
          }
        });
        if (m.type === 'smelter') row.insertBefore(row.children[2], row.children[1]); // input, fuel, progress, result
      }
    }
    // values
    if (m.type === 'chest') for (let i = 0; i < 27; i++) this.fillSlot(this.mSlots[i], m.slots[i]);
    if (m.type === 'smelter') {
      this.fillSlot(this.mSlots[0], m.input); this.fillSlot(this.mSlots[1], m.fuel); this.fillSlot(this.mSlots[2], m.output);
      box.querySelector('.flame')?.classList.toggle('on', m.burn > 0);
      const bar = box.querySelector('.progress span'); if (bar) bar.style.width = `${Math.round(m.progress * 100)}%`;
      box.querySelector('.status').textContent = m.input && !SMELT.has(m.input.id) ? 'That can\'t be smelted.' : m.burn > 0 ? 'Smelting…' : m.input ? 'Add fuel: coal, charcoal, embers or wood.' : 'Put ore, sand or raw food on the left.';
    }
    if (m.type === 'drill') { this.fillSlot(this.mSlots[0], m.fuel); box.querySelector('.status').textContent = m.status; }
  }

  renderRecipes() {
    const box = $('recipes');
    if (!this.open) return;
    const inv = this.g.inv;
    if (this.tab === 'creative') {
      box.className = 'creative';
      if (box.dataset.mode === 'creative') return;
      box.dataset.mode = 'creative';
      box.innerHTML = '';
      for (const it of ITEMS) {
        if (!it || (it.block && BLOCKS[it.block].hard < 0 && it.block !== 6 && it.block !== 15)) continue;
        const d = document.createElement('button');
        d.className = 'pick'; d.type = 'button';
        d.innerHTML = `<img src="${itemIcon(it.id, this.atlas)}" alt="">`;
        d.addEventListener('click', () => { this.held = { id: it.id, count: it.stack === 999 ? 99 : it.stack, dur: it.durability || 0 }; this.renderHeld(); });
        d.addEventListener('mouseenter', () => this.tooltip(it.id));
        d.addEventListener('mouseleave', () => this.tooltip(null));
        box.appendChild(d);
      }
      return;
    }
    box.className = '';
    box.dataset.mode = 'craft';
    const bench = this.g.nearBench();
    $('benchNote').textContent = bench ? 'Workbench nearby: every recipe is open.' : 'Stand near a Workbench for tools, machines, magic and decor.';
    const rows = RECIPES.map((r, i) => ({ r, i, ok: canCraft(inv, r, bench) }))
      .filter(x => (this.cat === 'All' || x.r.cat === this.cat) && (!this.onlyCraftable || x.ok) &&
        (!this.query || itemName(x.r.out).toLowerCase().includes(this.query) || x.r.in.some(([id]) => itemName(id).toLowerCase().includes(this.query))))
      .sort((a, b) => (b.ok - a.ok) || (a.i - b.i));
    box.innerHTML = rows.length ? '' : '<p class="empty">No recipes match.</p>';
    for (const { r, ok } of rows) {
      const row = document.createElement('div');
      row.className = 'recipe' + (ok ? ' ok' : '');
      const ins = r.in.map(([id, n]) => `<span class="ing ${inv.count(id) >= n ? '' : 'miss'}" title="${itemName(id)}"><img src="${itemIcon(id, this.atlas)}" alt="">${n}</span>`).join('');
      const desc = ITEMS[r.out]?.desc ? `<div class="desc">${ITEMS[r.out].desc}</div>` : '';
      row.innerHTML = `<img class="out" src="${itemIcon(r.out, this.atlas)}" alt="">
        <div><strong>${itemName(r.out)}${r.n > 1 ? ` ×${r.n}` : ''}</strong>${desc}
        <div class="ings">${ins}${r.bench ? `<span class="tag ${bench ? '' : 'miss'}">Workbench</span>` : ''}</div></div>
        <button type="button" ${ok ? '' : 'disabled'}>Craft</button>`;
      row.querySelector('button').addEventListener('click', e => {
        const times = e.shiftKey ? 8 : 1;
        let made = 0;
        for (let k = 0; k < times; k++) { if (craft(inv, r, this.g.nearBench(), this.g.fx())) made++; else break; }
        if (made) { this.g.sfx.craft(); this.toast(`Crafted ${itemName(r.out)}${r.n * made > 1 ? ` ×${r.n * made}` : ''}`); this.g.onCraft(r.out); }
        this.renderInventory();
      });
      row.querySelector('.out').addEventListener('mouseenter', () => this.tooltip(r.out));
      row.querySelector('.out').addEventListener('mouseleave', () => this.tooltip(null));
      box.appendChild(row);
    }
  }

  /* ---------------- quest log ---------------- */
  renderQuests(npcs) {
    const list = $('questList');
    if (!npcs.quests.length) { list.innerHTML = '<p class="empty">No quests yet. Villagers in the villages you find will ask for help: talk to them and choose "Need any help?".</p>'; return; }
    list.innerHTML = '';
    for (const q of npcs.quests) {
      const ready = q.status === 'ready' || npcs.canFinish(q);
      const d = document.createElement('div');
      d.className = 'quest' + (ready ? ' ready' : '');
      d.innerHTML = `<h4>${esc(q.title)}</h4><span class="prog">${esc(npcs.progressText(q))}</span>
        <p>From ${esc(q.giverName)} of ${esc(q.village)}. ${ready ? 'Return to them to collect your reward.' : esc(q.text)}</p>
        <button type="button">Abandon</button>`;
      d.querySelector('button').addEventListener('click', () => { npcs.abandon(q.id); this.renderQuests(npcs); });
      list.appendChild(d);
    }
  }

  /* ---------------- waystones ---------------- */
  renderWaystone(here, all, onRename, onTravel) {
    const name = $('wayName');
    name.value = here.name || '';
    name.onkeydown = e => e.stopPropagation();
    name.onchange = () => onRename(name.value.trim().slice(0, 24) || here.name);
    const list = $('wayList');
    const others = all.filter(w => w.id !== here.id);
    list.innerHTML = others.length ? '' : '<p class="empty">Touch other waystones on your travels and you can jump between them here.</p>';
    for (const w of others) {
      const b = document.createElement('button'); b.type = 'button';
      const d = Math.round(Math.hypot(w.x - here.x, w.z - here.z));
      b.innerHTML = `<strong>${esc(w.name)}</strong><span>${d} blocks away</span>`;
      b.addEventListener('click', () => onTravel(w));
      list.appendChild(b);
    }
  }
}

export function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
