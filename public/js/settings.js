// Player settings: graphics, controls (rebindable keys), mouse, audio. Stored per browser.
const KEY = 'cave-craft-settings-v2';

export const ACTIONS = [
  ['forward', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Strafe left', 'KeyA'], ['right', 'Strafe right', 'KeyD'],
  ['jump', 'Jump / swim / fly up', 'Space'], ['sprint', 'Sprint', 'ShiftLeft'], ['down', 'Fly down', 'KeyC'],
  ['inventory', 'Bag & crafting', 'KeyE'], ['map', 'World map', 'KeyM'], ['quests', 'Quest log', 'KeyJ'], ['chat', 'Chat', 'KeyT'],
  ['emote', 'Emote wheel', 'KeyG'], ['camera', 'Switch camera', 'KeyV'], ['fly', 'Fly (Creative)', 'KeyF'], ['mute', 'Mute sound', 'KeyN'],
  ['drop', 'Drop held item', 'KeyQ'], ['ping', 'Ping a spot for others', 'KeyP'], ['scoreboard', 'Players & scores (hold)', 'Tab'],
  ['profile', 'Profile & skills', 'KeyK'], ['worldsettings', 'World settings', 'KeyO'],
];

export const PRESETS = {
  low: { renderDistance: 4, shadows: 0, volumetric: false, resolution: 0.7, particles: 0.35, maxPixelRatio: 1 },
  medium: { renderDistance: 6, shadows: 1024, volumetric: false, resolution: 0.85, particles: 0.7, maxPixelRatio: 1.25 },
  high: { renderDistance: 8, shadows: 2048, volumetric: true, resolution: 1, particles: 1, maxPixelRatio: 1.5 },
  ultra: { renderDistance: 11, shadows: 4096, volumetric: true, resolution: 1, particles: 1, maxPixelRatio: 2 },
};

const DEFAULTS = {
  preset: 'medium', ...PRESETS.medium,
  autoPerf: true, fov: 75, sensitivity: 1, invertY: false, volume: 0.7, viewBob: true,
  keys: Object.fromEntries(ACTIONS.map(([a, , k]) => [a, k])),
};

function guessPreset() {
  const cores = navigator.hardwareConcurrency || 2;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || cores <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

export const settings = load();

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage blocked */ }
  if (!s) { const p = guessPreset(); return { ...DEFAULTS, preset: p, ...PRESETS[p] }; }
  return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) } };
}

export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked */ } }
export function applyPreset(name) { Object.assign(settings, PRESETS[name], { preset: name }); saveSettings(); }
export function resetKeys() { settings.keys = { ...DEFAULTS.keys }; saveSettings(); }

// which action a key code triggers
export function actionFor(code) {
  for (const [a, k] of Object.entries(settings.keys)) if (k === code) return a;
  return null;
}
export function keyLabel(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' (L)').replace('Right', ' (R)').replace(/^Arrow/, 'Arrow ');
}
