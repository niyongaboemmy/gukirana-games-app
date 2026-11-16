# Human realism rubric (QA-HUM-01)

What "looks like a real person" means for Gukirana Playground, as a repeatable score. Every person in the app is
assessed with it: the plaza player avatar (`world/Avatar.tsx`), the ring people (boxers, referee, corner team, judges,
hall staff: `world/human/boxer/*`) and the first-person fight view. Adults only (SAFE-01), no blood or injury.

Constraints the bars are set against: real-time WebGL2 in the browser on desktop and mid-range phones, plus WebXR;
licensed assets only (CC0 / MIT / bought with a game licence, recorded in `docs/ASSET-LICENSES.md`).

## How it is run

```
node qa/e2e/human-assess/assess.mjs --web http://localhost:<port> --out docs/QA/human-realism/<round>
node qa/e2e/human-assess/report.mjs docs/QA/human-realism/<round>          # scores.json (manual) + metrics → report
```

- `assess.mjs` captures a fixed shot list (`qa/e2e/human-assess/shots.json`) in the dev-only human lab
  (`/play/human-lab`: one plaza person under day / sunset / night rigs, bone-anchored cameras), the boxing lab
  (`/play/boxing-lab?mode=boxer`), the world (my own person under `window.__gkTod` day / sunset / night, an inspector
  camera that renders the live scene from a fixed view, the in-game follow camera) and the boxing hall (practice fight:
  boxers, referee, judges, staff; first person). Desktop 1280×720 and phone 844×390 (DPR 2). It writes contact sheets
  and `metrics.json` (measurements below).
- `report.mjs` turns the measurements into automatic scores, merges the reviewer's visual scores (`scores.json` in the
  round folder: a 0–5 score and a one-line reason per criterion and subject) and writes `realism-report.json` plus a
  markdown table. A criterion's score is the **lower** of its automatic and visual scores (a measurement can veto a
  pretty picture and vice versa).

## Scale

| Score | Meaning |
| --- | --- |
| 0 | Broken / absent (missing fingers, T-pose, body through clothes everywhere) |
| 1 | Toy or cartoon: reads as a game avatar at a glance |
| 2 | Stylised-realistic: right idea, obvious CG tells at normal viewing distance |
| 3 | Convincing at gameplay distance (3–8 m); close-ups show CG tells |
| 4 | Convincing in close-up at a glance (head-and-shoulders); an expert finds tells |
| 5 | Indistinguishable from a photo / film in a still at that framing |

**Pass bar: 4 for every criterion** (the user asked for "real people, not game avatars"). Where a 4 needs assets or a
renderer outside the constraints (scanned heads, 4K face maps, screen-space SSS on phones, strand hair) the report says
so, with the asset and the expected gain, instead of lowering the bar.

## Criteria

Each criterion: what is looked at, the reference, the automated part, and what a 4 looks like.

### 1. Proportions
- Reference (adult anthropometry): head height (crown–chin) H/7.5 (7.0–8.0 heads); joint-centre segment lengths
  (de Leva 1996): upper arm (shoulder–elbow) 0.162 H, forearm (elbow–wrist) 0.154 H, thigh (hip–knee) 0.243 H, shank
  (knee–ankle) 0.249 H; shoulder joint centres ≈ 0.20–0.24 H (male wider), hip joint centres ≈ 0.10–0.12 H. Adult
  heads (no child-like head ratio < 6.5). (Round 1 first used Drillis & Contini's surface-landmark ratios, 0.186 H for
  the upper arm, which joint centres never reach: corrected.)
- Automated: stature and head height from the skinned surface (head = vertices ≥ 98 % weighted to the head bone and its
  children, skin only), segment lengths from bone world positions, in the standing pose (bind pose for boxers).
  Auto score: 5 if head ratio 7.2–7.9 and all segments within ±10 %; 4 if 7.0–8.0 and ±15 %; 3 if 6.5–8.3 and ±22 %;
  else 2.
- A 4: nothing reads as long-limbed, big-headed or stubby from front, side and back.

### 2. Face
- Shape of eyes, nose, lips, ears; symmetry; no uncanny features (dead stare, doll cheeks, flat profile, missing
  philtrum / nasolabial structure); age reads correctly (18–30 / 31–50 / 50+); varied faces.
- Visual (face, face34, faceSide shots, every tone × age × body in the matrix sheets).
- A 4: a head-and-shoulders still reads as a photo of a person at a glance; the profile has a real brow, nose bridge,
  lips and chin.

### 3. Eyes
- Iris detail (fibres, limbal ring), sclera not paper white, wet line on the lower lid, catchlight, eye occlusion
  (soft shadow under the upper lid), blinking, saccades, lids following the gaze.
- Automated: blinks / min from the lid bones or blink morphs (natural 8–21 / min at rest), saccades / min (eye
  rotation speed > 120 °/s; ≥ 10 / min at rest) and the eye's range (> 3°). Auto score: 5 if both in range, 3 if one,
  1 if neither (no motion = a dead stare).
- A 4: the eyes in the `eyes` shot look wet and alive; no black-ring lashes.

### 4. Skin
- No plastic sheen (one broad specular everywhere), warm terminator (no grey shadows), pores / micro-normal at
  close range, lips and palms different from the face, tone-correct for every skin tone (especially dark skin: no ashy
  grey, no crushed black, no orange).
- Automated (cheek patch below the eyes in the face shots, every tone × age × body × light): the same patch is shot
  again on a plain matte reference sphere in the look's own skin albedo (roughness 0.6) at the face, same light and
  camera. Skin / reference L* within 0.75–1.35 (night ≥ 0.6) = neither crushed nor glowing, chroma ratio ≥ 0.65 = not
  greyed / ashy, blown highlights < 2 %, darkest tone above L* 4 at night. (Without the reference: rendered L* /
  albedo L*.) Auto score by the share of failing patches: 5 none, 4 ≤ 5 %, 3 ≤ 20 %, else 2. Material facts recorded
  (maps, normal map, roughness, clearcoat / sheen, custom skin shader).
- A 4: skin reads as skin at head-and-shoulders, in all three lights.

### 5. Hair
- Strand / card realism (no helmet or bowl), correct hairline, hair colour and grey for age, no floating cards, scalp
  visible through short hair like real hair.
- Visual (face34, faceSide, back shots).
- A 4: the hair silhouette and hairline read as real at head-and-shoulders.

### 6. Hands and fingers
- Five fingers with three segments each, natural rest curl, nails, knuckles, correct fists in gloves, no mitten hands.
- Automated: fingers per hand = leaf bones under the hand (5) with 3 finger bones each. Auto score: 5 if 5×3 on both
  hands, else 1 (the visual score then decides the 4/5).
- A 4: the `handR` / `handL` close-ups look like hands, not paddles.

### 7. Clothing
- Garments are separate geometry with thickness (hems, cuffs, collars stand off the body), folds where they should be,
  nothing anatomical showing through, no clipping in motion, real fabric response (knit, denim, satin, leather).
- Automated: garments separate (per-vertex material slots or garment meshes), and the vertex-inside test: every garment
  vertex is compared with the nearest skin vertex (≤ 4 cm, skinned positions and normals); "inside" = more than 2 mm
  under the skin. Auto score: 5 if separate and inside < 0.5 % (rest) with the worst ≤ 5 mm, 4 if < 1.5 %, 3 if < 4 %,
  2 if more; 2 at most when the clothes are the body surface itself (painted / single-surface clothes).
- A 4: torso close-ups show real cloth over a body; nothing prints through.

### 8. Motion
- No foot sliding, natural gait (heel strike, roll, toe-off; arm swing opposite the legs), weight shift, idle
  micro-motion (breathing, sway), no T-pose / A-pose at rest, no snapping between clips.
- Automated: foot sliding = horizontal travel of the ball of the foot (toe bone) while it is planted (within 1.5 cm of
  its lowest point for ≥ 0.1 s), per step, at 1.4 / 2.2 / 3.2 m/s in the lab and when walking in the world; cadence;
  idle head sway relative to the pelvis (2–30 mm); upper arm angle from vertical at rest (< 35°); worst per-frame bone
  rotation (snap) of the major bones (< 15° per 60 Hz frame). Auto score: 5 if mean slide ≤ 1.0 cm and max ≤ 2 cm and
  the rest pass; 4 if ≤ 1.5 / 3 cm; 3 if ≤ 3 / 6 cm; else 2.
- A 4: the walk strip looks like a filmed walk; the feet stick.

### 9. Expressions
- Believable, not exaggerated: effort, focus, wince, smile, talking; brows, lids, mouth corners, cheeks move together.
- Visual (boxer face in action, hall faces, plaza face idle / talking), plus the face rig facts (face bones, morphs).
- A 4: an expression in a still reads as a real person's.

### 10. Lighting response
- Looks right in day, sunset and night: skin keeps its tone, no glowing or black faces, shadows fall correctly, rim /
  warm light at sunset, readable faces under night lighting.
- Visual (lab rigs + world `__gkTod` day / sunset / night) and the skin numbers above per light.
- A 4: the same person looks like the same real person in all three.

### 11. LOD transitions
- No visible pop when a person switches detail level.
- Automated: a distance sweep (3–40 m) records the person's triangles; at every switch the image change across the
  switch is compared with the change over the same step without a switch (RMSE of the person's crop, in %): pop =
  RMSE(switch) − RMSE(control). Auto score: 5 if pop ≤ 0.5, 4 if ≤ 1.5, 3 if ≤ 3, else 2; also reported: the person's
  height in px at the switch (≤ 300 px at 1280×720 keeps it out of close-up).

### 12. Performance
- Budgets (P3-FGT-15 brief / docs/HUMAN-REALISM.md): one skinned mesh and one material per person (one draw call +
  shadow) for ring people, ≤ 60k triangles at close range, three shared textures; the plaza crowd's 250-draw-call
  scene budget (DESIGN-SPEC §16); phones keep 1K skin maps. The whole frame (world `__gkProbe.calls` / `.tris`).
- Automated: per person isolated draw calls (scene + shadow) and triangles, texture MB per body type, scene calls / tris.
  Auto score: 5 if ≤ 60k tris, ≤ 4 calls (with shadow) per person and ≤ 32 MB textures per body type; 4 if ≤ 80k / 8 /
  48; 3 otherwise.

### 13. First-person view (fight)
- Nothing of my own head, headgear, hair or vest enters the lens; my gloves and forearms read clean (no near-plane cuts,
  no inside-out faces); the opponent is framed (not filling the frame on phones); no motion sickness (no snapping).
- Visual (FPV frames desktop + phone: guard, each punch, block, look-down) and the automated lens check: "me" = the
  person whose head is nearest the camera; every one of my vertices drawn in the view frustum within 20 cm of the lens
  (after the shader's own hide sphere / near cut) is counted by material slot. A 4 needs 0 in the guard and only
  glove / wrap / forearm skin in punches.
- A 4: it looks like a real first-person boxing shot.

## Subjects

| Subject | Where | Shots |
| --- | --- | --- |
| Plaza person (2 looks: feminine / masculine) | human lab | full / 3/4 / side / back, face / 3/4 / profile, eyes, torso front / 3/4 / back, hips, both hands, feet; walk strips at 3 speeds; day / sunset / night; phone subset |
| Tone × age × body matrix | human lab | face + full 3/4, 4 skin tones (darkest, default, mid, lightest) × 3 age ranges × 2 bodies, day + night |
| Boxers (m / f) | boxing lab | full / side / back / chest, face / 3/4, shoulder, armpit |
| Me on the plaza | world | inspector full / 3/4 / side / back / face / 3/4 / hand + the game camera, day / sunset / night; walking in game |
| Ring people | boxing hall | the game camera, every person near the ring full 3/4 + face; first-person frame |
