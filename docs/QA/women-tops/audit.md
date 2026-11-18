# P2-AVA-17 — women's tops: simulated garments instead of the baked blazer

Follows P2-AVA-16 (`docs/QA/human-defects-2/audit.md`, held item "feminine tops"). The feminine campus body always drew
its baked blazer and shirt, whatever top was chosen. This pass replaces it, per item, with a real garment built in
Blender (`apps/web/scripts/women-tops`, README there) and merged into the body at runtime
(`apps/web/src/world/human/women-tops.ts`, `uWear` path in `world/human/materials.ts`). Gated by the existing realistic
campus people flag (`NEXT_PUBLIC_FF_CAMPUS_HUMANS`); no new flag. Item ids unchanged.

**Shipped: T-shirt (`tee`), White tee (`tee-white`), Imigongo print top (`imigongo-top`).**
**Held (keep the baked blazer, per-item switch `SHIPPED_TOPS`): Sport jersey, Hoodie, Track top, Kitenge shirt (sun,
leaf), Umushanana-inspired sash, Kitenge sash (wave).** The two blazers are the body's own garment (no change).

## What was built

- **The form** (`prep.py`): the feminine body's outer envelope (solidify → 8 mm voxel remesh → outer faces), with the
  blazer's tailoring removed: the collar laid onto the neck skin, lapels / button / pocket flaps smoothed out, the
  trunk taken in by the jacket's thickness, the hips rebuilt between the upper thighs and the waist (the trousers bulge
  into the jacket's flared skirt under it), the sleeves reshaped round the arm bones to an adult woman's arm. It is the
  cut source, the cloth collider and the bare-arm skin.
- **The garment** (`garment.py`): cut from a 24 mm re-mesh of the form (crew neck, short sleeve, low-hip length for the
  tee), pushed out to the surface fabric hangs on (from the bust it falls at a limited slope, the valley between the
  breasts spanned), plus 6 mm ease; Blender cloth (tension 80, bending 2, soft goals: firm at the neckline, free at the
  hem, self collision) while the arms come down from the A-pose into the relaxed pose (30 + 40 frames), un-skinned to
  the bind pose (inverse blend of bone matrices) so skinning in the relaxed pose gives the simulated shape back; Taubin
  smoothing, hems relaxed into smooth lines, ≥ 2 mm off the body. Every border turned: a 2.5 mm lip towards the body
  and a 1 cm facing inside (kept 0.6 mm outside the skin), sharp normals at the turn.
- **Folds for phones** (`bake.py`): a 4× denser copy simulated too (bending ×3, no crumples) laid over a smooth
  subdivision of the low garment; Cycles bakes its folds into a tangent-space normal map and the garment's occlusion on
  the body (armpits, under the bust, the folds' valleys), softened and packed into one 512² WebP (RGB = normal x,
  normal y, occlusion, 39 KB). Low garment 3 318 triangles, far level 1 326.
- **The blazer removed cleanly** (`keptTriangles`): every body triangle of the mask's top region, its pocket flaps and
  shirt cuffs (trousers / skin in the mask), the trousers' inward-facing lining round the hips and the trousers' top
  under the garment (above its hem + 1.5 cm). Nothing of the blazer is left: no shoulder tips, cuff ring, collar roll
  or hem. The asset brings the skin the top leaves bare (arms from inside the sleeve to 8 cm into the hand, narrowing
  there so the wrist never opens; the chest / back under the neckline, sunk 1.5 mm under the body's own skin) and a
  trousers band under the hem (seen when looking up under the top).
- **Same draw calls**: garment, skin and trousers band are appended to the body geometry itself (one geometry per body
  level and kind, shared by everyone wearing it); the body shader tells them apart by a UV offset (u + 4 / + 6 / + 8)
  and gets the fold map as one extra texture. Print and weave per item as before (prints laid in metres, P2-AVA-15).
  Skinned to the same skeleton (bone weights from the body via the form).

## How it was checked

Dev human lab (`/play/human-lab`), day light rig, Chrome headless over raw CDP (`qa/e2e/human-assess/women-tops.mjs`,
no packages). The page clock (performance.now, Date.now, rAF timestamps) is a virtual frame clock frozen 240 frames
after load, so before and after hold the same pose. Before = `?wtops=none` (every top on the baked blazer), after =
`?wtops=all` (every garment on), same look (feminine, skin #6E4530, bun, jeans), camera and light. Front / 3/4 /
profile 560² close-ups, full body and a walking frame 420×700. Pairs combined by `women-tops-combine.py` (≤ 120 KB).
Inspected at full size.

## Per item

| Item | Garment | Verdict | Why |
|------|---------|---------|-----|
| T-shirt (`tee`) | tee | **shipped** | The chosen tee shows (crew neck, short sleeves) instead of a blazer; soft folds under the bust, at the waist and the armpits, turned hems; arms and wrists continuous; no blazer remnants. Small residual: a few shallow creases near the hem front. |
| White tee (`tee-white`) | tee | **shipped** | Same garment; on white the folds read through the occlusion map, no grey blazer shading left. |
| Imigongo print top (`imigongo-top`) | tee | **shipped** | The print lies at real-world size on the folds; the blazer's lapel / pocket distortion of the print is gone. Arms-up frame (life emote) holds. |
| Sport jersey (`jersey`) | jersey (V-neck) | held | The V-neck simulates into an uneven, slightly ragged neckline; lumps at the chest and a crumple at the front hem. Better than the blazer at showing the item, but those are new defects. |
| Kitenge shirt, sun / leaf | shirt | held | Good print and body, but the open end of the sleeve turns out into a small flap on one side (the forearm sweeping down in the drape catches it). |
| Hoodie (`hoodie`) | hoodie | held | Long sleeves: the upper sleeve folds out into a wing as the arm comes down; no hood modelled yet. |
| Track top (`track`) | track | held | Same wing on the long sleeves. |
| Umushanana-inspired sash, Kitenge sash (wave) | sash + band | held | The sash band (second colour) came out as a thin line, a sleeve flap, and the trousers show through at one hip. |
| Blazer, Cream blazer | (the body's own blazer) | unchanged | |

Evidence (`*.jpg`, before | after): `<item>_{front,q34,profile,full,walk}` for tee, tee-white, imigongo-top, jersey,
kitenge-sun, kitenge-leaf; `<item>_{front,q34}` for hoodie, track, mushanana, sash-wave. (The walk frame of
imigongo-top caught a stretch emote of the lab's life layer: arms raised, the garment follows.)

## Performance (human lab crowd mode, 20 people, headless Chrome / Metal, frame rate uncapped, median of 3)

| viewport | before fps | after fps | draw calls | triangles | textures |
|----------|-----------:|----------:|-----------:|----------:|---------:|
| desktop 1280×720 DPR 1 | 480.5 (480.5 / 490.1 / 469.0) | 475.0 (477.6 / 475.0 / 463.3) | 152–153 → 152–153 | 273.6–298.7 k → 350.8–375.9 k | 80 → 84 |
| phone 844×390 DPR 2 | 456.0 (467.3 / 456.0 / 444.0) | 431.1 (431.1 / 468.8 / 425.0) | 154 → 154 | 273.6–298.7 k → 350.8–375.9 k | 80 → 84 |

Raw samples: `perf.json`. The triangle count rises by ~77 k for the crowd's feminine people (each garment adds
~3.3 k triangles near, ~1.3 k far, plus its skin / trousers band, minus the removed blazer).

`after` = every feminine top on its garment (`wtops=all`, the worst case: shipped items are a subset). The machine is
shared, single samples swing ±5 %: desktop unchanged within noise, phone −5 % median (one after sample is above every
before sample); no new draw calls (the garment is part of the body geometry), one extra texture per
garment kind in use.

## Size

Committed: `wt-tee.bin` (178 KB) + `wt-tee.webp` (39 KB). The held kinds are not committed; `build.sh` rebuilds them
(about 15 min for all six).

## Not fixed / left

- Held items above. Long sleeves need an underarm gusset (or a drape that starts with the arms down); elbow sleeves a
  firmer cuff; the sash band a better projection over the shoulder.
- No walk / sit correctives: the garment follows the skeleton by skinning; the walk frames hold, a deep sit was not
  reviewed separately.
- The old P2-AVA-16 refit path (`garment-fit.ts`, `FEMININE_CUTS = false`) stays in the tree, unused for the feminine
  body.
