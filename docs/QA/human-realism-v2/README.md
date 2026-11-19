# Campus people realism v2 (P2-AVA-18)

Switches: `apps/web/src/world/human/realism-v2.ts` (`V2_SHIPPED`). They all sit on top of the realistic campus people
(`NEXT_PUBLIC_FF_CAMPUS_HUMANS`). Dev override for comparisons: `?hv2=none|all|<item>,<item>`.

Evidence tool: `node qa/e2e/human-assess/realism-v2.mjs --a "main,http://localhost:3200," --b "v2,http://localhost:3220," --halt 150 --shots …`.
It uses the dev human lab (`/play/human-lab`) with the day light rig and a virtual 1/60 s frame clock. Both sides are
taken the same number of frames after the person is ready, so they hold the same pose. In each JPG, left is main
(:3200, the main checkout) and right is this branch, at the same camera and light. Every frame was checked at full size.

## Audit: the biggest gaps against a real person (phone, campus distance, then close-up)

1. **Women's clothes.** Every woman wears the feminine base blazer, whatever top she chose (all simulated tops are
   held). At campus distance its pocket flaps take the trousers' colour (blue or beige patches with a halo), and the
   shirt under it is the jacket colour, brightened until it glows. This shows at every distance.
2. **Hair edges.** Hashed alpha turns the soft hair alpha into per-pixel speckle: a sparkling fringe round short hair
   and afros, and a sprinkle of dots on the scalp between braids or round a bun. This shows at every distance.
3. **Face close-up.** The feminine base photo's brow is a pale, blocky band above the drawn brow, so the brow reads as
   painted two-tone stripes. Beauty marks are a crisp black disc that reads like a sticker. Other gaps, not fixed:
   a dark wedge at the mouth corners, a faceted seam across the feminine nose bridge, and a grey scalp layer under
   braids.
4. **Women's tee garment (P2-AVA-17, held).** Its edges are ragged and beaded, it crumples under the arms, and it
   carries a lumpy fold map.
5. **Motion.** The walk is already mocap with phase-locked feet (Rocketbox clips, foot lock, starts and stops). It held
   up in the side-by-side walking frames. It was not the weakest item, so it was not changed this round.

## Results

| Item | Switch | Status | Score against main (main = 100 %) | Why |
| --- | --- | --- | --- | --- |
| Blazer flaps and blouse | `blazer` | **ON** | ~130 % for women in the blazer | The flaps are now the jacket's own colour (no blue or beige patch, no halo), and a white blouse sits under the jacket instead of a glowing jacket-coloured shirt. Visible at campus distance and while walking. No new defect. Evidence: `shipped/torso_j`, `full_j`, `walk_j`, `full_f`, `clap_f`. |
| Beauty marks | `marks` | **ON** | ~115 % in face close-ups | The mark is now about 2.5 mm, slightly irregular, soft-edged and warm brown, where main had a black sticker dot. Evidence: `shipped/face34_*`, `face_f`, `eyes_f`. |
| Feminine brows | `brows` | **ON** | ~115 % in face close-ups | The photo brow, which was painted as pale scalp hair with strand relief, becomes skin. Only the drawn strand brow remains: one dark brow with a soft upper edge instead of two-tone stripes. It also helps the darkest skin tones (`face34_d`). Masculine heads are unchanged. Evidence: `shipped/eyes_f`, `face_f`, `face34_f`, `face34_d`, `face34_a`. |
| Hair edges (alpha-to-coverage) | `hairEdge` | held | ~90 % | The speckle goes. But the fuzz shells' light grazing colour now shows as a pale ring round afros and short hair, and the scalp layer under braids and buns turns into blotches. This trades one defect for another. Evidence: `held/hairEdge_*`. These were taken with `hv2=all` on the right, so the mark and brow changes also show there. |
| Women's tee rebuilt | `womenTee` | held | ~120 % at full body and campus distance, <100 % in front close-ups | The rebuilt tee is clean: the neckline beads, ragged sleeve and hem edges, underarm crumples and side lump are gone (`held/womenTee_*_oldtee-vs-new`). Against main's blazer it wins at full body, walking and clapping. **New defect:** at the base of the neck, the head mesh's jagged lower edge meets the garment's chest-skin patches, and the step shows in face and torso close-ups from the front, most on the darkest skin (`held/womenTee_neckseam_*`). It is held by the "no new defects" rule. |

Overall, for the people a viewer meets on campus, with all shipped items on: about **110 % of main**. This is small
but real. Women in the blazer gain the most, and faces gain a little in close-ups. There are no new defects in the
shipped set.

## What changed (code)

- `world/human/realism-v2.ts`: the switches (new).
- `world/human/materials.ts`: `uV2` uniform with four effects:
  - remaps the blazer pocket flaps and paints the blouse in the top's second colour;
  - draws the soft mole;
  - clears the feminine photo brow (albedo, painted hair and relief) and flattens its normals;
  - under `womenTee` only: paints the head-mesh chest as skin and darkens the garment skin.
- `world/human/alpha-edges.ts`: the coverage hair edges (held).
- `world/Avatar.tsx`: hooks for the held items.
- `world/human/women-tops.ts`: `TEE_ITEMS` behind `womenTee`.
- `scripts/women-tops/garment.py`, `bake.py`, and the rebuilt `wt-tee.bin` / `.webp`: calm pass, hem marking fix,
  hem normals, AO occluders, softened fold map. See that folder's README.

## Performance

Phone emulation is 844 × 390 at DPR 2 with the CPU throttled ×4 (CDP `Emulation.setCPUThrottlingRate`). The scene is
the human-lab crowd of 20 people, day rig, on headless Chrome / Metal on an M2 Pro. Frame time comes from rAF deltas
over 8 s, three interleaved runs, on the same dev server, with `hv2=none` (main's people) against the shipped
defaults. Raw data: `perf.json`.

| | median frame (runs) | p95 frame (runs) | draw calls | triangles | textures | programs |
| --- | --- | --- | --- | --- | --- | --- |
| main's people (`hv2=none`) | **9.5 ms** (9.7 / 9.4 / 9.5) | 13.1 ms (14.1 / 13.1 / 12.1) | 155 | 345.9 k | 83 | 17 |
| v2 shipped defaults | **9.4 ms** (9.4 / 9.5 / 9.3) | 12.8 ms (14.4 / 12.8 / 12.7) | 155 | 345.9 k | 83 | 17 |

There is no measurable difference: the gap is inside run-to-run noise.

The shipped items are uniform-driven branches in shaders that already exist: no new textures, draw calls or geometry.

## Asset decisions for a further large jump (ranked, for the user)

1. **Consented scans of real Rwandan adults.** Photograph or iPhone-scan (Polycam / RealityScan / photogrammetry)
   about 12 consenting adults: 3 age bands (18–30, 31–50, 50+) × feminine / masculine × 2 builds, in everyday
   Musanze clothes. Each person signs a model release that allows CC-BY publication in this public repo. The scans
   are retopologised onto our Bip01 skeleton with the human-v9 pipeline. This is the largest jump for faces, skin,
   hair and real garment folds, and it is the only route to authentic Rwandan faces. It needs the user's approval and
   a consent and release process.
2. **A commercial scanned-human library kept out of the public repo.** Examples are Renderpeople, 3D Scan Store and
   AXYZ: rigged, scanned and textured people. Their licences forbid redistribution, so the files would sit in a
   private bucket or CDN fetched at build or run time, never committed. Quality is immediately high, but this needs a
   purchase and an asset-hosting policy change.
3. **A 3D character artist commissioned under CC-BY to us.** Women's garments sewn as patterns (tee, kitenge shirt,
   mushanana), hair cards for braids, locs and afros, and an everyday base body. This fixes the class of problems
   this round worked around: the blazer base, the neck seam and the hair shells.
4. **A licence change for MetaHuman and/or Mixamo.** Currently banned by policy. It would bring high-fidelity faces and
   a large clip library, but the licences restrict redistribution, so the same private-hosting question as item 2
   applies. It needs the user's explicit approval.
5. **Sketchfab CC-BY full-body scans downloaded with the user's own account.** These are only CC-BY with attribution in
   `docs/ASSET-LICENSES.md`. Quality varies: the free no-login scans of v9 scored 10–15 %, so pick per scan and judge
   with the same side-by-side gate.
