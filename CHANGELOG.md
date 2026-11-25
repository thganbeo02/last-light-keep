# Changelog

## 2026-11-25 — 3.3 Captain and Coal

- Added Aldric Vane and Corwin Ashguard as pre-battle and replay picks, with HUD abilities, animated voxel rigs, and eight playable Almanac clips each. Hero movement cuts across clear terrain and interpolates between engine ticks.
- Restored War Drum ability effects and per-target Shaman heal sparkles. The UI and engine now read the same balance data from `src/content/`.
- Verified with `npm test` (120 tests), `npm run typecheck`, `npm run build`, and `git diff --check`. Chrome verified Corwin’s eight clips, playback controls, movement, and Kindle. Watch benchmarks match the pre-release engine on all seven maps. River Crossing, Highland Pass, and Ember Crater retain their existing gaps against the 3.2 recording.
- Hero balance is a first pass.

## 2026-11-24

- Milestone 2 (branch `m2/renderer-port`): battles run on the engine. `main.js` draws the engine's records (enemies, towers, soldiers, projectiles, ground patches), plays its events as effects, and sends the player's actions as inputs; about 850 lines of 3.x battle rules are deleted. The baseline is re-recorded from 3.2 with the Shaman fix. Tesla chains, Meltdown and Flashover now carry drawing info in their engine events.
- Verified with `npm test` (117 tests), `npm run typecheck`, a TypeScript check of `main.js` for undefined names, `npm run sim` (all maps match except Ember Crater's castle health, 22 against 10), `git diff --check`, and in the browser: Watch battles on every map and a played battle through every action. Not yet drawn: the War Drum's Thunder and Charge pulses, and per-enemy Shaman heal sparkles.
- Fixed in 3.2: Goblin Shamans heal again and Frost Wraiths sway and trail again. The 3.2 Ogre animation change deleted both blocks by accident; they are restored exactly as in 3.1. Verified with `npm test`, `npm run build` and `git diff --check`.
- Gameplay and polish batch, first published under 3.1, then bumped to 3.2 "Heavy Footsteps": its patch notes moved from 3.1 into a new 3.2 entry, and package.json is now 3.2.0:
  - Gruk's Mire Stomp: every 12 s, once a tower is within 2.5 tiles, a 0.7 s wind-up, then towers within 2.5 tiles are stunned for 2 s. In the game and the engine.
  - Calling a wave early takes the seconds skipped off every spell cooldown, in the game and the engine.
  - The Ogre Brute and Gruk share a smoothed heavy animation: sway, breathing while fighting, a club wind-up and slam, and Gruk's stomp wind-up. The first Ogre version threw an error on every hit and dropped a frame; that's fixed.
  - Spell buttons show the game's tooltip on hover. Upgrade previews show a stat that drops, such as Rangers' health, in red.
- Verified with `npm test` (117 tests), `npm run typecheck`, `npm run sim` on Mire's Edge (still matches 3.x), and `git diff --check`. Checked spell tooltips, the cooldown cut and an error-free Gruk battle in the browser. Not checked by eye: the animation, and the red upgrade stat.
- Added the hero art for Aldric Vane and Corwin Ashguard: 2 badges, 6 ability icons, 8 portraits and 2 Almanac cards, cut to transparent WebP. The art isn't used by the game yet; heroes arrive with the rebuild. The model reference sheets are still to come.
- Verified with `npm run build` (2.9 MB, about 120 KB more, since the Almanac cards load automatically) and `git diff --check`.
- Documented the wrap-up workflow for recording checked work in one focused commit. Version bumps, Git pushes, and Claude artifact publishing each require an explicit request.
- Verified with `npm test` (114 tests), `npm run typecheck`, and `git diff --check`.
