# Cave Craft

A voxel sandbox game for the browser, built from scratch on [three.js](https://threejs.org).
The world is endless and generated as you explore. Every new world gets its own seed, so every
world is different: biomes, villages, caves and ruins all land in new places.

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd cave-craft
npm install
npm start
```

Open **http://localhost:3000** in Chrome, Edge, Firefox or Safari.

- **Your own worlds**: press **New world** on the title screen. Leave the seed empty for a surprise,
  or type any word or number to get the same world again later. Worlds are saved in your browser
  (IndexedDB) and listed on the title screen, where you can play, delete, import or export them.
- **Playing together**: press **Play online**. Friends on the same network open the second address
  the server prints (for example `http://192.168.1.20:3000`). See [Online play](#online-play).
  - `PORT=8080 npm start` uses another port.
  - `DATA_DIR=/path npm start` keeps worlds and profiles somewhere else (default `./data`).
  - `SERVER_NAME="Our Club" npm start` names the server in the browser.

### Without Node

`public/` is a complete static site. Serve it with any web server (for example
`python3 -m http.server 8000` inside `public/`) and open http://localhost:8000. Everything except online
play works. Opening `index.html` straight from disk (`file://`) does not work,
because browsers block modules and workers there.

## Controls

All keys can be changed in **Settings → Controls**.

| Action | Default key | Touch |
|---|---|---|
| Move | W A S D | Left thumb stick |
| Look | Mouse (click the game to capture it) | Drag on the right side |
| Jump / swim / fly up | Space | Jump |
| Sprint | Left Shift | Push the stick all the way |
| Fly down (Creative) | C | |
| Mine / attack | Hold left mouse | Hold still on the right side |
| Place, use, eat, talk, open machines | Right mouse | Use, or tap in Place mode |
| Hotbar | 1–9, mouse wheel | Tap a slot |
| Bag & crafting | E | Bag |
| World map | M | Map |
| Quest log | J | Quests |
| Emote wheel | G | Emote |
| Switch camera (first person, behind, front) | V | View |
| Fly (Creative) | F or double-tap Space | Fly |
| Chat / commands | T or Enter | |
| Mute | N | |
| Drop held item (Ctrl drops the stack) | Q | |
| Ping a spot for other players | P | |
| Players and round scores (hold) | Tab | Players |
| Profile, skills and achievements | K | |
| World settings (owners and moderators) | O | |
| Pause | Esc | Menu |

Hold **Shift** while right-clicking a machine to place a block against it instead of opening it.
Chat commands: `/help`, `/who`, `/msg name text`, `/tp name`, `/seed`, `/home`, `/spawnpoint`,
`/start` (begin a round). Moderators also get `/kick`, `/ban`, `/unban`, `/mute name [minutes]`,
`/unmute`, `/role name visitor|builder|mod`, `/invite [name]`, `/set rule on|off`, `/time day|night`,
`/weather clear|rain|storm` and `/summon <creature>`. In your own single-player world you are the owner.

## Play with friends without a server (peer to peer)

You don't need Node, a server or any hosting. One player's browser runs the world and friends connect
straight to it (WebRTC), using the free PeerJS matchmaking service to swap addresses. It works from the
GitHub Pages link.

1. The **host** opens or creates a world, presses **Esc**, then **Host online (friends join)**.
2. The game shows a 5-letter **code** and a link.
3. **Friends** open the game, press **Play online**, type the code under **Join a friend's world** (or open
   the link) and press **Join**.

Worth knowing:
- The world runs on the host's computer. When the host closes the page or quits, everyone is sent back to
  the title screen. The host's world is saved in the host's browser, including each friend's bag.
- Friends must stay within about 80 blocks of the host, because only the area around the host is simulated.
  They are pulled back if they wander too far.
- The host is the owner: Esc → **World settings** (or key O) to kick, ban, mute and change rules.
  Bans last until the host closes the room.
- Some school or company networks block peer-to-peer connections. If joining never works, try another network
  (a phone hotspot is a good test), or use a real server (below).
- Guests' progress profiles are stored in their own browsers and sent to the host, so a modified browser can lie
  about its own level. Fine for friends, not for strangers.
- `?peerserver=host:port` on the page address uses your own PeerJS server instead of the free one.

## Online play (with a server)

Start the server (`npm start`) and press **Play online** on the title screen.

- **Server browser**: lists the server's public worlds with filters for game mode, biome, player
  count and a name search. Add other servers by address to list their worlds too.
- **Your own worlds**: **Create your own world** picks name, seed, mode, who can find it (public,
  unlisted or invite-only), the player limit and the rules. You own it and it is saved on the server
  (`data/rooms/<id>/`) even when nobody is playing.
- **Rules** (owner only, changeable any time in World settings): visitors can build, visitors can
  use machines, player fighting, creatures, hostile creatures, keep bag when knocked out, flowing
  liquids, day/night, weather, `/tp` between players and spawn protection.
- **Roles and invites**: Owner > Moderator > Builder > Visitor. World settings (O) lists players with
  role, mute, kick and ban buttons, invite codes (copy a link like `?room=…&invite=…`), the ban list
  and the world's name, visibility and size. Invite codes can also be typed into the browser.
- **One shared world brain**: the server runs creatures, villagers, dropped items, falling sand,
  flowing water and lava, chests, smelters and drills, time and weather. Everyone sees the same
  creature in the same place and the same chest contents. Blocks you mine pop out as items anyone can
  pick up. Joining and leaving is seamless; if the connection drops the game reconnects by itself.
- **Competitive worlds** (the server makes one of each to start):
  - *Sprint Trail*: race through five glowing beacons; the HUD points to the next one.
  - *Gather Rush*: collect the listed materials first.
  - *Glimmer Arena*: last one standing on a floating platform; everyone gets the same arena health.
  Rounds run on their own: lobby, countdown, play, results. Moderators can `/start` early.
- **Progression**: XP from mining, building, exploring, defeating creatures, quests and rounds.
  Every level gives a skill point for four trees (Delver, Warden, Wayfarer, Artisan: faster digging,
  ore luck, more health, speed, softer landings, longer-lasting tools, cheaper trades, faster
  smelting and more). 26 achievements, and hats, trails and titles that unlock with them.
  Single-player progress is kept in the browser; each server keeps its own profiles.
- **Anti-cheat**: the server checks movement speed, flying, reach, digging speed and rate, placing
  rate, hit cooldowns, chat rate and message floods. Repeat offenders are kicked automatically and
  everything is written to the world's `moderation.log`.

## The world

The world is endless sideways and 128 blocks tall. Chunks (16 × 16 columns) are generated, lit and
meshed in background workers, so exploring doesn't freeze the game.

**Biomes** are placed by temperature, humidity and how far inland a place is, and blend smoothly
into each other.

| Biome | What makes it different |
|---|---|
| Verdant Woods | Rolling hills, oaks, ferns, flowers and berry bushes; pines on high ground |
| Crystal Desert | Lavender crystal dunes, banded sandstone, glowing crystal spires |
| Ember Peaks | Basalt ridges, ash fields, lava pools and volcanoes with lava-filled craters |
| Shatter Cliffs | Fractal terrain: ridged noise cut into terraces, with overhangs and arches carved by 3D noise, in rust, ochre and cream rock layers |
| Frostfen | Snowy plains, tall pines and frozen lakes; snow falls all year |
| Coral Shallows | Warm shallow sea with coral heads, sea fans, kelp forests, glowing anemones and sea glass |
| Deep Sea | Cold open ocean with gravel floors and kelp |
| Floating Isles | Sky islands with hanging skystone roots and blossom trees above a shallow sea |
| Lumen Caverns | Huge underground caverns lit by glowmoss, hanging glow vines and giant glowing mushrooms |

Under every biome there are winding caves, coal, copper, iron, lumen and aether ores, and lava at the bottom.

**Villages** of Glimmerfolk appear in the woods, deserts, tundra and cliffs, with a plaza, a well,
lanterns, paths and a hut for each villager. **Ancient waystones** stand in mossy stone rings
across the world.

## Survival

- Health, hunger and breath. A full belly heals you. Falls, lava, drowning, starving and
  hostile creatures hurt you. When knocked out you return to your spawn point and keep your bag;
  the map marks where it happened.
- The right tool mines faster. Stone and ores need a pickaxe, and better ores need a better one.
  Tools wear out. Tool tiers: wood → stone → iron → crystal → aether.

### Creatures (all original)

| Creature | Where | Behaviour | Drops |
|---|---|---|---|
| Mossback | Woods, isles | Peaceful grazer; flees when hit | Meat, hide |
| Crystal Golem | Crystal Desert | Calm by day, hunts at night or when provoked | Crystal shards, Golem Core |
| Cinder Beetle | Ember Peaks | Always hostile, trails embers | Embers |
| Crag Strider | Shatter Cliffs | Long-legged leaper; fights back if provoked | Hide, meat |
| Frostling | Frostfen | Ice sprite that hunts at night and in storms | Frost Core, snow |
| Sky Serpent | Floating Isles | Long flyer; dives at you at night, in storms, or when provoked | Scales, meat |
| Lumoth | Lumen Caverns | Glowing moth that drifts through the caverns | Lumen Dust |
| Glassfin | Seas and reefs | Small fish that darts away | Fish |

## Crafting, machines and magic

Press **E**. Recipes are grouped (Tools, Machines, Magic, Decor, Food, Blocks, Materials) and
searchable; missing ingredients show in red. Most advanced recipes need a **Workbench** within 4 blocks.

**Machines** (right-click to open):
- **Smelter**: turns copper and iron ore into ingots, aether ore into shards, sand into glass,
  basalt into polished basalt, logs into charcoal, and cooks meat and fish. Burns coal, charcoal,
  embers or wood. Its window glows while it works.
- **Chest**: 27 slots of storage.
- **Auto Drill**: put a chest beside it and some fuel in it, and it digs straight down on its own,
  dropping everything it mines into the chest.
- **Jump Pad**: step on it to be launched high into the air.
- **Waystone**: touch one to attune it. From any waystone you can travel to every other one you've
  attuned. Name them however you like.

**Magic artifacts**:
| Artifact | What it does |
|---|---|
| Lumen Staff | Conjures floating lights |
| Blink Charm | Teleports you 8 blocks forward |
| Storm Rod | Calls down lightning where you aim |
| Homeward Compass | Takes you back to your spawn point |
| Feather Cloak | While carried: you fall gently and take no fall damage |
| Tide Amulet | While carried: breathe underwater and swim fast |
| Ember Heart | While carried: lava can't hurt you |

**Decorative blocks**: chalk, lagoon and rose tiles, mosaic, checker tiles, bookshelves, planters,
rose glass, sea glass, crystal glass, polished basalt, copper panels, carved strata, paper lanterns,
iron lanterns, crystal lamps, iron and aether blocks, stone bricks, mossy cobblestone, thatch.

## Villagers, quests and trading

Each Glimmerfolk villager has a name, a job (Elder, Merchant, Smith, Mystic or Cook) and one of six
personalities: Cheerful, Grumpy, Dreamy, Nervous, Boastful or Wise. The personality changes what they
say and how they haggle. Their glowing sprout and clothes show their job.

- They wander the plaza by day, walk home at night, run indoors when hostile creatures come near,
  and greet you when you walk up.
- **They remember you.** Talking, trading, gifts and finished quests make them like you more, which
  lowers their prices and changes how they talk to you. Hitting them does the opposite.
- **Rumours** come from the real world around their village: ask "Any news?" and they'll tell you
  which way the nearest reef, desert or waystone is.
- **Quests**: fetch items, defeat creatures, craft something, carry a message to a neighbour, or
  explore a biome. The quest log (J) tracks progress; the map shows where to go.
- **Trading** uses **Glimmer** coins. Each villager buys and sells different things, and their stock
  changes every day.

The villagers are game AI (a behaviour state machine with memory and personality-driven dialogue),
not a chatbot, so they work offline and without any API key.

## Lighting and performance

- Smooth per-vertex lighting with ambient occlusion, coloured block light from torches, lava,
  crystals and glowing plants, and sunlight that floods into caves.
- Real-time sun and moon **shadows** from a shadow map that follows you.
- **Fog** that thickens in valleys, over water and in the morning, glows toward the sun, and turns
  dark underground. With **Light shafts** on, a ray-marched volumetric pass adds sunbeams through
  the fog and under water.
- A 12-minute day/night cycle; rain, storms with lightning, snow, ash and crystal glitter.

**Settings → Graphics** has Low, Medium, High and Ultra presets (picked automatically the first
time based on your device), plus view distance, shadow quality, light shafts, resolution, particles
and field of view. **Automatic performance** lowers the resolution by itself when the frame rate
drops. On older laptops and phones, choose Low: no shadows, 4-chunk view distance and 70% resolution.

## Your character

Open **Character** from the title screen or pause menu: skin, seven hairstyles, hair and eye
colour, four tops, three bottoms, shoes, eight hats (including a wizard hat, leaf crown and miner's
lamp), goggles or glasses, and a backpack, cape, wings or scarf. Press **V** to see yourself,
and **G** for emotes: wave, dance, cheer, sit, bow, point, clap and spin. Other players see your
outfit and emotes.

## Saving

Single-player worlds save every 30 seconds, when you pause and quit, and when you close the tab.
Only changed chunks are stored, along with your bag, machines, world rules, villagers, quests, waystones and
the parts of the map you've explored. **Pause → Export world** downloads a world file you can import
on another computer.

## Project layout

```
cave-craft/
├── server.js            Web server, rooms, profiles, moderation and the server browser API
├── server/serverworld.js  Chunk store for the server's copy of each world
├── package.json
└── public/              The game (plain ES modules, no build step)
    ├── index.html       Menus, HUD and panels
    ├── style.css
    ├── vendor/          three.js r160 (MIT, bundled so it works offline)
    └── js/
        ├── main.js      Game loop, input, mining, building, combat, magic, saving, multiplayer glue
        ├── consts.js    World size, sea level, biome names
        ├── terrain.js   Climate, biome blending, heights, village and ruin placement
        ├── gen.js       Chunk generation: cliffs, caves, caverns, ores, plants, trees, coral, villages
        ├── mesher.js    Light flooding and chunk meshing with ambient occlusion (runs in workers)
        ├── worker.js    Background worker entry point
        ├── world.js     Endless chunk streaming, block access, worker pool
        ├── render.js    Block shader, chunk meshes, shadow map, volumetric light pass
        ├── sky.js       Sun, moon, stars, clouds, weather, fog colours
        ├── blocks.js    Blocks, items, procedural textures and icons
        ├── inventory.js Inventory, recipes, smelting
        ├── machines.js  Chests, smelters, drills, waystones
        ├── npc.js       Villagers: personalities, dialogue, rumours, quests, trading
        ├── sim/         The world brain, shared by single-player and the server:
        │   ├── sim.js        creatures, villagers, items, machines, rules, chat, anti-cheat
        │   ├── fluids.js     flowing water and lava
        │   ├── mobs.js, villagers.js, npcdata.js, drops.js
        │   ├── modes.js      Sprint Trail, Gather Rush, Glimmer Arena
        │   ├── progression.js XP, skills, achievements, cosmetic unlocks
        │   └── rules.js      modes, world rules and roles
        ├── host.js      Talks to the world brain (in-page or over the network)
        ├── entview.js   Draws creatures, villagers, items and falling blocks
        ├── models.js    Creature models
        ├── (vendor/peerjs.min.js, MIT: peer-to-peer connections)
        ├── social.js    Server browser, world settings, profile, round HUD
        ├── avatar.js    Customisable player models and emotes
        ├── map.js       Minimap and world map
        ├── ui.js        HUD, bag, crafting and machine panels, quest log
        ├── menu.js      Title screen, avatar editor, settings
        ├── settings.js  Graphics presets and key bindings
        ├── storage.js   IndexedDB saves, export and import
        ├── player.js    Movement and survival stats
        ├── physics.js   Collision and ray casting
        ├── particles.js Particle effects
        ├── sfx.js       Synthesized sound effects
        └── noise.js     Seeded simplex noise
```

Every texture, icon, model and sound is generated in code. There are no image or audio files.

## Limits worth knowing

- Bags (inventories) are still kept by each player's own game, so the server can't stop someone who
  edits their own bag. Everything in the world itself is checked by the server.
- Profiles are tied to a random secret saved in your browser. Clearing site data makes a new profile.
- The server has no passwords or HTTPS of its own; keep it on your home or school network, or put it
  behind a proper web host.
- The hosted web preview can only play single-player: it isn't allowed to open network connections.
- Worlds saved by the first version of the game (the 192-block world) can't be loaded; this version
  uses a new save format.
- How smooth it runs depends on the graphics card. Use the Low preset on weak devices.

## License

The game code is yours to use and change. three.js is MIT licensed (see `public/vendor/three-LICENSE.txt`).

## Play on GitHub Pages (single-player)

The `docs/` folder is a ready-made copy of `public/` for GitHub Pages. In the repository go to
**Settings → Pages**, set **Source** to **Deploy from a branch**, pick **main** and **/docs**, and save.
After a minute the game is at `https://<your-name>.github.io/<repo-name>/`.
If you change `public/`, run `npm run build:docs` to refresh `docs/`.

## Easiest way to start the server

Install [Node.js](https://nodejs.org) (LTS), then double-click **Start Cave Craft.bat** (Windows) or
**Start Cave Craft.command** (Mac). It installs what it needs the first time, starts the server and
opens the game. Keep its window open while you play.
