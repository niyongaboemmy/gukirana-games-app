# Boxing realism v7: art-director pass on the ring people (P3-FGT-18)

Status: implemented. This is presentation only. The engine, the money paths and the keyed-arm system (arm-fk joint
limits) are not touched. Feature flag `NEXT_PUBLIC_FF_BOXER_V7` is on unless set to `0`. With `0`, the app uses the
P3-FGT-17 bodies (`boxer-{m,f}-v6.glb`) with their shading, lighting and guard. Evidence is in `docs/QA/boxing-v7/`.

The user rejected P3-FGT-15, QA-HUM-01, P3-FGT-16 and P3-FGT-17. Their latest words: *"still looks abnormal … make it
more realistic, proper human body parts"*. The screenshot was the side broadcast camera: two female boxers in guard,
with the referee behind them.

Earlier passes changed the sculpt and the skin shader of the same base. This pass works differently:

1. Write a reference description of real amateur boxing.
2. Measure the body against athlete anthropometry and fix the outliers.
3. Decide the base mesh using renders.
4. Rebuild the garments as cloth.
5. Light the ring the way television does.
6. Re-key the guard.

## 1. Reference board (text only; no photos committed)

These are amateur and Olympic-style bouts under World Boxing / IBA practice. Facts that are not sourced carry an
**(unverified)** mark.

| # | Situation | What reads as real |
| --- | --- | --- |
| R1 | Elite women's bout, side TV camera, both in guard | Open-face headgear with cheek protectors. The vest hangs loose from the bust and shoulder blades and blouses over the waistband. Satin trunks hang from the hips to mid-thigh. Knees bent, rear heel up. |
| R2 | The same fighters, close (head and shoulders) | Headgear padding about 2–3.5 cm thick, so the head looks *bigger* than the bare head. Stitched panel seams, an ear piece with a seam ring, a chin strap under the jaw. Matte, slightly creased vinyl or leather. |
| R3 | Back of the headgear | Adjustment at the back of the head: a lace or velcro strap across the nape. |
| R4 | Competition vest (red or blue corner colour) | Thin polyester jersey. The straps lie flat on the trapezius, with no padding. Bound arm holes lie on the ribs. Folds where it tucks in. A matte, dry surface. |
| R5 | Competition trunks | Loose satin with leg openings much wider than the thigh, so the legs move inside them. A broad elastic waistband that sits flat and compresses a little; a contrasting band marks the belt line **(unverified as a rule; common practice)**. A stretched sheen along vertical folds. |
| R6 | 10 oz competition gloves | White scoring area over the knuckles, stitched panel edges, a velcro cuff over the wraps. |
| R7 | Orthodox guard, fundamentals | Torso bladed about 30–45°. Weight sat into bent knees. Chin tucked behind a raised lead shoulder. Elbows in over the ribs, gloves at cheekbone or brow height. Rear heel raised. |
| R8 | Jab or cross | Weight moves onto the front foot, the rear hip turns, and the head stays off the centre line. |
| R9 | Male elite bout (no headgear) | Thick neck sloping into the trapezius. The deltoid, biceps and triceps read under the key light. Waist-to-hip about 0.85. |
| R10 | Female athlete anthropometry | Waist-to-hip about 0.70–0.75, neck short (chin to sternal notch about 5 % of stature), shoulders narrower than a man's but square. |
| R11 | TV lighting | A truss over the ring with fixtures from all four sides at 50–60°. One hard overhead key gives short, dense shadows under the brow, chin, arms and fighters. Rims on the shoulders. A dark room with deep falloff. |
| R12 | Late rounds | Sweat sheen in patches (forehead, chest, shoulders) that rises from round to round; dry at the first bell. |
| R13 | Referee during the round | Ready stance: hands loosely together at the belt, close to the body. He keeps about 1–1.5 m off the pair and only steps in to break. |
| R14 | Scoring feedback in games and broadcasts | Who scored is never ambiguous. The colour and the word belong to the scorer. |

### Our build against the reference

| Item | Before (v6, the user's screenshot) | After (v7) |
| --- | --- | --- |
| Silhouette | Mannequin waist (WHR 0.72 / 0.60), long thin feminine neck, small head | WHR 0.84 / 0.70, feminine neck 0.053 H, heads 7.4–7.65 inside thick headgear |
| Vest | Straps standing up to 2.6 cm off the shoulders (read as epaulettes), shrink-wrapped torso, dark cavity at the arm hole | 4 mm of jersey with up to 6 mm extra working room over the strap. Loose hang (0.32 m/m). The bound hole lies on the ribs in a 9 cm band. Puffs at the tuck. Matte. |
| Trunks | Tights painted on the tights helper, with a stiff white ring band | Separate draped garment hanging from the seat. Wide openings with a flare, 6–7 uneven folds, a broad flat elastic band with ribbing and stitch rows. Satin with an anisotropic highlight. The cloth lags the thigh by 15 %. |
| Headgear | Smooth thin plastic shell (1.1 cm crown) | Product thickness (crown about 2 cm, brow 3+ cm, cheeks 2.5 cm, ears 2.6 cm). Stitched panels, a brow seam, a cheek seam, an ear ring, rear lacing, a velcro nape strap and webbing chin strap, matte worn leather. |
| Gloves | No stitching | Stitch rows around the scoring panel and down the side seam, with a pressed seam groove |
| Lighting | Flat fill, no shadow on the people, no AO | Overhead key casting the ring's only shadow map (fighters on the canvas, arms on the trunk). Rims, camera-side fills, the room dimmed to 20 %. N8AO on desktop. Baked vertex AO everywhere, including phones. |
| Posture | Upright, 29° blade | Hips 2 cm lower, 33° blade, chin tucked 0.08 rad deeper, lead shoulder raised (shrug 0.48), up on the rear ball |
| Referee | Hands 30 cm out in front, leaning in, floating beside the near boxer | Hands together at the belt, close to the body, upright |
| HUD | A punch that landed on *me* said "LANDED — Their Cross" in green | "HIT — their cross" in warm red; mine stay a green "Landed"; their stopped punches are a neutral cream |
| Sweat | Constant | Starts dry and rises with work and each round, in patches |

## 2. Silhouette and proportion audit

`apps/web/scripts/boxer/measure.mjs` measures the bind-pose skin (`MEASURE=1 node scripts/boxer/build.mjs`). References:

- head height and segment lengths from the rubric (de Leva 1996);
- chin and suprasternal heights from Drillis & Contini (0.870 H and 0.818 H, so the chin-to-notch distance is about 0.052 H);
- girths and waist-to-hip ratios for athletic adults.

| Measure | m v6 | m v7 | f v6 | f v7 | Reference |
| --- | --- | --- | --- | --- | --- |
| Stature | 1.756 | 1.757 | 1.683 | 1.666 | — |
| Heads tall (crown to chin) | 7.45 | 7.39 | **7.71** | 7.35 | 7.2–7.9 |
| Neck, chin to notch / H | 0.050 | 0.050 | **0.067** | 0.053 | ≈ 0.052 |
| Neck girth (m) | 0.395 | 0.418 | 0.332 | 0.395 | boxers: m 0.40+, f 0.33–0.36 |
| Waist girth (m) | **0.688** | 0.802 | **0.559** | 0.649 | m 0.78–0.84, f 0.65–0.70 |
| Waist-to-hip | **0.72** | 0.84 | **0.60** | 0.70 | m 0.83–0.88, f 0.70–0.75 |
| Hip girth (m) | 0.959 | 0.959 | 0.926 | 0.926 | m 0.95–1.0, f 0.92–0.97 |
| Upper arm girth, mid (cm) | 34 | 34 | 28.5 | 28.5 | m 32–35, f 26–28 |
| Thigh girth, upper (cm) | 55 | 55 | 51 | 51 | m 55–58, f 52–57 |

Outliers fixed with MakeHuman CC0 measure / head targets (`PROPORTION_V7` in `build.mjs`):

- the corset waist (the largest silhouette tell);
- the feminine neck, 28 % too long;
- the feminine head, slightly small;
- the masculine shoulder joints, a little wide.

The feminine neck girth went up because the mid-neck slab now sits on a shorter neck that slopes into the trapezius.
That suits a boxer.

In the rubric's skinned measurement (`assess/realism-report.json`), heads moved from 7.71–7.91 to 7.53–7.66. Segments
are within 9–11 %.

## 3. Base mesh decision: keep MakeHuman (renders: `docs/QA/boxing-v7/base.jpg`)

| Candidate | Licence | Result in guard (side and close camera, same ring rig) |
| --- | --- | --- |
| MakeHuman hm08, our build (current) | CC0 | Bare arms and legs with a photo skin; garments are separate geometry that we control; keyed-arm rig and weights built for it |
| Microsoft Rocketbox (campus people) | MIT | Photo textures, but **every body is dressed in its texture** (canvas jacket and jeans, suit, fleece). In a vest the arms show the recoloured sleeve texture, with no bare skin. The boxing kit has to be bolted on as rigid pieces. Reads less real than MakeHuman in this context (render). The lab's Rocketbox duel path was broken (`dressBody` reading a uniform the campus shader no longer has); fixed so it could be rendered. |
| MPFB2 skin system | CC0 skins / GPL addon | Same hm08 base and the same CC0 skin family as ours. Its gain is a Blender node shader that does not port to WebGL. |
| CC0 / CC-BY athlete scans (Sketchfab, Scan the World) | varies | Raw scans would need retopology, rigging and weights to our rig. None found of an athlete in competition kit that beats a procedural kit on our base. |

Decision: keep MakeHuman. A switch would lose the bare-skin body and the controllable garments, and win nothing that
reads in the side camera.

## 4. Garments as cloth (`build.mjs`, V7_BUILD)

- **Trunks.** `drapeTrunks()` builds the legs from the tights helper:
  - per leg, the radius hangs from the widest hip / seat ring with almost no inward slope (0.05) below the crotch;
  - a 1.6 cm flare at the hem and two-frequency folds (6 and 13 per turn, deepest at the hem);
  - the inner side is capped 5 mm short of the midline, so the legs never merge;
  - the band sits on the body, with 6 mm of elastic over it;
  - hem at knee + 12.5 cm;
  - skin weights: 15 % of each thigh / calf bone goes to the pelvis, so the cloth lags and the legs move inside.

  Shader:
  - a narrow outer piping instead of a side panel;
  - a 5.8 cm band with knit ribs and two stitch rows;
  - roughness 0.34;
  - anisotropy 0.7 along the vertical (three's anisotropic GGX). Every other slot runs it at 0 with a well-formed frame
    (a uv-less frame turned the boots into NaN white during development).
- **Vest.**
  - Loose hang (0.32 m/m, 1 cm of ease).
  - The arm hole lies on the body up to the shoulder-joint height, in a 9 cm band.
  - 4 mm of jersey, plus at most 6 mm of working room over the strap and shoulder blade (v6 had up to 2.6 cm).
  - The tuck lies on the body under the band; uneven puffs of 1–1.6 cm above the band.
  - The body is culled under the strap up to 0.85 × the shoulder width (was 0.56), so skin does not rise through the
    flatter strap.
  - Matte (roughness 0.82).
- **Not done:** a Verlet hem sway. The baked drape and the cloth lag give most of the read for no runtime cost.

## 5. Kit detail

- **Headgear.** `HEADGEAR_V7` in `kit-shapes.mjs` sets product thickness. The shell now carries its own (azimuth,
  elevation) uv. `gkHeadgearDetail()` in `boxer-material.ts` draws the detail on it:
  - crown panel seams with a stitch row on each side;
  - the brow-bolster seam, the cheek-pad seam and the ear-piece ring;
  - the rear criss-cross lacing over a dark gap, the velcro nape strap and the webbing chin strap.

  The material is matte (roughness 0.7–0.92, clearcoat 0.02), with seams pressed into the normal.
- **Gloves.** Stitch rows around the white scoring panel and down the side seam, with a pressed seam at the panel edge.

## 6. Lighting and rendering

- **Broadcast rig** (`fight/ring-lights.tsx`, RingMood), used by the hall (FocusMode), the fight lab and the boxing lab
  (`light=ring`).
  - Overhead key spot, intensity 3.6. It sits 0.9 m towards the camera and 6.2 m over the canvas.
  - The key casts the ring's **only** shadow map:
    - 2048² on desktop, 1024² on coarse-pointer devices, none on Lite;
    - near / far 3 / 11 m;
    - bias −0.0004, normal bias 0.025, PCF radius 3.
  - Two camera-side fill spots (0.6, no shadow).
  - Rims at 4.2.
  - Room fill dimmed to 20 % at full focus.
  - All lights are always mounted at intensity 0, so focusing adds no shader rebuild. Levels are static and ease in
    with the focus fade (the photosensitivity rules of docs/NIGHT-LIGHTING.md hold: nothing flashes).
- **Fighters receive shadows** (`mesh.receiveShadow` was false). The arms now shade the trunk, the vest shades the
  body, and the fighters cast onto the canvas.
- **SSAO.** N8AO runs at full resolution, quality "performance", radius 0.55 m, intensity 2.4. In the hall it sits in
  the SceneCanvas composer, mounted always and enabled only for a fighter in focus. The fight lab and the boxing lab
  have the same chain.
  - n8ao 2.0.1's half-resolution path crashes on three r187 (its multiple render target lacks `textures`), so half
    resolution is off.
- **Baked vertex AO for phones and everywhere.** `scripts/boxer/vertex-ao.mjs` voxelises the body, vest and trunks at
  1 cm. Each skin vertex then marches 24 cosine-weighted directions up to 16 cm.
  - The headgear and gloves are deliberately excluded, because the referee's face and hands share the body.
  - The shader applies AO² to the ambient light and a 0.55–1 contact factor to the direct light.
- **Sweat** (`fighters.tsx`): 0.22 + 0.5 × fatigue + 0.14 per round after the first.
  - The shader adds noise patches (more on the head) with a clearcoat of up to 0.7 at roughness 0.13 and wetter skin
    roughness.
- **Anatomy relief.** The baked anatomy normal is drawn at 1.7 × and its cavity at 1.3 ×, so the deltoid / biceps /
  triceps borders and the sternum line read under the key.
- **Colour (round 3).** The kit takes 82 % of the corner colour, because under the key and ACES the red lifted to a flat
  salmon.
- **Tone mapping.** ACES Filmic stays (the hall's look). Exposure 1.0. The boxing lab's studio light keeps Neutral.

## 7. Posture

`pose.ts GUARD_V7` (flag), per R7:

- hips 0.795 m (was 0.815);
- yaw −0.58 rad (33°; was 29°);
- lean 0.25;
- head pitch 0.35 (chin tucked 0.08 rad deeper) and yaw 0.12;
- lead heel 0.10, rear heel 0.40;
- knees pointed in over the toes;
- lead shoulder shrug 0.48, rear 0.16.

The feet and the keyed arm angles are unchanged, so every clip's travel, pivots and joint limits hold. All punches,
defence and reactions inherit the deeper stance through clips.ts' guard delta. `present.test.ts` now measures head snaps
relative to the guard.

## 8. Referee and HUD

- **Referee.** `REF_SPEC` (v7) puts the hands together at the belt, 18–19 cm in front of the hips (was 30 cm), with lean
  0.1 (was 0.17).
  - Not changed: his distance to the pair (`refereeSpot`). In some frames he still stands close behind the far boxer
    (see `broadcast.jpg`).
- **HUD.** `outcomePop()` in `fight/game/outcome.ts` (tested):
  - my punches keep their word and colour;
  - a punch landing on me shows `out.hit` "Hit", with the sub "their {punch}" in `#f0643c`;
  - their stopped punches are cream.
  - Strings are i18n keys in `fight/game/strings.ts`. No blue, no emoji.

## 9. Results

Sheets: `broadcast.jpg` (the user's view, desktop and phone), `duel.jpg`, `closeups.jpg`, `base.jpg`,
`edges-before.jpg` / `edges-after.jpg`, and the round comparisons `*-round1-vs-after.jpg`.

### Rounds

| Round | Compared against the reference | Worst remaining tell | Fix |
| --- | --- | --- | --- |
| 1 | Proportions, vest, trunks, headgear, light, guard all moved toward R1–R13 | Skin rising through the flatter strap; the looser vest coming through the band in red drips; boots NaN-white (anisotropy frame) | Wider strap cull, 6 mm working room, hug stops below the strap top, tuck under the band, isotropic frame for non-satin slots |
| 2 | Silhouette and cloth read; image too bright and flat (face fills, key 4.4) | Washed-out canvas and kit | Key 3.6, fills 0.6 |
| 3 | Kit colour a flat salmon / pale blue under ACES | Kit colour | Kit at 82 % of the corner colour |

### Rubric (docs/HUMAN-REALISM-RUBRIC.md), boxers

A score is the lower of the automatic and visual scores.

| Criterion | Before (v6) | After (v7) | Notes |
| --- | --- | --- | --- |
| Proportions | 4 auto, 3 visual (corset waist, long feminine neck) | **4** (auto 4, visual 4) | WHR and neck in range; skinned heads 7.53–7.66 |
| Clothing | **2** auto, 3 visual | **3** (auto 3, visual 3) | Loose trunks and a flat strap read as cloth at gameplay distance. In the pose, worst 7.6 % of garment vertices are inside the skin (was 8.1 %). Close-ups still show ragged edges at the arm-hole top in a hook and at one trunk hem. |
| Skin | 3 | 3 | AO and shadow help at 1–3 m; close-up needs scanned detail |
| Hands / gloves | 4 | 4 | stitching added; no cuff geometry |
| Motion / posture | 3 | 3 | the stance now has weight; still hand-keyed |
| Lighting response (ring) | 3 (flat, no shadow) | **4** | broadcast rig, shadows, AO, sweat over the rounds |
| Performance | 5 | 5 | below |

### Performance

Measured on an M2 Pro in headless Chrome (ANGLE / Metal). Frames are in `frames-*.json`.

| | Before (v6) | After (v7) |
| --- | --- | --- |
| One boxer, merged skinned mesh | 28.3k / 28.1k tris | 28.3k / 28.1k tris (unchanged budget, about 30k) |
| Draw calls per person | 1 + shadow (no shadow light in the ring) | 1 + 1 in the key's shadow map |
| Practice ring (fight lab) | 8 calls, 98.8k tris, 60 fps (1280×720 and 844×390 DPR 2) | 19 calls (8 scene + shadow-map casters + 8 composer passes: N8AO, tone map), 183k tris (the shadow pass draws the three people again), **60 fps** at 1280×720 and 844×390 DPR 2 |
| GLB | 3.24 / 3.20 MB | 3.25 / 3.20 MB |
| Textures per person | 29.3 MB desktop / 13.3 MB phone | unchanged (no new texture; AO is a vertex attribute that already existed) |
| New GPU memory | — | key shadow map 2048² (16 MB depth) on desktop, 1024² (4 MB) on coarse pointers; the N8AO targets at full resolution |

Note: the boxing lab's probe reads its counters after the composer's last pass, so the `light=ring` frames report 1 call.
The fight lab's numbers above are the real frame.

## 10. What still reads as CG, and the next step

Still CG:

- **Skin up close.** A 2K CC0 photo skin on a generic MakeHuman sculpt: no pores at head-and-shoulders, no real
  tendons or veins.
- **Arms at 1–2 m.** Better with the key and the anatomy relief, but the forms are still MakeHuman's averaged muscles.
- **Garment edges up close.** The arm-hole top in a hook and one trunk hem show ragged edges.
- **Motion.** Hand-keyed; no captured weight transfer, breathing rhythm or secondary motion.
- **Referee spacing.** He sometimes stands too close behind the far boxer.

**Most effective next step (paid): a scanned athletic body as the bake source.** For example, 3D Scan Store "Animation
Ready" athletic scans (£69.99 each plus the £499.99 commercial single-project licence; docs/HUMAN-REALISM-VR-RESEARCH.md
§11), wrapped to hm08. It would give real muscle, tendon and skin detail in the anatomy and skin maps, which is the one
thing procedural work on this base cannot invent.

**Free alternative:** a day of captured boxing motion (a phone-video markerless capture retargeted onto the keyed angle
channels), for motion 3 → 4.

## Rebuild

```
MH_DIR=<makehuman checkout>/makehuman/data node apps/web/scripts/boxer/build.mjs
```

- MakeHuman commit `a8bc2d54…`.
- `cwebp` must be on the PATH.
- `MEASURE=1` prints the audit.
- `V6=1` reproduces the P3-FGT-17 GLBs byte-for-byte (verified before the v7 changes).
- The anatomy maps `body-detail-{m,f}.webp` are re-baked from the v7 body. They are in MakeHuman UV space, so the v6 fallback reads them too.
