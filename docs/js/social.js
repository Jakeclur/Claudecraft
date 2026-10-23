// Online and progression screens: server browser, world settings and moderation,
// the profile (levels, skills, achievements, cosmetics) and the competitive-round HUD.
import { MODES, RULES, ROLE_NAMES } from './sim/rules.js';
import { SKILL_TREES, ACHIEVEMENTS, COSMETIC_LOCKS, levelFromXp, pointsAvailable, canLearn, isUnlocked, lockText } from './sim/progression.js';
import { BIOME_NAMES } from './consts.js';
import { itemIcon, itemName } from './blocks.js';
import { esc } from './ui.js';

const $ = id => document.getElementById(id);
const SERVERS_KEY = 'cave-craft-servers';
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

/* ------------------------------------------------------------------ */
/* Server browser                                                      */
/* ------------------------------------------------------------------ */
export class OnlinePanel {
  // api: { listRooms(base), createRoom(opts), join(base, roomId, invite), hasLocalServer }
  constructor(api) {
    this.api = api;
    this.rooms = [];
    this.servers = store.get(SERVERS_KEY, []);
    const f = $('onlineFilters');
    f.innerHTML = `
      <label>Mode <select id="fMode"><option value="">Any</option>${Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('')}</select></label>
      <label>Biome <select id="fBiome"><option value="">Any</option>${BIOME_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
      <label>Players <select id="fPlayers"><option value="">Any</option><option value="busy">Someone playing</option><option value="empty">Empty</option><option value="open">Not full</option></select></label>
      <label class="grow">Search <input id="fSearch" type="search" placeholder="World or owner name" autocomplete="off"></label>`;
    for (const id of ['fMode', 'fBiome', 'fPlayers', 'fSearch']) $(id).addEventListener('input', () => this.render());
    $('fSearch').addEventListener('keydown', e => e.stopPropagation());
    $('onlineRefresh').addEventListener('click', () => this.refresh());
    $('inviteJoin').addEventListener('click', () => { const c = $('inviteCode').value.trim().toUpperCase(); if (c) this.api.join('', null, c).catch(err => this.error(err.message)); });
    $('inviteCode').addEventListener('keydown', e => e.stopPropagation());
    $('addServer').addEventListener('click', () => {
      let v = $('serverAddr').value.trim();
      if (!v) return;
      if (!/^https?:\/\//.test(v)) v = 'http://' + v;
      try { v = new URL(v).origin; } catch { return this.error('That doesn\'t look like a server address.'); }
      if (!this.servers.includes(v)) { this.servers.push(v); store.set(SERVERS_KEY, this.servers); }
      $('serverAddr').value = '';
      this.refresh();
    });
    $('serverAddr').addEventListener('keydown', e => e.stopPropagation());
    $('showCreate').addEventListener('click', () => { $('createRoom').hidden = !$('createRoom').hidden; });
    const rules = $('crRules');
    rules.innerHTML = RULES.map(r => `<label title="${esc(r.desc || '')}"><input type="checkbox" data-rule="${r.id}" ${r.def ? 'checked' : ''}> ${r.label}</label>`).join('');
    $('crMode').innerHTML = Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.name}${m.desc ? ` — ${m.desc}` : ''}</option>`).join('');
    $('createRoom').addEventListener('submit', async e => {
      e.preventDefault();
      const opts = {
        name: $('crName').value, seed: $('crSeed').value, mode: $('crMode').value, visibility: $('crVis').value,
        maxPlayers: +$('crMax').value, description: $('crDesc').value,
        rules: Object.fromEntries([...rules.querySelectorAll('input')].map(i => [i.dataset.rule, i.checked])),
      };
      try { const room = await this.api.createRoom(opts); $('createRoom').hidden = true; await this.refresh(); this.api.join('', room.id); }
      catch (err) { this.error(err.message); }
    });
    for (const id of ['crName', 'crSeed', 'crDesc', 'crMax']) $(id).addEventListener('keydown', e => e.stopPropagation());
  }

  error(msg) { $('onlineError').textContent = msg; $('onlineError').hidden = !msg; }

  async refresh() {
    this.error('');
    $('roomList').innerHTML = '<p class="hint">Looking for worlds…</p>';
    const all = [];
    const sources = [...(this.api.hasLocalServer ? [''] : []), ...this.servers];
    await Promise.all(sources.map(async base => {
      try {
        const r = await this.api.listRooms(base);
        for (const room of r.rooms) all.push({ ...room, base, server: r.server });
      } catch (err) { all.push({ error: true, base, message: err.message }); }
    }));
    this.rooms = all;
    this.render();
  }

  render() {
    const mode = $('fMode').value, biome = $('fBiome').value, players = $('fPlayers').value, q = $('fSearch').value.trim().toLowerCase();
    const list = $('roomList');
    const rows = this.rooms.filter(r => !r.error).filter(r =>
      (!mode || r.mode === mode) && (biome === '' || r.biomes.includes(+biome)) &&
      (!players || (players === 'busy' ? r.players > 0 : players === 'empty' ? r.players === 0 : r.players < r.max)) &&
      (!q || r.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)));
    const errors = this.rooms.filter(r => r.error);
    list.innerHTML = '';
    if (!rows.length) list.innerHTML = '<p class="hint">No worlds match. Try other filters, or create your own world.</p>';
    for (const r of rows.sort((a, b) => b.players - a.players)) {
      const d = document.createElement('div');
      d.className = 'room';
      d.innerHTML = `<div class="rmain"><strong>${esc(r.name)}</strong>${r.yours ? '<span class="chip own">Yours</span>' : ''}${r.visibility !== 'public' ? `<span class="chip">${r.visibility === 'private' ? 'Invite-only' : 'Unlisted'}</span>` : ''}
        <span class="chip mode">${esc(r.modeName)}</span>
        <p>${esc(r.description || '')}</p>
        <p class="meta">${r.biomeNames.slice(0, 4).map(esc).join(' · ')} — by ${esc(r.owner)}${r.base ? ` on ${esc(r.server || r.base)}` : ''}${r.rules.pvp ? ' · PvP' : ''}${!r.rules.hostiles ? ' · Peaceful' : ''}</p></div>
        <div class="rside"><span class="count">${r.players}/${r.max}</span><button type="button" class="primary">Join</button></div>`;
      d.querySelector('button').addEventListener('click', () => this.api.join(r.base, r.id).catch(err => this.error(err.message)));
      list.appendChild(d);
    }
    for (const e of errors) list.insertAdjacentHTML('beforeend', `<p class="hint">Couldn't reach ${esc(e.base || 'this server')}: ${esc(e.message)}</p>`);
    $('serverChips').innerHTML = this.servers.map((s, i) => `<span class="chip">${esc(s)} <button type="button" data-i="${i}" aria-label="Remove">✕</button></span>`).join('');
    $('serverChips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this.servers.splice(+b.dataset.i, 1); store.set(SERVERS_KEY, this.servers); this.refresh(); }));
  }
}

/* ------------------------------------------------------------------ */
/* World settings & moderation (owners and moderators)                 */
/* ------------------------------------------------------------------ */
export class AdminPanel {
  // api: { send(msg) (roomAdmin), sim(msg) (in-world admin), players(), me(), roomLink(code) }
  constructor(api) {
    this.api = api; this.tab = 'players'; this.view = null;
    document.querySelectorAll('#worldAdmin [data-atab]').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.atab;
      document.querySelectorAll('#worldAdmin [data-atab]').forEach(x => x.classList.toggle('on', x === b));
      this.render();
    }));
  }
  set(view, room) { this.view = view; this.room = room; if (!$('worldAdmin').hidden) this.render(); }
  render() {
    const body = $('adminBody'), v = this.view;
    if (!v) { body.innerHTML = '<p class="hint">Only the world owner and moderators can change these settings.</p>'; return; }
    const me = this.api.me();
    if (this.tab === 'players') {
      const ps = this.api.players();
      body.innerHTML = ps.map(p => `<div class="arow"><strong>${esc(p.name)}</strong><span class="chip">${ROLE_NAMES[p.role] || 'Visitor'}</span>
        ${p.id === me.id || p.role === 'owner' ? '' : `
        <select data-role="${p.id}">${['visitor', 'builder', ...(v.owner ? ['mod'] : [])].map(r => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}</select>
        <button type="button" data-op="mute" data-id="${p.id}">Mute 10 min</button><button type="button" data-op="unmute" data-id="${p.id}">Unmute</button>
        <button type="button" data-op="kick" data-id="${p.id}">Kick</button><button type="button" data-op="ban" data-id="${p.id}" class="danger">Ban</button>`}</div>`).join('') || '<p class="hint">Nobody else is here.</p>';
      body.querySelectorAll('select[data-role]').forEach(s => s.addEventListener('change', () => this.api.sim({ t: 'admin', op: 'role', target: s.dataset.role, role: s.value })));
      body.querySelectorAll('button[data-op]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.op === 'ban' && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Really ban?'; return; }
        this.api.sim({ t: 'admin', op: b.dataset.op, target: b.dataset.id, minutes: 10 });
      }));
    } else if (this.tab === 'rules') {
      body.innerHTML = RULES.map(r => `<label class="arow"><input type="checkbox" data-rule="${r.id}" ${v.rules[r.id] ? 'checked' : ''} ${v.owner ? '' : 'disabled'}> <span><strong>${r.label}</strong>${r.desc ? `<br><small>${esc(r.desc)}</small>` : ''}</span></label>`).join('') +
        (v.owner ? '' : '<p class="hint">Only the owner can change the rules.</p>');
      body.querySelectorAll('input[data-rule]').forEach(i => i.addEventListener('change', () => this.api.send({ op: 'rules', rules: { [i.dataset.rule]: i.checked } })));
    } else if (this.tab === 'invites') {
      body.innerHTML = `<p class="hint">Invite codes let people into invite-only worlds. Anyone with the code (or the link) can join.</p>
        <div class="arow"><input id="invName" placeholder="Player name (optional)" maxlength="16"><button type="button" id="invMake" class="primary">Create invite</button></div>
        ${v.invites.map(i => `<div class="arow"><code>${esc(i.code)}</code><span class="hint">by ${esc(i.by)} · used ${i.uses || 0}×</span>
          <button type="button" data-copy="${esc(i.code)}">Copy link</button><button type="button" data-revoke="${esc(i.code)}">Revoke</button></div>`).join('')}`;
      $('invName').addEventListener('keydown', e => e.stopPropagation());
      $('invMake').addEventListener('click', () => this.api.send({ op: 'invite', name: $('invName').value.trim() }));
      body.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
        const link = this.api.roomLink(b.dataset.copy);
        navigator.clipboard?.writeText(link).then(() => { b.textContent = 'Copied'; }).catch(() => { b.textContent = link; });
      }));
      body.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => this.api.send({ op: 'revoke', code: b.dataset.revoke })));
    } else if (this.tab === 'bans') {
      body.innerHTML = v.bans.length ? v.bans.map(b => `<div class="arow"><strong>${esc(b.name)}</strong><span class="hint">${esc(b.reason || 'no reason')} · by ${esc(b.by || '?')}</span><button type="button" data-unban="${esc(b.name)}">Unban</button></div>`).join('') : '<p class="hint">Nobody is banned.</p>';
      body.querySelectorAll('[data-unban]').forEach(b => b.addEventListener('click', () => this.api.send({ op: 'unban', name: b.dataset.unban })));
    } else if (this.tab === 'world') {
      body.innerHTML = `
        <label>Name <input id="wName" value="${esc(v.name)}" maxlength="32" ${v.owner ? '' : 'disabled'}></label>
        <label>Description <input id="wDesc" value="${esc(v.description || '')}" maxlength="120" ${v.owner ? '' : 'disabled'}></label>
        <label>Who can find it <select id="wVis" ${v.owner ? '' : 'disabled'}>
          <option value="public" ${v.visibility === 'public' ? 'selected' : ''}>Public: listed in the browser</option>
          <option value="unlisted" ${v.visibility === 'unlisted' ? 'selected' : ''}>Unlisted: only with the link</option>
          <option value="private" ${v.visibility === 'private' ? 'selected' : ''}>Invite-only: needs an invite</option></select></label>
        <label>Most players <input id="wMax" type="number" min="2" max="32" value="${v.maxPlayers}" ${v.owner ? '' : 'disabled'}></label>
        ${v.owner ? '<div class="menurow"><button type="button" id="wSave" class="primary">Save</button><button type="button" id="wDelete" class="danger">Delete this world</button></div>' : ''}
        <p class="hint">Roles: Owner &gt; Moderator (kick, mute, ban, invite) &gt; Builder (can build when visitors can't) &gt; Visitor.</p>`;
      body.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
      $('wSave')?.addEventListener('click', () => {
        this.api.send({ op: 'rename', name: $('wName').value, description: $('wDesc').value });
        this.api.send({ op: 'visibility', value: $('wVis').value });
        this.api.send({ op: 'max', value: +$('wMax').value });
      });
      $('wDelete')?.addEventListener('click', e => {
        const b = e.target;
        if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Click again to delete forever'; return; }
        this.api.send({ op: 'delete' });
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Profile: level, skills, achievements, cosmetics                     */
/* ------------------------------------------------------------------ */
export class ProfilePanel {
  // api: { profile(), learn(id), respec(), online() }
  constructor(api) { this.api = api; }
  render() {
    const pr = this.api.profile() || { xp: 0, skills: {}, achievements: {} };
    const L = levelFromXp(pr.xp || 0), pts = pointsAvailable(pr);
    const done = ACHIEVEMENTS.filter(a => pr.achievements?.[a.id]).length;
    $('profileBody').innerHTML = `
      <div class="lvl"><div class="badge">${L.level}</div><div class="grow"><strong>Level ${L.level}</strong>
        <div class="xpbar"><span style="width:${Math.round(L.into / L.need * 100)}%"></span></div>
        <small>${Math.floor(L.into)} / ${L.need} XP to level ${L.level + 1} · ${pts} skill point${pts === 1 ? '' : 's'} to spend</small></div></div>
      <p class="hint">${this.api.online() ? 'This profile is kept by the server you are playing on.' : 'Single-player progress is kept in this browser. Online servers keep their own.'}
        Earn XP by mining, building, exploring new places and biomes, defeating creatures, finishing quests and taking part in rounds.</p>
      <h3>Skills</h3>
      <div class="trees">${SKILL_TREES.map(t => `<div class="tree"><h4>${t.name}</h4><p class="hint">${t.blurb}</p>
        ${t.nodes.map(n => { const r = pr.skills?.[n.id] || 0, can = canLearn(pr, n.id);
          return `<div class="node ${r ? 'has' : ''}"><div><strong>${n.name}</strong> <span class="rank">${r}/${n.max}</span><br><small>${n.desc}${n.req ? '' : ''}</small></div>
          <button type="button" data-learn="${n.id}" ${can ? '' : 'disabled'}>${r >= n.max ? 'Max' : 'Learn'}</button></div>`; }).join('')}</div>`).join('')}</div>
      <div class="menurow small"><button type="button" id="respec">Reset skill points</button></div>
      <h3>Achievements · ${done}/${ACHIEVEMENTS.length}</h3>
      <div class="achs">${ACHIEVEMENTS.map(a => `<div class="ach ${pr.achievements?.[a.id] ? 'got' : ''}"><strong>${a.name}</strong><small>${a.desc} · ${a.xp} XP</small></div>`).join('')}</div>
      <h3>Unlockable looks</h3>
      <div class="achs">${Object.keys(COSMETIC_LOCKS).map(k => { const [part, v] = k.split(':'); const ok = isUnlocked(pr, k);
        return `<div class="ach ${ok ? 'got' : ''}"><strong>${esc(v)} <span class="hint">(${part})</span></strong><small>${ok ? 'Unlocked: pick it in Character' : esc(lockText(k))}</small></div>`; }).join('')}</div>`;
    $('profileBody').querySelectorAll('[data-learn]').forEach(b => b.addEventListener('click', () => this.api.learn(b.dataset.learn)));
    $('respec').addEventListener('click', e => { if (!e.target.dataset.sure) { e.target.dataset.sure = 1; e.target.textContent = 'Click again to reset'; return; } this.api.respec(); });
  }
}

/* ------------------------------------------------------------------ */
/* Competitive round HUD and scoreboard                                */
/* ------------------------------------------------------------------ */
export function renderRound(r, extra = {}) {
  const hud = $('roundHud');
  if (!r) { hud.hidden = true; $('scoreboard').innerHTML = ''; return; }
  hud.hidden = false;
  const phase = { lobby: `Next round in ${r.left}s`, countdown: `Starting in ${r.left}…`, active: `${Math.floor(r.left / 60)}:${String(r.left % 60).padStart(2, '0')} left`, results: 'Results' }[r.phase];
  let goal = '';
  if (r.mode === 'race' && r.you?.playing && r.phase === 'active') goal = r.you.done ? `Finished in ${(r.you.done / 1000).toFixed(1)} s!` : `Checkpoint ${r.you.cp + 1} of ${r.course}${extra.dist != null ? ` · ${extra.dist} blocks ${extra.dir}` : ''}`;
  if (r.mode === 'harvest' && r.targets && r.phase !== 'lobby') goal = r.targets.map(t => `<span class="tgt"><img src="${itemIcon(t.icon, extra.atlas)}" alt="">${esc(t.name)} ${Math.min(t.n, r.you?.got?.[t.name] || 0)}/${t.n}</span>`).join('');
  if (r.mode === 'arena' && r.phase === 'active') goal = r.you?.playing ? (r.you.out ? 'You were knocked out. Watch the rest!' : `Arena health ${extra.arenaHp ?? 20}/20 · ${r.board.filter(b => !b.out).length} left standing`) : 'Watching this round';
  if (r.phase === 'lobby') goal = r.mode === 'arena' ? 'Waiting for at least 2 players' : 'Get ready! Moderators can type /start';
  hud.innerHTML = `<strong>${esc(r.name)}</strong> · Round ${r.round || 1} · ${phase}<div class="goal">${goal}</div>`;
  $('scoreboard').innerHTML = `<h4>${esc(r.name)} standings</h4>` + r.board.map((b, i) => `<div class="srow ${b.out ? 'out' : ''}"><span>${i + 1}. ${esc(b.name)}</span><span>${
    r.mode === 'race' ? (b.done ? `${(b.done / 1000).toFixed(1)} s` : `${b.cp}/${r.course}`) : r.mode === 'harvest' ? (b.done ? `${(b.done / 1000).toFixed(1)} s` : `${b.score}%`) : (b.out ? 'out' : `${b.hp} hp · ${b.kos} KO`)}</span></div>`).join('');
}

export { itemName };
