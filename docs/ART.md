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
- [ ] **19 badges.** List them here by key when the art lands.
- [ ] **Spell icons.** Militia Call, Catapult Barrage, Frost Nova.
- [ ] **Captain Hollis Brannock portraits, 4 expressions.** Name each file `brannock-<expression>.webp`.
