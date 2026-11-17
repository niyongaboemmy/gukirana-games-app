# Boxer v9: the Blender pipeline (P3-FGT-21)

Scripts: `apps/web/scripts/boxer-v9/`. Runner: `node apps/web/scripts/boxer-v9/run.mjs`.

**Status (P3-FGT-22, 2026-11-17): steps 1-8 and the KTX2 stage run end to end, headless, on Blender 5.2.4 LTS**, on
stand-in inputs that need no login: the shipped v8 GLB as the body (and as its own rig source), six CMU BVH boxing
takes, and a primitive placeholder glove. The real inputs (MetaHuman body, Mixamo auto-rig and clips, Sketchfab gear)
do not exist yet, so the Mixamo code paths of steps 3 and 4 and the shoe / headgear modes of step 6 have not run.
See "Verified on Blender 5.2" below for exactly what ran, what changed and the timings.

## What goes in, what comes out

```
MetaHuman full-body FBX ──┐
 (or a scanned body)      │  01 import ─ 02 decimate ──► body-for-mixamo.fbx ──► (you) Mixamo auto-rig
                          │                                                          │
Mixamo character.fbx ─────┴──────────────────────────────── 03 rig (Bip01 skeleton) ◄┘
Mixamo clip FBXs (+ CMU BVH backups) ──────────────────────  04 retarget clips
                                                             05 cloth: singlet + trunks, per-pose correctives
Sketchfab gloves / shoes / headgear ───────────────────────  06 fit gear (x N)
                                                             07 bake maps (2k + 1k PNG) ─► 10 ktx2 (ktx2.mjs)
                                                             08 export: boxer-m.glb, boxer-m-lod1.glb
                                                             09 library: boxer-clips.glb (shared M + F)
```

Everything lives in `apps/web/scripts/boxer-v9/work/`, which is git-ignored: inputs in `work/in/`, outputs in
`work/out/`. Nothing goes to `apps/web/public/` until the user approves the assets and the licences (LICENCES.md,
"Public repository").

## Running it

```
node apps/web/scripts/boxer-v9/run.mjs --check                                   # Blender? basisu / magick for KTX2?
node apps/web/scripts/boxer-v9/run.mjs --init                                    # work/ and work/pipeline.json
node apps/web/scripts/boxer-v9/run.mjs --body test --clips cmu --fast --publish-test   # the no-login test run
node apps/web/scripts/boxer-v9/run.mjs --body metahuman --clips mixamo           # the real run (stops at Mixamo)
node apps/web/scripts/boxer-v9/run.mjs --body scan --clips mixamo                # a scanned body instead
node apps/web/scripts/boxer-v9/run.mjs ... --from rig                            # continue after the Mixamo web step
node apps/web/scripts/boxer-v9/run.mjs ... --only cloth                          # re-run one step
node apps/web/scripts/boxer-v9/run.mjs ... --dry-run                             # print every command
```

- `--body metahuman|scan|test`: the body. `test` is the shipped v8 GLB, rigged from its own Bip01 skeleton
  (`03_rig.py --map bip01`), so no Mixamo step; it also re-unwraps the body (`02_decimate.py --unwrap`) because the
  MakeHuman UVs overlap. Never ship it: it only exercises the pipeline.
- `--clips mixamo|cmu`: `mixamo-clips.json` from `work/in/mixamo/<f>/`, or `cmu-clips.json` from `work/in/cmu/`
  (windows cut from long CMU takes; `--map cmu`).
- `--gear sketchfab|placeholder` (default `placeholder` with `--body test`): the gear list of `pipeline.json`, or two
  placeholder gloves made by `make_placeholder_gear.py`.
- `--fast`: 1k maps (and 512 px "-1k" copies) at 16 samples. `--publish-test` copies a `--body test` result to the
  git-ignored `apps/web/public/assets/characters/_v9test/` for the dev-only lab, and refuses real outputs.
- Missing inputs stop the runner with what to do: the MetaHuman / scan path, the Mixamo web step, or the `curl`
  lines for missing CMU takes (it never downloads anything itself).
- Every run prints a per-step timing table and writes `work/out/<f>/timings.json`.

The runner looks for Blender in `$BLENDER`, `/Applications/Blender.app`, `~/Applications/Blender.app`, the usual
Linux and Windows locations, then `PATH` (4.2 or newer; verified on 5.2.4 LTS). Each step is
`blender --factory-startup -b <previous.blend> -P <step>.py -- <args>`, and each step saves a new `.blend`, so any
step can be re-run or opened in the Blender UI to inspect.

## Verified on Blender 5.2 (P3-FGT-22)

Test run: `--body test --clips cmu --fast --publish-test` on an M2 Pro (CPU bake), all steps exit 0.

| Step               | Status                          | Time (test run)                    | Notes                                                                              |
| ------------------ | ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| placeholder        | ran                             | 2 s (skipped when the file exists) | 20.7k-triangle glove, decimated to 2.2k in step 6                                  |
| 1 import           | **verified** (GLB)              | 1.3 s                              | FBX / OBJ scans not run                                                            |
| 2 decimate         | **verified**                    | 1.0 s                              | 28,376 -> 19,000 triangles, head 9,734 -> 4,994                                    |
| (Mixamo web step)  | not run                         |                                    | needs the user's Adobe login                                                       |
| 3 rig              | **verified with `--map bip01`** | 1.3 s                              | 57 Bip01 bones, 0 unweighted vertices; `--map mixamo` not run                      |
| 4 clips            | **verified with `--map cmu`**   | 5.6 s                              | 6 clips from CMU 14_01; `--map mixamo` not run                                     |
| 5 cloth            | **verified**                    | 71 s                               | singlet + trunks, 5 correctives each (the other 8 poses have no CMU clip: skipped) |
| 6 gear             | **verified, glove mode**        | 1 s each                           | shoe / headgear not run                                                            |
| 7 bake             | **verified**                    | 15 s                               | 1k, 16 samples; 2k / 64 samples will be about 15x                                  |
| 8 export + library | **verified**                    | 1.1 s + 1.2 s                      | LOD0 26,572 triangles, LOD1 11,994; every bind rotation identity                   |
| ktx2               | **verified**                    | 30 s                               | 28 KTX2 files from the bake plan                                                   |
| **total**          |                                 | **2 min 10 s**                     |                                                                                    |

The test GLB was loaded in the dev-only lab (`/play/boxing-lab?mode=boxer&v9=1&clip=jab&at=0.33`, see
`world/human/boxer/v9-lab.dev.tsx`): the clips play on the exported skeleton, the cloth correctives blend as morph
targets, `helpers.ts` drives the helper bones, and `v9rig=1` runs the runtime `rig.ts` / `arm-fk.ts` on the v9
skeleton without changes. Review shots: `docs/QA/boxing-v9/pipeline-test/` (guard, jab, lead hook, the hit-reaction
stand-in, an armhole close-up, the rig.ts check). They show our own v8 body with CMU-driven motion only.

What changed for Blender 5.2 and what the first run found:

- **glTF import of our GLBs crashed** (`couldn't access the py sequence`) on 8-bit custom vertex attributes (`_AO`,
  `_MAT` ...). `common.import_any` now imports a temporary copy without the `_*` attributes.
- **Stale handles**: after `bpy.data.objects.remove()` the view layer can still yield `None` until updated
  (`select_only` updates it); a vertex group's Python handle dies when a modifier is applied (look it up by name).
- **Decimate with a vertex group** collapses weight 1 first and protects weight 0 (the opposite of the old comment),
  and the factor makes no difference. Step 2 now decimates in two passes: the head to `--face-tris`, then the rest.
- **Centring**: step 1 centred the bounding box, which arms or fists move; it now centres on a pelvis slice.
- **Step 3**: the source mesh was moved twice when fitted (once more through its parent armature); the new rig was
  named `boxer.001` beside the imported one. Unmapped source groups (face bones, end bones, another rig's helpers) are
  now folded into the nearest mapped ancestor, and the step fails if any vertex is left unweighted.
- **Step 4 retarget**: the old formula assumed the source and target rests were the same pose; a T-pose CMU take on
  the A-pose test body put every arm 45 degrees off. A per-bone rest alignment A (target joint-to-child direction onto
  the source's) fixes that, and is the identity for a Mixamo rig of our own body. Long takes are cut by
  `start` / `end`, turned to face -Y (`face`: `hips`, `chest` or `punch`), the hips are scaled by leg length with the
  lowest ankle at our standing ankle height, and a floor guard lifts the root on any frame where an ankle or toe joint
  would sink (0 frames needed on the test clips).
- **Step 5 cloth** (the big one): the first run threw the singlet off the body and came back torn. Fixed by, in
  order of effect: (1) the correctives are stored aside and only become shape keys after the last pose (with the keys
  on the mesh, each later simulation started more crumpled); (2) a soft goal towards the skinned shape (0.6 at the
  top to 0.25 at the hem, 0.85 on the border ring, 1.0 on straps and waistband); (3) every pose ramps rest -> guard ->
  pose, as a punch starts from the guard; (4) quaternion keys kept on one side of the 4D sphere (a sign flip spun a
  bone 360 degrees in 24 frames); (5) the singlet takes no arm weights (the arm passes outside the armhole), the
  collider is a body copy without forearms and hands, and it is reset at frame 1 of every simulation; (6) the folded
  hem is added after the simulation, on every shape key (a 2.5 mm lip inside the simulation turned into shards);
  (7) the singlet is tucked under the trunks (hard-pinned below the waistband); (8) bending raised to 2 / 4; (9) the
  dense guard copy uses one subdivision without self-collision (two subdivisions with self-collision ran over 10
  minutes). Each pose now logs `arm_inside` (garment vertices inside an upper arm: 0 in every pose but the rear hook,
  1-3 vertices) and the edge stretch against the plain skinned garment (p99 1.33-1.87); both are in
  `correctives.json`. The stretch limit of 1.6 still flags every pose ("CHECK FAILED" is logged, the step does not
  stop): see "Still open".
- **Step 6**: a node offset in the gear file (the placeholder had 19 cm) left the gloves floating; all transforms are
  applied first now.
- **Step 7**: the KTX2 plan entries now carry `object`, `map` and `variant` so the runtime (and the lab) can find the
  maps per mesh.

Still open (honest list):

- The garments are usable but not yet good: the trunks surface is lumpy, the waistband ripples, and one armhole edge
  shows a small ragged notch in the lead hook close-up. The stretch numbers say the same. Next: a finer garment
  mesh than the 2-3.5k triangle cut, or a pattern-made garment (`--source-singlet`), and a tuned stretch limit.
- CMU has no hit reactions, knockdowns, corner sits or victory poses; the hit-reaction shot uses a lean-back from the
  shadow-boxing take as a stand-in, and 8 of the 13 cloth poses were skipped. Mixamo covers them.
- The face is rigid (no jaw / blink bones in v9 yet), as planned.
- The mixer: `THREE.AnimationMixer.setTime()` did not move the bones in the lab, for reasons not found; the lab samples
  the clip tracks directly. The runtime task must check its own playback path.

## Triangle budget (one fighter, phone first)

| Part                        | LOD0             | Notes                                                                                                                                                |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body (face about 5k of it)  | 19,000           | `02_decimate.py --target`, the head to `--face-tris` (default 5,000). Hands and feet under gloves and shoes are deleted in step 6 (about 1.5k saved) |
| Singlet                     | 3,500            | `05_cloth.py --target`, including the folded hem                                                                                                     |
| Trunks                      | 3,500            |                                                                                                                                                      |
| Gloves                      | 2 x 2,200        | `06_fit_gear.py --target`                                                                                                                            |
| Shoes                       | 2 x 1,200        |                                                                                                                                                      |
| Headgear (female, sparring) | 2,000            |                                                                                                                                                      |
| **Total**                   | **about 33–35k** | `08_export.py` refuses more than 35,000                                                                                                              |
| LOD1                        | about 12,000     | Decimated copies, no correctives, same skeleton                                                                                                      |

Textures: 2048 px source maps (desktop) and 1024 px copies (phone), encoded as KTX2 by the existing
`apps/web/scripts/boxer/ktx2.mjs`: albedo as ETC1S, and normal, AO and roughness as UASTC.

## The steps

### 1. Import (`01_import_body.py`)

Imports the MetaHuman full-body FBX (or a scan: FBX, GLB or OBJ). Joins the skin meshes into `body`. Keeps hair,
brow and lash meshes apart. Drops the source skeleton (we re-rig). Feet on z = 0, centred, optional `--height`.
Prints the triangle count and whether the body faces -Y.

### 2. Decimate (`02_decimate.py`)

Keeps the untouched mesh as `body_hi` (the source for the normal bake). Collapses `body` to the budget with X
symmetry, keeping relatively more triangles on the face. Writes `body-for-mixamo.fbx` for the auto-rigger.

### Manual web step: Mixamo auto-rig (the user)

Upload `body-for-mixamo.fbx` at mixamo.com, place the markers, "Standard Skeleton (65)". Download it back as **FBX
Binary, T-pose, With Skin** and save it as `work/in/mixamo/m/character.fbx`. Then download the clips listed in
MIXAMO-MOVES.md.

### 3. Rig (`03_rig.py`): skeleton decision

Decision: **our own Bip01 skeleton, placed at Mixamo's joints, with Mixamo's skin weights.** Neither the MetaHuman
nor the Mixamo skeleton is used directly.

- The runtime boxing layer (`world/human/boxing/rig.ts`, `arm-fk.ts`, `boxer/helpers.ts`, `face.ts`) finds bones by
  their **Bip01 names**. The helpers assume **identity bind rotations**, as in the v8 GLB, where every node rotation
  is `[0,0,0,1]`. Building that skeleton keeps the keyed arms, the joint limits in `arm-fk.ts`
  (`LIMITS`: shoulder flex -40..175 degrees, elbow 0..150 degrees, wrist ±25 degrees ...), the keep-out and the helper bones working with no
  runtime rewrite.
- Mixamo's joints are where Mixamo's clips expect them, so retargeting onto the same joints is exact. The MetaHuman
  skeleton (about 1,000 joints with face rig logic) means nothing outside Unreal without RigLogic, and its body part
  would need a retarget anyway.
- Weights: Mixamo's are copied onto our own body mesh (Data Transfer, nearest face) rather than using Mixamo's mesh,
  which may re-order vertices. That keeps our UVs and materials. `Hips` becomes `Bip01_Pelvis` (Bip01 is the moving
  root, as in v8). The forearm twist takes the wrist half of the forearm weights. The shoulder helper takes half the
  deltoid around the joint.
- Every bone points straight up with roll 0, which is the identity rotation in glTF (Y-up). Bone map:
  `bone-map.json`.
- **Alternative without the Mixamo upload** (if the owner prefers not to upload the MetaHuman to Adobe): run
  `03_rig.py` against any Mixamo-rigged dummy of similar build to get the joints. Or, in the Blender UI, add the
  `boxer` armature by hand and use Object, Parent, With Automatic Weights. This route is **not scripted yet** and
  gives weaker weights around the shoulders.
- What the face loses: v8 had jaw, eyelid, brow and mouth-corner bones. Mixamo's auto-rig makes none. In v9 the face
  is rigid at first. A later task adds blink and jaw, either from the MetaHuman morph targets exported with the FBX
  (not yet checked) or with small bones placed by hand.

### 4. Clips (`04_retarget_clips.py`)

For every frame and every mapped bone: `R_target = R_source * R_source_rest^-1 * R_target_rest`. Only the root also
takes the hip translation, scaled by the hip-height ratio. No constraints and no bake operator are involved, so the
result is deterministic. Mirroring (`"mirror": true`) is exact because all our bones share one rest orientation.
`strip_root` keeps footwork in place. `clips-report.json` gives each clip's length, its root travel in three.js axes
(for `travel` in clips.ts) and an impact-time guess from the peak wrist speed. The same script takes CMU `.bvh`
backups.

**Arm joint limits with mocap:** clips play through the mixer. In the runtime task the keyed-arm layer stops
generating the arms and becomes a post-pass over the mocap: it converts the arm bones to `arm-fk` angles, applies
`clampArm` (limits), `keepOut` (gloves out of the own torso, the other arm and the opponent) and the small `aimArm`
correction at impact, then writes the bones back. Identity rest rotations make that conversion the same maths
`ArmFk` already uses. That is a runtime change, out of scope here.

### 5. Cloth (`05_cloth.py`)

Removes what made v8 look faceted and torn:

- the panel is cut from the body by skin weights (singlet: chest, back and clavicles above the waist, deep armholes,
  scoop neck; trunks: pelvis to mid-thigh, waistband at the navel), the border is relaxed into a smooth curve, then
  pushed out to the ease (6 mm singlet, 14 mm trunks). You can also supply your own garment mesh
  (`--source-singlet`);
- a **folded hem**: the border is extruded 2.5 mm inwards, so every edge has thickness and nothing reads as torn
  paper;
- real **Blender cloth** after the armature (polyester-like: light, soft bending), the waistband and strap tops
  pinned, the body as a collider, self-collision on;
- **drape**: a rest-pose simulation becomes the base shape;
- **per-pose correctives**: for each pose in `cloth-poses.json` (guard, the punch impacts, duck, block, down,
  kneel, arms up, sitting) the body is animated from rest into the pose over 24 frames, held for 20, the cloth
  settles, and the result is **inverse-skinned** back to rest space and stored as the shape key `corr_<pose>`. The
  phone plays only skinning plus a weighted blend of these keys, which is the same idea as v8's
  `boxer/corrective.ts`, with the shapes from a simulation instead of code;
- for the guard, a 4x denser simulation is kept as `<garment>_hi_guard` so step 7 can bake real wrinkles into the
  normal map.

### 6. Gear (`06_fit_gear.py`, once per item)

Brings a downloaded glove, shoe or headgear into a canonical frame (`--rotate`, chosen once by looking at the model).
Optional `--mirror`, which for a glove also turns the thumb back. `--cut-below` removes a scan's floor plate. Then it
fits the item:

- **glove**: scaled to `--length` (12 oz is about 0.30 m), its pivot (38 % up from the cuff) on the wrist,
  length along the forearm, thumb towards the thumb. Rigid on the hand; the cuff blends 60 % onto the forearm twist
  bone;
- **headgear**: about 22 mm of padding each side of the head, the crown 18 mm above the scalp, rigid on the head;
- **shoe**: 6 % longer than the foot, sole on the floor, weights copied from the foot and toe.

The model is kept as `<name>_hi` for the bake, decimated to `--target` and given clean UVs. `--hide-hands` and
`--hide-feet` delete the body faces underneath.

### 7. Bake (`07_bake.py`)

Cycles, selected-to-active, high to low per pair: normal (tangent), base colour (diffuse colour only), AO,
roughness, at 2k plus 1k copies. Garment pairs bake only the normal (wrinkles). Body roughness is clamped at 0.42 or
more (v8 skin was shiny; sweat is added back at runtime). Writes `ktx2-plan.json` for step 10.

### 8–9. Export (`08_export.py`)

`--what fighter`: skeleton plus meshes plus correctives (morph targets), no animation, no images. LOD1 is a decimated
copy without morph targets. `--what clips`: skeleton plus every action. **One clip library for both fighters**:
identity rest rotations make quaternion tracks portable between bodies of different size. Exporter options this
Blender lacks are skipped with a message.

### 10. KTX2 (`apps/web/scripts/boxer/ktx2.mjs --plan`)

The existing v8 encoder. It needs `basisu` and `magick`, which are already installed on this machine according to
`run.mjs --check`.

## Hand-off to a runtime task (not part of P3-FGT-21)

When the CHECKLIST passes:

1. the owner approves the assets and the licence policy change, and picks private storage for the GLBs;
2. a new task loads `boxer-m.glb` and `boxer-clips.glb` behind a feature flag (`NEXT_PUBLIC_FF_BOXER_V9`), maps fight
   acts to the new clips (MIXAMO-MOVES.md tables), runs `arm-fk` as a post-pass, and blends the cloth correctives;
3. it adds credits to `docs/ASSET-LICENSES.md` and the in-game credits.
