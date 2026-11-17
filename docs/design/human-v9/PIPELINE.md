# Human v9: the Blender pipeline (P2-AVA-13)

`apps/web/scripts/human-v9/`, headless Blender (verified on **Blender 5.2.4 LTS**, macOS, M2 Pro). Modelled on the
boxer pipeline (`apps/web/scripts/boxer-v9/`, `docs/design/boxer-v9/BLENDER-PIPELINE.md`) and reusing its steps
**read-only** where they fit; one boxer step was copied with a change (marked in its header). To be unified later.

```
node apps/web/scripts/human-v9/run.mjs --check          # Blender / basisu / magick, which inputs are missing
node apps/web/scripts/human-v9/run.mjs --fetch          # the test scans (Objaverse mirror) + CMU takes, no login
node apps/web/scripts/human-v9/run.mjs [--person <id>] [--only <step>] [--from <step>] [--fast] [--dry-run] [--publish]
```

Inputs and outputs live in `apps/web/scripts/human-v9/work/` and the published copy in
`apps/web/public/assets/characters/_v9humans/`: both git-ignored. People are listed in `people.json`, clips in
`human-clips.json`. Every step prints `[human-v9]` lines, stops with `[human-v9] ERROR: ...` and the runner prints
per-step timings (also in `work/out/timings.json`).

| Step | Script | What it does |
| --- | --- | --- |
| import | `01_import_scan.py` | Imports GLB/OBJ/FBX, joins the meshes, welds Sketchfab's primitive splits, drops debris islands, makes Z up, **stands a leaning scan upright** (feet-to-neck line vertical; fwild leaned 15 degrees), turns it so the shoulders lie on X and the toes point to -Y, **removes a ground plate / base** (lowest slices much wider than the legs are cut), **fills holes** (soles, crown) and triangulates the fills, scales to the given height, feet on z = 0, pelvis centred; gives it a principled material reading the scan's texture or vertex colours. Report: `01-report.json`. |
| decimate | boxer `02_decimate.py` (reused) | Collapse decimation to 19k triangles (5k for the head), the full scan kept as `body_hi`; `--unwrap` (new smart UVs) when the scan was decimated, because its colour is baked anyway. |
| rig | `03_autorig.py` | **Auto-rig onto the Bip01 skeleton** the boxers and campus people use, no Mixamo: joints found from the mesh by cross-sections (crotch by rays, legs, spine, neck, head, shoulder joints clamped to the adult 9-11.5 % half width, fingertips, elbows and wrists centred in the arm's own section), identity rest rotations (every bone points up, roll 0), weights by bone heat on a watertight voxel copy, copied back, 4 influences, stray vertices filled from their neighbours; distance fall-off if bone heat fails. Report: `03-report.json` with every joint. |
| windows | `04a_clip_windows.py` | Finds the clip windows in the long CMU takes: one whole gait cycle for walks (left plant to left plant, middle of the take), the best-matching loop for idles / talk / wave / cheer / seated, the sit-down and stand-up cut from the hip-height profile (longest seated run). |
| clips | `04_retarget_clips.py` (copied from boxer, changed) | Per frame `R_target = R_source * R_source_rest^-1 * A * R_target_rest`, root translation scaled by leg length, **floor guard** (no ankle / toe below standing height). Human change: `--keep-rest` (spine, neck, head, clavicles) takes the mocap's change from its own rest without the rest-direction alignment: the scan keeps its own posture and the head no longer tips back. |
| bake | boxer `07_bake.py` (reused) | Only for decimated scans: colour and normal from `body_hi` onto the 19k body, 2k (Cycles, 16 samples). |
| maps | `05_maps.py` | The colour (and normal) maps plus a **skin mask** (colour rule on the albedo, R = skin) for the runtime shader, and the KTX2 job list. |
| export | `06_export.py` | One GLB per person: the skeleton + `lod0` (≤ 20k), `lod1` (~6k), `lod2` (~1.5k) skinned meshes, no images, no animation. |
| library | boxer `08_export.py --what clips` (reused) | The shared clip library GLB (rotations for every bone + the root track). |
| ktx2 | `apps/web/scripts/boxer/ktx2.mjs --plan` (reused) | ETC1S colour / mask, UASTC normals, 2k desktop + 1k phone. |
| publish | `run.mjs --publish` | Copies GLBs, KTX2 maps and `manifest.json` (with the CC BY credit lines) to the git-ignored public folder. |

Measured on the three test scans (M2 Pro, CPU Cycles): the whole run takes **about 1.5 minutes** (import 1-20 s,
rig ~2 s, clips ~4 s, bake ~7 s, KTX2 2-16 s per person).

QA helper: `preview.py` renders front / side / back Workbench sheets of any stage (`--joints` shows the rig's joints
through a see-through body, `--action walk --frame 10` a clip frame).

## The CMU clips

Free, no login: CMU Graphics Lab Motion Capture Database (BVH conversion, public mirror
`una-dinosauria/cmu-mocap`). "The data used in this project was obtained from mocap.cs.cmu.edu. The database was
created with funding from NSF EIA-0196217." Free for any use, including commercial.

| Clip | CMU take | Window found |
| --- | --- | --- |
| walk | 07_01 walk | 1 gait cycle, 1.00 s, 1.17 m/s |
| walkSlow | 07_04 slow walk | 1 gait cycle, 1.57 s, 0.78 m/s |
| idle | 139_02 shifting weight | 4.1 s loop |
| idleWait | 137_28 normal wait | 5.7 s loop |
| lookAround | 139_01 looking around | 4.0 s loop |
| talk | 18_08 conversation, hand gestures | 6.2 s loop (seam 0.07) |
| talk2 | 138_11 story telling | 2.6 s loop (root held) |
| wave | 143_25 waving | 2.0 s loop |
| cheer | 142_06 elated | 2.0 s loop |
| sitDown / standUp | 143_18 sit down and get up | 1.1 s / 0.9 s |
| sit | 114_05 sitting in a chair | 4.5 s loop |
| jump | 13_39 jump | 3.0 s |

Not in CMU: a real clap (cheer stands in), turn on the spot (the runtime turns the body and the walk blends).

## Mixamo equivalents

If you download Mixamo clips later (Adobe ID; "FBX Binary, Without Skin, 30 fps"), these replace the CMU takes with
cleaner, studio-captured motion, and `04_retarget_clips.py --map mixamo` takes them as they are: Walking, Slow
Walking (or Female Walk), Breathing Idle, Weight Shift, Looking Around, Talking (several), Waving, Clapping,
Cheering, Sitting Down / Sitting Idle / Standing Up (chair), Left / Right Turn, Jump.

## What is still missing

- **Hands**: no finger bones (scan hands are mittens or baked fists); a good scan with open hands needs finger joints
  added to `03_autorig.py`.
- **Face**: no blinks, no jaw: a scan's eyes and mouth are texture. Possible later with a separate eye / lid mesh.
- **Skin mask**: a colour rule, not segmentation; yellow or beige clothes can be partly taken as skin.
- **Cloth**: the clothes are part of the scanned skin, so they bend with the body like rubber in big poses (no cloth
  correctives like the boxers').
