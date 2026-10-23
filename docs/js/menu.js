// Title screen (world list, create/import), avatar editor with live preview, and the settings panel.
import * as THREE from '../vendor/three.module.js';
import { storage } from './storage.js';
import { settings, saveSettings, applyPreset, resetKeys, ACTIONS, PRESETS, keyLabel } from './settings.js';
import { Avatar, AVATAR_OPTIONS, EMOTES, defaultAvatar } from './avatar.js';
import { esc } from './ui.js';
import { isUnlocked, lockText } from './sim/progression.js';

const $ = id => document.getElementById(id);

export function seedFromText(t) {
  t = (t || '').trim();
  if (!t) return Math.floor(Math.random() * 2 ** 31);
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/* ------------------------------------------------------------------ */
/* World list                                                          */
/* ------------------------------------------------------------------ */
export class TitleMenu {
  // onPlay(meta), online: whether a multiplayer server is present
  constructor(onPlay) {
    this.onPlay = onPlay;
    $('newWorldBtn').addEventListener('click', () => this.showCreate(true));
    $('cancelCreate').addEventListener('click', () => this.showCreate(false));
    $('createWorld').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData($('createWorld'));
      const count = (await storage.listWorlds()).length;
      const meta = {
        id: 'w' + Date.now().toString(36),
        name: $('worldName').value.trim() || `World ${count + 1}`,
        seed: seedFromText($('worldSeed').value),
        mode: fd.get('mode'), created: Date.now(), lastPlayed: Date.now(), version: 2,
      };
      await storage.putWorld(meta);
      this.onPlay(meta);
    });
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await storage.importWorld(JSON.parse(await f.text())); this.refresh(); }
      catch (err) { alertIn($('worldList'), err.message || 'Could not read that file.'); }
      e.target.value = '';
    });
  }

  showCreate(v) {
    $('createWorld').hidden = !v; $('menuMain').hidden = v;
    if (v) { $('worldName').value = ''; $('worldSeed').value = ''; $('worldName').focus(); }
  }

  async refresh() {
    const list = $('worldList');
    const worlds = await storage.listWorlds();
    if (!(await storage.available())) list.innerHTML = '<p class="hint">This browser is blocking storage, so worlds will not be saved after you close the page.</p>';
    else list.innerHTML = '';
    if (!worlds.length) list.insertAdjacentHTML('beforeend', '<p class="hint">No worlds yet. Press <b>New world</b> to generate one. Every world is different.</p>');
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world';
      const when = new Date(w.lastPlayed || w.created).toLocaleDateString();
      row.innerHTML = `<div><strong>${esc(w.name)}</strong><span>${w.mode === 'creative' ? 'Creative' : 'Survival'} · seed ${w.seed} · ${when}</span></div>
        <button type="button" class="play">Play</button><button type="button" class="del">Delete</button>`;
      row.querySelector('.play').addEventListener('click', () => this.onPlay(w));
      const del = row.querySelector('.del');
      del.addEventListener('click', async () => {
        if (del.dataset.sure) { await storage.deleteWorld(w.id); this.refresh(); return; }
        del.dataset.sure = '1'; del.textContent = 'Really?';
        setTimeout(() => { del.dataset.sure = ''; del.textContent = 'Delete'; }, 3000);
      });
      list.appendChild(row);
    }
  }
}

function alertIn(el, msg) { const p = document.createElement('p'); p.className = 'hint'; p.style.color = 'var(--bad)'; p.textContent = msg; el.prepend(p); }

/* ------------------------------------------------------------------ */
/* Avatar editor                                                       */
/* ------------------------------------------------------------------ */
export class AvatarEditor {
  constructor(getCfg, setCfg, getProfile = () => null) {
    this.getCfg = getCfg; this.setCfg = setCfg; this.getProfile = getProfile;
    this.renderer = null;
    $('avatarRandom').addEventListener('click', () => {
      const prof = this.getProfile();
      const ok = (part, v) => isUnlocked(prof, `${part}:${v}`);
      this.cfg = { ...defaultAvatar(), trail: this.cfg.trail, title: this.cfg.title };
      this.cfg.hat = pick(AVATAR_OPTIONS.hat.filter(v => ok('hat', v)));
      this.cfg.back = pick(AVATAR_OPTIONS.back.filter(v => ok('back', v)));
      this.apply();
    });
    $('avatarEmote').addEventListener('click', () => this.avatar?.playEmote(pick(EMOTES.filter(e => e !== 'sit'))));
  }
  open() {
    this.cfg = { ...this.getCfg() };
    if (!this.renderer) {
      const c = $('avatarPreview');
      this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      this.renderer.setSize(c.clientWidth || 280, c.clientHeight || 368, false);
      this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(30, (c.clientWidth || 280) / (c.clientHeight || 368), 0.1, 50);
      this.cam.position.set(0, 1.5, 6.2); this.cam.lookAt(0, 1.05, 0);
      this.avatar = new Avatar(this.scene, this.cfg);
      const loop = () => {
        if (!$('avatarEditor').hidden) {
          this.t = (this.t || 0) + 1 / 60;
          this.avatar.pose(1 / 60, 0, 0, 0, Math.sin(this.t * 0.6) * 0.8, 0, 0, 1);
          this.renderer.render(this.scene, this.cam);
        }
        requestAnimationFrame(loop);
      };
      loop();
    }
    this.apply();
  }
  apply() {
    this.avatar.setConfig(this.cfg);
    this.setCfg(this.cfg);
    this.renderOptions();
  }
  renderOptions() {
    const O = AVATAR_OPTIONS, box = $('avatarOptions');
    const rows = [
      ['Skin', 'skin', O.skin, true], ['Hair', 'hair', O.hair], ['Hair colour', 'hairColor', O.hairColor, true], ['Eyes', 'eyes', O.eyes, true],
      ['Top', 'top', O.top], ['Top colour', 'topColor', O.colors, true], ['Bottom', 'bottom', O.bottom], ['Bottom colour', 'bottomColor', O.colors, true],
      ['Shoes', 'shoes', O.colors, true], ['Hat', 'hat', O.hat], ['Face', 'face', O.face], ['Back', 'back', O.back], ['Accent colour', 'accent', O.colors, true],
      ['Trail', 'trail', O.trail], ['Title', 'title', O.title],
    ];
    const prof = this.getProfile();
    box.innerHTML = '';
    for (const [label, key, values, swatch] of rows) {
      const d = document.createElement('div'); d.className = 'opt';
      d.innerHTML = `<h4>${label}</h4><div class="${swatch ? 'swatches' : 'choicesrow'}"></div>`;
      const row = d.lastChild;
      for (const v of values) {
        const b = document.createElement('button'); b.type = 'button';
        if (swatch) { b.style.background = v; b.setAttribute('aria-label', `${label} ${v}`); } else b.textContent = v;
        if (this.cfg[key] === v) b.classList.add('on');
        const locked = !swatch && v !== 'none' && !isUnlocked(prof, `${key}:${v}`);
        if (locked) { b.classList.add('locked'); b.title = lockText(`${key}:${v}`); }
        b.addEventListener('click', () => {
          if (locked) { d.querySelector('.lockhint')?.remove(); d.insertAdjacentHTML('beforeend', `<p class="hint lockhint">${esc(v)} is locked: ${esc(lockText(`${key}:${v}`))}.</p>`); return; }
          this.cfg[key] = v; this.apply();
        });
        row.appendChild(b);
      }
      box.appendChild(d);
    }
  }
}
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
export class SettingsPanel {
  constructor(onChange) {
    this.onChange = onChange;
    this.tab = 'graphics';
    document.querySelectorAll('#settingsPanel [data-tab]').forEach(b => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      document.querySelectorAll('#settingsPanel [data-tab]').forEach(x => x.classList.toggle('on', x === b));
      this.render();
    }));
  }
  changed() { saveSettings(); this.onChange(); }
  render() {
    const body = $('settingsBody');
    body.innerHTML = '';
    const row = (label, help, control) => {
      const d = document.createElement('div'); d.className = 'setrow';
      d.innerHTML = `<label>${label}${help ? `<small>${help}</small>` : ''}</label>`;
      d.appendChild(control); body.appendChild(d); return d;
    };
    const range = (key, min, max, step, fmt = v => v) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<input type="range" min="${min}" max="${max}" step="${step}" value="${settings[key]}"><small>${fmt(settings[key])}</small>`;
      const inp = wrap.firstChild;
      inp.addEventListener('input', () => { settings[key] = +inp.value; wrap.lastChild.textContent = fmt(+inp.value); settings.preset = 'custom'; this.changed(); });
      return wrap;
    };
    const toggle = key => {
      const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!settings[key];
      inp.addEventListener('change', () => { settings[key] = inp.checked; settings.preset = 'custom'; this.changed(); });
      return inp;
    };
    if (this.tab === 'graphics') {
      const presets = document.createElement('div'); presets.className = 'choicesrow';
      for (const p of [...Object.keys(PRESETS)]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = p;
        if (settings.preset === p) b.classList.add('on');
        b.addEventListener('click', () => { applyPreset(p); this.onChange(); this.render(); });
        presets.appendChild(b);
      }
      row('Quality preset', 'Low suits older laptops and phones. Ultra needs a strong graphics card.', presets);
      row('View distance', 'How many chunks around you are drawn.', range('renderDistance', 3, 14, 1, v => `${v} chunks (${v * 16} blocks)`));
      const sh = document.createElement('select');
      for (const [v, l] of [[0, 'Off'], [1024, 'Soft (1024)'], [2048, 'Sharp (2048)'], [4096, 'Very sharp (4096)']]) sh.add(new Option(l, v, false, settings.shadows === v));
      sh.addEventListener('change', () => { settings.shadows = +sh.value; settings.preset = 'custom'; this.changed(); });
      row('Sun shadows', 'Real-time shadows from the sun and moon.', sh);
      row('Light shafts', 'Volumetric fog that catches sunbeams. Needs shadows.', toggle('volumetric'));
      row('Resolution', 'Lower renders fewer pixels and runs faster.', range('resolution', 0.5, 1, 0.05, v => `${Math.round(v * 100)}%`));
      row('Particles', '', range('particles', 0, 1, 0.05, v => `${Math.round(v * 100)}%`));
      row('Automatic performance', 'Lowers resolution by itself when the frame rate drops.', toggle('autoPerf'));
      row('Field of view', '', range('fov', 55, 100, 1, v => `${v}°`));
      row('View bobbing', '', toggle('viewBob'));
    } else if (this.tab === 'controls') {
      row('Mouse sensitivity', '', range('sensitivity', 0.2, 3, 0.05, v => `${v.toFixed(2)}×`));
      row('Invert look up/down', '', toggle('invertY'));
      for (const [action, label] of ACTIONS) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'keybtn';
        b.textContent = keyLabel(settings.keys[action]);
        b.addEventListener('click', () => {
          b.classList.add('wait'); b.textContent = 'Press a key…';
          const onKey = e => {
            e.preventDefault(); e.stopPropagation();
            document.removeEventListener('keydown', onKey, true);
            if (e.code !== 'Escape') {
              // a key can only do one thing: unbind it elsewhere
              for (const [a, k] of Object.entries(settings.keys)) if (k === e.code) settings.keys[a] = '';
              settings.keys[action] = e.code;
              this.changed();
            }
            this.render();
          };
          document.addEventListener('keydown', onKey, true);
        });
        row(label, '', b);
      }
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'keybtn'; reset.textContent = 'Reset keys';
      reset.addEventListener('click', () => { resetKeys(); this.onChange(); this.render(); });
      row('Defaults', 'Hotbar slots are always 1 to 9. Left mouse mines and attacks, right mouse places and uses.', reset);
    } else {
      row('Volume', '', range('volume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`));
    }
  }
}
