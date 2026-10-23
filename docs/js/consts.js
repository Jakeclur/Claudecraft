// World dimensions shared by the main thread and workers.
export const CHUNK = 16;          // chunk width and depth
export const WH = 128;            // world height
export const SEA = 48;            // sea level
export const CHUNK_VOL = CHUNK * CHUNK * WH;

// index inside a chunk (local x, z in 0..15)
export const cidx = (x, y, z) => x + CHUNK * (z + CHUNK * y);

export const BIOME = { FOREST: 0, DESERT: 1, VOLCANIC: 2, SKY: 3, CLIFFS: 4, TUNDRA: 5, REEF: 6, OCEAN: 7, LUMEN: 8 };
export const BIOME_NAMES = ['Verdant Woods', 'Crystal Desert', 'Ember Peaks', 'Floating Isles', 'Shatter Cliffs', 'Frostfen', 'Coral Shallows', 'Deep Sea', 'Lumen Caverns'];
export const BIOME_COLORS = ['#5fae4a', '#e7b8f0', '#c0502a', '#9ff0d8', '#d27a4d', '#e8f2ff', '#ff8ab8', '#2a5a9a', '#965aff'];
