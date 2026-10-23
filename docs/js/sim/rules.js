// World rules, roles and permission checks shared by the server and the browser.

export const MODES = {
  survival: { name: 'Survival', kind: 'sandbox' },
  creative: { name: 'Creative', kind: 'sandbox' },
  race: { name: 'Sprint Trail', kind: 'event', desc: 'Race through glowing beacons. First to the last one wins.' },
  harvest: { name: 'Gather Rush', kind: 'event', desc: 'Collect the listed materials faster than everyone else.' },
  arena: { name: 'Glimmer Arena', kind: 'event', desc: 'Last one standing on the floating arena wins.' },
};

export const RULES = [
  { id: 'visitorsBuild', label: 'Visitors can build', desc: 'If off, only builders, moderators and the owner can change blocks.', def: true },
  { id: 'visitorsMachines', label: 'Visitors can use chests and machines', def: true },
  { id: 'pvp', label: 'Player fighting', desc: 'Lets players hurt each other outside the arena.', def: false },
  { id: 'creatures', label: 'Creatures', def: true },
  { id: 'hostiles', label: 'Hostile creatures', desc: 'If off, nothing attacks players.', def: true },
  { id: 'keepInventory', label: 'Keep bag when knocked out', def: true },
  { id: 'fluids', label: 'Water and lava flow', def: true },
  { id: 'daylight', label: 'Day and night cycle', desc: 'If off, it stays midday.', def: true },
  { id: 'weather', label: 'Weather', def: true },
  { id: 'teleportToFriends', label: 'Players can /tp to each other', def: true },
  { id: 'spawnProtection', label: 'Protect the area around spawn (16 blocks)', def: true },
];
export function defaultRules(mode = 'survival') {
  const r = Object.fromEntries(RULES.map(x => [x.id, x.def]));
  if (mode === 'arena' || mode === 'race' || mode === 'harvest') { r.hostiles = false; r.spawnProtection = false; }
  if (mode === 'creative') r.hostiles = false;
  return r;
}

export const ROLES = ['visitor', 'builder', 'mod', 'owner'];
export const ROLE_NAMES = { visitor: 'Visitor', builder: 'Builder', mod: 'Moderator', owner: 'Owner' };
const RANK = { visitor: 0, builder: 1, mod: 2, owner: 3 };
export const atLeast = (role, need) => (RANK[role] ?? 0) >= RANK[need];

export function canBuild(role, rules, x, z, spawn) {
  if (atLeast(role, 'builder')) return true;
  if (!rules.visitorsBuild) return false;
  if (rules.spawnProtection && spawn && Math.abs(x - spawn.x) <= 16 && Math.abs(z - spawn.z) <= 16) return false;
  return true;
}
export const canModerate = role => atLeast(role, 'mod');
export const canUseMachines = (role, rules) => atLeast(role, 'builder') || rules.visitorsMachines;
