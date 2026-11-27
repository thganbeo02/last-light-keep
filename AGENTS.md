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
npm test         # Vitest: engine rules and simulator checks
npm run typecheck
```

## Layout

| Path | What it holds |
| --- | --- |
| `index.html` | All the UI markup: HUD, title, world map, briefing, almanac, patch notes and the skill tree. |
| `src/main.js` | The renderer and UI, split into sections marked `// ====` and `// ----` (scene, maps, enemy, tower and soldier models and their views, effects, camera, the engine bridge, input, spells, campaign, cloud save, War Council, patch notes, almanac, HUD, loop). It reads the shared balance data and draws the engine’s battle state. |
| `src/utils.js` | Math, noise and colour helpers. |
| `src/patches.json` | In-game patch notes, newest first. The first entry is the version the title screen shows. |
| `src/style.css` | All the styles. |
| `src/art/` | Painted art as WebP files. `almanac/` holds tower forms (`arrow-1` … `drum-b`), enemies (`e_*`) and soldiers (`u_*`), which load automatically through `import.meta.glob`. See `docs/ART.md`. |
| `src/engine/` | The battle engine in TypeScript: every battle rule, pure and deterministic, with no DOM, Three.js, clock or `Math.random` (use `rng.ts`). The game runs it through the engine bridge in `main.js`. |
| `src/content/` | Shared balance data for the engine and UI. Edit the corresponding content module directly. |
| `test/` | Vitest tests for the engine and simulator. |
| `tools/` | The simulator (`npm run sim`), which plays Watch battles on the engine and compares them with `test/baseline.json`. |
| `docs/` | The art pipeline and milestone checklists (`M1.md` engine, `M2.md` renderer on the engine, `M3.md` heroes). |

## Rules

- **Battle rules live in `src/engine/` only.** `main.js` draws the engine's records, plays its events and sends the player's actions as inputs (the engine bridge section). A gameplay change is an engine change with a test; change shared balance data in `src/content/`. Run `npm test` and `npm run typecheck` before committing, and `npm run sim` after a balance change.
- **The rebuild:** work through the current milestone's doc in `docs/` in order and tick its steps in the same change; note any bug found there.

- **Never change the save keys** `voxelSiege.stars.v1` and `voxelSiege.save.v2`, or the cloud document path `data/users/<id>/save`. They predate the rename, and live players' progress depends on them. If the save shape changes, update `mergeSave()` so that old saves still merge.
- **Use `src/patches.json` for versioned releases.** Write one entry for the release batch and cover meaningful player-visible changes. Typos and small copy edits can ship under the current version without a patch note.
  - Patch format: `{v, title, blurb, hi: [[name, icon, text]], sec: [[section, items]]}`.
  - Item format: `[name, icon, tag, summary, lines]`. `tag` is one of `new`, `buff`, `nerf` or `change`.
  - Line format: `[stat, old, new, kind]` or `[text, kind]`. `kind` is `b` (buff, green), `n` (nerf, red), `c` (change) or `new`.
  - Colours are from the player's side: a change that makes enemies stronger is a nerf.
  - Icons are keys in `PN_GLYPH`/`SKI`, or `tw:<tower>` / `en:<enemy>` for art.
- Keep the build a single file. Load nothing at runtime from new hosts: artifacts only allow scripts from a few CDNs and fonts from Google Fonts.
- The game keeps much of its state in shared top-level variables. Move a section into its own module only when it can stand alone, as `utils.js` does. Imported bindings are read-only, so a `let` that other sections reassign cannot be moved out as it stands.
- Test hooks on `window`: `__g()` returns the game state, `__step(n)` runs n ticks at 30 per second, `__probe(s)` simulates s seconds, `__shot(name)` takes a camera shot, `__enemyDims()` returns each enemy type's centre height, `__muzzles()` each tower form's muzzle height, `__towerStats(ids)` every attacking tower form's stats and costs with the given War Council picks, `__barrStats(ids)` every Barracks form's soldier stats, `__drumStats(ids)` every War Drum form's stats, `__G()` the engine's battle, `__eIn(input)` queues a player action for its next step, `__setGold(n)` sets the battle's gold, and `__mapInfo(i)` rebuilds map i and returns its plots, path lengths, samples and tiles (the source of `test/fixtures/maps-3x.json`). Use them to check a change in the browser without playing by hand.
- Testing mode: on the world map, tap the star counter 5 times. Every level, tower and spell opens (`save.dev`).

## Wrap up

- An explicit **“wrap up”** authorizes one focused Git commit for the current task. Otherwise, commit only when the user asks. Preserve unrelated work, including changes already staged.
- Use `type(scope): imperative summary` for commit subjects, for example `docs(workflow): document the wrap-up process`. Keep any commit body under 50 words and use it for context the diff alone cannot explain.
- Finish the task, run the relevant checks and `git diff --check`, and add a short dated entry to `CHANGELOG.md` (create it if needed). Record what changed, the checks run, and any known limitations. Stage and commit only the task's changes, then summarize the outcome and give the commit hash.
- Version bumps, Git pushes, and Claude artifact publishing each require a separate explicit request. A release or publish request also covers its commit (see Publishing). The user can combine requests in one message, such as **“wrap up and publish to the artifact.”**

## Publishing

Keep the version fixed during development, local builds, and previews. Bump the `v` shown in game once per batch, before the release build, when the user asks for a versioned release or explicitly requests a bump. Publishing small fixes can reuse the current version.

1. Commit first. A request to release or publish a version includes committing it: write the patch note, bump the version, add the `CHANGELOG.md` entry, run the checks, and commit, so the published build matches a commit. Never publish from uncommitted changes.
2. Run `npm run build` to generate `dist/index.html` from that commit.
3. Publish `dist/index.html` to the **same** artifact URL, `https://claude.ai/artifact/APmUNmJzfP4saKjkqWW2kJ`, so the link and the cloud saves keep working.
4. The artifact needs the `db` and `user` capabilities. They persist across redeploys, so leave the capabilities field out when republishing.
