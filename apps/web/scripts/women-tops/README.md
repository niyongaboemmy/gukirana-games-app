# Women's tops (P2-AVA-17)

Real garments for the feminine campus body: every feminine top kind is its own mesh, cut from the body and draped
with Blender cloth, instead of the body's baked blazer. The runtime side is `apps/web/src/world/human/women-tops.ts`
(the per-item switch `SHIPPED_TOPS`, the body rebuild) and the `uWear` path in `world/human/materials.ts`.
QA: `docs/QA/women-tops/audit.md`.

## Rebuild

Needs Blender 5.2 on `PATH` (or `BLENDER=/path/to/blender`), nothing else.

    sh apps/web/scripts/women-tops/build.sh              # every kind, ~15 min on an M2 Pro
    sh apps/web/scripts/women-tops/build.sh --no-prep tee hoodie

It writes `apps/web/public/assets/characters/women-tops/wt-<kind>.bin` + `.webp` (about 200–310 KB per kind) and keeps
its Blender files and logs in `apps/web/scripts/women-tops/work/` (git-ignored). Only the kinds of shipped items are
committed (today `tee`, 217 KB); a kind is committed together with turning its items on.

## Steps

1. `prep.py` (feminine.glb, ~5 s): the body in its rest frame; regions per face from the recolour mask (the blazer =
   the top region + its pocket flaps + the shirt cuffs, which the mask calls trousers / skin); `kept` = the body
   without the blazer and without the trousers' inward-facing lining; `form` = the outer envelope of the body
   (solidify → 8 mm voxel remesh → outer faces only), its tailoring smoothed away (collar laid onto the neck skin,
   lapels / buttons / pockets smoothed, the trunk taken in by the jacket's thickness, the hips rebuilt between the
   upper thighs and the waist, the sleeves reshaped round the arm bones to an adult woman's arm), the body's skin
   weights on it.
2. `garment.py --kind <k>` (~2–3 min): the panel cut from a 24 mm re-mesh of the form by the cut rules of `KINDS`
   (neckline shape / depth / width, sleeve end along the arm, hem below the hip joints); pushed out to the surface
   fabric hangs on (from the bust it falls with a limited slope, the valley between the breasts is spanned), plus
   the ease; skin weights; soft cloth goals (firm at the neckline, free at the hem); simulated while the arms come
   down from the A-pose into a relaxed pose (30 + 40 frames, self collision, the form as collider); un-skinned to
   the rest pose; Taubin-smoothed and kept 2 mm outside the body; the same on a 4× denser copy for the bake; turned
   hems (2.5 mm lip + 1 cm inner facing) on every border. Also cut: the bare skin this top leaves (arms from inside
   the sleeve to 4.5 cm into the hand, narrowing there; the chest / back under the neckline) and a trousers band
   under the hem, both sunk under the form.
3. `bake.py --kind <k>` (~10 s): UVs; Cycles bakes the dense simulation (laid over a smoothed copy of the low
   garment) into a tangent-space normal map and the garment's occlusion on the body; packed as RGB = normal x, normal y,
   occlusion, 512², WebP; a decimated far level of every part; the binary asset (quantised positions in the body
   geometry's bind space, normals, UVs, 4 bone weights by bone name) that `parseTopAsset` reads.

## Tuning a kind

`KINDS` in `garment.py`: `neck` (crew / vee / scoop / mock), `depth`, `width`, `sleeve` (0 shoulder joint, 1 elbow,
2 wrist; > 1.9 = long with the arm skin only near the cuff), `hem` (m below the hip joints, keep ≥ 0.15: the
trousers bulge above that line), `ease`, cloth `mass` / `tension` / `bending`, `slope`, `goal_hem`.
Turn an item on in `SHIPPED_TOPS` only after the before / after review (`qa/e2e/human-assess/women-tops.mjs`).

## P2-AVA-18 changes (clean edges)

- `garment.py`: after the simulation and the push out of the body, a **calm** pass (`calm_weights` / `calm`): Taubin
  steps weighted per vertex where the cloth crumpled — the underarm (round the upper arm and the torso's side down to
  the hem), a band of four rings along every border, the front above the hem — then only points still more than 3 mm
  inside the body are pushed out, and the skin weights in those zones are smoothed (no arm weight on the torso below
  the armpit). `--calm 0` turns it off. The turned hems are now marked (`hem` = 1) on the extruded lip / facing faces
  (extruded faces inherited the cloth layer, so nothing had been marked).
- `bake.py`: the hems take the cloth's smooth normal (`lip_normals`: no more row of pale beads along the neckline and
  sleeve ends); only the garment and the trunk occlude in the AO bake; the fold normal map is softened (~7 texel
  normalised blur, clamped) and flat on the hem texels (a dent the dense simulation left on the side baked in as a lump).
- The tee items stay held behind `realism-v2.ts` `womenTee` (docs/QA/human-realism-v2/README.md).

