# Boxing realism v5: the people in the ring rebuilt — keyed anatomical arms, real kit, staging (P3-FGT-16)

Status: implemented (presentation only; the engine v2 rules, the life model and the money paths are untouched — no
engine version bump). Builds on docs/FIGHT-REALISM-V3.md / V4.md (the MakeHuman boxer body), docs/HUMAN-REALISM.md
(skin, eyes, draped garments) and docs/BOXING-V5.md (the fight camera). Evidence: `docs/QA/boxing-v5/`. Feature flag:
`NEXT_PUBLIC_FF_KEYED_ARMS` (on unless `0`; off falls back to the P3-FGT-14 wrist-target IK).

The user's verdict on P3-FGT-15 + QA-HUM-01: *"arms are malformed and not function as of human, even the whole human
in the ring is not normal."* This task diagnosed first, measured, then rebuilt the arms, the kit and the staging.

## 1. Diagnosis

Tools: the boxer lab (`/play/boxing-lab?mode=boxer`, new `arms=ik` switch), a new two-fighter lab on the real ring
bodies (`/play/boxing-lab?body=boxer&headgear=1&clip=<clip>&at=impact`, contact targets as the hall computes them,
the clinch at the engine's tie-up gap with the referee placed by the hall's own rule), and three QA scripts:
`qa/e2e/boxing-v5-sheet.mjs` (every action, side / close / front cameras, 1280×720 and 844×390),
`qa/e2e/boxer-probe.mjs` (elbow measurements in the browser) and `qa/e2e/boxer-tris.mjs` (triangle budget).

### 1a. Arms: the per-frame IK put the elbows where no elbow can go

`boxer-probe.mjs` measures, on the live skeleton, how far the forearm leaves the elbow's hinge plane (a real elbow
bends in one plane: 0°) and the signed flexion (below 0 = bent backwards). Old IK (`arms=ik`) vs the rebuilt arms,
both on the boxer body, at each action's key moment (`docs/QA/boxing-v5/arms-before-ik.jsonl`, `arms-after-keyed.jsonl`):

| Action | Old IK: lead flex / sideways | Old IK: rear | Keyed: lead flex / sideways | Keyed: rear |
| --- | --- | --- | --- | --- |
| guard | 160° / **23°** | 125° / **22°** | 130° / 0° | 122° / 0° |
| jab (impact) | 33° / 14° | 128° / **25°** | 62° / 0° | 117° / 0° |
| cross | 127° / **39°** | 29° / 20° | 121° / 0° | 72° / 0° |
| lead hook | 101° / **31°** | 109° / **35°** | 95° / 0° | 101° / 0° |
| rear hook | 119° / **37°** | 102° / 1° | 116° / 0° | 98° / 0° |
| lead uppercut | 113° / **45°** | 135° / 28° | 95° / 0° | 113° / 0° |
| rear uppercut | 131° / 29° | 119° / **45°** | 119° / 0° | 100° / 0° |
| lead body | 120° / 9° | 104° / **46°** | 92° / 0° | 100° / 0° |
| rear body | 131° / **41°** | 77° / 10° | 119° / 0° | 107° / 0° |
| block high | **−163° (backwards)** / **50°** | 110° / 4° | 123° / 0° | 100° / 0° |
| block low | **−153° (backwards)** / 1° | 128° / 23° | 135° / 0° | 114° / 0° |
| clinch | 157° / 25° | 137° / 10° | 122° / 0° | 102° / 0° |
| hit (head, heavy) | 134° / 9° | 138° / **34°** | 116° / 0° | 111° / 0° |
| stagger | 114° / 14° | 124° / **50°** | 108° / 0° | 103° / 0° |

Causes, in order of weight:
1. **Procedural two-bone IK every frame** (`rig.ts`): wrist targets authored for the slimmer Rocketbox body, an elbow
   "pole" vector, then a keep-out that swung the pole up to ±90° round the shoulder → wrist line to clear the chest.
   Two-bone IK only places the elbow on a circle; the hand's roll was then forced to the authored palm direction, so the
   forearm twisted and swung out of its hinge plane (20–50° above) and, in the blocks, folded backwards. Nothing in
   the chain knew a joint limit.
2. **Retargeted targets on a different body**: the wrist targets came from the reference body; on the deeper MakeHuman
   chest the keep-out fought the targets frame by frame (elbows at shoulder height in hooks, the rear arm across the
   chest in the guard, gloves above the head on uppercuts — `compare-hook.jpg`, `compare-uppercut.jpg`).
3. **No contact model between the two fighters**: forearms crossed through each other and through the opponent; the
   clinch pose was two independent guards pushed together (`compare-clinch.jpg`).

### 1b. Kit, body, staging

| Seen in the user's screenshot | Cause found |
| --- | --- |
| Vest arm holes / neckline with white, jagged, torn edges, body showing through | (a) the vest hem strips were drawn in **both windings** at the same depth and had **radial normals lying in their own plane** (bump shading broke into sparkles); (b) the strap / arm-hole edge was **skinned to the upper arm**: in a raised guard the edge stretched with the deltoid into a zig-zag; (c) the arm hole reached ~9 cm under the armpit fold; (d) a **white binding**, single-sided cloth: through the hole you saw the void inside the vest |
| Waistband a jagged white band, stair-stepped stripe | the side stripe's centre line **jumped** at the crotch line (`cx` switched between hip and leg centre), band and stripe edges unfiltered (aliasing) |
| Gloves / headgear like smooth inflated balloons | glove = one superellipsoid + an ellipsoid thumb; headgear = a uniform offset of a smoothed head envelope (dips inside the cheeks at the opening: the rim **z-fought with the skin**, a dotted fringe); both glossy (clearcoat 0.1, roughness 0.5) |
| Waxy shiny skin | a constant oily clearcoat (0.06) at rest plus a strong warm "subsurface" fill |
| Referee inside the clinch | `refereeSpot` breaking position was **0.35 m** off the pair line, behind the pair's middle — inside the 0.75 m body separation, then pushed radially, ending right behind the boxers in the camera's view |

The body itself (MakeHuman CC0, proportions 4 in QA-HUM-01) was not the cause of the "malformed arms": with correct
joint angles the same mesh, weights and helper bones deform cleanly (`compare-guard.jpg`).

## 2. Sources and licences

- **Motion**: CMU Graphics Lab Motion Capture Database (free for all uses; raw data not redistributed) — boxing takes
  13_17/18, 14_01–03, 15_13, 17_10 and the punching takes of subjects 86/141/143/144 were parsed (ASF/AMC, own reader)
  and scanned for punch peaks. Used as **measurements**: straight punches go from 62 % to full extension in 0.06–0.12 s
  and back in 0.15–0.2 s (our clips: jab impact 0.14 s from the guard, recovery 0.26 s; the engine time-warps them);
  shoulder-to-wrist reach at full extension ≈ 0.58–0.65 m (ours 0.525 m + 8.5 cm to the glove's centre). Not used as
  a retarget source: amateur subjects with parallel feet, bare-hand guards a 12 oz glove would pass through, no body
  hooks, clinch, reactions or knockdowns — mixing retargeted mocap for some actions with keyed poses for the others
  would have given two different "people". Excluded on licence: Bandai Namco Research Motiondataset (CC BY-NC-ND),
  Mixamo (redistribution of raw files forbidden; project rule). Recorded in docs/ASSET-LICENSES.md.
- **Body**: MakeHuman 1.x CC0 base (unchanged commit `a8bc2d54…`), skin / eye assets CC0 (P3-FGT-15).
- **Gloves, headgear**: new procedural shapes, original work (`apps/web/scripts/boxer/kit-shapes.mjs`), dimensions from
  public product specifications of 10–12 oz amateur gloves (≈ 30 cm with the cuff, 13 cm wide) and open-face amateur
  headgear (forehead bolster, cheek pads, ear pieces).

## 3. Approach: keyed anatomical arms (no per-frame IK)

`apps/web/src/world/human/boxing/arm-fk.ts`, `pose.ts`, `clips.ts`, `rig.ts`:

- **Joint-angle channels in the pose**: every pose now carries, per arm, shoulder flexion / abduction / internal
  rotation, elbow flexion, forearm pronation, wrist flexion and clavicle elevation / protraction, plus an `fk` weight.
  The clips key these angles; the existing machinery (monotone cubic keys, cross-fades, intensity, southpaw mirroring,
  time-warp to the engine) interpolates them like any other channel, so **every in-between frame is a blend of two
  valid human poses**. Clips that still use wrist targets (referee, ceremony, walking, the knockdown fall) carry
  `fk = 0`; hand-overs cross-fade.
- **Forward kinematics from anatomy**: the reference pose is the arm hanging, palm to the thigh; each segment's bind
  direction, elbow hinge and palm are measured from the skeleton (`ArmFk`), so the same angles mean the same pose on
  the masculine and feminine bodies (and on any rig with these bones).
- **Joint limits on every frame** (`clampArm`): elbow 0–150° hinge (no sideways bend exists in the model, no backwards
  bend passes the clamp), shoulder swing-twist cone (no adduction through the trunk unless the arm is raised in front;
  internal rotation limited overhead), pronation −30…115° (half carried by the forearm-twist bone, `helpers.ts`), wrist
  ±25°, clavicle −8…32° / −15…30°.
- **Small corrections only, in angle space, re-clamped**:
  - *aim* (`aimArm`): the striking glove is bent onto the contact point the hall computes (`fighters.tsx aimFor`),
    ≤ 22° of shoulder swing and ±60° of elbow, weighted 0 at the guard → 1 at impact; the glove's centre stops 4 cm
    short of the point (leather meets the face, never sinks in);
  - *keep-out* (`keepOut`): elbows, forearms, gloves and upper arms are kept out of the own head (headgear sphere) and
    torso slices, the other arm (capsule + glove) and **the opponent** (head, chest and belly capsules, both arms; fed
    every frame by `BoxerAvatar opponent=`) by the least change of shoulder angles (projected gradient steps, ≤ 0.6
    rad); the striking arm near impact ignores the opponent (the aim decides the contact).
- **Authoring**: the keys were fitted with a constrained solver to glove / elbow targets in the root frame (or
  relative to the head for a guarding glove) at each key of each clip's torso motion, with a comfort term
  (`arm-fitroot.dev.test.ts`, an authoring aid), then reviewed in the two-fighter lab. The guard: elbows in front of the
  lower ribs, forearms rising to the gloves at the cheekbones, palms in; the jab and cross extend to the face at the
  presentation range; hooks travel with a horizontal upper arm at shoulder height and a 95–100° elbow; uppercuts rise
  under the chin with the palm turned in; body shots dig low with the knees; blocks bring the gloves to the temples /
  the forearms over the ribs; reactions flinch or clamp the elbows from the guard.
- **Clinch**: a real tie-up — lead arm over the opponent's rear arm round the upper back, rear arm under the
  opponent's lead arm round the lower back (both fighters the same, so the arms interleave), heads beside each other,
  at the engine's tie-up distance (0.66 m root to root).
- **Range**: the presentation gaps follow the keyed reach (`present.ts GAP_V2`: jab reach 1.10 m, hook 0.90 m,
  uppercut 0.82 m, tie-up 0.66 m; engine distances unchanged).

## 4. Kit and body

`apps/web/scripts/boxer/build.mjs`, `kit-shapes.mjs`, `boxer/boxer-material.ts` (GLBs regenerated, CC0 source unchanged):

- **Vest**: smaller arm hole (bottom ~4 cm under the armpit fold), wider straps, a higher front neckline; the edge is
  skinned to the shoulder (shoulder helper + clavicle), not to the arm, so it stays a clean curve in a raised guard or
  a full jab; a bound edge in a darker shade of the kit; hem strips single-wound with their true normals; the cloth is
  drawn on both sides (the inside shows through the openings, no void); the body is only dropped ≥ 2.2 cm inside a
  garment's edge (skin shows under an arm hole, never a hole).
- **Trunks**: one continuous side stripe (its centre moves smoothly from the hip to the leg), anti-aliased band and
  stripe edges (`fwidth`), satin roughness 0.34 → 0.48, clearcoat 0.25 → 0.06 (a soft sheen, not wet plastic).
- **Gloves**: a lofted leather body with a superellipse section (boxy-round), the back rising into the knuckle padding
  and closing in a rounded front roll, a flat palm with the grip line, a separate thumb along the side tied at its tip,
  a cuff with a raised hook-and-loop strap and a rolled lip, stitched seams as grooves (darkened); the cuff's far end
  follows the forearm-twist bone. 30 cm with the cuff, 13 cm wide. Matte (roughness 0.62–0.66, clearcoat 0.04).
- **Headgear**: forehead bolster, cheek pads, ear pieces and a quilted crown (thickness by region, seams as grooves),
  the pads rolling down to the face opening instead of ending in a shelf; the shell never dips under the head (no
  z-fighting at the opening); the rim strips have their own normals; matte leather.
- **Skin**: no clearcoat at rest (it grows only with sweat above 0.35), roughness floor 0.5, the warm subsurface fill
  halved — matte, believable skin on all four tones; the photo skin texture and tone pipeline unchanged.
- **Body**: MakeHuman CC0 base kept (adult proportions passed QA-HUM-01 at 4); helper bones (shoulder, forearm twist)
  kept and now driven by anatomical angles.

## 5. Staging

- The referee breaks a clinch from the side at arm's length: ~0.72 m off the pair line and offset along it, so he is
  0.70–0.95 m from the nearer boxer's centre and beside the tie-up in a camera across the pair (was 0.35 m, behind the
  pair's middle); the 0.75 m body separation in `fighters.tsx` is unchanged. In the round he stays 1.5–2.5 m off the
  pair line (tested: `present.test.ts`).
- Fighters stand at the keyed punch ranges (§3); the fight camera code is unchanged (it frames the pair's middle).

## 6. Results

Evidence sheets (before above, after below; side / close / front cameras at 1280×720 and 844×390):
`docs/QA/boxing-v5/compare-{guard,jab,cross,hook,uppercut,body-shot,block,clinch,hit-reaction,knockdown,referee-count}.jpg`,
after only: `after-{rear-hook,lead-uppercut,rear-body}.jpg`; kit close-ups `compare-kit.jpg`; elbow measurements
`arms-*.jsonl`; frame numbers `before-perf.json`, `after-perf.json`.

**Rubric scores** (docs/HUMAN-REALISM-RUBRIC.md, boxers in the ring; my visual scores against the scale, the
measurements above as the automatic part):

| Criterion | Before (QA-HUM-01 R3 → my re-read) | After | Why |
| --- | --- | --- | --- |
| Arms (motion of the upper limbs) | 3 → **2** | **4** | every pose anatomical (hinge elbows 0° sideways, 62–135°), guard / punches / blocks / clinch read as boxing; an expert sees keyed timing, no secondary motion |
| Proportions | 4 | **4** | body unchanged; arm reach now matches the punch ranges |
| Clothing | 3 → **2** | **4** at gameplay and close range | clean arm holes, straps and neckline in every action, no white / torn edges, no body showing through, continuous trunks stripe, product-shaped gloves and headgear; tells left: no fabric folds in motion, the strap's lateral edge slightly rides on the deltoid at full extension |
| Motion (whole body) | 3 → **2–3** | **3–4** | punches with body mechanics (unchanged torso / leg clips) plus correct arms; transitions cross-fade cleanly; tells: hand-keyed (not captured) rhythm, the lead body hook is hidden from the side camera, knockdown arms still on the old wrist targets |
| Skin | 3 | 3–4 | matte, no wax; still no screen-space SSS (phone budget) |

**Performance** (M2 Pro, headless Chrome; lab duel with ring, two fighters + referee):

| | Before | After |
| --- | --- | --- |
| One ring person, merged mesh (masculine boxer / feminine / referee) | 26.8k tris (m) | **25.7k / 25.4k / 27.7k** (budget ≈ 30k) |
| Lab duel frame (two boxers + ring, incl. shadow pass) | 11 draw calls, 124.7k tris | 11 draw calls, 120.3k tris |
| Clinch with the referee | 13 calls, 182.1k tris | 13 calls, 175.7k tris |
| Per-frame cost of the keyed arms | — | 2 arms × (FK + ≤ 6 keep-out steps × 4 finite differences + ≤ 4 aim steps); the person within 16 m only (far people skip the keep-out) |

Practice ring in the fight lab (`/fight-lab?scene=1`, engine-driven fight, two fighters + referee + corner team,
`qa/e2e/boxer-fight-lab.mjs`; `docs/QA/boxing-v5/fight-lab-perf-*.json`, `fight-lab-after.jpg`): **8 draw calls, 93.5k
triangles, 60 fps** in the round at 1280×720 and at 844×390 DPR 2 (P3-FGT-14: 8 calls, 94.6k, 60 fps); 9–10 calls,
123.5–123.9k at the rest with the corner team.

GLB sizes: boxer-m.glb 3.19 MB, boxer-f.glb 3.13 MB (both within 5 KB of before: the new glove gains what the single-wound hem strips save). Practice-ring numbers: see below.

## 7. Remaining gaps and what would close them

| Gap | What closes it |
| --- | --- |
| Hand-keyed rhythm (no captured micro-motion, no secondary motion in the shoulders / head on every punch) | Capture or license professional boxing mocap (a mocap studio session of an amateur boxer in gloves, or a commercial pack with a game licence) and retarget onto the joint-angle channels — the channels, limits and corrections stay; only the keys change |
| ~~Knockdown, count and get-up arms on the old wrist targets~~ | Done in §8 |
| ~~Lead body hook hidden from the side camera~~ | Done in §8 |
| Tiny skin specks (≈ 1 cm) on the upper back under the strap in the hardest shrug (high block), seen from behind at 0.4 m | Per-pose corrective shapes for the trapezius, or a body cull driven by the cloth's own posed distance (a GPU pass) |
| A knocked-down boxer's glove rests on the knee, it does not reach the canvas (the kneeling torso is too upright for a straight arm to reach the floor) | A deeper fall key (more lean) with the floor contact (§8) holding the glove on the canvas |
| No cloth simulation (vest folds, trunks flutter) | Baked fold normal maps per garment and per-pose corrective shapes; real simulation is over the phone budget |
| Faces / skin up close (3) | Scanned heads / SSS on desktop — unchanged from docs/QA/human-realism/round-3.md |

## 8. Follow-up (after the first review): bound vest edges, keyed knockdown, body-work camera

Review of `compare-kit.jpg` rows 2–3: the strap and arm hole still showed a saw-tooth cut, the binding broken and skin
in notches. Causes and fixes (`apps/web/scripts/boxer/build.mjs`, `world/human/boxer/boxer-body.ts`):

| Seen | Cause | Fix |
| --- | --- | --- |
| Saw-tooth edge up close | the edge is the clip of the body mesh (piecewise linear on its triangles); the hem was a flat 6 mm strip on it | **a bound edge**: the boundary loops are ironed along themselves (Taubin, 16 passes, skin smoothed along the loop), then a binding is rolled round them — a 6 mm band on the outside, a rounded lip 2.8 mm proud, the underside — with its direction across the edge from the loop's own tangent (a clip sliver's third corner gave noisy directions: spikes) |
| Binding broken, skin in notches at the strap | the strap sat on the deltoid and was skinned to the shoulder helper / clavicle (P3-FGT-16 first pass), so in a raised guard the deltoid rose through it; weight-based fields (head / neck weight) cut the strap tops by the neck into splinters | the strap sits medial, on the trapezius (hole line 8.7 cm inside the shoulder joint); the vest follows the body under it again, its skin smoothed over the garment (2 passes); no skin-weight terms near the edge, only geometric ones; the arm hole narrower behind (a real back panel, not a racer-back Y); more stand-off over the trapezius and shoulder blades |
| Stair-stepped red through the skin at the front neckline when the chin tucks | the throat skin slides under the neckline, the body's dropped faces moved with it | the body is kept 3 cm further in at the throat only (front of the neck) |
| Skin slivers rising through the narrow straps in a shrug | a body face is only dropped when all three corners are covered; the strap is ~4 cm wide | a second cover bit (`vestCore`, medial straps / upper back, ≥ 2.5 mm inside): a face with two of its corners there is dropped too |

Evidence: `docs/QA/boxing-v5/compare-edges-closeup.jpg` — the same 60 close-ups (0.4–0.5 m) before and after: 10
poses (guard, jab, cross, lead hook, rear uppercut, lead body, block, clinch, knockdown on the knee, get-up) × front
neckline, both shoulders, both sides of the back, under the arm (`qa/e2e/boxer-edges.mjs`). The edge is a continuous
bound hem in all of them; the remaining tell is listed in §7.

**Knockdown, count and get-up** are keyed in the angle channels (no wrist targets left; tested in `arm-fk.test.ts`):
the guard falls apart as the legs give, the lead glove comes down on the lead knee, the rear arm hangs and takes the
fall; on the knee the lead forearm rests across the knee; getting up the lead hand pushes off the knee and the guard
rises with the legs. A **floor contact** in `rig.ts` keeps every glove at least its own radius above the canvas (the
aim correction lifts it onto the floor, never through). Sheets: `after2-knockdown.jpg`, `after2-knockdown-landing.jpg`,
`after2-referee-count.jpg`, `after2-get-up.jpg`.

**Body work from the side** (`fight/camera.tsx bodyWorkShot`, tested in `camera-body.test.ts`): while a lead-hand
body shot (the lead hook or jab to the body) is thrown the broadcast camera wants the puncher's lead side — a cut
when it stands on the far side (at most one every 1.2 s, never to a side whose shot would leave the ropes) — and drops
30 cm (look point 22 cm) to body height, eased in and out.

Budget after the follow-up: one boxer 27.6k triangles (masculine), 27.2k (feminine), referee 27.7k (≈ 30k budget);
`after2-*.json` frame numbers unchanged in draw calls (11 / 13).
