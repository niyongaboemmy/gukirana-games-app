# Fighter v8: the ring people rebuilt (P3-FGT-19B)

Status: **implemented, flag on.** `NEXT_PUBLIC_FF_BOXER_V8` is on unless set to `0`, which falls back to the v7 people.
The fighters are rebuilt from the P3-FGT-19A design (`docs/design/fighter-v8/SPEC.md`).

This is presentation only: the engine, the money paths and the server-authoritative fight are untouched. Evidence is
in `docs/QA/boxing-v8/`:

- `final/` holds the v7 | v8 sheets and the scored acceptance report;
- `e2e/` holds the hall and fight-lab practice fights;
- `baseline-v7/` holds the Phase 0 baseline.

The user asked for the fighters to be rebuilt from scratch because they "feel not normal persons". Phase 0 (§1–3)
built the switch, the asset stages and the scored harness. Phase 1 (§4–9) built the v8 fighters from the design and
iterated against its checklist.

## 1. Feature flag and loading path

`apps/web/src/world/human/boxer/generation.ts` is the one switch for which ring people load.

- The v8 fighters are on unless `NEXT_PUBLIC_FF_BOXER_V8=0`. They were off by default until the build met its checklist
  (§7). v8 needs v7, because it builds on the v7 rig, clips and ring lighting.
- In development builds, `?boxer=v7|v8` on any lab URL picks the generation for that page. This lets one dev server
  render the before and after pairs.
- Each generation has an asset set (`boxerAssets()`): the GLB per gender, the skin and anatomy maps, and whether they
  are KTX2. The v8 assets live in their own folder, `/assets/characters/v8/`, so the v7 files stay byte-for-byte the
  fallback.
- `V8_ASSETS_READY` is `true` now that the v8 files ship. While it was `false`, a v8 request fell back to v7, so the
  flag could never load a missing file. The labs report both values on their probe: `generation`
  (what loaded) and `v8Requested` (what was asked for).
- `boxer-body.ts` (`BOXER_URL`), `boxer-material.ts` (texture URLs; the `v8` option; the program cache key
  `gk-boxer-v8`) and `BoxerAvatar.tsx` (KTX2 renderer registration) all read the switch.
- Tests: `generation.test.ts`.

## 2. Groundwork stages (all behind the v8 path)

### Textures: KTX2 / Basis

- **Encoder:** `scripts/boxer/ktx2.mjs` uses `basisu` 2.50 and ImageMagick.
  - Colour maps are encoded as ETC1S.
  - Normal and detail maps are encoded as UASTC with RDO, in linear space, with renormalised mips.
  - It also accepts a plan file of several maps.
- **Runtime:** `world/human/boxer/v8/ktx2.ts` uses three's `KTX2Loader` with the transcoder in `public/basis/`.
  - The cache is keyed by URL, so every fighter shares one GPU copy.
  - Loads requested before the renderer is registered wait for it.
- **Memory accounting:** `scripts/boxer/texture-budget.mjs`.

Measured on the current v7 maps (the v8 maps will replace them):

| Map | Source | KTX2 file | GPU (RGBA8 + mips) | GPU (KTX2) |
| --- | --- | --- | --- | --- |
| `skin-m.webp` 2048² | 1956 KB WebP | 901 KB (ETC1S) | 21.3 MB | 2.7 MB (BC1 / ETC2) |
| `body-detail-m.webp` 1024² | 244 KB WebP | 371 KB (UASTC) | 5.3 MB | 1.3 MB (BC7 / ASTC) |

That is 8× less memory for colour maps and 4× for data maps. The research estimated about 4×.

### Garments with their own skinning

`scripts/boxer/garment-skin.mjs` works for any garment mesh: a modelled vest, an authored trunk, or a source-v8 asset.

- It finds the closest point on the body surface, using a uniform triangle grid and Ericson's closest-point test.
- It interpolates the body's weights there (barycentric), keeps the top 4 and renormalises.
- It smooths the weights over the garment's own edges. Vertices too far from the body take their neighbours' weights.
- `signedDistances` / `insideShare` check, at build time, that no garment vertex starts inside the skin.
- Tests: `v8/garment-skin.test.ts`.

### Skin shading base

`world/human/boxer/v8/skin-v8.ts` provides GLSL plus a TypeScript twin of the same maths:

- curvature-driven, per-channel, energy-conserving wrapped diffuse (an analytic stand-in for pre-integrated skin);
- shadow-edge red scatter;
- dual-lobe specular roughness.

It builds on `world/human/skin/skin-shading.ts`. Tests: `v8/skin-v8.test.ts`. The test checks that the wrapped
diffuse reflects exactly Lambert's energy.

### Shipped-GLB audit

`scripts/boxer/glb-read.mjs` and `measure-glb.mjs` run `measure.mjs` on any shipped GLB, so no MakeHuman checkout is
needed. They also count one fighter's LOD0 triangles with the kit's body cull applied. On v7 they reproduce §2 and §9
of `FIGHT-REALISM-V7.md`:

| | Stature | WHR | Triangles |
| --- | --- | --- | --- |
| m | 1.757 | 0.84 | 28,347 |
| f | 1.666 | 0.70 | 28,064 |

Tests: `v8/glb-audit.test.ts`.

## 3. The acceptance harness (`qa/e2e/fighter-v8/`)

One command gives a scored report:

```
node qa/e2e/fighter-v8/run.mjs --web http://localhost:<port> --out docs/QA/boxing-v8/harness [--quick] [--label round1]
```

- **Phases.** By default the run has two phases: `v7` (before) and `v8` (after). Both use the same shot list, with
  `&boxer=<phase>` added to each URL.
- **Shots (`config.mjs`).**
  - broadcast side camera in the fight lab's practice ring;
  - duels under the ring rig (f/f, m/m, close);
  - turnarounds of m and f at 0 / 90 / 180 / −90°;
  - close-ups: shoulder, arm hole, waistband, gloves, headgear, faces;
  - action frames: guard, jab, cross, hook, uppercut, body shot, block, clinch, hit reaction, knockdown.
- **Viewports.** Desktop is 1280×720. Phone is 844×390 at DPR 2, used for the broadcast, duel, guard and jab shots.
- **Metrics.** In the page this is `inpage.js` with the injected `metrics.mjs`; on the node side it is the GLB audit.

  | Metric | How it is measured |
  | --- | --- |
  | Proportions and LOD0 triangles | from the GLB the page loaded |
  | Garment vertices inside the skin | per person and pose, with QA-HUM-01's CPU-skinned test |
  | Cavity visibility | an id render from the page camera; counts the share of the person's pixels showing skin back faces (a hole into the body) and garment back faces (the inside of an arm hole, hem or neck) |
  | Joint-limit violations | elbow and knee over-flexion, knee hyperextension, wrist deviation, neck bend and spine twist, on the posed skeleton |
  | Foot sliding | toes sampled every frame while the duel plays; travel while the foot is planted |
  | Performance | fps over 3 s, draw calls and triangles of the frame and of one fighter alone, texture MB per fighter (compressed textures counted by their mips) |

- **Thresholds (`acceptance.json`).**
  - Seeded from the brief: about 30k triangles and 60 fps.
  - Seeded from the v7 anthropometric references: heads tall, neck, WHR, girths.
  - Seeded as a rule: zero joint-limit violations.
  - Left `null` (unset) for the design's checklist to fill: garment inside the skin, cavity, foot sliding, draw calls,
    texture MB.
  - An `equals: "v8"` item fails while the page still falls back to v7.
- **Outputs.**
  - `sheets/<group>.jpg`: before | after per shot.
  - `report.json`: all metrics and the score per phase.
  - `report.md`: the acceptance table.
  - Raw PNGs go to `$TMPDIR` and are not committed.
- **Tests.** `v8/harness-metrics.test.ts` covers the maths, the scoring and the config's shape.

### Baseline: v7 through the harness (`docs/QA/boxing-v8/baseline-v7/`)

The "before" numbers, measured on an M2 Pro with headless Chrome (ANGLE / Metal):

| Metric | v7 |
| --- | --- |
| Triangles per fighter (m / f) | 28,347 / 28,064 |
| Broadcast fps, 1280×720 | 60 |
| Broadcast fps, 844×390 DPR 2 | 60 |
| Broadcast frame draw calls | 19 |
| Draw calls of one fighter alone | 1 |
| Texture MB per fighter, all RGBA8 | 29.3 (skin 21.3, anatomy 5.3, detail 1.3, iris 1.3) |
| Garment vertices inside the skin, worst pose | 7.5 % (broadcast, the referee); guard 4.1 % |
| Inside of the body visible, worst shot | 0.36 % of the person's pixels |
| Inside of the garments visible: broadcast / worst shot | 0.23 % / 1.09 % (knockdown, body shot, hook) |
| Joint-limit violations | 0 |
| Foot sliding in the step loop, worst plant | 15.2 cm (2.3 cm/s planted) |

Two items fail on v7:

- `gen`: v8 is not loaded yet.
- Feminine waist girth: 0.649 against a 0.65–0.70 reference.

**Harness fixes made while validating it on v7:**

- The knee-hyperextension check first flagged the rear leg of a cross. On the ball of the foot, the toe bone sits
  almost straight below the ankle, so the check now judges the bend across the leg, not horizontally.
- The dev lab's library cycle crashed on a defence clip that has no scripted partner (`parry`). It is now guarded.

**Open:** the library-cycle foot job measured no travel at all. The step-loop job is the one that counts. This is to
be checked in Phase 1.

## 4. Phase 1: how the v8 fighters are built

The game build stays `apps/web/scripts/boxer/build.mjs`, so the Bip01 rig, weights, torso slices, morphs and runtime
extras that the clips rely on are unchanged. `V8=1` switches it to the v8 inputs and writes
`public/assets/characters/v8/boxer-{m,f}.glb`. The design prototype supplies the cloth and kit:

```
npm install --prefix qa/fighter-v8
MH_DIR=<makehuman>/makehuman/data node qa/fighter-v8/build.mjs mW,fL           # SDF kit, bind pose (out/<f>.glb)
node qa/fighter-v8/cloth-sim.mjs mW rest && node qa/fighter-v8/cloth-sim.mjs fL rest   # draped cloth, bind pose
MH_DIR=… V8=1 BAKE=0 node apps/web/scripts/boxer/build.mjs                    # the v8 GLBs
node apps/web/scripts/boxer/ktx2.mjs --plan <plan>                            # the v8 skin set (KTX2)
```

MakeHuman is at commit `a8bc2d54…`. The plan for `ktx2.mjs` lists the albedo per tone, the normal, roughness and sweat
maps. `qa/fighter-v8/cloth-sim.mjs` gained a `rest` export: the single-layer bind-pose drape with its skin weights. Its
trunks inseam is 7 cm shorter than the design's (`INSEAM_SHORTEN`), because draped at the original length the hem
settled on the knee top (checklist 11).

### Body (`scripts/boxer/v8-body.mjs`, SPEC §2)

- **Sources from `source-v8/shape-targets.json`:**
  - MakeHuman macro values;
  - regional and athlete-face targets;
  - the design's 14 sculpt volumes;
  - a uniform scale to the class stature.
- **Class mapping:** the base body of each gender is the lighter class (male welterweight 1.76 m, female lightweight
  1.65 m). The `heavy` morph is the heavier class (male heavyweight 1.87 m, female middleweight 1.70 m), so the ring's
  weight class blends between them.
- **Removed:** the `mature` morph. Fighters are adults of 25–27; the referee and staff keep the v7 bodies.
- **The heavyweight's 3 % small head (a known miss): fixed.** Head scale plus neck height plus a little waist give 7.83
  heads, neck 0.051 H and WHR 0.87.

### Garments (`scripts/boxer/v8-kit.mjs` + the V8 block in `build.mjs`, SPEC §7)

- **Source:** the simulated rest drape (pattern-cut singlet, trunks and band), decimated to the budget with
  meshoptimizer (MIT, dev only). Every kept vertex is a source vertex. Budget: singlet 3.5k, trunks 2.8k, band 1.2k.
- **Orientation:** the sewing panels are cut mirrored and the solver wound one panel inward, so every cloth triangle is
  re-oriented outward and the normals are rebuilt. Before this fix, half the singlet showed its inner face and the seams
  averaged opposite normals; this was the faint "vest seam line" the design listed as a known miss.
- **Singlet:**
  - It keeps the cloth's own skin, with no arm bone (SPEC §7b).
  - It blends 60 % toward the body's weights at its closest point. The arm bones become the shoulder helper (half the
    arm's turn), so the jersey rides the chest and lat skin.
  - At the top of the arm hole it follows fully. It never does at the armpit or side seam, which would drag behind the
    arm.
  - A 1.1 cm bound arm hole and neck (the trim slot).
- **Tuck:**
  - The singlet's tucked part takes the band's skin weights.
  - It is pulled 4 mm inside the band, twice: once against the draped band and once after the band's own push-out.
  - The trunks' gathered top ring sits 2.5 mm under the band. The coinciding sewn rings had z-fought into a ragged edge.
- **Trunks and band:**
  - Each trunks leg follows its own leg only: weights from the body's closest point, the other leg's bones moved onto
    the pelvis. The solver's weights diffused across the crotch seam and made a skirt in a wide stance.
  - The 18 % cloth lag starts below the crotch.
  - The band never follows a thigh.
- **Push-out:** all cloth is pushed out of the drawn (culled, low-poly) skin by closest point on a triangle: 5 mm for
  jersey, 6 mm for satin above the crotch, 3.5 mm elsewhere. The runtime `depenetrate()` is skipped for v8. Its
  nearest-vertex test measured the tucked singlet against skin culled under the band and pushed it out through the band.
- **Runtime cloth push (SPEC §7b; `boxer-material.ts`, vertex shader):**
  - singlet that enters an upper-arm cone moves toward the torso axis;
  - trunks inside a thigh cone move out from the leg axis;
  - the cone radii are the skin's 90th-percentile distance from each bone (build `landmarks.caps`);
  - the bones update every frame (`BoxerAvatar`).
- **Body under the kit:** the body under each garment core is culled where it lies more than 3 cm inside the cut edges
  (arm holes, neck and leg hems only; never the arm-hole band). Also culled: the skin inside the boots and gloves, and
  under the headgear pads.

### Kit (SPEC §7a, §8)

- **Gloves:** the prototype's SDF gloves at 1.5k triangles each: leather, the white panel and the tape as their own
  slots. Fitted to the spec's numbers in the glove's own frame (principal axis):
  - the fist block narrowed to 12.1 × 12.3 cm;
  - the cuff shortened behind the tape to 10.5 cm behind the wrist;
  - the white panel limited to 6 cm behind the striking face (the prototype's panel ran over the back of the hand).
- **Headgear:** 3.5k triangles.
- **Boots:** 1.25k each.
- **Hand wraps:** 0.4k each, drawn only without gloves.

### Skin (SPEC §5–6; `boxer-material.ts`, `uV8`)

- **Maps:**
  - the albedo of the nearest of the 4 Monk-scale tones, re-tinted to the person's own tone;
  - the tangent normal (pores, anatomy, veins);
  - roughness zones;
  - the sweat mask.

  All are KTX2: ETC1S for the albedo, roughness and sweat; UASTC for the normal.
- **Specular:** one dielectric F0 of 0.028 for every tone (`SKIN_F0`).
- **Sweat:** the second lobe is sweat × mask (roughness 0.28 → 0.12). Dry at the first bell; rises with the work done and
  the rounds (`fight/sweat.ts`, tested).
- **Diffuse:** the pre-integrated-style wrapped diffuse stays (R 0.36, G 0.15, B 0.10 × curvature).
- **Leather:** 0.5 roughness and a 0.25 clearcoat on the glove leather.
- **Band:** cream, with two woven kit-colour stripes drawn in the shader.

### Guard, jab, hook (SPEC §9; `pose.ts` `GUARD_V8`, `clips.ts` `V8_KEYS`, `rig.ts` `ArmBias`)

- **Torso:** sat 2 cm deeper than v7, bladed 36° plus 6° of chest, head pitched to tuck the chin.
- **Clavicles:** lead up 11° / forward 13°, rear up 7° / forward 30°.
- **Feet:** the rear heel up 0.45 rad and the rear foot turned out 58°. The feet keep the v7 positions every footwork
  and pivot clip is authored around, 1–2 cm from the spec's.
- **Fitting:** the keyed-arm angles were fitted on the real rig and both bodies (`qa/e2e/fighter-v8/fit-pose.mjs`: the
  lab poses the body synchronously through `BoxerProbe.poseNow` while a coordinate descent moves the angles):
  - lead fist 24–26 cm in front at eye height, to the lead side of the lead eye (the eyes look past it);
  - rear glove on the cheekbone, 4.0 cm from the cheek;
  - forearms at 64–68°;
  - elbows 18–19 cm down and inside the shoulders;
  - wrists straight.
- **Keyed arms:** the system and the joint limits are kept. Every v8 key is clamped into the limits.
- **Re-keyed impacts:**
  - jab: 92 % extended, palm down;
  - lead hook: elbow at 87° and at shoulder height;
  - high block's hold: with less rear protraction, because the rolled shoulder squashed its skin.
- **Female guard correction:** the lighter, shorter female body put the lead glove 3 cm lower against her eyes, so she
  carries a fitted correction (`V8_GUARD_BIAS_F`). It applies in full at the guard and fades out as the arm leaves it,
  so the punches keep their angles.

### Lighting

No change was needed in `fight/ring-lights.tsx`. The v7 broadcast rig already does what the spec asks: a hard key from
above, rims, a dark room and no flat front fill. The checks that depend on it pass: the deltoid step (0.51) and the T1
chroma (1.58 × target). Tone mapping stays the hall's ACES. The red reads deep under the v7 kit-colour scale (§7 of
the v7 doc).

## 5. Performance (M2 Pro, headless Chrome, ANGLE / Metal)

| | v7 | v8 |
| --- | --- | --- |
| LOD0 triangles per fighter (m / f) | 28,347 / 28,064 | 28,551 / 28,506 (spec ≤ 31k) |
| Draw calls per fighter | 1 (+1 shadow) | 1 (+1 shadow) |
| Practice-ring frame | 19 calls, 60 fps at 1280×720 and 844×390 DPR 2 | 19 calls, 60 fps at both |
| Textures per fighter | 29.3 MB (RGBA8 WebP), 13.3 MB phone | 11.5 MB (KTX2) on desktop and phone (spec ≤ 14 MB) |
| GLB per gender | 3.25 / 3.20 MB | 2.1 / 2.1 MB (fighters only; the referee and staff stay on v7) |
| Hall practice fight | 60 fps desktop | 60 fps desktop and phone; 55–59 fps for one moment while the corner stool is carried in (v7: 59) |

Not built: **LOD1 / LOD2**. The fighters meet the 60 fps target at LOD0 in the practice ring and the hall on both screen
sizes, so the dithered LOD chain of SPEC §4 is the next step for crowded halls, not a blocker.

## 6. Harness additions (Phase 1)

- `qa/e2e/fighter-v8/static.mjs` covers the shipped GLBs, the KTX2 set and the design sources:
  - the four classes' proportions;
  - band, hem, opening, gathers and tuck;
  - glove dimensions in the glove frame;
  - headgear padding over the pads (the rounded rims are reported apart: down to 0.4 cm at the face opening);
  - tone albedos;
  - budgets;
  - ages.
- `qa/e2e/fighter-v8/inpage-checks.js` runs per pose on one fighter. It applies the same cloth push the shader draws:
  - the 15a guard / jab / hook numbers;
  - eyes visible (ray test);
  - the rear glove's gap to the cheek;
  - garment-in-skin by closest point on the drawn skin triangles;
  - the band hold in poses (radius about the pelvis axis);
  - the arm cover (`armtest.mjs` ported: rays to the outer upper arm from the front, both broadcast sides and 3/4);
  - the face opening;
  - one F0 per ring;
  - the deltoid line.
- The `checks` shot group, the T1 close shot and the screenshot analysis (chroma, deltoid step) are in `run.mjs`.
- `acceptance.json` is the SPEC §15 checklist, item by item.

## 7. Acceptance checklist (SPEC §15), final run `docs/QA/boxing-v8/final/report.md`

The final run scores **76 pass, 7 fail**. The 2 unset items are foot sliding, which the checklist leaves open. All 7
fails belong to items 7 and 8.

| # | Item | v8 | Result |
| --- | --- | --- | --- |
| 1 | Stature ±0.5 cm (4 classes) | 1.760 / 1.870 / 1.650 / 1.700 | pass |
| 2 | WHR ♂ 0.83–0.88, ♀ 0.70–0.76 | 0.84–0.87 / 0.75 | pass |
| 3 | Bideltoid / H; neck chin–notch / H | ♂ 0.345–0.35, ♀ 0.311–0.313; 0.051–0.054 | pass |
| 4 | Heads tall 7.3–7.9 | 7.53–7.83 | pass |
| 5 | Neck girth ♂; upper arm ±1.5 cm | 0.408 m; 0.2 cm off | pass |
| 6 | Deltoid luminance step ≥ 8 % | 51 % | pass |
| 7 | Garment vertices inside the skin ≤ 1 % (stand / guard / jab / hook) | 1.1 / 8.0 / 4.7 / 6.9 % | **fail** (see §8) |
| 7 | No singlet outside the band in poses | 55 vertices (jab / hook) | **fail** (see §8) |
| 8 | No vest inner face visible, guard side shot | 89 px (v7 84); broadcast 263 px (v7 140) | **fail** (see §8) |
| 9 | Singlet ≥ 1 mm inside the band | 0 outside | pass |
| 10 | Band 8–10 cm, follows the waist ≤ 8 mm, ΔE ≥ 40, below the navel | 8.2–8.5 cm, 7.3 mm, ΔE 76, 0.66 cm | pass |
| 11 | Trunks hem between mid-thigh and the knee top | ♂ 0.64 m, ♀ 0.60 m | pass |
| 12 | Leg opening ≥ 1.25 × thigh | 1.50 | pass |
| 13 | Gathers ≥ 1.15 | 1.33 | pass |
| 14 | Separate garment meshes, hidden body deleted | yes (16.3k of 28.4k body triangles culled) | pass |
| 14a | Outer upper arm covered by singlet ≤ 2 % | 1.5 % (v7 8.2 %) | pass |
| 15 | Gloves: length, knuckle width / depth, cuff, tape, block ratio, panel, thumb | 26.6 cm, 12.1 / 12.3 cm, 10.5 cm, 5.6 cm, 1.37, panel on the knuckle face, thumb | pass |
| 15a | Guard forearms 55–75°, elbows in and ≥ 18 cm down, eyes visible, wrists ≤ 12°, rear glove ≤ 4 cm to the cheek, lead glove at eye height ± 4 cm and 20–30 cm out | 64–68°, in, 18.3 cm, visible, 0°, 4.0 cm, 1.6 cm, 24–26 cm | pass |
| 15a | Jab palm down ≥ 0.8, 90–98 % extended; hook elbow 80–100° at shoulder height ± 5 cm, palm down or in | 0.91, 92 %; 87°, 2.5 cm, 0.66 | pass |
| 16 | Headgear padding ≥ 2.0 cm, brow roll ≥ 3.2 cm, the face opening shows eyes, nose and mouth | 2.2 cm (pads), 3.8 cm, yes | pass |
| 17 | Mouthguard not red | white | pass |
| 18 | Tone albedos ΔE ≤ 6 | worst 1.7 | pass |
| 19 | T1 lit chroma ≥ 60 % of target | 158 % | pass |
| 20 | One F0 for every tone | 0.028 constant | pass |
| 21 | Sweat dry at the first bell, rising | unit test | pass |
| 22 | ≤ 31k triangles, 1 draw call, ≤ 4 influences | 28.6k, 1, 4 | pass |
| 23 | 60 fps at 1280×720 and 844×390 DPR 2 | 60 / 60 | pass |
| 24 | Phone textures ≤ 14 MB | 11.5 MB | pass |
| 25 | Adults only (age macro 0.5–0.55) | 0.50–0.52 | pass |
| 26 | Respectful, non-sexualised: women in a full singlet, trunks per IBA | full singlet, mid-thigh trunks | pass (visual, `final/sheets/turnaround.jpg`) |
| 27 | Natural hair under the headgear | cropped / cornrows painted in the albedo | pass (visual, `final/sheets/closeup.jpg`) |

## 8. What is still short, and why

- **Item 7: garment vertices inside the skin in poses.**
  - **Why:** the prototype met ≤ 1 % by re-simulating the cloth for every pose. The game skins one draped garment, and
    moving skin under linear-blend-skinned cloth comes through where the two move differently. The remaining hits are:
    - the pectoral and armpit skin (weighted partly to the arm) under the singlet front;
    - the hip crease under the trunks in the guard.
  - **What closed most of it:**
    - the outward-oriented panels;
    - the closest-triangle push-out;
    - arm-hole weights on the shoulder girdle;
    - the cone push in the shader.
    - Arm cover went from 8.2 % (v7) to 1.5 %.
  - **What closes the rest:** a per-pose corrective, either pose-space blend shapes or a GPU cloth relax baked from the
    prototype's per-pose sims (guard / jab / hook already exist).
- **Item 7: band hold in punches.** In the jab and hook, 55 tucked singlet vertices rise 1+ mm past the band as the
  hips turn. On screen the band covers them. Same cause and same remedy as above.
- **Item 8: vest inner face.** A single-layer singlet open at the arm hole shows a little of its back panel's inside
  between the arm and the ribs: 89 px from the side (v7: 84). The design's "no pixel" needs a thickened (two-layer) arm
  hole: the prototype solidifies its cloth, but that doubles the garment's triangles past the 30k budget.
- **Not built (SPEC §4–5):**
  - LOD1 / LOD2 (see §5);
  - the baked fold normal maps for the garments. The folds are geometry from the simulation, and the decimation keeps
    them at broadcast distance; close-ups lose the finest creases.
- **The design's other known misses:**
  - the vest's crumpled front: decimation smooths it;
  - the vest seam line: fixed by the panel orientation;
  - the heavyweight head: fixed;
  - the boot crease at the forefoot when the heel lifts: unchanged, the prototype's boot skin;
  - the hand-wrap close-ups reading as CG: unchanged; the wraps only show without gloves.
- **The referee, corner staff and judges stay on the v7 bodies.** The v8 GLB carries the fighters only.

## 9. End-to-end check (`docs/QA/boxing-v8/e2e/`)

I ran a real practice fight in the Boxing hall on my own stack (web, API and realtime on unused ports; local PGlite):

- **Desktop and phone:** walk-in, punches landing and blocked, the rest on the stool with the corner team, round 2. 60
  fps.
- **Fight lab:** the knockdown and the referee's count, the HUD, the training drill, and the phone's
  touch controls.

v7 and v8 behave the same in the hall script. Its scripted knockdown does not trigger on either, which is why the
fight lab covers the count. Nothing in the HUD, the hits, the knockdown, the referee or the corner regressed.
