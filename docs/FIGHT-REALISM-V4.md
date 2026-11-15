# Boxing realism v4: arms attached to the boxers, and the P3-FGT-13 gaps (P3-FGT-14)

Status: implemented. Builds on docs/FIGHT-REALISM-V3.md (the MakeHuman-based boxer bodies). Evidence:
`docs/QA/evidence/p3-fgt-14/`. Presentation only: the engine, the life / recovery rules and the money paths are
untouched.

## 1. "The arms look like they are not attached to the person" — diagnosis

Tools written for it: the lab's boxer debug view `/play/boxing-lab?mode=boxer` (`world/human/boxer/BoxerLab.tsx`:
any clip frozen at any time; `debug=bones` skeleton overlay, `debug=weights` per-bone heatmap or `bone=arm` clavicle /
upper arm / forearm colours, `bind=1` bind pose, `bare=1` the body alone, `glb=before` the P3-FGT-13 GLB, `cmp=1` the
Rocketbox body the rig was authored on beside it, views in the chest frame), a CPU-skinning probe
(`boxer/skin-probe.dev.ts`: the real GLB + motion library + rig + helpers in node, measuring the skinned mesh) and
contact sheets (`qa/e2e/boxer-sheet.mjs`, `boxer-sweep.mjs`).

Checked in the order of the brief, with what each showed:

| # | Suspect | Finding | Evidence |
| --- | --- | --- | --- |
| 1a | Skeleton / bone mapping | **Root cause.** The clavicles hung from `Bip01_Spine2`; in the reference rig (3ds Max biped / Rocketbox) they hang from the **neck**, which `rig.ts` turns part-way back towards the opponent (between the chest turn and the head aim). On the boxer the shoulders took the full chest turn: in the guard the lead shoulder sat 14 cm further forward and 8 cm further in than on the reference body (shoulder in the chest frame z = +0.068 vs −0.073 m). The chest pivot was MakeHuman's `spine02`, 25 cm under the shoulders (reference 11 cm). The guard's lead wrist target ended 11 cm from the lead shoulder: the arm folded shut and the IK pole, projected on a near-vertical shoulder → wrist line, put the **elbow out sideways at shoulder height** | `diag-02`, `diag-08`; probe numbers above |
| 1b | Bind / inverse bind / rest pose | Correct: identity bind rotations, inverse binds from the joint positions, the rig is IK-driven (no rotation retarget needed) | — |
| 1c | Skin weights | **Contributing.** Next to the shoulder joint ~26–30 % of each vertex's weight was on the clavicle / chest (MakeHuman's `shoulder01` merged into the clavicle): the deltoid stayed behind as a lump with a crease when the arm rose, and folded over the shoulder top | `diag-03`, `diag-04`, `diag-07` |
| 2 | Retargeting (proportions) | **Root cause.** The authored wrist targets / elbow poles come from the slimmer reference body: on the deeper MakeHuman chest the **rear forearm ran through the chest** in the guard — 49 % of the rear forearm / hand vertices inside the trunk (25 % of both arms), the same in most actions (jab 22 %, lead uppercut 30 %, slip 27 %, duck 26 %, block low 23 %). From the front the rear arm was a stump ending at the chest | `diag-05`, `diag-06`, table §4 |
| 3 | Mesh / vest | **Root cause of the look.** The vest's arm hole was "arm weight > 22 %", which on MakeHuman's weights opened the vest down the ribs and across the pec, jagged at the shoulder: the arm came out of a large skin oval on the side of the torso. No geometry gap: the body is one piece | `diag-01`, `diag-04` |
| 4 | Contact IK | Not a cause: `fitAim` changes the wrist target only; the chain stays connected | — |

## 2. The fix

**Build (`apps/web/scripts/boxer/build.mjs`, GLBs regenerated):**
- the reference rig's hierarchy: clavicles under `Bip01_Neck`; the spine pivots at the reference heights (Spine =
  lower back, Spine1 = bottom of the ribs, Spine2 = the upper chest, ≈ 11 cm under the shoulder joints);
- corrective helper bones (appended, indices of the others unchanged): `Bip01_{L,R}_ShoulderHelper` at the shoulder
  joint, turning half as far as the upper arm, carrying the deltoid / armpit share that MakeHuman weights to the
  clavicle and chest (`skin-math.mjs shoulderShare`: full on the deltoid cap, none on the collarbone / pec, under the
  joint only where the arm already pulls); `Bip01_{L,R}_ForearmTwist` on the forearm axis with MakeHuman's
  `lowerarm02` weights, rolling half the hand's twist (no candy wrapper at the wrist);
- weights normalised to exactly 255 per vertex (`weightBytes`), every vertex on valid bones (tested);
- the singlet's arm hole cut geometrically (an ellipse round the shoulder joint seen from the side, lateral of the
  strap line, a rounded corner at the strap, sized by the shoulder width so the feminine body keeps its straps);
- torso slices (13 rows, per body-type morph) for the rig's keep-out.

**Rig (`world/human/boxing/rig.ts`, only for bodies that pass `torso`: the boxer body; the Rocketbox path is
unchanged):**
- torso keep-out: the glove target comes forward off the chest (never out sideways through the far flank); the
  elbow pole swings round the shoulder → wrist line, the least it takes (≤ 90°, never over the shoulder, a rising
  elbow costs more), until the elbow and points along both segments are outside the trunk; if no swing clears it the
  wrist steps forward 2.5 cm at a time (≤ 15 cm);
- shoulder rhythm: the clavicle lifts by ⅓ of the upper arm's elevation above 55° (≤ 0.3 rad) and rolls forward as
  the elbow comes forward / across (≤ 0.22 rad) — what the reference body's mocap clavicles did;
- `boxer/helpers.ts` poses the helpers after the rig every frame (swing-twist decomposition for the forearm twist).

## 3. The P3-FGT-13 gaps

| Gap | Done |
| --- | --- |
| Referee shirt like a bodysuit (female referee worst) | Draped cloth: per height slice the body's outer envelope (bridging the cleavage, the spine groove), hanging from the chest / bust / shoulder blades with at most 0.22 m/m of inward slope, bloused into a tuck under the belt, soft vertical folds, the bust's small bumps bridged (1.4 cm over the smoothed body); loose short sleeves flaring to the hem; a stand collar growing out of the neckline with pointed wings beside the bow tie; trousers hanging straight from the seat / thighs with a waistband; the staff polo uses the same cloth (`referee-*`, `staff-f-after`) |
| Side camera at rope height | `camera.tsx clearRopes`: when the eye is outside the ropes and the sight line would cross the rope line within 11 cm of a rope, the eye rises / drops (the least) to look through the middle of a gap or over the top rope; applied to the shot target before the operator's damping (smooth). The knockdown shot is lower and wider so the counting referee is in it. Tested (`camera-ropes.test.ts`) |
| Fighter sitting on air between rounds | The rest spot is the ring kit's own stool spot (hips over the seat; the seated pose's 6 cm hip offset compensated); at the bell the corner's second lifts the stool over the ropes and sets it down (1.2 s), then the ring kit's stool takes over (the hall and the ring lab delay their rest flag by as long) (`lab-rest-*`, `hall-rest-*`) |
| Judges at the feature rings | Three officials seated at the three judges' tables of R1 / R2 only (`fight/judges.tsx`), watching and writing (the `judgeSit` clip, each on its own phase), shown within 26 m of the camera (3 draw calls per ring when shown) (`hall-rest-stool-carried-R1`, `hall-rest-on-stool-R2`) |
| Referee count finger by finger | `boxing/count-signs.ts`: 1–5 on one hand (index first, thumb last), 6–10 the first hand up open and the other counting again (`refCount2`); palm and fingers shown to the fighter; driven from the snapshot's `count` for knockdowns and standing counts (`referee-finger-count-1-10`, `lab-count-*`) |
| The player's face shape on the boxer head | Done: the avatar's face choices (shape, eyes, nose, lips) as 16 sparse morph targets from MakeHuman's CC0 face targets at moderate weights, baked per person (`face-shapes-on-boxer-head`; tested: each moves the head only, by mm). Exact Rocketbox head geometry is not transferred (different topology), the choices are |

Also: morph targets are stored as normalised int16 (KHR_mesh_quantization), the face targets as sparse floats (three's
sparse loader drops the normalised flag): boxer-m.glb 3.30 → 2.86 MB, boxer-f.glb 3.25 → 2.81 MB with the new targets
and bones.

## 4. Numbers (CPU skinning, `BOXER_REPORT=1 vitest boxer-skin.test.ts`)

Forearm / hand vertices inside the trunk (both arms), before → after, masculine / feminine:

| Action | m | f |
| --- | --- | --- |
| guard | 25 % → 0 % | 23 % → 0 % |
| jab | 22 % → 5 % | 20 % → 5 % |
| cross | 6 % → 1 % | 0 % → 0 % |
| lead hook | 16 % → 0 % | 13 % → 0 % |
| rear hook | 14 % → 0 % | 11 % → 0 % |
| lead uppercut | 30 % → 0 % | 30 % → 0 % |
| lead body | 13 % → 1 % | 9 % → 1 % |
| block low | 23 % → 1 % | 17 % → 3 % |
| slip | 27 % → 0 % | 21 % → 0 % |
| duck | 26 % → 0 % | 24 % → 0 % |

Guard lead elbow under the shoulder: 5 → 12 cm (m), 3 → 8 cm (f). The shoulder edge stretch (95th percentile, edges
within 12 cm of the joint) rose from 1.3–1.9 to 1.5–2.7: the arms now move clear of the chest (more abduction than
before), and the armpit skin stretches as real skin does; no tearing or collapse in the sheets.

## 5. Performance, flicker

- Fight lab (practice ring, two fighters + referee + corner team at the rest, headless Chrome, M2 Pro): **8 draw
  calls** in the round, 10 while the stool is carried, 9 at the rest; **60 fps** at 1280×720 and at 844×390 DPR 2
  (`perf-lab-*.json`). Triangles ≈ 94.6k in the round.
- Judges: +3 draw calls per feature ring within 26 m of the camera; a fight on a standard ring never shows them.
- `qa/e2e/zscan.mjs hall:boxing` on the worktree stack: 0 flat z-fighting pairs, 0 wall-face pairs.

## 6. Not done / open

- The lead hook's elbow still rises over the shoulder at impact, as authored for the reference body (both bodies do).
- Garment LODs.
- The headgear and hair cap are rigid shells sized on the base head: a strongly "long" or "round" face choice may
  touch the hair cap's edge.
