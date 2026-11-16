# Boxing v5: the fight rebuilt on realistic humans, in first person (P3-FGT-15, phase 2)

Status: implemented (presentation + camera); the engine v2 rules and life model are kept unchanged (no engine version
bump: no rule changed). Builds on docs/FIGHT-GAME-V2.md (engine v2), docs/FIGHT-REALISM-V3.md / V4.md (bodies,
contact IK, life rules), docs/BOXING-SCORING.md, docs/GAME-EXIT-RULES.md and docs/HUMAN-REALISM.md (the realistic human).
Evidence: `docs/QA/evidence/p3-fgt-15/`. Ideas only: no game's name, art, characters, UI or music is reproduced.

## 1. Research summary

**Games (console, PC, VR)** — what players praise and criticise:
- *Physics-led console boxing* (simulation-leaning titles of the last decade): four base punch families expanded by
  footing, angle and combos; footwork to find range with the jab; damage split head / body with body work draining the
  stamina ceiling; criticised for floaty momentum, few knockdown animations and get-up mini-games some players dislike
  (one recent title lets you switch the mini-game off — the fighter then gets up by their stats).
- *VR boxing* (room-scale titles, 2016–2025): the player's own gloves in view are the whole point; punches must be
  measured and direct (no flailing); fatigue is visible (dropped hands, breathing); recovery by defending and moving;
  head-snap and stagger on clean hits; the opponent's reaction must match where and how hard you hit. Criticised: hits
  that pass through bodies, random-feeling damage, motion sickness from forced camera motion.
- Lessons kept: gloves never pass through a body (contact IK), location-correct reactions, readable fatigue, no forced
  camera motion beyond your own head (reduced-motion option), get-up by rhythm not mashing.

**Rules (amateur / Olympic style, IBA / national amateur codes)**: 3 × 3 min rounds (we keep the shorter practice
format), 10-point must per judge, standing eight count in amateur boxing (scores as a knockdown), mandatory eight after a
knockdown, three counts in a round / four in a bout stop the contest (RSC), fouls with warnings and point deductions
(below the belt, holding, head, rabbit punch), the belt line visible (vest tucked into the trunks), open-face headgear,
10/12 oz gloves, hand wraps, vests in the corner colour.

**Biomechanics** (FIGHT-REALISM-V3 §2): proximal-to-distal chain (legs → hips → trunk → shoulder → fist); a hook turns the
head (rotational acceleration), a straight drives it back, an uppercut lifts the chin; body shots fold the trunk towards
the hit side with an exhalation.

## 2. What we keep from engine v2 and what we rebuilt

| Area | Decision | Why |
| --- | --- | --- |
| Engine v2 (server-authoritative, deterministic, 30 Hz ticks, fight log + replay / audit, @gukirana/fairness RNG only) | **Kept as is** | It already models footwork, solid bodies and the ropes, the full punch set (jab, cross, lead / rear hook, uppercut, body variants), defence (guard, block, slip, duck, parry, step-out), counters, clinch with breaks, fouls ladder, knockdowns with counts, standing counts, RSC, KO, corner recovery and the life meters. No rule change was needed for this task, so the engine version and every recorded log replay are untouched |
| Life / recovery rules (P3-FGT-13) | Kept | Simulations below still separate skill cleanly |
| Rating (Glicko-2), no pay-to-win | Kept | The paid corner refresh stays practice-only |
| Bodies, faces, skin, eyes, hair, clothing | **Rebuilt** (docs/HUMAN-REALISM.md) | The user's main complaint |
| Kit: vest | **Rebuilt as a draped garment** tucked under the trunks' waistband | The painted-on vest showed the chest |
| Camera | **First person added** (an option: QA-HUM-01 round 1 scored it 2 of 5, so the side broadcast camera is the default until it passes, docs/QA/human-realism/round-1.md); side broadcast, behind and auto kept | The user's key ask |
| Emotions | Face channels kept (focus, effort, wince, smile, mouth / breathing, eyes) + a flush with effort and fatigue | Life on the face |

## 3. Persons and clothing

Fighters (the player's own look: skin tone, eye colour, brows, facial hair, face shape, gender, age range → body-type
morph), the referee, the corner coach and second, judges and hall staff are all the realistic human. Kit, all real
garment geometry on the body (the body is not drawn under it): sleeveless vest in the corner colour hanging as cloth
(bound neckline and arm holes, knit micro-texture), satin trunks with a white waistband and side stripe (sheen),
high boots with laces and light soles, socks, hand wraps, laced gloves with a white striking area, padded open-face
headgear. Referee: white short-sleeved shirt (draped), black bow tie, black trousers with belt, black shoes. Adults only,
modest sport clothing, no blood or injury (redness only, fading).

## 4. Fighting, acting, rules (as played)

Every punch type has its own authored motion with the hip / shoulder chain and **contact IK**: the glove meets the
target's face, body or guard on the engine's impact frame (never punching air, never through a body); the target
reacts by location and type (straight: head back; lead / rear hook: head turned to the side away from the glove; uppercut:
chin up; body: fold towards the side hit, guard drops, breath out). Blocks drive the gloves back to the face; slips and
ducks take the head off the line; clinch ties up until the referee breaks it. Knockdown → kneel and breathe → the
referee counts on his fingers → get up by steady presses (no mashing); the standing fighter waits in a neutral corner.
Between rounds: the second carries the stool over the ropes, the fighter sits, the coach gives one line of advice.
Result: the winner's arms go up and the referee raises the winner's hand; the loser lowers their eyes and nods.

## 5. First-person fighting (the key ask)

`apps/web/src/fight/fpv.ts` (maths, tested), `fight/camera.tsx` (frame loop), `fight/fighters.tsx` (probes),
`world/human/boxer/boxer-material.ts` (head cut-away).

- **Where the camera is:** in my boxer's eyes — the head bone's world pose plus an eye offset (7 cm up, 5 cm forward:
  the eyes' centre of rotation, like a VR rig), following the head every frame (no lag behind my own body).
- **What I see:** my head and headgear are cut away by a bind-space sphere in my material only (`uHide`), and my
  shoulders / vest straps / upper chest are not drawn within 16 cm of the eye (`uNearCut`), so nothing of my own body
  blocks the view while **my gloves and forearms stay in view in the guard**; looking down (free look) shows my vest,
  trunks, legs and boots — the same skinned body everyone else sees, fully animated and IK-correct.
- **Punches:** they come out of my view and land on the opponent's face / body / gloves (contact IK) with hit-stop and a
  small camera push.
- **Getting hit:** my head's hit reaction turns my view (40 % of the head's turn steers the view; 8 % with reduced
  motion), on top of the existing reduced-motion-aware shake.
- **Aim:** the view aims 20 cm under the opponent's face (their chin, my gloves in the lower third), blended with my
  head's own direction (slips and ducks move the view as in a real slip).
- **Free look:** right-drag (mouse; a left click is a jab), drag on the open view (touch), right stick (gamepad); eased
  back to centre when released; limits ±57° sideways, 66° down, 20° up.
- **Lens:** ~100° horizontal (a headset's) — 68° vertical at 16:9, 60° on wide phones (60–72° allowed), near plane 3 cm. On a 844×390 phone the opponent at boxing range fills most of the frame (it is that close); the side camera stays one tap away.
- **When:** the round, the countdown and the other fighter's count; the corner, my own knockdown and the result use the
  broadcast shots (and blend back in 0.45 s).
- **Choice:** the HUD camera button cycles My eyes → Side → Behind → Auto; flag `NEXT_PUBLIC_FF_FIGHT_FPV` (on unless 0);
  i18n key `cam.first`.
- **WebXR:** inside a headset session the XR camera owns the view, so the FPV rig (hide sphere, near cut, the body under
  you) gives you your own body from your real eyes. Driving the gloves from tracked controllers / hands is **not done**:
  the engine is server-authoritative on discrete actions, so it needs a gesture → action recogniser (speed, path,
  target) with the arm IK clamped to the engine's result; documented as the next step.

## 6. Competitiveness and fairness

Engine untouched; the simulations (`packages/games/boxing/src/sim.test.ts`, 3 × 60 s, half from each corner) on this
branch:

| Pairing | W-D-L |
| --- | --- |
| L2 vs L1 | 33-0-7 |
| L3 vs L2 | 40-0-0 |
| L4 vs L3 | 39-0-1 |
| L5 vs L4 | 34-0-6 |
| L3 vs L1, L4 vs L2, L5 vs L3 | 40-0-0 each |
| L1 / L2 / L3 vs button masher | 40-0-0 each |
| Same L3 with better timing + defence | 65-4-11 (84 %) |
| Counters alone vs L3 | 44-7-29 (59 %) |

The first-person camera is presentation only (both fighters' inputs and the engine are identical whichever camera a
player picks); no paid item affects a live fight; no bots in cash rooms (unchanged).

## 7. Performance (fight lab, headless Chrome, M2 Pro)

| View | Draw calls | Triangles | FPS |
| --- | --- | --- | --- |
| First person, round, 1280×720 | 8 | 96.4k | 60 |
| Side camera, round, 1280×720 | 8 | 96.4k | 60 |
| Corner (rest, + corner team), 1280×720 | 9 | 126.7k | 60 |
| First person, round, 844×390 DPR 2 | 8 | 96.7k | 60 |
| Corner, 844×390 DPR 2 | 9 | 127.6k | 60 |

The real boxing hall on the worktree stack (web 3980, API 4980 on a scratch PGlite DB, realtime 3247): a practice
fight at R1 in first person (`hall-*` evidence); `qa/e2e/zscan.mjs hall:boxing`: **0** flat z-fighting pairs, **0**
wall-face pairs. The plaza renderer and the plaza avatar are untouched by this task (no plaza draw-call change).

Per person one draw call (+ shadow); 56–60k triangles close up; shared textures: skin 2K (1K on phones / Lite), detail
512, iris 512. Download added: skin textures 1.5 + 1.8 MB (2K) or 0.37 + 0.48 MB (1K), detail 0.24 MB, iris 0.02 MB;
GLBs 3.1 / 3.0 MB (uv added, the eye proxy).

## 8. Not done / open

- Tracked-controller gloves in WebXR (§5).
- The plaza player avatar on the realistic human (docs/HUMAN-REALISM.md §6).
- Scanned faces / CC4-grade heroes (paid, docs/HUMAN-REALISM.md §7); long hair styles as cards on the ring people
  (everyone has a close crop; under the headgear it does not show).
- Gloves and headgear are still procedural shapes with leather shading.
- No new knockdown / stagger clips beyond P3-FGT-13/14's; no mocap import.

## Sources

- The Thrill of the Fight 2 reviews (VR boxing realism, damage model, stamina) — https://uploadvr.com/the-thrill-of-the-fight-2-review · https://www.techradar.com/gaming/the-thrill-of-the-fight-2-vr-gaming-preview · https://gamingtrend.com/reviews/the-thrill-of-the-fight-2-review/
- Undisputed reviews (punch families, footwork, get-up mini-game, knockdown variety) — https://cogconnected.com/review/undisputed-review/ · https://gamingbolt.com/undisputed-review-managing-the-fight · https://xboxaddict.com/Staff-Review/14990/Undisputed.html · https://shacknews.com/article/141699/undisputed-review-impressions
- IBA Technical & Competition Rules — https://www.iba.sport/wp-content/uploads/2022/02/20230209-IBA-Technical-Competition-Rules.pdf · https://www.iba.sport/about-iba/boxing-rules/
- Ontario amateur combative sport rules (ten-point must) — https://www.ontario.ca/document/amateur-combative-sport-rules-boxing/part-iv-competition-requirements
- Biomechanics and physiology sources as listed in docs/FIGHT-REALISM-V3.md
