# Boxer v9: the Blender pipeline (P3-FGT-21)

Scripts: `apps/web/scripts/boxer-v9/`. Runner: `node apps/web/scripts/boxer-v9/run.mjs`.

**Status: every Blender script is UNTESTED.** They were written before Blender was installed on this machine. They
pass a Python syntax check (`python3 -m py_compile`), nothing more. Expect to fix small API mismatches on the first
run. The runner's `--check`, `--init` and `--dry-run` paths were run with Node 24. Each script's header says what it
does, its arguments and its assumptions.

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
node apps/web/scripts/boxer-v9/run.mjs --check      # Blender found? basisu / magick for KTX2?
node apps/web/scripts/boxer-v9/run.mjs --init       # creates work/ and work/pipeline.json (edit it)
node apps/web/scripts/boxer-v9/run.mjs --dry-run    # prints every blender command
node apps/web/scripts/boxer-v9/run.mjs              # runs; stops at the Mixamo web step with instructions
node apps/web/scripts/boxer-v9/run.mjs --from rig   # continue after Mixamo
node apps/web/scripts/boxer-v9/run.mjs --only cloth # re-run one step
```

The runner looks for Blender in `$BLENDER`, `/Applications/Blender.app`, `~/Applications/Blender.app`, the usual
Linux and Windows locations, then `PATH`. It needs 4.2 or newer (4.5 LTS recommended). Each step is
`blender --factory-startup -b <previous.blend> -P <step>.py -- <args>`, and each step saves a new `.blend`, so any
step can be re-run or opened in the Blender UI to inspect.

## Triangle budget (one fighter, phone first)

| Part | LOD0 | Notes |
| --- | --- | --- |
| Body (face about 5k of it) | 19,000 | `02_decimate.py --target`. The face is protected (`--face-keep`). Hands and feet under gloves and shoes are deleted in step 6 (about 1.5k saved) |
| Singlet | 3,500 | `05_cloth.py --target`, including the folded hem |
| Trunks | 3,500 | |
| Gloves | 2 x 2,200 | `06_fit_gear.py --target` |
| Shoes | 2 x 1,200 | |
| Headgear (female, sparring) | 2,000 | |
| **Total** | **about 33–35k** | `08_export.py` refuses more than 35,000 |
| LOD1 | about 12,000 | Decimated copies, no correctives, same skeleton |

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
