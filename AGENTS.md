# Last Light Keep: agent guide

Shared instructions for Claude Code, Codex, and any other coding agent. `CLAUDE.md` only imports this file, so put every rule here.

## What this is

Last Light Keep (formerly Voxel Siege) is a 3D voxel tower-defense game in the Kingdom Rush style, built with Three.js. It ships as **one self-contained HTML file** published as a claude.ai artifact, and players' progress is cloud-saved in that artifact's database.

## Commands

```bash
npm install
npm run dev      # http://localhost:5173 (Vite)
npm run build    # writes dist/index.html, a single file with all JS, CSS and art inlined
npm run preview  # serves the built dist/
npm test         # Vitest: engine rules and the content parity check
npm run typecheck
npm run extract  # copies balance constants from src/main.js into src/content/
```

## Layout

| Path | What it holds |
| --- | --- |
| `index.html` | All the UI markup: HUD, title, world map, briefing, almanac, patch notes and the skill tree. |
| `src/main.js` | The game, split into sections marked `// ====` and `// ----` (renderer, maps, enemies, towers, barracks, war drum, waves, AI, camera, input, spells, campaign, cloud save, War Council, patch notes, almanac, HUD, loop). |
| `src/utils.js` | Math, noise and colour helpers. |
| `src/patches.json` | In-game patch notes, newest first. The first entry is the version the title screen shows. |
| `src/style.css` | All the styles. |
| `src/art/` | Painted art as WebP files. `almanac/` holds tower forms (`arrow-1` … `drum-b`), enemies (`e_*`) and soldiers (`u_*`), which load automatically through `import.meta.glob`. See `docs/ART.md`. |
| `src/engine/` | The rebuild's battle engine in TypeScript: pure and deterministic, with no DOM, Three.js, clock or `Math.random` (use `rng.ts`). Not bundled into the game yet. |
| `src/content/` | Balance data generated from `main.js` by `npm run extract`. Don't edit it by hand while `main.js` is the live game. |
| `test/` | Vitest tests. `content.test.ts` fails when `src/content` and `main.js` drift apart. |
| `tools/` | Node scripts: content extraction now, the simulator later. |
| `docs/` | The art pipeline, and `M1.md`, the milestone 1 plan and checklist. |

## Rules

- **The rebuild:** work through `docs/M1.md` in order and tick its steps in the same change. Port behaviour as it is first, and note any bug found in `docs/M1.md`. Run `npm test` and `npm run typecheck` before committing.

- **Never change the save keys** `voxelSiege.stars.v1` and `voxelSiege.save.v2`, or the cloud document path `data/users/<id>/save`. They predate the rename, and live players' progress depends on them. If the save shape changes, update `mergeSave()` so that old saves still merge.
- **Use `src/patches.json` for versioned releases.** Write one entry for the release batch and cover meaningful player-visible changes. Typos and small copy edits can ship under the current version without a patch note.
  - Patch format: `{v, title, blurb, hi: [[name, icon, text]], sec: [[section, items]]}`.
  - Item format: `[name, icon, tag, summary, lines]`. `tag` is one of `new`, `buff`, `nerf` or `change`.
  - Line format: `[stat, old, new, kind]` or `[text, kind]`. `kind` is `b` (buff, green), `n` (nerf, red), `c` (change) or `new`.
  - Colours are from the player's side: a change that makes enemies stronger is a nerf.
  - Icons are keys in `PN_GLYPH`/`SKI`, or `tw:<tower>` / `en:<enemy>` for art.
- Keep the build a single file. Load nothing at runtime from new hosts: artifacts only allow scripts from a few CDNs and fonts from Google Fonts.
- The game keeps much of its state in shared top-level variables. Move a section into its own module only when it can stand alone, as `utils.js` does. Imported bindings are read-only, so a `let` that other sections reassign cannot be moved out as it stands.
- Test hooks on `window`: `__g()` returns the game state, `__step(n)` runs n ticks at 30 per second, `__probe(s)` simulates s seconds, `__shot(name)` takes a camera shot, `__enemyDims()` returns each enemy type's centre height, `__muzzles()` each tower form's muzzle height, `__towerStats(ids)` every attacking tower form's stats and costs with the given War Council picks, and `__mapInfo(i)` rebuilds map i and returns its plots, path lengths, samples and tiles (the source of `test/fixtures/maps-3x.json`). Use them to check a change in the browser without playing by hand.
- Testing mode: on the world map, tap the star counter 5 times. Every level, tower and spell opens (`save.dev`).

## Publishing

Keep the version fixed during development, local builds, and previews. Bump the `v` shown in game once per batch, before the release build, when the user asks for a versioned release or explicitly requests a bump. Publishing small fixes can reuse the current version.

1. Run `npm run build` to generate `dist/index.html` locally. Deployment is a separate step.
2. Publish `dist/index.html` to the **same** artifact URL, `https://claude.ai/artifact/APmUNmJzfP4saKjkqWW2kJ`, so the link and the cloud saves keep working.
3. The artifact needs the `db` and `user` capabilities. They persist across redeploys, so leave the capabilities field out when republishing.
