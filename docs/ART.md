# Art pipeline

1. **Source.** Keep the full-size originals (PNG/PSD) outside the repo, or in `art-src/`, which is git-ignored.
2. **Export.** Save as WebP, quality 80–85, with a transparent background for icons and units. Rough sizes:
   - almanac and unit art: 240×240, about 10–25 KB
   - badges and spell icons: 128×128
   - portraits: 512×512
   - title art: 1600×900, under 250 KB

   No WebP exporter? Run `npx @squoosh/cli --webp '{quality:82}' file.png`, or `brew install webp` and then `cwebp -q 82 in.png -o out.webp`.
3. **Place.** Put the file in `src/art/<group>/<key>.webp`. Vite inlines it into the single-file build, so no other wiring is needed beyond an import or a glob.
   - `src/art/almanac/`: tower forms (`arrow-1`, `arrow-a`, …), enemies (`e_<type>`) and soldiers (`u_<type>`). These load automatically.
   - `src/art/` root: the title key art (`title-art.webp`) and the old Voxel Siege logo (`logo.webp`). The logo is unused now.
4. **Check the size.** `npm run build` prints the size of `dist/index.html`. It must stay under 16 MB, the artifact limit, and smaller loads faster.

## Wanted for 4.0 (Painted UI)

- [ ] **Last Light Keep logo.** Until it arrives, a text wordmark stands in (`.t-word` in `index.html` and `style.css`). To use it, swap the `<h1 class="t-logo t-word">` back to `<img src="/src/art/logo.webp">`.
- [x] **19 badges** in `src/art/badges/`, each a 256×256 round WebP with transparent corners. The size lets them show sharp at 128 px. The tower ring uses them.
    - Actions: `action-build`, `action-rally`, `action-sell`, `action-targeting`, `action-upgrade`.
    - Specialisations: `volley`, `longbow`, `inferno`, `storm`, `overload`, `siege-mortar`, `scattergun`, `deep-freeze`, `glacier-field`, `fireline`, `paladins`, `rangers`, `war-horn`, `hex-totem`.
    - Tower types (bronze rim, used by the build ring): `tower-arrow`, `tower-cannon`, `tower-frost`, `tower-tesla`, `tower-flame`, `tower-barracks`, `tower-drum`.
    - The originals (1254 px PNG) stay outside the repo.
- [x] **Spell icons** in `src/art/spells/` (`militia`, `catapult`, `nova`): white background removed, 256 px WebP. The spell bar uses them. Taken from `spell-militiaman`, `spell-boulder-barrage-v2` and `spell-frost-burst`. Three other Frost Nova variants are unused.
- [x] **Heroes: Aldric Vane and Corwin Ashguard.** Battle selection, HUD portraits and abilities, and Almanac cards use the painted WebP art.
    - Badges: `src/art/badges/hero-aldric`, `hero-corwin` (256 px, iron rim with an ember edge, the hero family).
    - Ability icons: `src/art/heroes/ab-<ability>` (256 px): `rally-the-line`, `shield-wall`, `the-gate-holds` (Aldric); `kindle`, `ashen-ward`, `undying-coal` (Corwin).
    - Portraits: `src/art/heroes/<hero>-<expression>` (512 px): `neutral`, `determined`, `hurt`, `triumphant`.
    - Almanac cards: `src/art/almanac/u_aldric`, `u_corwin` (256 px).
    - The originals (1254 px PNG, portraits 512 px) stay outside the repo.
- [x] **Model reference sheets** for [Aldric](art/aldric-sheet.jpg) and [Corwin](art/corwin-sheet.jpg). The four views and palette swatches guided the voxel models. The sheets ship with the docs only.
