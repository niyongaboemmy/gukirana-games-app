# Fighter v8: the ring people rebuilt (P3-FGT-19B)

Status: **Phase 0 (groundwork) done; Phase 1 waits for the v8 design** (P3-FGT-19A: `docs/design/fighter-v8/SPEC.md`
and its acceptance checklist). Presentation only: the engine, the money paths and the server-authoritative fight are
untouched. Evidence goes to `docs/QA/boxing-v8/`.

The user asked for the fighters to be rebuilt from scratch because they "feel not normal persons". This document
describes what is built so far and how the v8 work is scored.

## 1. Feature flag and loading path

`apps/web/src/world/human/boxer/generation.ts` is the one switch for which ring people load.

- `NEXT_PUBLIC_FF_BOXER_V8=1` turns v8 on. The default is **OFF** until the design passes. v8 needs v7, because it
  builds on the v7 rig, clips and ring lighting.
- In development builds, `?boxer=v7|v8` on any lab URL picks the generation for that page. This lets one dev server
  render the before and after pairs.
- Each generation has an asset set (`boxerAssets()`): the GLB per gender, the skin and anatomy maps, and whether they
  are KTX2. The v8 assets live in their own folder, `/assets/characters/v8/`, so the v7 files stay byte-for-byte the
  fallback.
- `V8_ASSETS_READY` stays `false` until the commit that ships the v8 files. Until then, a v8 request quietly falls
  back to v7, so the flag can never load a missing file. The labs report both values on their probe: `generation`
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

## 4. Phase 1 (to do when the design lands)

Implement the SPEC in full:

- body, proportions, baked detail maps, skin shading, garments, kit;
- face and expressions, stance, guard and clips (keeping the keyed arms and joint limits unless the spec says
  otherwise);
- LODs and ring-light tweaks.

Then:

1. Ship the files to `/assets/characters/v8/` and set `V8_ASSETS_READY = true`.
2. Fill in `acceptance.json` from the checklist.
3. Iterate with the harness until every item passes.
4. Switch the flag on.
5. Run an end-to-end practice fight in the Boxing hall.
