// Villager data shared by the server and the browser: jobs, personalities, names, trades,
// quest pools, and the deterministic villager roster for a generated village.
import { B, I, toolId } from '../blocks.js';
import { mulberry32 } from '../noise.js';
import { BIOME } from '../consts.js';

/* ------------------------------------------------------------------ */
/* Who they are                                                        */
/* ------------------------------------------------------------------ */
export const FOLK_ROLES = {
  elder: { title: 'Elder', sprout: 0xffd34d, cloth: 0x6a4ab0, trim: 0xffd34d },
  merchant: { title: 'Merchant', sprout: 0x6ce07a, cloth: 0x3a8a5a, trim: 0xe8c068 },
  smith: { title: 'Smith', sprout: 0xff8a3a, cloth: 0x6a4a34, trim: 0x8a8a96 },
  mystic: { title: 'Mystic', sprout: 0xb07cff, cloth: 0x2e2e66, trim: 0x8ff4ff },
  cook: { title: 'Cook', sprout: 0xff8ac8, cloth: 0xf4f0e8, trim: 0xe05a5a },
};

// each personality colours how a villager talks and haggles
export const PERSONALITIES = {
  cheerful: {
    label: 'Cheerful', price: 0.95, brow: 0,
    hello: ['Oh! Hello hello, {player}!', 'What a lovely surprise!', '{player}! You made my whole day brighter.'],
    first: ['A new face! I\'m {name}, the {role} of {village}. Welcome, welcome!'],
    weather: { rain: 'Rain means puddles, and puddles mean splashing!', storm: 'Thunder sounds like the sky is drumming. Isn\'t it grand?', clear: 'Sunshine like this makes everything sparkle.', night: 'The stars are out! Make a wish with me?' },
    small: ['I counted forty-two blossoms on the way to the well this morning.', 'Have you tried glowberries with a pinch of ember? Spicy!', 'Everybody here is my favourite. Don\'t tell them.'],
    bye: ['Come back soon, okay?', 'Bye-bye! Wave on your way out!'],
    thanks: 'You did it! I could hug you. I will, actually.',
    low: 'Oh... it\'s you. I\'m sure you didn\'t mean it.',
  },
  grumpy: {
    label: 'Grumpy', price: 1.15, brow: 0.35,
    hello: ['Hmph. You again.', 'What do you want, {player}?', 'If you\'re here to chat, I\'m busy.'],
    first: ['Name\'s {name}. I\'m the {role}. Don\'t touch anything.'],
    weather: { rain: 'Rain. Wonderful. My boots are soaked.', storm: 'Can\'t sleep through all this banging.', clear: 'Too bright. Squinting gives me wrinkles.', night: 'It\'s late. Go to bed like a normal person.' },
    small: ['Kids keep climbing my roof. Roofs aren\'t ladders.', 'Back in my day, we mined with our elbows.', 'The well water tastes like pebbles. Always has.'],
    bye: ['Finally.', 'Mind the door.'],
    thanks: 'Hm. Not bad. Not bad at all. Don\'t let it go to your head.',
    low: 'Get lost before I call the Elder.',
  },
  dreamy: {
    label: 'Dreamy', price: 1.0, brow: -0.1,
    hello: ['Oh, {player}... I was just listening to the clouds.', 'Do you ever feel the stars humming?', 'Hello, wanderer of many paths.'],
    first: ['I am {name}. They call me the {role}, but I am mostly a daydream.'],
    weather: { rain: 'Rain is the sky writing letters to the ground.', storm: 'The storm is singing in a key I almost remember.', clear: 'The clouds look like sleeping Mossbacks today.', night: 'Night is when the world tells its secrets.' },
    small: ['I once followed a Lumoth for three days. It led me back home.', 'Some say the floating isles remember the ground they left.', 'Have you noticed every waystone hums a different note?'],
    bye: ['Drift safely.', 'May your path curl kindly.'],
    thanks: 'You brought it! The world feels a little more whole now.',
    low: 'Your footsteps feel heavy today...',
  },
  nervous: {
    label: 'Nervous', price: 1.0, brow: -0.25,
    hello: ['Ah! Oh, it\'s only you, {player}. Phew.', 'D-did you hear something?', 'Hi! Sorry. Hi.'],
    first: ['I-I\'m {name}. The {role}. Please don\'t let any golems follow you in.'],
    weather: { rain: 'What if the river rises? What if it rises a LOT?', storm: 'Lightning! I\'m staying under the table.', clear: 'Clear skies are good. Nothing can hide in clear skies. Right?', night: 'Night. That\'s when the Frostlings come out, you know.' },
    small: ['I double-check the door every evening. Triple, on Tuesdays.', 'Is that a Cinder Beetle on your boot? No? Okay.', 'I keep a spare torch in every pocket.'],
    bye: ['Stay safe! Please!', 'Watch out for... everything.'],
    thanks: 'Oh thank goodness. I couldn\'t have done it myself. I would have fainted.',
    low: 'P-please keep your distance.',
  },
  boastful: {
    label: 'Boastful', price: 1.05, brow: 0.1,
    hello: ['Ah, {player}! Come to admire my handiwork?', 'You\'re in luck. You found the finest {role} in {village}.', 'Ha! I knew you\'d be back.'],
    first: ['The name\'s {name}! Best {role} this side of the Shatter Cliffs. Possibly both sides.'],
    weather: { rain: 'I once wrestled a rainstorm. It gave up first.', storm: 'Storms are jealous of my thunderous voice.', clear: 'Perfect weather for being impressive.', night: 'Even the moon came out to see me.' },
    small: ['I once outran a Sky Serpent. Backwards.', 'My smelter is so hot it melts rumours.', 'Ask anyone. Actually, don\'t. They\'re jealous.'],
    bye: ['Tell everyone you met me!', 'Off you go, little legend.'],
    thanks: 'Of course you succeeded. You learned from watching me.',
    low: 'I don\'t talk to people who mess with my village.',
  },
  wise: {
    label: 'Wise', price: 0.98, brow: 0.05,
    hello: ['Welcome back, {player}. Sit, if you like.', 'Ah. The traveller returns.', 'Every road leads somewhere, {player}. Yours led here.'],
    first: ['I am {name}, {role} of {village}. Ask, and I will tell what I know.'],
    weather: { rain: 'The rain feeds the roots we never see.', storm: 'Storms pass. Mountains remain.', clear: 'A clear day shows far, but not deep.', night: 'In darkness, small lights matter most.' },
    small: ['Iron needs fire to become a tool. So do people.', 'The Lumen Caverns glow brightest where few have walked.', 'A good trade leaves both sides smiling.'],
    bye: ['Go gently.', 'Until our paths cross again.'],
    thanks: 'Well done. Kindness repaid is kindness doubled.',
    low: 'Trust is slow to grow and quick to burn.',
  },
};
export const PERSONALITY_KEYS = Object.keys(PERSONALITIES);

const SYL_A = ['Bri', 'Tam', 'Olo', 'Wen', 'Quil', 'Sae', 'Mo', 'Fen', 'Lu', 'Pip', 'Ora', 'Ziv', 'Nim', 'Kesh', 'Ari', 'Dov', 'Hal', 'Yeb', 'Rue', 'Tov'];
const SYL_B = ['ble', 'ra', 'wick', 'lo', 'mira', 'vin', 'tch', 'dle', 'sa', 'nu', 'bo', 'ett', 'pin', 'dra', 'mo', 'ly'];
const V_A = ['Moss', 'Glimmer', 'Amber', 'Thistle', 'Lantern', 'Copper', 'Willow', 'Pebble', 'Ember', 'Hollow', 'Bramble', 'Frost'];
const V_B = ['brook', 'hollow', 'stead', 'reach', 'mere', 'ford', 'haven', 'knoll', 'fold', 'rest'];

/* ------------------------------------------------------------------ */
/* Trades (price in Glimmer)                                           */
/* ------------------------------------------------------------------ */
export const TRADES = {
  merchant: {
    sell: [[B.TORCH, 8, 4], [I.BERRIES, 6, 4], [I.COOKED_FISH, 3, 7], [B.PLANKS, 16, 5], [B.CGLASS, 8, 7], [B.CHEST, 1, 8], [B.LANTERN, 2, 12]],
    buy: [[B.LOG, 8, 4], [B.COBBLE, 16, 3], [B.SAND, 16, 3], [I.BERRIES, 8, 4], [B.KELP, 8, 4], [B.FLOWER_RED, 4, 3]],
  },
  smith: {
    sell: [[I.IRON_INGOT, 2, 12], [I.COPPER_INGOT, 3, 9], [toolId('iron', 'pick'), 1, 34], [toolId('iron', 'sword'), 1, 30], [I.GEAR, 2, 10], [B.SMELTER, 1, 14], [I.COAL, 8, 6]],
    buy: [[B.COPPER_ORE, 4, 7], [B.IRON_ORE, 4, 9], [I.COAL, 8, 5], [I.EMBER, 4, 6], [B.MAGMA, 4, 5]],
  },
  mystic: {
    sell: [[I.LUMEN_DUST, 2, 10], [I.AETHER_SHARD, 1, 24], [I.LUMEN_STAFF, 1, 60], [I.BLINK_CHARM, 1, 80], [I.FEATHER_CLOAK, 1, 90], [I.TIDE_AMULET, 1, 90], [I.HOME_COMPASS, 1, 50]],
    buy: [[I.SHARD, 4, 8], [I.SCALE, 1, 10], [I.CORE, 1, 20], [I.PEARL, 1, 12], [I.FROST_CORE, 1, 20], [I.LUMEN_DUST, 2, 6]],
  },
  cook: {
    sell: [[I.COOKED_MEAT, 2, 6], [I.MUSHROOM_STEW, 1, 12], [I.SKYFRUIT, 2, 8], [B.PLANTER, 2, 8], [B.PAPER_LANTERN, 2, 8]],
    buy: [[I.MEAT, 4, 6], [I.FISH, 4, 6], [I.BERRIES, 8, 4], [I.SKYFRUIT, 2, 6], [B.LUMEN_CAP, 2, 6]],
  },
  elder: {
    sell: [[B.WAYSTONE, 1, 40], [B.MOSAIC, 8, 10], [B.BOOKSHELF, 2, 10], [B.TILE_TEAL, 8, 8], [I.HOME_COMPASS, 1, 55]],
    buy: [[I.HIDE, 2, 8], [B.CRYSTAL, 2, 8], [I.SKYFRUIT, 2, 6]],
  },
};

/* ------------------------------------------------------------------ */
/* Quests                                                              */
/* ------------------------------------------------------------------ */
export const GATHER = {
  merchant: [[B.LOG, 12], [B.SAND, 16], [B.COBBLE, 24], [I.BERRIES, 8], [B.KELP, 6], [B.PINE_LOG, 10]],
  smith: [[B.COPPER_ORE, 5], [B.IRON_ORE, 5], [I.COAL, 10], [I.EMBER, 4]],
  mystic: [[I.LUMEN_DUST, 4], [I.SHARD, 6], [I.PEARL, 2], [I.SCALE, 2]],
  cook: [[I.FISH, 4], [I.MEAT, 4], [I.BERRIES, 10], [I.SKYFRUIT, 3]],
  elder: [[B.CRYSTAL, 3], [I.HIDE, 3], [B.CORAL_PINK, 4]],
};
export const HUNT = { mystic: [['golem', 2], ['lumoth', 3]], elder: [['frostling', 2], ['beetle', 3]], smith: [['beetle', 3], ['strider', 2]], cook: [['glassfin', 3]], merchant: [['mossback', 2]] };
export const CRAFT = { smith: [toolId('iron', 'pick'), toolId('stone', 'sword'), B.LANTERN], cook: [I.MUSHROOM_STEW, I.COOKED_MEAT], mystic: [I.LUMEN_STAFF], merchant: [B.CHEST], elder: [B.MOSAIC] };
export const EXPLORE = [BIOME.DESERT, BIOME.VOLCANIC, BIOME.SKY, BIOME.CLIFFS, BIOME.TUNDRA, BIOME.REEF, BIOME.LUMEN, BIOME.FOREST];

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function compass(dx, dz) {
  const a = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2);
  return DIRS[Math.round(a / (Math.PI / 4)) % 8];
}
export const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// The same seed and village always produce the same villagers, on every machine.
export function makeVillage(seed, meta) {
  const r = mulberry32(seed ^ hashStr(meta.id));
  const name = pick(V_A, r) + pick(V_B, r);
  const folk = meta.huts.map((h, i) => ({
    id: `${meta.id}#${i}`, village: meta.id, role: h.role, name: pick(SYL_A, r) + pick(SYL_B, r),
    personality: pick(PERSONALITY_KEYS, r), skin: ['#f6d7bc', '#e8b998', '#c98f63', '#9a6440', '#b8d8a8', '#c8c0ff'][Math.floor(r() * 6)],
    home: h.home, door: h.door, out: h.out,
  }));
  return { id: meta.id, name, x: meta.x, y: meta.y, z: meta.z, biome: meta.biome, folk };
}
