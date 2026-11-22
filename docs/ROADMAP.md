# Roadmap

## Done

- **3.0 Beat of War.** Added the War Drum, a Barracks rework, the three spells, the War Council skill tree and star tracks for each difficulty.
- **3.1 The Last Light.** Renamed the game from Voxel Siege to Last Light Keep and added the beacon-fire lore: the Keep's fire is the last one burning against the Ashen King.
- **Repo move.** Moved from a single artifact file to a Vite project with `AGENTS.md`/`CLAUDE.md`, `patches.json` and an art pipeline.

## Next: 4.0 Painted UI

Replace the placeholder UI with painted art: a new logo, 19 badges, spell icons, and Brannock portraits in 4 expressions. This is waiting on the images. The checklist is in `ART.md`.

## Later

- Build the planned levels (`map: null` in `LEVELS`): 2-2, 2-3, 3-2, 4-2 and 4-3 (the Ashen Throne).
- Keep splitting `src/main.js` into modules where sections can stand alone. The constraint is described in `AGENTS.md`.
