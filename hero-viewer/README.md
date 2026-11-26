# Last Light Keep hero workshop

Open [the standalone viewer](standalone/index.html) directly in a WebGL-capable browser. It includes both models, all eight reference views and the renderer. It works offline.

Select a hero and camera angle to compare the model with its corresponding view at the same displayed height. Drag or use the arrow keys to rotate. Scroll or pinch to zoom, and Shift-drag or use two fingers to pan. Spin orbits the model. Reset restores the current preset and 100% zoom.

## Assets and comparisons

| Hero | glTF 2.0 asset | Model and reference |
| --- | --- | --- |
| Aldric Vane | [Aldric GLB](assets/aldric.glb) | [Four preset renders](comparisons/aldric-four-views.png) |
| Corwin Ashguard | [Corwin GLB](assets/corwin.glb) | [Four preset renders](comparisons/corwin-four-views.png) |

Both assets are posed, Y-up meshes normalized to 1.8 units tall. They carry their own textures and materials. Mesh names identify individual pieces, including Aldric’s crown locks, armor plates, scabbard and shield rim, and Corwin’s hood shell, lining, cloth panels, lantern cage, handle, glass and coal. Texture coordinates are fixed on the mesh as the camera moves.

The comparison sheets pair actual browser renders with crops of the supplied artwork. Each pair uses the same crop and scale.

## Visible differences

- **Aldric.** The outer hair locks, beard corners and cape tails meet at different angles in the three-quarter view. His shield reads thinner in profile, and its angle leaves a wider gap beside the tabard.
- **Corwin.** The hood folds and mantle tips are more regular around the shoulders. The three-quarter view leaves more space between his torso and lantern. The lantern glows more evenly across the coal than the sheet’s bright yellow core and dark red outer facets.
- **Three-quarter view.** The painted three-quarter pose is not a rigid turn of the other views: limbs are drawn narrower and parts are shifted. The model is fitted to the front, side and back views, so the three-quarter view matches less closely (see the scores below).
- **Close inspection.** The sheets only show each surface at a few angles. Paint can change abruptly across some armor bevels, knuckles and folded hems. The sheet artwork supplies the resolution of scars and weathering.

## Development

From the repository root, run `npm run dev` and open `/hero-viewer/`. To rebuild only the offline viewer, run `npx vite build --config hero-viewer/vite.config.js`. Its output is `hero-viewer/standalone/index.html`.

The game’s Almanac opens the same workshop at full size, with the current release number and the selected hero and motion version. In the standalone viewer, use `?hero=corwin` to start on Corwin or `?motion=v1` to start on Aldric’s original motion clips.

The model sources are in `authoring/`. From this directory, run `python3 -B -m authoring.export /path/to/aldric-sheet.png /path/to/corwin-sheet.png` with NumPy and Pillow installed. Use the original 1774 × 887 sheets. The exporter builds each mesh in sheet coordinates, bakes separate material finishes and wear for each mesh into a UV atlas, and writes the GLBs and reference crops into `assets/`. The sheets are in `docs/art/` at the repository root.

`python3 -B -m authoring.fit <hero> <sheet>` nudges each modeled assembly (at most 8 px and 8% scale; connected pieces such as a whole arm or the lantern and the hand that holds it move together) to match the front, side and back silhouettes, and writes `authoring/fit-<hero>.json`. The exporter applies it. Re-run the fit after changing a model, then export.

`python3 -B -m authoring.score <aldric sheet> <corwin sheet> [outdir] [hero]` exports, renders each model in sheet coordinates and prints, per view, the silhouette overlap and the share of overlapping pixels painted within 48 RGB of the sheet (2 px tolerance). With an `outdir`, it writes model, sheet and difference strips. The three-quarter view uses the viewer's fixed turn.

Historical measurements for the previous projected-paint bake follow.

| Hero | Front | Three-quarter | Side | Back |
| --- | --- | --- | --- | --- |
| Aldric, silhouette / paint | 95.5% / 95.8% | 89.0% / 75.8% | 92.3% / 86.4% | 93.5% / 92.5% |
| Corwin, silhouette / paint | 93.9% / 95.9% | 86.8% / 73.2% | 91.2% / 88.9% | 90.4% / 96.7% |

## Aldric’s animations

Use the buttons beneath the models to preview Idle, March, March v2, Rally the Line, Shield Wall, Shield Wall v2, The Gate Holds, The Gate Holds v2, Normal Attack, Taking Damage, or Defeated. Idle and both marches loop. The comparison pane shows the static reference sheet for the selected camera preset. Each skill plays once and holds its final frame. The scrubber and frame buttons pause playback and sample the clip at 30 frames per second. Pause holds the current pose, Replay starts the selected clip again, and Reference pose restores the original stance. The downloadable Aldric GLB includes all eleven clips, articulated armor, the rally standard, and the spectral gate.
