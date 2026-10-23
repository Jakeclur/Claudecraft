// Cave Craft: setup, menus, input, mining/building, combat, magic, villagers, saving and online play.
// Creatures, villagers, dropped items, liquids, machines, rounds and progression live in the world
// brain (sim/sim.js). Single-player runs it in this page (LocalHost); online it runs on the server
// (RemoteHost). This file only draws what the brain says and sends it what the player does.
import * as THREE from '../vendor/three.module.js';
import { buildAtlas, blockMapColors, B, I, BLOCKS, ITEMS, KIND, WATERY, LIQ_TYPE, IS_SOLID, itemName, itemIcon } from './blocks.js';
import { BIOME, BIOME_NAMES, CHUNK, WH, SEA } from './consts.js';
import { World } from './world.js';
import { makeMaterials, ChunkMeshes, Shadows, Volumetric } from './render.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { MOB_MODELS } from './models.js';
import { EntityViews } from './entview.js';
import { Player } from './player.js';
import { Inventory, SMELT, FUEL } from './inventory.js';
import { Npcs } from './npc.js';
import { Avatar, defaultAvatar, TRAIL_COLORS } from './avatar.js';
import { WorldMap, drawMarkers } from './map.js';
import { UI } from './ui.js';
import { TitleMenu, AvatarEditor, SettingsPanel } from './menu.js';
import { OnlinePanel, AdminPanel, ProfilePanel, renderRound } from './social.js';
import { storage } from './storage.js';
import { settings, actionFor } from './settings.js';
import { LocalHost, RemoteHost, PeerHost, fetchRooms, localProfile } from './host.js';
import { skillEffects, sanitizeAvatar, levelFromXp } from './sim/progression.js';
import { MODES, ROLE_NAMES, canBuild } from './sim/rules.js';
import { raycastBlock, overlapsBox, rayBox } from './physics.js';
import { sfx, initAudio, toggleMute, setVolume } from './sfx.js';

// raw sRGB in, raw out: textures, vertex colours and the custom shaders all agree
THREE.ColorManagement.enabled = false;

const $ = id => document.getElementById(id);
const CURVE = i => Math.pow(0.82, 15 - i);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

/* ------------------------------------------------------------------ */
/* Renderer & shared objects                                           */
/* ------------------------------------------------------------------ */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
let autoScale = 1;
function resize() {
  const pr = Math.min(settings.maxPixelRatio || 1.5, window.devicePixelRatio || 1) * settings.resolution * autoScale;
  renderer.setPixelRatio(Math.max(0.35, pr));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const atlas = buildAtlas();
const mapColors = blockMapColors(atlas);
const mats = makeMaterials(atlas);
const chunkMeshes = new ChunkMeshes(scene, mats);
const shadows = new Shadows(mats);
const volumetric = new Volumetric();
const sky = new Sky(scene, mats);
const particles = new Particles(scene);
const views = new EntityViews(scene, atlas);
const player = new Player();
const inv = new Inventory();
const map = new WorldMap(mapColors);
const avatars = new Map(); // other players: id -> Avatar (with .role, .pid)
let world = null, npcs = null, selfAvatar = null, host = null;

const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x101018, transparent: true, opacity: 0.75 }));
outline.visible = false; scene.add(outline);

// held item drawn over the view in first person
const handScene = new THREE.Scene();
const handCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
const handSprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
handSprite.scale.set(0.3, 0.3, 1);
handScene.add(hand, handSprite);

/* ------------------------------------------------------------------ */
/* Game object shared with UI and villagers                            */
/* ------------------------------------------------------------------ */
const game = {
  atlas, inv, player, sfx, scene, sel: 0, playing: false, loading: false, meta: null, mode: 'survival',
  waystones: [], spawn: null, deathPoint: null, day: 0, camMode: 0, name: 'Caver',
  online: false, myId: null, role: 'owner', rules: {}, profile: null, round: null, arenaHp: null, frozen: false, room: null,
  avatar: local.get('cave-craft-avatar') || defaultAvatar(),
  get world() { return world; },
  select(i) { this.sel = (i + 9) % 9; ui.renderHotbar(); updateHand(); const s = inv.slots[this.sel]; if (s) ui.toast(itemName(s.id)); },
  closePanel, sendChat, resumeAfterChat, nearBench, emote, onCraft, quickMoveToMachine,
  machineSet(key, o) { host?.send({ t: 'mset', key, ...o }); },
  fx() { return skillEffects(game.profile, arenaPlaying()); },
};
const ui = new UI(game);
inv.onChange = () => { ui.renderHotbar(); updateHand(); if (ui.open) ui.renderInventory(); };

const npcGame = {
  scene, player, inv, sfx, atlas,
  get world() { return world; },
  get host() { return host; },
  ui: { showPanel: n => { ui.showPanel(n); unlockForPanel(); }, hidePanel: n => { ui.hidePanel(n); afterPanelClosed(); } },
  playerName: () => game.name, day: () => game.day, weather: () => sky.weather, isNight: () => sky.daylight < 0.35,
  sel: () => game.sel, toast: (t, k) => ui.toast(t, k), onChange: () => refreshQuests(),
  fx: () => game.fx(), progress: (stat, value) => host?.send({ t: 'progress', stat, value }),
};

const isTouch = 'ontouchstart' in window || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
if (isTouch) document.body.classList.add('touch');

function arenaPlaying() { const r = game.round; return !!(r && r.mode === 'arena' && r.you?.playing && !r.you.out && (r.phase === 'active' || r.phase === 'countdown')); }
function applySkills() {
  const fx = game.fx();
  player.fx = fx;
  if (player.health > fx.maxHealth) player.health = fx.maxHealth;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
function applySettings() {
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  resize();
  if (world) world.setRadius(settings.renderDistance);
  shadows.configure(settings.shadows, Math.min(110, Math.max(48, settings.renderDistance * 12)));
  mats.shared.uShadows.value = settings.shadows ? 1 : 0;
  setVolume(settings.volume);
  camera.far = (settings.renderDistance + 2) * CHUNK + 80; camera.updateProjectionMatrix();
  sky.fogScale = 6 / Math.max(3, settings.renderDistance);
}
applySettings();

const settingsPanel = new SettingsPanel(applySettings);
const avatarEditor = new AvatarEditor(() => game.avatar, cfg => {
  game.avatar = sanitizeAvatar({ ...cfg }, currentProfile());
  local.set('cave-craft-avatar', game.avatar);
  if (selfAvatar) selfAvatar.setConfig(game.avatar);
  host?.send({ t: 'avatar', cfg: game.avatar });
}, () => currentProfile());
function currentProfile() { return game.profile || localProfile(game.name); }
$('avatarBtn').addEventListener('click', () => { ui.showPanel('avatarEditor'); avatarEditor.open(); });
$('settingsBtn').addEventListener('click', () => { ui.showPanel('settingsPanel'); settingsPanel.render(); });
$('pauseAvatar').addEventListener('click', () => { ui.showPanel('avatarEditor'); avatarEditor.open(); });
$('pauseSettings').addEventListener('click', () => { ui.showPanel('settingsPanel'); settingsPanel.render(); });

const profilePanel = new ProfilePanel({
  profile: () => currentProfile(),
  learn: id => { if (host) host.send({ t: 'learn', skill: id }); },
  respec: () => { if (host) host.send({ t: 'respec' }); },
  online: () => game.online,
});
function openProfile() { profilePanel.render(); if (game.playing) openPanel('profile'); else ui.showPanel('profile'); }
$('profileBtn').addEventListener('click', openProfile);
$('pauseProfile').addEventListener('click', () => { ui.hidePanel('pause'); openProfile(); });

const adminPanel = new AdminPanel({
  send: m => {
    if (game.online) host.send({ t: 'roomAdmin', ...m });
    else if (m.op === 'rules') host.send({ t: 'admin', op: 'rules', rules: m.rules });
  },
  sim: m => host?.send(m),
  players: () => [{ id: game.myId, name: game.name, role: game.role }, ...[...avatars.entries()].map(([id, a]) => ({ id, name: a.name, role: a.role }))],
  me: () => ({ id: game.myId, role: game.role }),
  roomLink: code => {
    const u = new URL(location.href.split('?')[0]);
    if (game.room) u.searchParams.set('room', game.room.id);
    u.searchParams.set('invite', code);
    if (host?.base) u.searchParams.set('server', host.base);
    return u.href;
  },
});
let adminView = null;
function localAdminView() { return { rules: game.rules, owner: true, invites: [], bans: [], name: game.meta?.name || '', description: '', visibility: 'private', maxPlayers: 1, local: true }; }
function openWorldSettings() {
  if (!game.playing) return;
  if (!adminView && game.online) { ui.toast(`Only the owner and moderators can change world settings. You are a ${ROLE_NAMES[game.role]}.`); return; }
  // invites, bans and the world listing only mean something on a server
  for (const t of ['invites', 'bans', 'world']) document.querySelector(`#worldAdmin [data-atab=${t}]`).hidden = !game.online;
  if (!game.online && !['players', 'rules'].includes(adminPanel.tab)) document.querySelector('#worldAdmin [data-atab=rules]').click();
  adminPanel.set(game.online ? adminView : localAdminView(), game.room);
  openPanel('worldAdmin');
  adminPanel.render();
}
function joinLink(code) { return `${location.origin}${location.pathname}?join=${code}`; }
function refreshHostUI() {
  const b = $('pauseHost'), info = $('hostInfo');
  const can = game.playing || game.loading ? !!host && host.local === true : false;
  b.hidden = !can;
  if (!can) { info.hidden = true; return; }
  if (host.hosting) {
    b.textContent = 'Stop letting friends in';
    info.hidden = false;
    info.innerHTML = `<b>Code: ${host.code}</b> · ${host.guests.size} friend${host.guests.size === 1 ? '' : 's'} here<br>Friends open the game, press <b>Play online</b> and type the code. Or send them: <input readonly id="hostLink" value="${joinLink(host.code)}" onfocus="this.select()">`;
    $('hostLink').addEventListener('keydown', e => e.stopPropagation());
  } else { b.textContent = 'Host online (friends join)'; info.hidden = true; }
}
$('pauseHost').addEventListener('click', async () => {
  if (!host?.local) return;
  const b = $('pauseHost');
  if (host.hosting) { host.closeRoom(); refreshHostUI(); ui.toast('Your world is closed to friends again.'); return; }
  b.disabled = true; b.textContent = 'Opening…';
  try {
    const code = await host.openRoom(game.meta.name);
    ui.chat('', `Friends can join with code ${code}. Keep this page open: the world runs on your computer.`, true);
  } catch (e) { ui.toast(e.message, 'bad'); }
  b.disabled = false; refreshHostUI();
});
$('pauseAdmin').addEventListener('click', () => { ui.hidePanel('pause'); openWorldSettings(); });

/* ------------------------------------------------------------------ */
/* Title screen and the online browser                                 */
/* ------------------------------------------------------------------ */
const nameInput = $('nameInput');
nameInput.value = local.get('cave-craft-name') || `Caver${Math.floor(Math.random() * 900 + 100)}`;
nameInput.addEventListener('keydown', e => e.stopPropagation());
const title = new TitleMenu(meta => startWorld(meta));
title.refresh();
const params = new URLSearchParams(location.search);

let serverInfo = null, remote = null;
async function connectRemote(base) {
  if (remote && remote.base === base && remote.ws?.readyState === 1) return remote;
  remote?.close();
  remote = new RemoteHost(base);
  try { await remote.connect(playerName(), game.avatar); }
  catch (err) { remote = null; throw err; }
  remote.on('disconnected', () => { if (!game.playing && !game.loading) remote = null; });
  return remote;
}
function playerName() { return nameInput.value.trim().slice(0, 16) || 'Caver'; }

const onlinePanel = new OnlinePanel({
  get hasLocalServer() { return !!serverInfo; },
  async listRooms(base) {
    if (!base && serverInfo) { const r = await connectRemote(''); return { rooms: await r.listRooms(), server: r.serverName }; }
    return fetchRooms(base);
  },
  async createRoom(opts) { const r = await connectRemote(''); return r.createRoom(opts); },
  async join(base, id, invite) { await joinOnline(base || '', id, invite); },
});
function showOnline() {
  $('online').hidden = false;
  $('noServerNote').hidden = !!serverInfo;
  $('createBlock').hidden = !serverInfo;
  onlinePanel.refresh();
}
$('playOnlineBtn').addEventListener('click', showOnline);
$('onlineClose').addEventListener('click', () => { $('online').hidden = true; });

fetch('/api/info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null).then(info => {
  serverInfo = info && info.game === 'cave-craft' ? info : null;
  const s = $('netStatus');
  if (serverInfo) {
    s.textContent = `${serverInfo.name}: ${serverInfo.players} player${serverInfo.players === 1 ? '' : 's'} in ${serverInfo.rooms} world${serverInfo.rooms === 1 ? '' : 's'}.`;
    s.classList.add('on');
  } else s.textContent = 'Single-player here. Start the included server to host worlds for friends, or join a server by its address under Play online.';
  // invite links: ?room=ID&invite=CODE&server=http://host:port
  if (params.get('join')) {
    $('inviteBanner').hidden = false;
    $('inviteBanner').querySelector('span').textContent = `A friend invited you to their world (code ${params.get('join').toUpperCase()}).`;
  } else if (params.get('room') || params.get('invite')) {
    $('inviteBanner').hidden = false;
    $('inviteBanner').querySelector('span').textContent = `You were invited to a world${params.get('server') ? ` on ${params.get('server')}` : ''}.`;
  }
});
$('inviteGo').addEventListener('click', () => params.get('join') ? joinPeer(params.get('join')) : joinOnline(params.get('server') || '', params.get('room'), params.get('invite')));

async function joinPeer(code) {
  if (game.loading || game.playing) return;
  const err = msg => { $('onlineError').textContent = msg; $('onlineError').hidden = false; $('inviteBanner').querySelector('span').textContent = msg; };
  const r = new PeerHost(code);
  try {
    initAudio();
    $('peerJoin').disabled = true; $('onlineError').hidden = false; $('onlineError').textContent = 'Connecting to your friend…';
    await r.connect(playerName(), game.avatar);
    r.hold();
    const { welcome, info } = await r.join('p2p');
    $('online').hidden = true; $('onlineError').hidden = true;
    await startWorld({ id: `p2p-${welcome.seed}`, name: info.room.name, seed: welcome.seed, mode: welcome.mode }, { host: r, welcome, info });
  } catch (e) {
    r.release(); r.close();
    err(e.message || 'Could not join that world.');
  } finally { $('peerJoin').disabled = false; }
}
$('peerJoin').addEventListener('click', () => { const c = $('peerCode').value.trim(); if (c) joinPeer(c); });
$('peerCode').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('peerJoin').click(); });
$('peerCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

async function joinOnline(base, roomId, invite) {
  if (game.loading || game.playing) return;
  const err = msg => { $('onlineError').textContent = msg; $('onlineError').hidden = false; $('inviteBanner').querySelector('span').textContent = msg; };
  try {
    initAudio();
    const r = await connectRemote(base);
    r.hold();
    const { welcome, info } = await r.join(roomId, invite);
    $('online').hidden = true;
    await startWorld({ id: `mp-${base || 'here'}-${info.room.id}`, name: info.room.name, seed: welcome.seed, mode: welcome.mode }, { host: r, welcome, info });
  } catch (e) {
    remote?.release();
    err(e.message || 'Could not join that world.');
  }
}

/* ------------------------------------------------------------------ */
/* Starting, saving and quitting                                       */
/* ------------------------------------------------------------------ */
let modifiedKeys = new Set();
const pendingChunkSaves = new Map();
let saveTimer = null;
const knownRuins = new Map();

async function startWorld(meta, online = null) {
  if (game.loading || game.playing) return;
  initAudio();
  game.loading = true;
  game.name = playerName();
  local.set('cave-craft-name', game.name);
  $('menuMain').hidden = true; $('createWorld').hidden = true; $('loading').hidden = false;
  const progress = (p, t) => { $('loading').querySelector('span').style.setProperty('--p', `${Math.round(p * 100)}%`); $('loadText').textContent = t; };
  progress(0.05, 'Opening world');

  game.meta = meta; game.mode = meta.mode || 'survival'; game.online = !!online;
  player.creative = game.mode === 'creative';
  game.round = null; game.arenaHp = null; game.frozen = false; renderRound(null);
  const state = online ? (online.welcome.state || {}) : ((await storage.loadState(meta.id)) || {});
  modifiedKeys = online ? new Set(online.info.modified) : new Set(await storage.chunkKeys(meta.id));
  progress(0.15, 'Unrolling the map');
  map.clear();
  for (const [k, px] of await storage.loadMaps(meta.id)) map.setTile(k, px);

  world = new World(meta.seed, {
    onMesh: (c, data) => chunkMeshes.set(c, data),
    onUnload: c => chunkMeshes.remove(c),
    onGenerated: c => {
      world.serverEdits.delete(c.key);
      map.update(c);
      for (const v of c.meta.villages) npcs.register(v);
      for (const r of c.meta.ruins) knownRuins.set(r.id, r);
      host?.onChunk(c.meta);
    },
    hasSaved: k => modifiedKeys.has(k),
    loadSaved: k => game.online ? host.chunk(...k.split(',').map(Number)) : storage.loadChunk(meta.id, k),
    saveChunk: c => { if (!game.online) pendingChunkSaves.set(c.key, c.blocks.slice()); },
  });
  world.setRadius(settings.renderDistance);
  npcs = new Npcs(npcGame);

  // spawn point first: the local world brain needs it
  game.spawn = state.spawn || (online ? { ...online.welcome.spawn } : null);
  if (!game.spawn) { const s = world.terrain.findSpawn(); game.spawn = { x: s.x, y: null, z: s.z }; }

  let welcome;
  if (online) {
    host = online.host;
    welcome = online.welcome;
    game.room = online.info.room;
    adminView = online.info.admin;
  } else {
    host = new LocalHost(world, {
      seed: meta.seed, mode: game.mode, rules: state.rules, spawn: { x: game.spawn.x, y: game.spawn.y ?? 64, z: game.spawn.z },
      saved: state.sim || { machines: state.machines, time: state.time }, name: game.name, avatar: game.avatar,
    });
    game.room = null; adminView = null;
    // so friends joining this browser-hosted world can load the blocks that have been changed
    host.modifiedList = () => [...new Set([...modifiedKeys, ...(world ? world.allModified().map(c => c.key) : [])])];
    host.chunkProvider = async (cx, cz) => {
      const k = cx + ',' + cz, c = world?.chunks.get(k);
      if (c && c.blocks && c.modified) return c.blocks;
      if (pendingChunkSaves.has(k)) return pendingChunkSaves.get(k);
      if (modifiedKeys.has(k)) return storage.loadChunk(meta.id, k);
      return null;
    };
  }
  refreshHostUI();
  bindHost(host);
  if (!online) welcome = host.start();
  game.myId = welcome.id; game.role = welcome.role; game.rules = welcome.rules; game.worldSpawn = welcome.spawn;
  game.profile = welcome.profile || host.profile || null;
  sky.authority = false;
  sky.setEnv(welcome.time, welcome.weather);
  applySkills();

  // restore the player's own things
  npcs.load(online ? { quests: state.quests, social: state.social, discovered: state.villages } : state.npcs);
  game.waystones = state.waystones || [];
  game.day = state.day || 0;
  if (state.inv) inv.load(state.inv); else inv.clear();
  game.deathPoint = state.deathPoint || null;
  const saved = online ? (state.x !== undefined ? { x: state.x, y: state.y, z: state.z, health: state.health, hunger: state.hunger } : null) : state.player;
  if (saved) {
    Object.assign(player, { x: saved.x, y: saved.y, z: saved.z, yaw: saved.yaw || 0, pitch: 0 });
    player.health = saved.health ?? 20; player.hunger = saved.hunger ?? 20;
  } else {
    player.x = game.spawn.x; player.z = game.spawn.z;
    player.y = game.spawn.y ?? world.terrain.column(Math.floor(player.x), Math.floor(player.z)).h + 2;
    player.yaw = Math.PI * 0.75; player.needsSurface = !online;
    if (player.creative) [B.GRASS, B.STONE, B.PLANKS, B.LOG, B.CGLASS, B.BRICKS, B.CLAMP, B.TORCH, B.MOSAIC].forEach(id => inv.add(id, 64));
  }
  player.vx = player.vy = player.vz = 0;
  player.dead = false;
  sendPos();

  selfAvatar?.dispose();
  selfAvatar = new Avatar(scene, game.avatar);
  for (const p of welcome.players) addAvatar(p);
  if (online) host.release();

  // stream in the area around the player
  progress(0.2, 'Growing the world');
  await new Promise(resolve => {
    const wait = () => {
      world.update(player.x, player.z);
      const r = world.readyAround(player.x, player.z, Math.max(1, Math.min(3, settings.renderDistance - 1)));
      progress(0.2 + 0.8 * r, r < 0.5 ? 'Growing the world' : 'Lighting caves and building chunks');
      if (r >= 1 || !game.loading) resolve(); else setTimeout(wait, 50);
    };
    wait();
  });
  if (!game.loading) return; // kicked or disconnected while loading
  if (player.needsSurface) {
    // nudge the first spawn to a nearby spot under open sky (not inside a tree)
    let best = null;
    const leafy = (x, y, z) => { for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let h = 1; h <= 3; h++) if (KIND[world.get(x + a, y + h, z + b)] === 2) return true; return false; };
    for (let r = 0; r <= 24 && !best; r++) for (let dz = -r; dz <= r && !best; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = Math.floor(player.x) + dx, z = Math.floor(player.z) + dz, y = world.surfaceY(x, z);
      const below = world.get(x, y - 1, z);
      if (y > SEA && IS_SOLID[below] && KIND[below] === 1 && world.lightAt(x, y + 1, z).sky === 15 && !leafy(x, y, z)) { best = { x: x + 0.5, y, z: z + 0.5 }; break; }
    }
    if (best) Object.assign(player, best); else player.y = world.surfaceY(player.x, player.z);
    game.spawn = { x: player.x, y: player.y, z: player.z };
    if (host.local) host.sim.spawn = { ...game.spawn };
    player.needsSurface = false;
  } else if (online && !saved) player.waitGround = true;

  meta.lastPlayed = Date.now();
  if (!online) storage.putWorld(meta);
  game.loading = false; game.playing = true;
  $('menu').hidden = true; $('hud').hidden = false; $('loading').hidden = true; $('menuMain').hidden = false;
  $('tFly').hidden = !player.creative;
  ui.renderHotbar(); updateHand(); refreshQuests();
  const biome = world.biomeAt(player.x, player.z);
  ui.toast(saved ? `Welcome back to ${meta.name}.` : `${meta.name}: you wake up in the ${BIOME_NAMES[biome]}.`, 'good');
  if (!saved && !MODES[game.mode]?.desc) setTimeout(() => ui.toast(player.creative ? 'Creative: F to fly, E for every block.' : 'Punch a tree for logs, then press E to craft.'), 2600);
  if (MODES[game.mode]?.desc) ui.chat('', `${MODES[game.mode].name}: ${MODES[game.mode].desc}`, true);
  if (online) ui.chat('', `Joined ${meta.name} as ${game.name} (${ROLE_NAMES[game.role]}). Press ${keyName('chat')} to chat, ${keyName('scoreboard')} for players, ${keyName('ping')} to ping a spot.`, true);
  lock();
  clearInterval(saveTimer);
  saveTimer = setInterval(() => saveGame(), online ? 10000 : 30000);
}

function playerState() {
  return {
    inv: inv.toJSON(), health: player.health, hunger: player.hunger, waystones: game.waystones,
    quests: npcs.quests, social: npcs.social, villages: [...npcs.discovered], spawn: game.spawn,
  };
}
async function saveGame() {
  if (!game.playing || !world) return;
  const id = game.meta.id;
  await storage.saveMaps(id, map.takeDirty());
  if (game.online) { host.send({ t: 'state', state: playerState() }); return; }
  const list = [...pendingChunkSaves.entries()];
  pendingChunkSaves.clear();
  for (const c of world.allModified()) if (c.savedVersion !== c.version) { list.push([c.key, c.blocks.slice()]); c.savedVersion = c.version; modifiedKeys.add(c.key); }
  for (const [k] of list) modifiedKeys.add(k);
  await storage.saveChunks(id, list);
  await storage.saveState(id, {
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, health: player.health, hunger: player.hunger },
    inv: inv.toJSON(), npcs: npcs.toJSON(), waystones: game.waystones, day: game.day,
    spawn: game.spawn, deathPoint: game.deathPoint, rules: game.rules, sim: host.serialize(),
  });
  game.meta.lastPlayed = Date.now(); await storage.putWorld(game.meta);
}
addEventListener('beforeunload', () => { saveGame(); });
addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

async function quitToTitle(reason = null) {
  const wasOnline = game.online, h = host;
  if (h && !h.local) h.closing = true; // don't treat our own goodbye as a lost connection
  if (game.playing) await saveGame();
  game.playing = false; game.loading = false;
  clearInterval(saveTimer);
  closeAllPanels();
  if (document.pointerLockElement) document.exitPointerLock();
  views.clear(); chunkMeshes.clear();
  for (const a of avatars.values()) a.dispose(); avatars.clear();
  selfAvatar?.dispose(); selfAvatar = null;
  world?.dispose(); world = null;
  if (wasOnline && h) { h.leave(); h.close(); if (remote === h) remote = null; } else h?.close();
  host = null; adminView = null; game.round = null; renderRound(null);
  sky.authority = true;
  $('hud').hidden = true; $('menu').hidden = false; $('pause').hidden = true; $('loading').hidden = true; $('menuMain').hidden = false;
  if (reason) { $('netStatus').textContent = reason; $('netStatus').classList.add('warn'); }
  title.refresh();
}
$('quitBtn').addEventListener('click', () => quitToTitle());
$('pauseExport').addEventListener('click', async () => {
  if (game.online) { ui.toast('Online worlds live on their server, so there is nothing to export here.'); return; }
  await saveGame();
  const data = await storage.exportWorld(game.meta.id);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${game.meta.name.replace(/[^\w-]+/g, '_')}.cavecraft.json`;
  document.body.appendChild(a); a.click(); a.remove();
  ui.toast('Exporting world. If nothing downloads, this page cannot save files here: run the game locally to export.');
});

/* ------------------------------------------------------------------ */
/* Messages from the world brain                                       */
/* ------------------------------------------------------------------ */
const pendingPlace = new Map(); // "x,y,z" -> { b, t } so refused placements give the block back
let pendingMachine = null;

function applyEdit(x, y, z, b) {
  const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
  modifiedKeys.add(k);
  if (!world.set(x, y, z, b, { remote: true }) && !world.loaded(x, z)) {
    // chunk still on its way: apply when it arrives
    if (!world.serverEdits.has(k)) world.serverEdits.set(k, []);
    world.serverEdits.get(k).push([x, y, z, b]);
  }
}

function bindHost(h) {
  h.on('edits', m => { if (world) for (const [x, y, z, b] of m.list) applyEdit(x, y, z, b); });
  h.on('fix', m => {
    if (!world) return;
    world.set(m.x, m.y, m.z, m.b, { remote: true });
    const k = `${m.x},${m.y},${m.z}`, p = pendingPlace.get(k);
    if (p && p.b !== m.b && !player.creative) inv.add(p.b, 1);
    pendingPlace.delete(k);
  });
  h.on('entNew', m => views.add(m.list));
  h.on('ents', m => views.update(m.list));
  h.on('entGone', m => views.remove(m.ids));
  h.on('give', m => {
    if (player.creative) return;
    const left = inv.add(m.item, m.count, m.dur || undefined);
    if (left > 0) { host.send({ t: 'drop', item: m.item, count: left, dur: m.dur }); ui.toast('Your bag is full.', 'bad'); }
  });
  h.on('picked', m => { if (!player.creative) { sfx.pickup(); ui.toast(`+${m.count} ${itemName(m.item)}`); } });
  h.on('hurt', m => {
    if (player.dead) return;
    if (m.dmg > 0) player.damage(m.dmg, events, m.cause);
    else { ui.hurtFlash(); sfx.hurt(); }
    const dx = player.x - m.fx, dz = player.z - m.fz, d = Math.hypot(dx, dz) || 1, k = game.fx().knockback * (m.arena ? 1.6 : 1);
    player.vx += (dx / d) * 7 * k; player.vz += (dz / d) * 7 * k; player.vy = 5 * Math.max(0.5, k);
    player.peakY = null;
  });
  h.on('kill', m => npcs.onKill(m.type));
  h.on('greet', m => npcs.greet(views.get(m.id)));
  h.on('say', m => views.get(m.id)?.say(m.text, 4));
  h.on('favor', m => { npcs.addFavor(m.id, m.add); views.get(m.id)?.say('Ow! What was that for?', 3); });
  h.on('fx', m => {
    if (m.kind === 'poof') { particles.burst(m.x, m.y, m.z, m.color, 40, 5); sfx.brk(); }
    if (m.kind === 'bolt') {
      sky.flash = 1; sfx.zap();
      for (let i = 0; i < 40; i++) particles.spawn(m.x + (Math.random() - .5) * 0.6, m.y + i * 0.6, m.z + (Math.random() - .5) * 0.6, 0, 0, 0, i % 3 ? 0xfff6c8 : 0x9fe8ff, 0.4, 0);
      particles.burst(m.x, m.y, m.z, 0xffe680, 30, 6);
    }
  });
  h.on('mstate', m => {
    if (pendingMachine === m.key) { pendingMachine = null; sfx.door(); toggleInventory(true, m.m); return; }
    if (ui.open && ui.machine && `${ui.machine.x},${ui.machine.y},${ui.machine.z}` === m.key) { ui.machine = m.m; ui.renderMachine(); }
  });
  h.on('env', m => sky.setEnv(m.time, m.weather));
  h.on('waystoneGone', m => { game.waystones = game.waystones.filter(w => !(w.x === m.x && w.y === m.y && w.z === m.z)); });
  h.on('tpto', m => { teleport(m.x, m.y, m.z, false); game.frozen = !!m.freeze; });
  h.on('freeze', m => { game.frozen = !!m.on; });
  h.on('hp', m => { game.arenaHp = m.arena ? m.hp : null; if (m.arena && m.hp < 20) { ui.hurtFlash(); } renderRoundHud(); });
  h.on('round', m => { const was = arenaPlaying(); game.round = m; if (was !== arenaPlaying()) applySkills(); renderRoundHud(); });
  h.on('profile', m => {
    const before = levelFromXp(game.profile?.xp || 0).level;
    game.profile = { ...m.profile, level: levelFromXp(m.profile.xp || 0).level };
    applySkills();
    for (const e of m.events || []) {
      if (e.type === 'achievement') { ui.toast(`Achievement: ${e.name}! ${e.desc || ''}`, 'good'); sfx.magic(); }
      if (e.type === 'level') { ui.toast(`Level ${e.level}! You have a new skill point (${keyName('profile')}).`, 'good'); sfx.magic(); particles.burst(player.x, player.y + 1, player.z, 0xffd34d, 40, 4); }
    }
    if (ui.isOpen('profile')) profilePanel.render();
    if (before !== game.profile.level) updateLevelBadge();
    updateLevelBadge();
  });
  h.on('avatarOk', m => { game.avatar = m.cfg; local.set('cave-craft-avatar', game.avatar); selfAvatar?.setConfig(m.cfg); });
  h.on('join', m => { addAvatar(m); });
  h.on('leave', m => { const a = avatars.get(m.id); if (a) { a.dispose(); avatars.delete(m.id); } });
  h.on('pos', m => { const a = avatars.get(m.id); if (a) a.setTarget(m); });
  h.on('avatar', m => { const a = avatars.get(m.id); if (a) a.setConfig(m.cfg); });
  h.on('emote', m => { avatars.get(m.id)?.playEmote(m.name); });
  h.on('chat', m => {
    const roleTag = m.role === 'owner' ? '★ ' : m.role === 'mod' ? '◆ ' : '';
    const titleTag = m.title && m.title !== 'none' ? ` [${m.title}]` : '';
    ui.chat(m.whisper ? m.name : `${roleTag}${m.name}${titleTag}`, m.text);
    if (m.id !== game.myId) sfx.pickup?.();
  });
  h.on('sys', m => ui.chat('', m.text, true));
  h.on('ping', m => {
    pings.push({ x: m.x, y: m.y, z: m.z, name: m.name, t: 20 });
    if (m.id !== game.myId) ui.chat('', `${m.name} pinged a spot ${Math.round(Math.hypot(m.x - player.x, m.z - player.z))} blocks away.`, true);
    sfx.boing?.();
  });
  h.on('role', m => { game.role = m.role; ui.toast(`You are now a ${ROLE_NAMES[m.role]}.`, 'good'); if (!['owner', 'mod'].includes(m.role)) { adminView = null; if (ui.isOpen('worldAdmin')) closePanel('worldAdmin'); } });
  h.on('roleOf', m => { const a = avatars.get(m.id); if (a) a.role = m.role; if (ui.isOpen('worldAdmin')) adminPanel.render(); });
  h.on('rules', m => { game.rules = m.rules; if (adminView) adminView.rules = m.rules; if (ui.isOpen('worldAdmin')) { adminPanel.set(game.online ? adminView : localAdminView(), game.room); } });
  h.on('admin', m => { adminView = m.admin; game.room = m.room || game.room; adminPanel.set(adminView, game.room); });
  h.on('invite', m => {
    const link = adminPanel.api.roomLink(m.code);
    ui.chat('', `Invite link: ${link}`, true);
  });
  h.on('kicked', m => { quitToTitle(m.reason || 'You were removed from the world.'); });
  h.on('guests', () => refreshHostUI());
  h.on('error', m => ui.toast(m.message, 'bad'));
  h.on('left', () => {});
  h.on('disconnected', () => { if (game.playing && h === host) reconnect(); });
}

// online: try to get back into the same world after a network hiccup
let reconnecting = false;
async function reconnect() {
  if (reconnecting) return;
  reconnecting = true;
  const old = host, roomId = old.room?.id || old.joinArgs?.room, invite = old.joinArgs?.invite;
  ui.toast('Connection lost. Reconnecting…', 'bad');
  for (let i = 0; i < 5 && game.playing && host === old; i++) {
    await sleep(1000 * 2 ** i);
    try {
      const r = old.clone();
      await r.connect(game.name, game.avatar);
      r.hold();
      const { welcome, info } = await r.join(roomId, invite);
      if (!game.playing || host !== old) { r.close(); break; }
      host = r; remote = r;
      views.clear();
      for (const a of avatars.values()) a.dispose(); avatars.clear();
      bindHost(r);
      game.myId = welcome.id; game.role = welcome.role; game.rules = welcome.rules; game.room = info.room; adminView = info.admin;
      for (const p of welcome.players) addAvatar(p);
      modifiedKeys = new Set(info.modified);
      r.release();
      // catch up on blocks changed while we were away
      for (const c of world.chunks.values()) if (c.blocks && modifiedKeys.has(c.key)) refreshChunk(c);
      sendPos(); host.send({ t: 'state', state: playerState() });
      ui.toast('Reconnected.', 'good');
      reconnecting = false;
      return;
    } catch { /* try again */ }
  }
  reconnecting = false;
  if (game.playing && host === old) quitToTitle('Lost connection to the server.');
}
async function refreshChunk(c) {
  const data = await host.chunk(c.cx, c.cz);
  if (!data || !world || !c.blocks) return;
  const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
  for (let i = 0; i < data.length; i++) {
    if (c.blocks[i] === data[i]) continue;
    const lx = i % CHUNK, lz = Math.floor(i / CHUNK) % CHUNK, y = Math.floor(i / (CHUNK * CHUNK));
    world.set(ox + lx, y, oz + lz, data[i], { remote: true });
  }
}

/* ------------------------------------------------------------------ */
/* Pointer lock and panels                                             */
/* ------------------------------------------------------------------ */
const PANELS = ['inventory', 'dialogue', 'questlog', 'bigmap', 'waystone', 'emotes', 'avatarEditor', 'settingsPanel', 'pause', 'death', 'profile', 'worldAdmin'];
const CLOSABLE = ['inventory', 'dialogue', 'questlog', 'bigmap', 'waystone', 'emotes', 'profile', 'worldAdmin'];
let locked = false, fallback = isTouch;
function anyPanel() { return PANELS.some(p => ui.isOpen(p)) || ui.chatOpen(); }
function lock() {
  if (fallback || !game.playing || anyPanel()) return;
  try {
    const r = canvas.requestPointerLock?.();
    if (r && r.catch) r.catch(() => { fallback = true; });
    if (!canvas.requestPointerLock) fallback = true;
  } catch { fallback = true; }
}
function unlockForPanel() { if (document.pointerLockElement) document.exitPointerLock(); mining = false; }
function afterPanelClosed() { if (!anyPanel()) lock(); }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) mining = false;
  if (!locked && !fallback && game.playing && !anyPanel() && !player.dead) ui.showPanel('pause');
});
document.addEventListener('pointerlockerror', () => { fallback = true; });
$('resumeBtn').addEventListener('click', () => { ui.hidePanel('pause'); lock(); });
function closePanel(name) {
  if (name === 'inventory') return toggleInventory(false);
  if (name === 'dialogue') return npcs?.close();
  ui.hidePanel(name);
  if (!game.playing) return;
  if (name === 'avatarEditor' || name === 'settingsPanel') { if (!ui.isOpen('pause')) afterPanelClosed(); return; }
  afterPanelClosed();
}
function closeAllPanels() { for (const p of PANELS) ui.hidePanel(p); if (ui.open) toggleInventory(false); ui.setOpen(false); }
function openPanel(name) { if (!game.playing || player.dead) return; ui.showPanel(name); unlockForPanel(); }
function inputBlocked() { return !game.playing || anyPanel() || player.dead || (!locked && !fallback); }

function toggleInventory(v = !ui.open, machine = null) {
  if (!game.playing || (player.dead && v)) return;
  if (!v && ui.machine) host?.send({ t: 'mclose' });
  ui.setOpen(v, machine);
  if (v) unlockForPanel(); else afterPanelClosed();
}

/* ------------------------------------------------------------------ */
/* Keyboard & mouse                                                    */
/* ------------------------------------------------------------------ */
const held = {};
let mining = false, lastJump = 0;
const keyName = a => (settings.keys[a] || '').replace(/^Key/, '');

addEventListener('keydown', e => {
  if (ui.chatOpen() || (e.target && e.target.tagName === 'INPUT')) return;
  const a = actionFor(e.code);
  if (a) held[a] = true;
  if (!game.playing) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
  if (e.code === 'Escape') {
    for (const p of CLOSABLE) if (ui.isOpen(p)) { closePanel(p); return; }
    if (fallback && !anyPanel() && !player.dead) openPanel('pause');
    return;
  }
  if (a === 'scoreboard') { $('scoreboard').classList.add('show'); renderScoreboard(); return; }
  if (a === 'inventory') { if (!ui.isOpen('dialogue')) toggleInventory(); return; }
  if (a === 'map') { if (ui.isOpen('bigmap')) closePanel('bigmap'); else if (!anyPanel()) openMap(); return; }
  if (a === 'quests') { if (ui.isOpen('questlog')) closePanel('questlog'); else if (!anyPanel()) { ui.renderQuests(npcs); openPanel('questlog'); } return; }
  if (a === 'emote') { if (ui.isOpen('emotes')) closePanel('emotes'); else if (!anyPanel()) openPanel('emotes'); return; }
  if (a === 'profile') { if (ui.isOpen('profile')) closePanel('profile'); else if (!anyPanel()) openProfile(); return; }
  if (a === 'worldsettings') { if (ui.isOpen('worldAdmin')) closePanel('worldAdmin'); else if (!anyPanel()) openWorldSettings(); return; }
  if (anyPanel()) return;
  if (a === 'chat' || e.code === 'Enter' || e.code === 'Slash') { e.preventDefault(); unlockForPanel(); ui.openChat(); if (e.code === 'Slash') ui.chatInput.value = '/'; return; }
  if (/^Digit[1-9]$/.test(e.code)) game.select(+e.code.slice(5) - 1);
  if (a === 'mute') ui.toast(toggleMute() ? 'Sound off' : 'Sound on');
  if (a === 'camera') { game.camMode = (game.camMode + 1) % 3; document.body.classList.toggle('third', game.camMode > 0); }
  if (a === 'fly' && player.creative) toggleFly();
  if (a === 'jump' && player.creative && !e.repeat) { const now = performance.now(); if (now - lastJump < 280) toggleFly(); lastJump = now; }
  if (a === 'drop' && !e.repeat) dropHeld(e.ctrlKey);
  if (a === 'ping' && !e.repeat) pingSpot();
});
addEventListener('keyup', e => {
  const a = actionFor(e.code);
  if (a) held[a] = false;
  if (a === 'scoreboard') $('scoreboard').classList.remove('show');
});
addEventListener('blur', () => { for (const k in held) held[k] = false; mining = false; $('scoreboard').classList.remove('show'); });
addEventListener('wheel', e => { if (game.playing && !anyPanel()) game.select(game.sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function toggleFly() { player.flying = !player.flying; player.vy = 0; ui.toast(player.flying ? 'Flying' : 'Walking'); }

function look(dx, dy, k) {
  const s = k * settings.sensitivity;
  player.yaw -= dx * s; player.pitch -= dy * s * (settings.invertY ? -1 : 1);
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
}
let drag = null;
canvas.addEventListener('mousedown', e => {
  if (!game.playing || anyPanel() || player.dead) return;
  if (!locked && !fallback) { lock(); return; }
  if (fallback) { drag = { x: e.clientX, y: e.clientY, moved: 0, btn: e.button }; if (e.button === 0) mining = true; return; }
  if (e.button === 0) { mining = true; attack(); }
  if (e.button === 2) useItem();
});
addEventListener('mousemove', e => {
  if (locked) { if (Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) look(e.movementX, e.movementY, 0.0023); }
  else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.moved > 6) mining = false;
    look(dx, dy, 0.005);
  }
});
addEventListener('mouseup', e => {
  if (e.button === 0) mining = false;
  if (drag && drag.moved < 6) { if (drag.btn === 0) attack(); else if (drag.btn === 2) useItem(); }
  drag = null;
});

// touch controls
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let lookT = null, placeMode = false;
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (!game.playing || anyPanel()) return;
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && stick.id === null) Object.assign(stick, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
    else if (!lookT) { lookT = { id: t.identifier, x: t.clientX, y: t.clientY, moved: 0, at: performance.now() }; if (!placeMode) mining = true; }
  }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) {
      let dx = t.clientX - stick.ox, dy = t.clientY - stick.oy;
      const m = Math.hypot(dx, dy); if (m > 55) { dx *= 55 / m; dy *= 55 / m; }
      stick.x = dx / 55; stick.y = dy / 55;
      $('stickKnob').style.transform = `translate(${dx * 0.7}px, ${dy * 0.7}px)`;
    } else if (lookT && t.identifier === lookT.id) {
      const dx = t.clientX - lookT.x, dy = t.clientY - lookT.y;
      lookT.moved += Math.abs(dx) + Math.abs(dy); lookT.x = t.clientX; lookT.y = t.clientY;
      if (lookT.moved > 10) mining = false;
      look(dx, dy, 0.006);
    }
  }
}, { passive: false });
function endTouch(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) { stick.id = null; stick.x = stick.y = 0; $('stickKnob').style.transform = ''; }
    else if (lookT && t.identifier === lookT.id) {
      if (lookT.moved < 10 && performance.now() - lookT.at < 300) { if (placeMode) useItem(); else attack(); }
      lookT = null; mining = false;
    }
  }
}
canvas.addEventListener('touchend', endTouch); canvas.addEventListener('touchcancel', endTouch);
const touchBtn = (id, down, up) => {
  $(id).addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
  if (up) $(id).addEventListener('touchend', e => { e.preventDefault(); up(); });
  $(id).addEventListener('click', () => { if (!isTouch) down(); });
};
touchBtn('tJump', () => { held.jump = true; }, () => { held.jump = false; });
touchBtn('tMode', () => { placeMode = !placeMode; $('tMode').textContent = placeMode ? 'Place' : 'Break'; $('tMode').classList.toggle('place', placeMode); });
touchBtn('tUse', () => useItem());
touchBtn('tInv', () => toggleInventory());
touchBtn('tMap', () => openMap());
touchBtn('tQuest', () => { ui.renderQuests(npcs); openPanel('questlog'); });
touchBtn('tEmote', () => openPanel('emotes'));
touchBtn('tCam', () => { game.camMode = (game.camMode + 1) % 3; });
touchBtn('tFly', () => toggleFly());
touchBtn('tPause', () => openPanel('pause'));
touchBtn('tScore', () => { $('scoreboard').classList.toggle('show'); renderScoreboard(); });

/* ------------------------------------------------------------------ */
/* Chat and commands                                                   */
/* ------------------------------------------------------------------ */
function resumeAfterChat() { afterPanelClosed(); }
function sendChat(text) {
  const [cmd] = text.slice(1).toLowerCase().split(/\s+/);
  const say = t => ui.chat('', t, true);
  if (text.startsWith('/')) {
    if (cmd === 'seed') return say(`World seed: ${world.seed}`);
    if (cmd === 'home') { host.send({ t: 'tp' }); teleport(game.spawn.x, game.spawn.y ?? 80, game.spawn.z); return say('Back at your spawn point.'); }
    if (cmd === 'spawnpoint') { game.spawn = { x: player.x, y: player.y, z: player.z }; return say('Spawn point set here.'); }
  }
  host?.send({ t: 'chat', text });
}

/* ------------------------------------------------------------------ */
/* Mining, building and dropping                                       */
/* ------------------------------------------------------------------ */
function heldStack() { return inv.slots[game.sel]; }
function heldTool() { const s = heldStack(); return s && ITEMS[s.id]?.tool ? ITEMS[s.id].tool : null; }
function breakTime(id) {
  const d = BLOCKS[id];
  if (d.hard < 0) return Infinity;
  if (player.creative) return 0;
  if (d.hard === 0) return 0.05;
  const tool = heldTool();
  let t = d.hard;
  if (tool && d.tool === tool.type && tool.tier >= d.minTier) t /= tool.speed;
  else if (d.needsTool) t *= 1.6;
  if (player.inWater && !player.perks.tide) t *= 2.5;
  if (!player.ground && !player.inWater && !player.flying) t *= 2;
  return t * 0.5 / game.fx().digSpeed;
}
function mayBuildHere(x, z) {
  if (!game.online || canBuild(game.role, game.rules, x, z, game.worldSpawn)) return true;
  ui.toast(game.rules.visitorsBuild ? 'The area around spawn is protected. Build a little further out!' : 'Visitors can\'t build in this world. Ask the owner to make you a builder.', 'bad');
  return false;
}
function breakBlock(hit) {
  const { x, y, z, id } = hit;
  if (y <= 0 || BLOCKS[id].hard < 0) return;
  if (!mayBuildHere(x, z)) return;
  const s = heldStack();
  // online the block disappears right away; the world brain confirms (or puts it back)
  if (game.online) world.set(x, y, z, WATERY[id] ? B.WATER : B.AIR, { remote: true });
  host.send({ t: 'dig', x, y, z, tool: s && ITEMS[s.id]?.tool ? s.id : null });
  particles.burst(x + 0.5, y + 0.5, z + 0.5, BLOCKS[id].color, Math.round(22 * settings.particles) + 2, 4);
  sfx.brk();
  if (!player.creative && heldTool() && inv.wear(game.sel)) ui.toast('Your tool broke!', 'bad');
}

function placeBlock(x, y, z, b) {
  if (!mayBuildHere(x, z)) return false;
  const here = world.get(x, y, z);
  if (here !== B.AIR && KIND[here] !== 3 && KIND[here] !== 4 && !WATERY[here] && !LIQ_TYPE[here]) return false;
  if (game.online) world.set(x, y, z, b, { remote: true });
  pendingPlace.set(`${x},${y},${z}`, { b, t: performance.now() });
  host.send({ t: 'place', x, y, z, b });
  return true;
}

function dropHeld(all) {
  const s = heldStack();
  if (!s || player.dead) return;
  const n = all ? s.count : 1;
  host.send({ t: 'drop', item: s.id, count: n, dur: s.dur });
  if (all) { inv.slots[game.sel] = null; inv.onChange(); } else inv.takeOne(game.sel);
}

const pings = [];
function pingSpot() {
  const eye = new THREE.Vector3(player.x, player.y + player.eye, player.z), dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const hit = raycastBlock(world, eye, dir, 96);
  const p = hit ? { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 } : { x: eye.x + dir.x * 30, y: eye.y + dir.y * 30, z: eye.z + dir.z * 30 };
  host.send({ t: 'ping', ...p });
}

function quickMoveToMachine(m, s, clear) {
  const key = `${m.x},${m.y},${m.z}`;
  if (m.type === 'chest') {
    const max = ITEMS[s.id]?.stack || 64;
    for (let pass = 0; pass < 2 && s.count > 0; pass++) for (let i = 0; i < 27 && s.count > 0; i++) {
      const c = m.slots[i];
      if (pass === 0 && c && c.id === s.id && c.count < max) { const n = Math.min(max - c.count, s.count); c.count += n; s.count -= n; game.machineSet(key, { slot: i, stack: c }); }
      else if (pass === 1 && !c) { m.slots[i] = { ...s }; s.count = 0; game.machineSet(key, { slot: i, stack: m.slots[i] }); }
    }
    if (!s.count) clear();
    return;
  }
  const field = m.type === 'smelter' && SMELT.has(s.id) ? 'input' : FUEL.has(s.id) ? 'fuel' : null;
  if (!field) return;
  const cur = m[field];
  if (!cur) { m[field] = { ...s }; clear(); }
  else if (cur.id === s.id) { const room = (ITEMS[s.id]?.stack || 64) - cur.count; const n = Math.min(room, s.count); cur.count += n; s.count -= n; if (!s.count) clear(); }
  else return;
  game.machineSet(key, { field, stack: m[field] });
}

/* ------------------------------------------------------------------ */
/* Using things: blocks, machines, villagers, food and magic           */
/* ------------------------------------------------------------------ */
let magicCool = 0;
function useItem() {
  if (target.npc) { npcs.open(target.npc); return; }
  const hit = target.block;
  if (hit && !held.sprint) {
    const def = BLOCKS[hit.id];
    if (def.machine === 'waystone') return openWaystone(hit.x, hit.y, hit.z);
    if (def.machine) {
      if (game.role === 'visitor' && game.rules.visitorsMachines === false) { ui.toast('The owner hasn\'t let visitors use machines here.', 'bad'); return; }
      pendingMachine = `${hit.x},${hit.y},${hit.z}`;
      host.send({ t: 'mopen', x: hit.x, y: hit.y, z: hit.z });
      return;
    }
    if (hit.id === B.WORKBENCH) return toggleInventory(true);
  }
  const s = heldStack();
  if (!s) return;
  const it = ITEMS[s.id];
  if (it.food) {
    if (player.creative) return;
    if (player.eat(it.food)) { inv.takeOne(game.sel); sfx.eat(); ui.toast(`Ate ${it.name}`); } else ui.toast('Not hungry right now');
    return;
  }
  if (it.use) return useMagic(it, s);
  if (!it.block || !hit) return;
  let { px: x, py: y, pz: z } = hit;
  if (KIND[hit.id] === 4 && hit.id !== B.GLOW_ORB) { x = hit.x; y = hit.y; z = hit.z; }
  if (y < 1 || y >= WH - 2) return;
  const def = BLOCKS[it.block];
  if (def.solid && overlapsBox(player, x, y, z)) return;
  if (def.solid) for (const a of avatars.values()) if (a.cur && overlapsBox({ x: a.cur.x, y: a.cur.y, z: a.cur.z, w: 0.3, h: 1.8 }, x, y, z)) return;
  if (def.kind === 'cross' && !def.wet && it.block !== B.GLOW_ORB && it.block !== B.GLOW_VINE && !world.solidAt(x, y - 1, z)) return;
  if (placeBlock(x, y, z, it.block)) {
    sfx.place();
    if (!player.creative) inv.takeOne(game.sel);
    if (it.block === B.WAYSTONE) registerWaystone(x, y, z, true);
  }
}

function useMagic(it) {
  if (magicCool > 0) return;
  const eye = camera.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const wear = () => { if (!player.creative && it.durability && inv.wear(game.sel)) ui.toast(`Your ${it.name} crumbled to dust.`, 'bad'); };
  if (it.use === 'orb') {
    const hit = raycastBlock(world, eye, dir, 6);
    const p = hit ? [hit.px, hit.py, hit.pz] : [Math.floor(eye.x + dir.x * 3), Math.floor(eye.y + dir.y * 3), Math.floor(eye.z + dir.z * 3)];
    if (world.get(...p) !== 0) return;
    if (!placeBlock(p[0], p[1], p[2], B.GLOW_ORB)) return;
    pendingPlace.delete(p.join(',')); // magic, not from the bag
    sfx.magic(); particles.burst(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 0xc8f8ff, 16, 2); wear(); magicCool = 0.3;
  } else if (it.use === 'blink') {
    let best = null;
    for (let d = 1; d <= 8; d += 0.5) {
      const x = player.x + dir.x * d, y = player.y + Math.max(0, dir.y) * d, z = player.z + dir.z * d;
      if (world.solidAt(Math.floor(x), Math.floor(y), Math.floor(z)) || world.solidAt(Math.floor(x), Math.floor(y + 1), Math.floor(z))) break;
      best = { x, y, z };
    }
    if (!best) return ui.toast('No room to blink there.');
    host.send({ t: 'tp', short: true });
    particles.burst(player.x, player.y + 1, player.z, 0x5ae0ff, 20, 3);
    player.x = best.x; player.y = best.y; player.z = best.z; player.vy = 0; player.peakY = null;
    particles.burst(player.x, player.y + 1, player.z, 0xffffff, 20, 3);
    sfx.blink(); wear(); magicCool = 0.8;
  } else if (it.use === 'storm') {
    const hit = raycastBlock(world, eye, dir, 32);
    const c = views.raycast(eye, dir, hit ? hit.dist : 32);
    const pt = c ? { x: c.view.x, y: c.view.y, z: c.view.z } : hit ? { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 } : null;
    if (!pt) return ui.toast('Aim at the ground or a creature.');
    host.send({ t: 'storm', ...pt });
    wear(); magicCool = 2;
  } else if (it.use === 'home') {
    particles.burst(player.x, player.y + 1, player.z, 0xffd34d, 30, 3);
    host.send({ t: 'tp' });
    teleport(game.spawn.x, game.spawn.y ?? 80, game.spawn.z);
    sfx.blink(); magicCool = 20;
    ui.toast('Home sweet home.');
  }
}

function teleport(x, y, z, tell = true) {
  if (tell && host) host.send({ t: 'tp' });
  player.x = x; player.y = y; player.z = z; player.vx = player.vy = player.vz = 0; player.peakY = null;
  player.waitGround = true; // hover until the chunks underneath arrive
}

/* ---------------- waystones ---------------- */
function registerWaystone(x, y, z, placed = false) {
  const id = `${x},${y},${z}`;
  let w = game.waystones.find(w => w.id === id);
  if (!w) {
    const n = game.waystones.length + 1;
    const ruin = [...knownRuins.values()].find(r => r.x === x && r.z === z);
    const biome = BIOME_NAMES[world.biomeAt(x, z)];
    w = { id, x, y, z, name: placed ? `My waystone ${n}` : ruin ? `Old stone of the ${biome}` : `Waystone ${n}` };
    game.waystones.push(w);
    ui.toast(`Waystone attuned: ${w.name}`, 'good');
    sfx.magic();
    host?.send({ t: 'progress', stat: 'waystones', value: game.waystones.length });
  }
  return w;
}
function openWaystone(x, y, z) {
  const w = registerWaystone(x, y, z);
  ui.renderWaystone(w, game.waystones, name => { w.name = name; }, dest => {
    if (game.round?.you?.playing && game.round.phase === 'active') { ui.toast('Not during a round!', 'bad'); return; }
    closePanel('waystone');
    particles.burst(player.x, player.y + 1, player.z, 0x8cfff0, 30, 3);
    teleport(dest.x + 0.5, dest.y + 1, dest.z + 0.5);
    sfx.blink();
    ui.toast(`Travelled to ${dest.name}`);
  });
  openPanel('waystone');
}

/* ---------------- combat ---------------- */
let attackCool = 0;
function attack() {
  if (attackCool > 0) return;
  const tool = heldTool();
  if (target.npc) { attackCool = 0.5; host.send({ t: 'hit', id: target.npc.id }); sfx.hit(); return; }
  if (target.other) {
    attackCool = 0.45;
    const canFight = game.rules.pvp || (game.round?.mode === 'arena' && game.round.phase === 'active');
    if (!canFight) { ui.toast('Player fighting is off in this world.'); return; }
    host.send({ t: 'pvp', target: target.other.id, dmg: tool ? tool.damage : 1 });
    particles.burst(target.other.a.cur.x, target.other.a.cur.y + 1.2, target.other.a.cur.z, 0xffffff, 8, 3);
    sfx.hit();
    return;
  }
  const v = target.creature;
  if (!v) return;
  attackCool = 0.35;
  const crit = !player.ground && player.vy < -1;
  host.send({ t: 'hit', id: v.id, dmg: tool ? tool.damage : 1, crit });
  if (crit) particles.burst(v.x, v.y + 1, v.z, 0xffffff, 8, 3);
  particles.burst(v.x, v.y + (v.T?.h || 1) * 0.6, v.z, 0xff4a4a, 10, 3);
  sfx.hit();
  if (tool && !player.creative && inv.wear(game.sel)) ui.toast('Your weapon broke!', 'bad');
}

function onCraft(id) {
  if (BLOCKS[id]?.machine || id === B.WORKBENCH) host?.send({ t: 'progress', stat: 'machines' });
  if (ITEMS[id]?.use || ITEMS[id]?.cat === 'Magic') host?.send({ t: 'progress', stat: 'artifacts' });
}

function emote(name) {
  selfAvatar?.playEmote(name);
  host?.send({ t: 'emote', name });
  if (game.camMode === 0 && name !== 'sit') { game.camMode = 2; clearTimeout(emote.t); emote.t = setTimeout(() => { if (game.camMode === 2) game.camMode = 0; }, 2600); }
}
$('emotes').addEventListener('contextmenu', e => e.preventDefault());

function nearBench() {
  const px = Math.floor(player.x), py = Math.floor(player.y), pz = Math.floor(player.z);
  for (let y = py - 2; y <= py + 3; y++) for (let z = pz - 4; z <= pz + 4; z++) for (let x = px - 4; x <= px + 4; x++)
    if (world.get(x, y, z) === B.WORKBENCH) return true;
  return false;
}

const events = {
  hurt() { ui.hurtFlash(); sfx.hurt(); },
  died(cause) {
    sfx.die();
    game.deathPoint = { x: player.x, z: player.z };
    const keep = game.rules.keepInventory !== false || player.creative;
    host.send({ t: 'died', cause, items: keep ? null : inv.toJSON().filter(Boolean) });
    if (!keep) inv.clear();
    $('deathCause').textContent = `${game.name} ${cause}. ${keep ? 'Your bag is safe.' : 'Your things were dropped where you fell.'}`;
    closeAllPanels();
    ui.showPanel('death');
    unlockForPanel();
  },
};
$('respawnBtn').addEventListener('click', () => {
  player.reset();
  applySkills(); player.health = player.fx.maxHealth;
  teleport(game.spawn.x, game.spawn.y ?? 80, game.spawn.z);
  host.send({ t: 'respawn' });
  ui.hidePanel('death');
  lock();
});

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */
const mapView = { x: 0, z: 0, scale: 2 };
function openMap() {
  if (!game.playing) return;
  mapView.x = player.x; mapView.z = player.z;
  openPanel('bigmap');
  const c = $('mapCanvas');
  c.width = innerWidth * Math.min(2, devicePixelRatio || 1); c.height = innerHeight * Math.min(2, devicePixelRatio || 1);
}
$('mapCenter').addEventListener('click', () => { mapView.x = player.x; mapView.z = player.z; });
{
  const c = $('mapCanvas');
  let dragM = null;
  const pts = new Map();
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); dragM = { x: e.clientX, y: e.clientY, d: null }; });
  c.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (dragM.d) mapView.scale = Math.max(0.25, Math.min(8, mapView.scale * d / dragM.d));
      dragM.d = d;
      return;
    }
    mapView.x -= (e.clientX - prev[0]) / mapView.scale; mapView.z -= (e.clientY - prev[1]) / mapView.scale;
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2 && dragM) dragM.d = null; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', e => { e.preventDefault(); mapView.scale = Math.max(0.25, Math.min(8, mapView.scale * (e.deltaY > 0 ? 0.85 : 1.18))); }, { passive: false });
}
function mapMarkers() {
  const m = [];
  if (game.spawn) m.push({ x: game.spawn.x, z: game.spawn.z, kind: 'spawn', label: 'Spawn' });
  if (game.deathPoint) m.push({ x: game.deathPoint.x, z: game.deathPoint.z, kind: 'death', label: 'Knocked out here' });
  for (const v of npcs.villages.values()) if (npcs.discovered.has(v.id)) m.push({ x: v.x, z: v.z, kind: 'village', label: v.name });
  for (const w of game.waystones) m.push({ x: w.x, z: w.z, kind: 'waystone', label: w.name, active: true });
  for (const q of npcs.quests) {
    if (q.hint && q.status === 'active') m.push({ x: q.hint.x, z: q.hint.z, kind: 'quest', label: q.title });
    else m.push({ x: q.vx, z: q.vz + 3, kind: 'quest', label: q.status === 'ready' ? `Report to ${q.giverName}` : '' });
  }
  for (const p of pings) m.push({ x: p.x, z: p.z, kind: 'ping', label: `${p.name}'s ping` });
  const next = game.round?.you?.next;
  if (next && game.round.phase === 'active') m.push({ x: next.x, z: next.z, kind: 'goal', label: 'Next beacon' });
  for (const a of avatars.values()) if (a.cur) m.push({ x: a.cur.x, z: a.cur.z, kind: 'other', yaw: a.cur.yaw, label: a.name });
  m.push({ x: player.x, z: player.z, kind: 'player', yaw: player.yaw, label: 'You' });
  return m;
}
const mini = $('minimap').getContext('2d');
function drawMinimap() {
  const view = map.draw(mini, 160, 160, player.x, player.z, 1.1);
  drawMarkers(mini, view, mapMarkers().filter(m => Math.abs(m.x - player.x) < 80 && Math.abs(m.z - player.z) < 80), true);
  mini.fillStyle = '#fff'; mini.font = 'bold 11px sans-serif'; mini.textAlign = 'center'; mini.fillText('N', 80, 12);
}
function drawBigMap() {
  const c = $('mapCanvas'), g = c.getContext('2d');
  const k = c.width / innerWidth;
  const view = map.draw(g, c.width, c.height, mapView.x, mapView.z, mapView.scale * k);
  g.save(); g.scale(k, k);
  const v2 = { toScreen: (x, z) => view.toScreen(x, z).map(n => n / k) };
  drawMarkers(g, v2, mapMarkers());
  g.restore();
  $('mapHint').textContent = `${BIOME_NAMES[currentBiome]} · ${Math.floor(player.x)}, ${Math.floor(player.z)} · Waystones let you travel between places you've attuned.`;
}

/* ------------------------------------------------------------------ */
/* Other players, rounds and the scoreboard                            */
/* ------------------------------------------------------------------ */
function addAvatar(p) {
  if (avatars.has(p.id) || p.id === game.myId) return;
  const a = new Avatar(scene, p.avatar || defaultAvatar(), p.name, p.level || 1);
  a.role = p.role || 'visitor';
  if (p.x !== undefined) a.setTarget({ x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, pitch: p.pitch || 0 });
  avatars.set(p.id, a);
}
function renderRoundHud() {
  const r = game.round;
  let dist = null, dir = '';
  const next = r?.you?.next;
  if (next) {
    dist = Math.round(Math.hypot(next.x - player.x, next.z - player.z));
    const ang = Math.atan2(-(next.x - player.x), -(next.z - player.z)) - player.yaw;
    const a = ((ang % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    dir = Math.abs(a) < 0.4 ? 'ahead' : Math.abs(a) > 2.7 ? 'behind you' : a > 0 ? 'to your left' : 'to your right';
  }
  renderRound(r, { dist, dir, atlas, arenaHp: game.arenaHp });
  if (!r) renderScoreboard();
}
function renderScoreboard() {
  if (game.round) return renderRoundHud();
  const rows = [{ name: game.name, role: game.role, level: game.profile?.level || levelFromXp(game.profile?.xp || 0).level, me: true },
    ...[...avatars.values()].map(a => ({ name: a.name, role: a.role, level: a.level }))];
  $('scoreboard').innerHTML = `<h4>${game.online ? esc(game.room?.name || 'Online') : 'Single-player'} · ${rows.length} here</h4>` +
    rows.map(r => `<div class="srow"><span>${r.me ? '<b>' : ''}${esc(r.name)}${r.me ? '</b>' : ''} <small>${ROLE_NAMES[r.role] || ''}</small></span><span>Lv ${r.level || 1}</span></div>`).join('');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function updateLevelBadge() {
  const L = levelFromXp(game.profile?.xp || 0);
  $('lvl').innerHTML = `<b>${L.level}</b><span style="width:${Math.round(L.into / L.need * 100)}%"></span>`;
  $('lvl').title = `Level ${L.level}: ${Math.floor(L.into)}/${L.need} XP`;
}

/* ------------------------------------------------------------------ */
/* Frame loop                                                          */
/* ------------------------------------------------------------------ */
const ctx = {
  currentBiome: 0,
  lightFn: (x, y, z) => {
    const l = world.lightAt(x, y, z);
    return Math.max(0.1 + player.fx.nightSight, CURVE(l.sky) * (0.22 + 0.78 * sky.daylight), CURVE(l.blk));
  },
};

const target = { block: null, creature: null, npc: null, other: null };
let breakProg = 0, breakKey = '', digT = 0, last = performance.now(), slowT = 0, fastT = 0, fps = 60;
let hudT = 0, miniT = 0, mapT = 0, posT = 0, wasInWater = false, swing = 0, currentBiome = 0, lastTime = sky.time, trailT = 0;
const dir = new THREE.Vector3();

function refreshQuests() { if (npcs) { ui.questTracker(npcs.quests, q => npcs.progressText(q)); if (ui.isOpen('questlog')) ui.renderQuests(npcs); } }
function sendPos() { host?.send({ t: 'pos', x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3) }); }

function updateHand() {
  const s = inv.slots[game.sel];
  hand.visible = false; handSprite.visible = false;
  if (!s) return;
  const it = ITEMS[s.id];
  if (it.block && BLOCKS[it.block].kind !== 'cross') { hand.material = blockMatFor(it.block); hand.visible = true; }
  else {
    const img = new Image();
    img.onload = () => { const t = new THREE.Texture(img); t.magFilter = THREE.NearestFilter; t.needsUpdate = true; handSprite.material.map?.dispose(); handSprite.material.map = t; handSprite.material.needsUpdate = true; };
    img.src = itemIcon(s.id, atlas);
    handSprite.visible = true;
  }
}
const handMats = new Map();
function blockMatFor(id) {
  if (handMats.has(id)) return handMats.get(id);
  const ms = [1, 1, 0, 2, 1, 1].map(side => {
    const t = BLOCKS[id].tex[side];
    const c = document.createElement('canvas'); c.width = c.height = 16;
    c.getContext('2d').drawImage(atlas, (t % 16) * 16, Math.floor(t / 16) * 16, 16, 16, 0, 0, 16, 16);
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
    return new THREE.MeshBasicMaterial({ map: tex });
  });
  handMats.set(id, ms);
  return ms;
}

// cosmetic trails behind moving players
function trail(cfg, x, y, z, speed) {
  if (!cfg || !cfg.trail || cfg.trail === 'none' || speed < 1) return;
  const cols = TRAIL_COLORS[cfg.trail]; if (!cols) return;
  particles.spawn(x + (Math.random() - 0.5) * 0.5, y + 0.1 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.5,
    0, 0.6 + Math.random() * 0.5, 0, cols[Math.random() < 0.5 ? 0 : 1], 0.8, cfg.trail === 'embers' ? -1 : 1);
}

function raycastPlayers(o, d, max) {
  let best = null, bd = max;
  for (const [id, a] of avatars) {
    const c = a.cur; if (!c) continue;
    const t = rayBox(o, d, [c.x - 0.35, c.y, c.z - 0.35], [c.x + 0.35, c.y + 1.85, c.z + 0.35]);
    if (t >= 0 && t < bd) { bd = t; best = { id, a, dist: t }; }
  }
  return best;
}

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min((now - last) / 1000, 0.25), dt = Math.min(realDt, 0.05); last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;
  if (!game.playing) {
    renderer.setClearColor(0x0e0c16); renderer.clear();
    if (game.loading && world) { world.update(player.x, player.z); host?.tick(dt); }
    return;
  }

  // automatic resolution to keep the game smooth
  if (settings.autoPerf) {
    if (fps < 34) { slowT += dt; fastT = 0; } else if (fps > 57) { fastT += dt; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT > 3 && autoScale > 0.55) { autoScale -= 0.1; slowT = 0; resize(); }
    if (fastT > 10 && autoScale < 1) { autoScale = Math.min(1, autoScale + 0.1); fastT = 0; resize(); }
  }

  // which perks the carried artifacts give
  player.perks = { feather: inv.has(I.FEATHER_CLOAK), tide: inv.has(I.TIDE_AMULET), ember: inv.has(I.EMBER_HEART) };

  // movement
  const blocked = inputBlocked();
  const input = blocked || game.frozen ? { fwd: 0, strafe: 0, jump: false, sprint: false, down: false } : {
    fwd: (held.forward || keys.ArrowUp ? 1 : 0) - (held.back || keys.ArrowDown ? 1 : 0) - stick.y,
    strafe: (held.right ? 1 : 0) - (held.left ? 1 : 0) + stick.x,
    jump: !!held.jump, sprint: !!held.sprint || Math.hypot(stick.x, stick.y) > 0.95, down: !!held.down,
  };
  const groundReady = world.loaded(player.x, player.z) && world.chunkAt(Math.floor(player.x), Math.floor(player.z))?.meshed >= 0;
  if (player.waitGround) {
    if (groundReady) {
      player.waitGround = false;
      const g = world.groundBelow(Math.floor(player.x), player.y + 1, Math.floor(player.z));
      if (g === null || world.solidAt(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z))) player.y = world.surfaceY(player.x, player.z);
    }
  } else if (groundReady) player.update(dt, input, world, events);
  if (player.inWater && !wasInWater && Math.abs(player.vy) > 2) sfx.splash();
  wasInWater = player.inWater;
  if (player.ground && player.onBlock === B.JUMP_PAD && !player.flying) {
    player.vy = 17; player.peakY = null; player.ground = false; sfx.boing();
    particles.burst(player.x, player.y, player.z, 0x78ff9c, 14, 3);
    player.padded = true;
  }
  if (player.padded && player.ground) { player.padded = false; player.peakY = null; }

  // time and days
  if (sky.time < lastTime - 0.5) game.day++;
  lastTime = sky.time;

  // camera
  camera.getWorldDirection(dir);
  const bobOn = settings.viewBob && player.ground && !player.flying;
  const bob = bobOn ? Math.sin(now / 110) * Math.min(1, Math.hypot(player.vx, player.vz) / 4) * 0.04 : 0;
  const eye = new THREE.Vector3(player.x, player.y + player.eye + bob, player.z);
  let thirdBlocked = false;
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (game.camMode === 0) camera.position.copy(eye);
  else {
    const fwd = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
    const back = game.camMode === 1 ? fwd.clone().negate() : fwd.clone();
    const hit = raycastBlock(world, eye, back, 4.5);
    const d = hit ? hit.dist - 0.3 : 4.5;
    // too cramped to see yourself: fall back to the eye for this frame
    if (d < 1.4) { camera.position.copy(eye); thirdBlocked = true; }
    else {
      camera.position.copy(eye).addScaledVector(back, d);
      if (game.camMode === 2) camera.rotation.set(-player.pitch, player.yaw + Math.PI, 0);
    }
  }
  camera.updateMatrixWorld();
  camera.getWorldDirection(dir);
  // aim always from the eye in first person, from the camera in third person
  const firstPerson = game.camMode === 0 || thirdBlocked;
  const aimFrom = firstPerson ? eye : camera.position;
  const aimDir = game.camMode === 2 && !thirdBlocked ? new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch)) : dir;

  // biome (glowing caverns count when you are down in them)
  const col = world.terrain.column(Math.floor(player.x), Math.floor(player.z));
  const headLight = world.lightAt(player.x, player.y + 1.5, player.z);
  currentBiome = player.y < Math.min(50, col.h - 6) && headLight.sky < 6 && col.lumen > 0.2 && !player.headInWater ? BIOME.LUMEN : world.biomeAt(player.x, player.z);
  ctx.currentBiome = currentBiome;

  // tell the world brain where we are, then let it think (single-player runs it here)
  posT -= dt;
  if (posT <= 0) { posT = game.online ? 0.1 : 0.05; sendPos(); }
  // the world keeps real time even when frames are slow
  for (let left = realDt; left > 1e-4 && host; left -= 0.05) host.tick(Math.min(0.05, left));
  if (!game.playing) return; // kicked during this frame

  world.update(player.x, player.z);
  npcs.update(dt, ctx);
  views.frame(dt, ctx.lightFn);
  sky.update(dt, camera.position, currentBiome === BIOME.LUMEN ? BIOME.FOREST : currentBiome, world);
  if (currentBiome === BIOME.LUMEN) { mats.shared.uFogColor.value.set(0.35, 0.2, 0.6); }
  // under water: short blue-green fog
  if (WATERY[world.get(camera.position.x, camera.position.y, camera.position.z)]) {
    const d = 0.35 + 0.65 * sky.daylight;
    mats.shared.uFogColor.value.set(0.1 * d, 0.36 * d, 0.5 * d);
    mats.shared.uFogDensity.value = 0.035; mats.shared.uHeightFog.value = 0;
  }
  mats.shared.uTime.value = now / 1000;
  const emit = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = world.chunkAt(Math.floor(player.x) + dx * CHUNK, Math.floor(player.z) + dz * CHUNK);
    if (c && c.glow && c.glow.length) emit.push({ ox: c.cx * CHUNK, oz: c.cz * CHUNK, list: c.glow });
  }
  particles.ambient(dt, emit, camera.position, settings.particles);
  // trails and pings
  trailT -= dt;
  const doTrail = trailT <= 0 && settings.particles > 0.2;
  if (doTrail) trailT = 0.05 / settings.particles;
  for (const a of avatars.values()) {
    a.updateRemote(dt, ctx.lightFn);
    if (doTrail && a.cur && a.target) trail(a.cfg, a.cur.x, a.cur.y, a.cur.z, Math.hypot(a.target.x - a.cur.x, a.target.z - a.cur.z) * 10);
  }
  if (doTrail) trail(game.avatar, player.x, player.y, player.z, Math.hypot(player.vx, player.vz));
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i]; p.t -= dt;
    if (p.t <= 0) { pings.splice(i, 1); continue; }
    if (Math.random() < dt * 20) particles.spawn(p.x, p.y + Math.random() * 6, p.z, 0, 1.5, 0, 0xffb347, 0.7, 0);
  }
  particles.update(dt);
  if (selfAvatar) {
    selfAvatar.setVisible(game.camMode !== 0 && !thirdBlocked);
    selfAvatar.pose(dt, player.x, player.y, player.z, player.yaw, player.pitch, Math.hypot(player.vx, player.vz), ctx.lightFn(player.x, player.y + 1, player.z));
  }

  // map tiles after edits (a few per frame)
  let mapUpdates = 0;
  for (const c of world.chunks.values()) { if (c.mapDirty && c.blocks && mapUpdates < 4) { map.update(c); c.mapDirty = false; mapUpdates++; } }

  // targeting
  const reach = player.creative ? 8 : 5;
  const extra = firstPerson ? 0 : camera.position.distanceTo(eye);
  const hit = raycastBlock(world, aimFrom, aimDir, reach + extra);
  const maxEnt = Math.min(3.6 + extra, hit ? hit.dist : 99);
  const eh = views.raycast(aimFrom, aimDir, maxEnt);
  const ph = raycastPlayers(aimFrom, aimDir, Math.min(maxEnt, eh ? eh.dist : 99));
  const ev = !ph && eh ? eh.view : null;
  target.block = hit; target.other = ph;
  target.creature = ev && ev.k === 'm' ? ev : null;
  target.npc = ev && ev.k === 'v' ? ev : null;
  outline.visible = !!hit && !eh && !ph;
  if (hit) outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  if (ph) ui.setTarget(`${ph.a.name}${ph.a.role && ph.a.role !== 'visitor' ? ` · ${ROLE_NAMES[ph.a.role]}` : ''}`);
  else if (target.npc) ui.setTarget(`${target.npc.data.name} the ${target.npc.data.role} · right-click to talk`);
  else if (target.creature) ui.setTarget(`${MOB_MODELS[target.creature.info.type]?.name || 'Creature'}  ${Math.max(0, target.creature.hp)}/${target.creature.max}`);
  else if (hit && BLOCKS[hit.id]) ui.setTarget(BLOCKS[hit.id].name + (BLOCKS[hit.id].machine ? ' · right-click to open' : ''));
  else ui.setTarget('');

  // mining
  attackCool = Math.max(0, attackCool - dt); magicCool = Math.max(0, magicCool - dt);
  if (mining && !blocked && !game.frozen && hit && !eh && !ph) {
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (key !== breakKey) { breakKey = key; breakProg = 0; }
    const t = breakTime(hit.id);
    if (t === 0) { if (attackCool <= 0) { breakBlock(hit); attackCool = 0.18; } }
    else if (t < Infinity) {
      breakProg += dt / t;
      digT -= dt; if (digT <= 0) { digT = 0.22; sfx.dig(); particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, BLOCKS[hit.id].color, 3, 2); }
      if (breakProg >= 1) { breakBlock(hit); breakProg = 0; breakKey = ''; }
    }
    swing = (swing + dt * 9) % (Math.PI * 2);
  } else { breakProg = 0; breakKey = ''; swing = 0; }
  ui.setBreak(breakProg);

  // HUD
  const camBlock = world.get(camera.position.x, camera.position.y, camera.position.z);
  ui.setUnderwater(WATERY[camBlock] === 1, LIQ_TYPE[camBlock] === 2);
  ui.renderStats();
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.25;
    const inf = sky.info();
    const wx = sky.weather === 'clear' ? 'Clear' : sky.weather === 'rain' ? 'Rain' : 'Storm';
    ui.setInfo(`<span class="biome">${BIOME_NAMES[currentBiome]}</span><br>Day ${game.day + 1} · ${inf.clock} · ${wx}<br>${Math.floor(player.x)}, ${Math.floor(player.y)}, ${Math.floor(player.z)}<br>${Math.round(fps)} fps${game.online ? ` · ${avatars.size + 1} online` : ''}`);
    refreshQuests();
    if (game.round) renderRoundHud();
    if ($('scoreboard').classList.contains('show')) renderScoreboard();
    const now2 = performance.now();
    for (const [k, p] of pendingPlace) if (now2 - p.t > 4000) pendingPlace.delete(k);
  }
  miniT -= dt;
  if (miniT <= 0) { miniT = 0.2; drawMinimap(); }
  if (ui.isOpen('bigmap')) { mapT -= dt; if (mapT <= 0) { mapT = 0.05; drawBigMap(); } }

  // render: shadows, scene (optionally through the light-shaft pass), held item
  if (settings.shadows && mats.shared.uSunInt.value > 0.01) shadows.render(renderer, scene, new THREE.Vector3(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z)), mats.shared.uSunDir.value);
  const useVol = settings.volumetric && settings.shadows && mats.shared.uSunInt.value > 0.05;
  renderer.autoClear = true;
  if (useVol) {
    volumetric.begin(renderer);
    renderer.render(scene, camera);
    volumetric.finish(renderer, camera, mats.shared, WATERY[camBlock] === 1);
  } else renderer.render(scene, camera);
  if (firstPerson) {
    handCam.aspect = camera.aspect; handCam.updateProjectionMatrix();
    const sw = Math.sin(swing) * 0.08;
    const walk = Math.sin(now / 160) * Math.min(1, Math.hypot(player.vx, player.vz) / 4) * 0.02;
    hand.position.set(0.44 + walk, -0.34 - Math.abs(sw) + walk, -0.75 + sw);
    hand.rotation.set(0.3 + sw * 2, 0.7, 0);
    handSprite.position.set(0.4 + walk, -0.32 - Math.abs(sw), -0.7 + sw);
    const lf = ctx.lightFn(player.x, player.y + 1, player.z);
    if (Array.isArray(hand.material)) hand.material.forEach(m => m.color.setScalar(lf));
    handSprite.material.color.setScalar(lf);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(handScene, handCam);
    renderer.autoClear = true;
  }
}
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
updateLevelBadge();
requestAnimationFrame(frame);

// for debugging in the browser console
window.caveCraft = { get world() { return world; }, player, inv, sky, views, get npcs() { return npcs; }, get host() { return host; }, map, game, target, settings, teleport };
