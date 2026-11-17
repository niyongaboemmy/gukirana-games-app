# Human v9: real scanned people for the campus (P2-AVA-13)

## In one paragraph

The idea was to stop building campus people in code and use **real 3D scans of clothed adults plus real motion
capture**, processed in Blender, as the boxer v9 work does. The pipeline and the flagged runtime are built and work
end to end. But **no free scan that can be downloaded without a login is good enough**: the ones we could get are
phone captures with 1k textures and mushy faces, and they **lose clearly to the current campus people** in a
side-by-side. So nothing changes in the game: the flag `NEXT_PUBLIC_FF_HUMANS_V9` stays **off**, and the scans are
only test inputs. The pipeline is ready for a good scan the moment you download one (10 minutes, list below) or
scan real people yourself.

## What was built

- **Pipeline** (`apps/web/scripts/human-v9/`, headless Blender 5.2): import and clean a scan (straighten, find the
  front, cut the ground plate, fill holes, scale), decimate, **auto-rig onto the same Bip01 skeleton as the boxers**
  (no Mixamo upload needed), retarget **CMU motion capture** (walk, slow walk, idles with weight shift, look around,
  two talking takes, wave, cheer, sit down / sit / stand up, jump) with a floor guard, bake colour and normal maps,
  build a skin mask, export one GLB per person with three levels of detail (≤ 20k, ~6k, ~1.5k triangles), a shared
  clip library, KTX2 textures (2k desktop, 1k phone). One command: `node apps/web/scripts/human-v9/run.mjs`.
  Details: [PIPELINE.md](PIPELINE.md). Whole run for three people: about 1.5 minutes on the M2 Pro.
- **Runtime** (`apps/web/src/world/human/v9/`), behind `NEXT_PUBLIC_FF_HUMANS_V9` (default off; `?humans=v9` in
  development): `ScannedPerson`, a drop-in for an ambient campus person (same action codes, talking, fading at
  dusk), shared geometry / material / clips per scanned person, LOD switching with hysteresis, far people animated at
  a lower rate, the existing foot lock, breathing on chest and shoulders, the shared skin module (pore detail and
  roughness breakup on skin, matte cloth with a knit micro-normal elsewhere). Campus life uses it when the flag is on
  **and** published v9 people exist; otherwise the current people, unchanged. Avatar customisation is untouched.
- **Human lab** (`/play/human-lab`, dev only): `?v9=only`, `?v9=side` (current left, v9 right), `v9person=`,
  `v9clip=`, and `crowd=<n>` with v9 people. Comparison script: `qa/e2e/human-assess/v9-compare.mjs`.
- Unit tests for the runtime rules (`world/human/v9/logic.test.ts`).

## Licences and credits

- The three test scans are **CC BY 4.0** (checked on each official page): in3D "Woman", in3D "Dima", fwild "Full
  body", fetched without a login from the Objaverse 1.0 mirror. They are **not committed** (git-ignored
  `apps/web/scripts/human-v9/work/` and `apps/web/public/assets/characters/_v9humans/`). Credits:
  [docs/QA/human-v9/CREDITS.md](../../QA/human-v9/CREDITS.md); the manifest carries the credit line for each person.
- Motion: CMU Graphics Lab Motion Capture Database (free for any use, credit line in PIPELINE.md).
- Rejected: everything non-commercial or research-only, and ~230 person scans whose author has since removed them.
  Full search and the source bar: [ASSET-SOURCES.md](ASSET-SOURCES.md).

## Honest rating against the current people

Judged at full size in the human lab, same camera and light rig (day), the current campus people against each v9
test person: face close-up, full body standing, walking. Images: `docs/QA/human-v9/`.

| | Current campus people | v9 test scans |
| --- | --- | --- |
| Face | Modelled head, real eyeballs, lids, lips, skin detail | **Mush**: 1k photo texture smeared over ~1k head triangles; no readable eyes or lips; one has a hair bun that reads as a hood |
| Body / proportions | Good | Real proportions (the one thing that is better) |
| Clothes | Good, with fabric shading | Baked into the skin: soft, and they bend like rubber in big poses |
| Hands | Posed, fingers | Mitten fists (no finger bones) |
| Motion | Good mocap, foot lock, lean, reactions | Real CMU mocap, now without the head tipping back; still stiffer, no face, no reactions |
| **Overall** | the reference | **about 10-15 %: clearly worse. Does not pass the quality gate.** |

What would change this: a scan that meets the source bar (4k+ texture, ~100k+ triangles source, a clear face, arms
away from the body). The deep3dstudio studio scans or your own scans should get much closer; the code-built faces
of the current people will still win on close-ups until a scan has a separate eye mesh.

## Performance

20 people on screen in the lab's crowd mode (the same scene as the P2-AVA-12 crowd test), measured on the M2 Pro in
headless Chrome with the frame cap off: current people 453 fps / 164 draw calls, v9 people 699 fps / 30 draw calls at
desktop 1280 × 720 (the emulated phone viewport 844 × 390 DPR 2 gives the same picture: 453 vs 711 fps; it runs on
the M2 GPU, so it is not a real-phone number). Table: [docs/QA/human-v9/REVIEW.md](../../QA/human-v9/REVIEW.md#performance).
Each v9 person is one mesh (the current people are ~20 meshes each), so performance is not the problem.

## Your options (each optional)

1. **Download the two deep3dstudio scans** (free Sketchfab account, CC BY 4.0, 5 minutes):
   <https://sketchfab.com/3d-models/free-download-athletic-african-man-walking-223-f9a8e3b108f04e998815593f78f163b1>
   and
   <https://sketchfab.com/3d-models/free-download-attractive-african-woman-236-f2c29b6947f34237a0bfdc777120ef28>
   ("Download 3D model", pick glTF / GLB or the original format), into
   `apps/web/scripts/human-v9/work/in/scans/deep3d-man/source.glb` and `.../deep3d-woman/source.glb`. Then ask the
   agent to add them to `people.json` and run the pipeline and the side-by-side.
2. **Scan real people** (best for Rwandan faces and clothes): consenting adults, A-pose, a LiDAR iPhone with Polycam
   / KIRI / Scaniverse, export the full mesh with a 4k-8k texture, and a signed model release. How to shoot:
   [docs/design/boxer-v9/SCAN-GUIDE.md](../boxer-v9/SCAN-GUIDE.md) (being written by the boxer agent; not in this branch yet).
3. **Mixamo clips** (Adobe ID) for cleaner motion than CMU: the list is in
   [PIPELINE.md](PIPELINE.md#mixamo-equivalents).
4. Leave the flag off until a v9 person wins the side-by-side. Shipping any scan also needs your decision on where
   the GLBs live (they are not in the public repo).
