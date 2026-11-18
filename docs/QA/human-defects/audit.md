# P2-AVA-15 — campus human close-up defect audit

Scope: the current campus people (`apps/web/src/world/Avatar.tsx`, `world/human/{hair,headwear,head-fit,head-geometry,materials}.ts`)
with the realistic campus people flag on (`NEXT_PUBLIC_FF_CAMPUS_HUMANS`, default on). Every fix is gated on that existing
flag (`campusHumansOn()`); `?people=v1` still shows the older people. No new flag.

## How it was audited

- Dev human lab (`/play/human-lab`), day light rig, 640×640 and 900×900 close-ups, driven over raw CDP (no new packages).
- Matrix: all 18 hair styles × 6 headwear choices (none, cap, beanie, bucket, kufi, kitenge headwrap) at profile, 3/4 and
  back; 8 tops (tee, hoodie, jersey, track, blazer, kitenge shirt, sash, imigongo top) × 3 bodies at neck 3/4, front, side
  and full body. 324 head shots + 96 top shots (contact sheets were inspected at full size; not committed: ~40 MB).
- Before / after pairs: same look, camera, light and pose. The lab's animation clock is replaced by a virtual frame clock
  and frozen 240 frames after the person is ready, so both runs show the same idle pose (small differences remain where
  the idle director picked a fidget on a different frame).

## Defects found

| # | Defect | Where | Severity | Status |
|---|--------|-------|----------|--------|
| 1 | Kufi floats as a rigid bowl over pressed locs / braids: ~1 cm clearance, see-through gap under the edge, 2 mm turn-in, razor-thin edge | kufi × locs, braids, twists, short locs, puffs (all bodies) | high (user report) | **fixed** |
| 2 | Kufi and cap crown sink into a bald scalp: skin shows through the fabric in patches | bald × kufi, bald × cap | high | **fixed** |
| 3 | Cap back edge paper-thin (no hem) | cap × all | medium | **fixed** (bound hem) |
| 4 | Locs read as flat planks: near-black uniform albedo, constant width, flat cut ends, 3-sided far LOD tubes | locs, short locs (all hats) | high (user report) | **fixed** |
| 5 | Locs and braids arch up off the crown like sticks (strands rest on the skull template, ~1 cm above the real feminine scalp, sparse) | locs, braids, no hat | high | **improved** (lie flat, slimmer, denser, scalp-offset); a few front roots still lift a few mm |
| 6 | No secondary motion on hanging strands | locs, braids, braid ponytail | medium | **fixed** (light sway in the vertex shader) |
| 7 | Hair base under a cap / at the temples noisy, speckled, pixelated hairline | every shell style; the feminine temple patch | high (user report) | **fixed** (per-octave anti-aliasing, filtered mask, softer hairline into the skin, AA on the head texture's scalp noise) |
| 8 | Printed tops: collar / lapel UV islands blow one motif up into flat teal / white shards; the print jumps at every UV seam | kitenge, imigongo, sash tops (all bodies) | high (user report) | **fixed** (prints laid on the garment in metres: tri-planar projection) |
| 9 | Head collar texels of printed tops drawn plain white | printed tops | medium | **fixed** (print on the head collar too) |
| 10 | Triangular light / dark patches on cheeks, beside the nose and on the jaw ("blotches") | every face, worst on the feminine head | high (user report) | **fixed** (relaxed normals on the close-up head + real per-vertex tangents for the photo normal map) |
| 11 | Lips blend into the skin | every face | medium (user report) | **fixed** (photo lip shading kept, slightly deeper natural tone) |
| 12 | Ear reads flat | every face | medium (user report) | **fixed** (photo folds deepened in tone and bump) |
| 13 | Neutral body: a pale arc across the forehead at the hairline (sky through a gap left by the removed baked cap brim) | neutral × every style without a hat | medium | **not fixed** — needs a geometry fill of the neutral head's former brim seam (separate task) |
| 14 | Shirt collar / lapel geometry itself is low-poly (Rocketbox base mesh): no separate collar stand or thickness | every top | medium | **not fixed** — the visible shards were the print mapping (#8) and are gone; a new modelled collar is out of scope for a defect pass |
| 15 | Feminine body always wears the baked blazer + shirt whatever top is chosen (tee / hoodie / jersey recolour it) | feminine × tee, hoodie, jersey, track | low (design) | not fixed (catalogue / asset question) |
| 16 | Twists stand out stiffly | twists | low (it is the style) | left as is |

Not seen: hands broken, clothing poking through at the neck in the lab poses, hat-hair clipping other than #1 / #2.

## Evidence (`docs/QA/human-defects/*.jpg`, before | after)

- `01-locs-kufi_*` — the user's case (feminine, locs, white kufi with brown zigzag band, teal kitenge shirt): profile both
  sides, 3/4, front, back, from below (gap under the kufi), neck / collar, full body.
- `02-locs-nohat_*`, `03-braids-nohat_*` — crown sticks, loc shape and tone.
- `04-shortlocs-cap_*` — rounded, tapered short locs under a cap; the cap's bound hem.
- `05-bald-kufi_*`, `06-bald-cap_q34` — hats no longer sink into the scalp.
- `07-short-kufi_*` — kufi from below, printed collar.
- `08-face-f_*`, `09-face-m_*` — cheek / nose / jaw patches, lips, ears, collar.

## Performance (human lab crowd mode, 20 people, `crowd-perf` method over CDP, median of 3)

Headless Chrome (Metal), frame rate uncapped, so the numbers are relative, not device fps:

| viewport | before fps | after fps | draw calls | triangles |
|----------|-----------:|----------:|-----------:|----------:|
| desktop 1280×720 DPR 1 | 458.2 | 436.4 (−4.8 %) | 165 → 165 | 295 461 → 341 785 |
| phone 844×390 DPR 2 | 456.4 | 430.7 (−5.6 %) | 168 → 168 | 295 467 → 341 791 |

No new draw calls or textures. The extra triangles come from the round 8-sided (near) / 5-sided (far) strand tubes with
rounded tips, the denser locs (74 vs 50) and the hat hems; they only exist on people wearing those styles. The close-up
head gains a tangent attribute; normals are relaxed once per base head at load.
