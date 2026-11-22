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
| `docs/` | The roadmap and the art pipeline. |

## Rules

- **Never change the save keys** `voxelSiege.stars.v1` and `voxelSiege.save.v2`, or the cloud document path `data/users/<id>/save`. They predate the rename, and live players' progress depends on them. If the save shape changes, update `mergeSave()` so that old saves still merge.
- **Every player-visible change gets a `src/patches.json` entry.**
  - Patch format: `{v, title, blurb, hi: [[name, icon, text]], sec: [[section, items]]}`.
  - Item format: `[name, icon, tag, summary, lines]`. `tag` is one of `new`, `buff`, `nerf` or `change`.
  - Line format: `[stat, old, new, kind]` or `[text, kind]`. `kind` is `b` (buff, green), `n` (nerf, red), `c` (change) or `new`.
  - Colours are from the player's side: a change that makes enemies stronger is a nerf.
  - Icons are keys in `PN_GLYPH`/`SKI`, or `tw:<tower>` / `en:<enemy>` for art.
- Keep the build a single file. Load nothing at runtime from new hosts: artifacts only allow scripts from a few CDNs and fonts from Google Fonts.
- The game keeps much of its state in shared top-level variables. Move a section into its own module only when it can stand alone, as `utils.js` does. Imported bindings are read-only, so a `let` that other sections reassign cannot be moved out as it stands.
- Test hooks on `window`: `__g()` returns the game state, `__step(n)` runs n ticks at 30 per second, `__probe(s)` simulates s seconds, and `__shot(name)` takes a camera shot. Use them to check a change in the browser without playing by hand.
- Testing mode: on the world map, tap the star counter 5 times. Every level, tower and spell opens (`save.dev`).

## Publishing

1. Run `npm run build`.
2. Publish `dist/index.html` to the **same** artifact URL, `https://claude.ai/artifact/APmUNmJzfP4saKjkqWW2kJ`, so the link and the cloud saves keep working.
3. The artifact needs the `db` and `user` capabilities. They persist across redeploys, so leave the capabilities field out when republishing.
