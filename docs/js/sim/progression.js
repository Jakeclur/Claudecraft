// Player progression shared by the browser and the server: XP and levels, skill trees,
// achievements, and the cosmetics they unlock. Pure data + functions, no DOM.

export function xpForLevel(level) { return Math.round(60 * Math.pow(level, 1.5)); } // xp needed to go from level to level+1
export function levelFromXp(xp) {
  let level = 1, need = xpForLevel(1);
  while (xp >= need && level < 99) { xp -= need; level++; need = xpForLevel(level); }
  return { level, into: xp, need };
}

/* ------------------------------------------------------------------ */
/* Skill trees: one point per level after the first                   */
/* ------------------------------------------------------------------ */
export const SKILL_TREES = [
  {
    id: 'delver', name: 'Delver', blurb: 'Mining and the deep places.',
    nodes: [
      { id: 'keenpick', name: 'Keen Pick', max: 3, desc: 'Dig 10% faster per rank.' },
      { id: 'luckyseams', name: 'Lucky Seams', max: 3, req: 'keenpick', desc: '8% chance per rank to get a second drop from ores.' },
      { id: 'lanterneyes', name: 'Lantern Eyes', max: 2, req: 'keenpick', desc: 'See more in dark caves.' },
      { id: 'deeplungs', name: 'Deep Lungs', max: 2, req: 'lanterneyes', desc: '50% more breath per rank.' },
    ],
  },
  {
    id: 'warden', name: 'Warden', blurb: 'Standing your ground.',
    nodes: [
      { id: 'sturdy', name: 'Sturdy', max: 3, desc: '+2 maximum health per rank.' },
      { id: 'keenedge', name: 'Keen Edge', max: 3, req: 'sturdy', desc: '+10% weapon damage per rank (not in the arena).' },
      { id: 'steadfast', name: 'Steadfast', max: 2, req: 'sturdy', desc: 'Get knocked back 30% less per rank.' },
      { id: 'secondwind', name: 'Second Wind', max: 2, req: 'steadfast', desc: 'Heal faster when well fed.' },
    ],
  },
  {
    id: 'wayfarer', name: 'Wayfarer', blurb: 'Roads, hills and long journeys.',
    nodes: [
      { id: 'fleetfoot', name: 'Fleet Foot', max: 3, desc: 'Move 4% faster per rank.' },
      { id: 'springstep', name: 'Spring Step', max: 2, req: 'fleetfoot', desc: 'Jump a little higher per rank.' },
      { id: 'lightpack', name: 'Light Pack', max: 3, req: 'fleetfoot', desc: 'Get hungry 12% slower per rank.' },
      { id: 'softlanding', name: 'Soft Landing', max: 2, req: 'springstep', desc: 'Take less fall damage.' },
    ],
  },
  {
    id: 'artisan', name: 'Artisan', blurb: 'Making and trading.',
    nodes: [
      { id: 'tempered', name: 'Tempered', max: 3, desc: 'Tools you craft last 20% longer per rank.' },
      { id: 'thrifty', name: 'Thrifty Hands', max: 3, req: 'tempered', desc: '6% chance per rank to get one ingredient back when crafting.' },
      { id: 'charm', name: 'Merchant\'s Charm', max: 3, req: 'thrifty', desc: 'Villagers give 5% better prices per rank.' },
      { id: 'quickfire', name: 'Quickfire', max: 2, req: 'tempered', desc: 'Your smelters work 25% faster per rank.' },
    ],
  },
];
export const SKILLS = Object.fromEntries(SKILL_TREES.flatMap(t => t.nodes.map(n => [n.id, { ...n, tree: t.id }])));

export function pointsAvailable(profile) {
  const { level } = levelFromXp(profile.xp || 0);
  const spent = Object.values(profile.skills || {}).reduce((a, b) => a + b, 0);
  return Math.max(0, level - 1 - spent);
}
export function canLearn(profile, id) {
  const s = SKILLS[id];
  if (!s) return false;
  const have = profile.skills?.[id] || 0;
  if (have >= s.max) return false;
  if (s.req && !(profile.skills?.[s.req] > 0)) return false;
  return pointsAvailable(profile) > 0;
}
export const rank = (profile, id) => profile?.skills?.[id] || 0;

// numbers the game uses, derived from skills
export function skillEffects(profile, arena = false) {
  const r = id => rank(profile, id);
  return {
    digSpeed: 1 + 0.1 * r('keenpick'),
    oreLuck: 0.08 * r('luckyseams'),
    nightSight: 0.06 * r('lanterneyes'),
    breath: 1 + 0.5 * r('deeplungs'),
    maxHealth: 20 + (arena ? 0 : 2 * r('sturdy')),
    damage: arena ? 1 : 1 + 0.1 * r('keenedge'),
    knockback: 1 - 0.3 * r('steadfast'),
    regen: 1 + 0.5 * r('secondwind'),
    speed: 1 + 0.04 * r('fleetfoot'),
    jump: 1 + 0.06 * r('springstep'),
    hunger: 1 - 0.12 * r('lightpack'),
    fall: 1 - 0.35 * r('softlanding'),
    toolLife: 1 + 0.2 * r('tempered'),
    refund: 0.06 * r('thrifty'),
    prices: 1 - 0.05 * r('charm'),
    smelt: 1 + 0.25 * r('quickfire'),
  };
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */
// stat-driven: unlocked when stats[stat] >= n
export const ACHIEVEMENTS = [
  { id: 'firstlog', name: 'First Splinters', desc: 'Chop your first log.', stat: 'logs', n: 1, xp: 20 },
  { id: 'deep', name: 'Deep Digger', desc: 'Reach below height 20.', stat: 'deep', n: 1, xp: 40 },
  { id: 'lumen', name: 'Lumen Seeker', desc: 'Find the Lumen Caverns.', stat: 'biome8', n: 1, xp: 50 },
  { id: 'reef', name: 'Reef Diver', desc: 'Swim in the Coral Shallows.', stat: 'biome6', n: 1, xp: 40 },
  { id: 'sky', name: 'Skywalker', desc: 'Stand on a floating isle.', stat: 'isle', n: 1, xp: 50 },
  { id: 'cliffs', name: 'Cliffhanger', desc: 'Explore the Shatter Cliffs.', stat: 'biome4', n: 1, xp: 30 },
  { id: 'frost', name: 'Frostbitten', desc: 'Explore Frostfen.', stat: 'biome5', n: 1, xp: 30 },
  { id: 'ember', name: 'Ember Treader', desc: 'Explore the Ember Peaks.', stat: 'biome2', n: 1, xp: 30 },
  { id: 'crystal', name: 'Crystal Gazer', desc: 'Explore the Crystal Desert.', stat: 'biome1', n: 1, xp: 30 },
  { id: 'walker', name: 'World Walker', desc: 'Visit all nine biomes.', stat: 'biomes', n: 9, xp: 200 },
  { id: 'smelt', name: 'Smelt Smith', desc: 'Smelt your first ingot.', stat: 'ingots', n: 1, xp: 30 },
  { id: 'tinker', name: 'Tinkerer', desc: 'Craft a machine.', stat: 'machines', n: 1, xp: 40 },
  { id: 'arcane', name: 'Arcanist', desc: 'Craft a magic artifact.', stat: 'artifacts', n: 1, xp: 60 },
  { id: 'golem', name: 'Golem Breaker', desc: 'Defeat a Crystal Golem.', stat: 'kill_golem', n: 1, xp: 50 },
  { id: 'serpent', name: 'Skybreaker', desc: 'Defeat a Sky Serpent.', stat: 'kill_serpent', n: 1, xp: 80 },
  { id: 'hunter', name: 'Wild Warden', desc: 'Defeat 50 creatures.', stat: 'kills', n: 50, xp: 100 },
  { id: 'friend', name: 'Friend of the Folk', desc: 'Become good friends with a villager.', stat: 'bestFavor', n: 40, xp: 60 },
  { id: 'errands', name: 'Errand Runner', desc: 'Complete 5 villager quests.', stat: 'quests', n: 5, xp: 100 },
  { id: 'waywise', name: 'Waywise', desc: 'Attune 5 waystones.', stat: 'waystones', n: 5, xp: 80 },
  { id: 'builder', name: 'Master Builder', desc: 'Place 1,000 blocks.', stat: 'placed', n: 1000, xp: 150 },
  { id: 'digger', name: 'Tunnel Rat', desc: 'Break 2,000 blocks.', stat: 'broken', n: 2000, xp: 150 },
  { id: 'social', name: 'Good Company', desc: 'Play in a world with 3 other people.', stat: 'company', n: 1, xp: 50 },
  { id: 'trail', name: 'Trail Blazer', desc: 'Win a Sprint Trail.', stat: 'win_race', n: 1, xp: 150 },
  { id: 'rush', name: 'Rush Hour', desc: 'Win a Gather Rush.', stat: 'win_harvest', n: 1, xp: 150 },
  { id: 'champ', name: 'Arena Champion', desc: 'Win a Glimmer Arena.', stat: 'win_arena', n: 1, xp: 150 },
  { id: 'veteran', name: 'Event Regular', desc: 'Take part in 10 competitive rounds.', stat: 'rounds', n: 10, xp: 100 },
];

/* ------------------------------------------------------------------ */
/* Cosmetics: avatar parts behind achievements or levels               */
/* ------------------------------------------------------------------ */
// key -> unlock rule ({ level } or { ach })
export const COSMETIC_LOCKS = {
  'hat:wizard': { ach: 'arcane' }, 'hat:leafcrown': { ach: 'friend' }, 'hat:miner': { ach: 'deep' }, 'hat:tophat': { level: 10 },
  'hat:horns': { ach: 'champ' }, 'hat:crown': { level: 20 }, 'hat:halo': { ach: 'walker' },
  'back:wings': { ach: 'serpent' }, 'back:cape': { level: 5 },
  'face:goggles': { ach: 'reef' }, 'face:mask': { level: 8 },
  'trail:sparkle': { level: 3 }, 'trail:embers': { ach: 'ember' }, 'trail:snow': { ach: 'frost' }, 'trail:petals': { ach: 'sky' },
  'trail:lumen': { ach: 'lumen' }, 'trail:stars': { ach: 'trail' }, 'trail:coins': { ach: 'rush' },
  'title:the Delver': { ach: 'digger' }, 'title:Reefwalker': { ach: 'reef' }, 'title:Champion': { ach: 'champ' },
  'title:Pathfinder': { ach: 'walker' }, 'title:Friend of the Folk': { ach: 'friend' }, 'title:the Swift': { ach: 'trail' },
  'title:Builder': { ach: 'builder' }, 'title:Veteran': { level: 15 },
};
export const TRAILS = ['none', 'sparkle', 'embers', 'snow', 'petals', 'lumen', 'stars', 'coins'];
export const TITLES = ['none', 'the Delver', 'Reefwalker', 'Champion', 'Pathfinder', 'Friend of the Folk', 'the Swift', 'Builder', 'Veteran'];

export function lockFor(key) { return COSMETIC_LOCKS[key] || null; }
export function isUnlocked(profile, key) {
  const l = COSMETIC_LOCKS[key];
  if (!l) return true;
  if (l.level) return levelFromXp(profile?.xp || 0).level >= l.level;
  return !!profile?.achievements?.[l.ach];
}
export function lockText(key) {
  const l = COSMETIC_LOCKS[key];
  if (!l) return '';
  if (l.level) return `Reach level ${l.level}`;
  const a = ACHIEVEMENTS.find(a => a.id === l.ach);
  return a ? `Earn “${a.name}”` : 'Locked';
}
// strip anything the profile hasn't unlocked (the server does this too)
export function sanitizeAvatar(cfg, profile) {
  const out = { ...cfg };
  for (const part of ['hat', 'back', 'face', 'trail', 'title']) {
    if (out[part] && out[part] !== 'none' && !isUnlocked(profile, `${part}:${out[part]}`)) out[part] = 'none';
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recording progress                                                  */
/* ------------------------------------------------------------------ */
export function newProfile(id, name) {
  return { id, name, xp: 0, skills: {}, achievements: {}, stats: {}, created: Date.now() };
}

// Add to a stat (or raise a max-stat) and award XP. Returns events for the player:
// [{ type: 'xp', amount }, { type: 'level', level }, { type: 'achievement', id, name }]
export function record(profile, { stat, add = 0, max, xp = 0 } = {}) {
  const events = [];
  profile.stats = profile.stats || {}; profile.achievements = profile.achievements || {};
  const before = levelFromXp(profile.xp || 0).level;
  if (stat) {
    if (max !== undefined) profile.stats[stat] = Math.max(profile.stats[stat] || 0, max);
    else profile.stats[stat] = (profile.stats[stat] || 0) + add;
  }
  let gained = xp;
  for (const a of ACHIEVEMENTS) {
    if (profile.achievements[a.id]) continue;
    if ((profile.stats[a.stat] || 0) >= a.n) {
      profile.achievements[a.id] = Date.now();
      gained += a.xp;
      events.push({ type: 'achievement', id: a.id, name: a.name, desc: a.desc });
    }
  }
  if (gained) { profile.xp = (profile.xp || 0) + gained; events.push({ type: 'xp', amount: gained }); }
  const after = levelFromXp(profile.xp || 0).level;
  if (after > before) events.push({ type: 'level', level: after });
  return events;
}

// XP for game actions (shared so single-player and servers agree)
export const XP = {
  break: 0.5, ore: 4, rare: 10, place: 0.25, kill: { mossback: 4, glassfin: 3, lumoth: 4, beetle: 8, strider: 10, frostling: 10, golem: 20, serpent: 30 },
  quest: 30, explore: 2, roundPlay: 20, roundWin: 100, craftMachine: 10, craftArtifact: 20,
};
