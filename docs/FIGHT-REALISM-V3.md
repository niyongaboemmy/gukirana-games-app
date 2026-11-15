# Boxing session realism v3: real fighters, real people, real hits, fighter life (P3-FGT-13)

Status: implemented (see §9 for what is still open). Builds on docs/FIGHT-GAME-V2.md (engine v2, rating),
docs/FIGHT-REDESIGN.md and docs/BOXING-SCORING.md. Ideas only: no game's name, characters, art, UI or music is
reproduced. Evidence: `docs/QA/evidence/p3-fgt-13/`.

## 1. What was wrong (gap analysis)

From the player's practice-fight screenshot and our own captures (`00-before-ring.jpg`):

| Area | Gap | Cause |
| --- | --- | --- |
| Fighters | Reshaped plaza characters: faceted torsos, a shirt collar left on the vest, blocky shoulders, baggy two-tone "trunks" that read as trousers, stiff hands, flat skin, a helmet-shell headgear | The ring kit was fitted over clothed Rocketbox bodies (their shirt / trouser geometry was recoloured) |
| Referee | Grey denim-like jacket over a white shirt, arms akimbo, static | The plaza outfit system has no referee clothes; the referee stance put the hands at the hips with the elbows out |
| Corner / judges / staff | No corner team; hall staff on plaza bodies | Not built |
| Distance | Static stand-off; "Too far to land" while nothing happened | Practice level 1 approached to "jab reach + 4 cm" and then stopped: 3 cm outside its own jab, forever (measured: 121 cm for 11 s) |
| Score | 48-2 inside 40 s at level 1 | Level 1 attacked 4 %/tick only in range (never in range) and defended 15 %: a punching bag |
| Hits | One head and one body reaction for every punch; the glove reached a fixed distance at the authored height | Reactions were picked by power only; reach fit was forward-only |
| Life | One balance bar; the corner refilled everything; a knockdown always got up at 8 | No recovery model, no skill on the canvas |
| Camera | Clamped per axis inside the ropes: an oblique view behind one fighter when the pair worked off-centre; the rest shot looked at the wrong corner on turned rings | Clamp slid the eye sideways; the corner maths ignored the ring's rotation |

## 2. Research (sources at the end)

**Amateur rules.** Olympic-style boxing keeps the standing eight count (a protection count that scores as a knockdown);
three counts in a round or four in a bout stop the contest (RSC). The mandatory count after a knockdown is eight; a
boxer not fit to continue at the end of the count loses by knockout. Professional unified rules drop the standing
count; we follow the amateur model.

**Biomechanics.** Punches are a proximal-to-distal chain (legs → hips → trunk → shoulder → fist); the lead hook has the
highest fist speed in amateur 3D kinematics, uppercuts the highest shoulder / elbow angular speeds. Head-impact studies
of Olympic boxers find the hook produces the largest force and proportionally more ROTATIONAL than translational head
acceleration (the contact point is far from the head's centre of mass): a hook turns the head, a straight drives it
back, an uppercut lifts the chin. Body shots compress the trunk; the natural response is flexion towards the hit side
with an exhalation.

**Physiology.** Amateur bouts are 3 × 3 min with 1 min seated rest; lactate rises round on round (≈ 2.4 → 3.3 → 4.3
mmol/L in a simulation) and does not clear within a minute. A corner restores part of the fighter, not all of it.
Elite boxers work at a higher activity:rest ratio (18:1 vs 9:1 for novices) — fitness is managed inside the round,
which is why recovery "on the move" and in defence matters.

**Games (lessons only).** Physics-led console boxing games tie the reaction to the impact (location, direction,
momentum) and reward timing over mashing; VR boxing games make fatigue visible (dropped hands, breathing) and let the
player recover by defending and moving; several titles split damage into head and body, where body damage drains the
stamina ceiling. A common criticism is gloves punching air or passing through bodies — hence contact IK. Knockdown
mini-games that reward rhythm over speed avoid the "mash to get up" problem.

## 3. Real fighters and people (the body pipeline)

- **Decision:** a dedicated body, not another reshape. Built from the MakeHuman 1.x CC0 assets (base mesh, macro
  targets, default skeleton and weights) by `apps/web/scripts/boxer/build.mjs` into `boxer-m.glb` / `boxer-f.glb`.
  Licence and source commit: docs/ASSET-LICENSES.md. No unlicensed downloads.
- **Body:** adult (25–30 y) athletic build per gender (MakeHuman muscle 0.92 / 0.84, weight 0.42 / 0.44, ideal
  proportions, height ≈ 1.77 / 1.69 m), real quad topology (13.9k vertices), three body-type morphs (heavy, slim,
  mature) with the joint offsets. Each ring has a weight class (both fighters alike), each fighter a little variety;
  the age range of the player's look selects the mature morph. Gender and skin tone, eye colour, brow style and
  facial hair come from the player's look. (Exact face shape does not carry over: see §9.)
- **Rig:** the 163 MakeHuman bones merged into 64 `Bip01_*` bones so the existing boxing rig layer, clips and IK drive
  the body unchanged; face bones kept (jaw, eyelids, brows, mouth corners) and driven by `boxer-face.ts`
  (breathing mouth, blinks, wince, focus, smile).
- **Kit, generated from the body itself** (smooth edges by clipping triangles on a field, cloth bridging over
  concavities): sleeveless vest with arm holes and a scoop neck (white binding, no collar), knee-length satin trunks
  with a white waistband and a stripe down the outside of each leg (from the base mesh's tights helper, flared to the
  hem), high boots on a lofted last with white laces and a light sole, socks, hand wraps at the wrist, laced gloves
  with cuff and a white striking area (fist inside, wrist straight), padded open-face headgear with cheek and brow
  pads and a chin strap.
- **Referee:** white short-sleeved shirt with collar, black bow tie, black trousers with belt, black shoes, short
  hair; ready stance with the hands in front and the elbows down.
- **Staff:** venue polo + trousers (corner coach and second, hall coaches, reception, cleaner); hall trainees in kit
  without headgear (the skipper without gloves).
- **One draw call per person:** body + garments merged into one skinned mesh with one material (per-vertex material
  slot, cavity, hit zone, face paint). Shader: subsurface approximation (warm back-scatter at grazing angles), sweat
  making the skin glossier with fatigue, redness on the head / torso growing with damage and flashing where hits
  land (never blood or injury), muscle definition as a bump from the cavity field, satin / leather sheen, procedural
  eyes (iris in the player's colour).

## 4. Actions and hit reactions

| Event | Attacker | Target |
| --- | --- | --- |
| Jab / cross to the head | the straight with hip and shoulder turn, rear heel up on the cross; glove bent onto the target's face (contact IK) | `hitStraight`: head snaps straight back, weight rocks onto the rear foot; a heavy counter cross rocks a step back (`hitHeadHeavy`) |
| Lead hook to the head | elbow up, hips snap round | `hitHookFromLead`: lands on the target's right cheek, head turns to the target's left, torso gives with it |
| Rear hook to the head | | `hitHookFromRear`: left cheek, head turns right |
| Uppercut | knees dip and drive up | `hitUppercut`: chin snaps up and back, up on the toes, gloves fly apart |
| Body straight / uppercut | contact IK takes the glove to the stomach; hips and lean go down with it | `hitBodyLight` / `hitBodyHeavy`: fold over the stomach, guard drops, mouth opens (breath out) |
| Lead / rear hook to the body | | `hitBodyLead` (right side, the liver: fold right, rear elbow clamps) / `hitBodyRear` |
| Blocked | glove lands on the gloves (aim = the guard when it is held) | `blockImpact` (gloves driven back to the face, chin tucks) / `blockLow` for the body |
| Parried | `parried`: arm swept off line, weight carried past | `parry`: rear glove taps across and back |
| Slip / duck | aim captured at the punch start: the head moves off it and the glove goes past | existing slip / roll clips |
| Clinch | arms over the other's arms, head on the shoulder | the referee steps in and calls "Break!" (engine), both reset to the break gap |
| Knockdown | — | knockdown → kneel with breathing → `getUp` when the task is done; the referee counts over the fighter, the other waits in a neutral corner |

**Contact IK** (`motion.ts fitAim`, tested): the punch keeps its authored shape and timing; the share of the
correction follows how far the glove has travelled from the guard towards its impact pose (0 in the guard, 1 at
impact, 0 again in the recovery), capped at 40 cm, so the glove meets the face / stomach / gloves at the engine's
impact frame without punching air or passing through.

**Distance:** the engine stays the authority on positions (no presentation auto-close). Practice level 1 now walks in
to where its jab lands and engages; the coach's "Too far" uses the boxers' exact positions (only when the player is
really out of range).

## 5. Fighter life and recovery (engine, deterministic, symmetric)

New fights carry `life: 1` (FightLog / snapshot); a log recorded before replays with the P3-FGT-10 rules and the same
canonical state (the new fighter fields are absent when it is off — tested). Constants in `LIFE`
(`packages/games/boxing/src/engine.ts`).

| Meter | Meaning |
| --- | --- |
| Balance (composure, 0–1000) | 0 → knockdown; capped at 1000 − head damage / 2 |
| Stamina (0–1000) | output costs it; capped at 1000 − body damage / 2 |
| Head damage (wear, 0–1000) | clean head hits add damage / 5; ≥ 850 when down = the referee will not let you continue |
| Body damage (0–1000) | body shots add 34 % of their damage |

| Recovery | Rule (numbers) | Counterplay |
| --- | --- | --- |
| Defence | block +6 balance; slip / duck / step-out evade +14 balance +6 stamina; parry +14 / +6 | feints, angles, body shots under the guard |
| Breathing on the move | out of range by ≥ 150 mm past the jab, off the ropes and corners, no clean hit for 30 ticks: +2 stamina / tick and balance every tick (instead of every 2nd) | cut off the ring, pin on the ropes (no breather there) |
| Clinch | (P3-FGT-10) holder +7 stamina / tick, balance +3 / 2 ticks | the referee breaks it after 2 s; the 2nd break of a round is HOLDING |
| Corner | over the rest: 60 % of the missing stamina and 75 % of the missing balance (to the ceilings), head damage −40, body damage −30 at once | damage mostly stays: later rounds get harder |
| Standing count | balance ≤ 150 after a clean hit and 4 clean hits taken within 90 ticks without landing one: 8-count standing, scores as a knockdown (+3 points to the other), then balance ≥ 450 | counts towards RSC (3 in a round / 4 in a fight) |
| Get up (knockdown) | from count 2, steady presses ≥ 9 ticks apart (+4 when tired); a sooner press is panic and costs one. Need 4 + 3 per earlier knockdown + 1 per 160 head damage (+3 exhausted). Up at the mandatory 8, or at once after 8; not done by 10 → KO. Done by count 5: +60 balance | head damage, knockdowns and exhaustion make it longer; mashing never works |
| Second wind | once per round, last 20 s, stamina < 350, ≥ 10 defences this round and not out-landed, no clean hit for 200 ticks: +180 stamina, +80 balance | pressure that lands clean shots denies it |

No pay-to-win: the paid "corner refresh" stays practice-only (`PracticeSession.cornerRefresh`), never in live fights.
The live room now accepts presses during a count (the get-up task), still rate-limited.

**Simulations** (scripted agents, `sim.test.ts`, `life.test.ts`, 3 × 60 s, half from each corner):

| Pairing | Result (W-D-L) |
| --- | --- |
| L2 vs L1 | 33-0-7 |
| L3 vs L2 | 40-0-0 |
| L4 vs L3 | 39-0-1 |
| L5 vs L4 | 34-0-6 (85 %) |
| L1 / L2 / L3 vs button masher | 40-0-0 each |
| Same L3, better timing + defence | 65-4-11 (84 %) |
| L5 vs L1 (24 fights) | 24/24 wins, all stoppages, longest fight 135 s |
| L5 vs a panicky L1 (steady 5) | 3 / 16 KO by count-out |
| L3 vs L2 (20 fights) | 16 RSC, 2 KO, 2 UD |
| L4 vs L3 (20) | 19 UD, 1 MD; second winds 46 (defence is rewarded) |

Fights always end (KO / RSC remain possible; `maxFightTicks` now allows every count to run to 10). Symmetry:
10 k mirrored random-input fights with life on give mirrored cards (scoring.test.ts).

**Practice level 1 balance:** a level-2-like player vs level 1 over 40 s: 45-37 points on average (was a 48-2
blow-out); a clearly better player (L3) still dominates level 1 (74-34 in 60 s, often a stoppage).

## 6. HUD

Head / body damage bars under stamina and balance; the get-up panel (pips, a ready / wait / too-fast beat, device
wording); "Standing count" on the count card; "Second wind" pops; the corner's advice between rounds (one plain line
from the meters and the score: hands up, elbows in, breathe and move, they are hurt, work the body, use the jab, keep
defending). All UI text is in `fight/game/strings.ts` (i18n keys).

## 7. Camera and presentation

The side broadcast shot stays square to the pair: inside the ropes it comes closer along the line of the shot (the
fighters get bigger) instead of sliding oblique; the rest shot looks at the turned ring's real corner with the corner
team in view; an optional impact camera (setting, off with reduced motion) pushes in ~22 % for under half a second on
knockdowns and heavy counters. The referee points at the fouler on warnings, waves off stoppages / KOs, waits in a
neutral corner between rounds, counts standing counts.

## 8. Performance

Ring lab (`/fight-lab?scene=1`, practice ring, two fighters + referee, + 4 corner staff at the rest), headless Chrome on
an M2 Pro: **8 draw calls** during a round (10 at the rest), **60 fps** desktop 1280×720 and phone emulation 844×390
DPR 2 (`perf-*.json`). Triangles ≈ 95k in the round. Each person is one draw call (+ shadow). Far rings keep the
instanced impostors (LOD 2); persons beyond 16 m skip the face and finger detail and the fine shader detail.
Download: `boxer-m.glb` / `boxer-f.glb` ≈ 3.3 MB each (≈ 1.4 MB gzipped), loaded when a ring person mounts.

## 9. Not done / open

> P3-FGT-14 (docs/FIGHT-REALISM-V4.md) closed the first four items below: the face shape carries over, the referee
> counts on his fingers, judges sit at the feature rings, the fighter sits on a real stool, the referee's shirt hangs
> as cloth, the morph targets are quantised. Garment LODs remain open.

- The player's exact face (Rocketbox head shape) does not carry over; skin tone, eye colour, brows, facial hair, gender
  and age do. A face-shape transfer onto the MakeHuman head is future work.
- The referee counts with the arm (no per-number finger poses); no judges' tables at feature rings yet.
- No stool mesh: the fighter sits on the corner (the ring kit has no stool).
- The female referee's shirt still follows the bust closely; garment LODs and a lighter GLB (quantised morphs) are
  open.
- Hall run on the worktree stack (web 3930, API 4930 on a scratch PGlite DB, realtime 3197): `qa/e2e/zscan.mjs hall:boxing` reports 0 flat z-fighting pairs and 1 wall-face pair (an unnamed white mesh against the merged hall at (43.3, -16.1), the training-zone rack area: not a ring person, not changed here). The hall staff render on the boxer body; practice starts from the hall.

## Sources

- Standing eight count — https://en.wikipedia.org/wiki/Standing_eight_count
- Wisconsin amateur boxing rules (3 knockdowns stop the bout) — https://docs.legis.wisconsin.gov/document/administrativecode/SPS%20192.81(2)
- Ontario amateur combative sport rules — https://www.ontario.ca/document/amateur-combative-sport-rules-boxing/part-iv-competition-requirements
- ABC unified rules (no standing count in pro boxing) — https://www.abcboxing.com/?p=1676
- Head biomechanics of Olympic boxing punches (rotational vs translational acceleration) — https://wbldb.lievers.net/10195904.html
- Taekwondo kicks vs boxing punches, head acceleration — https://pmc.ncbi.nlm.nih.gov/articles/PMC3944542
- 3D kinematics of amateur boxing punches — https://core.ac.uk/download/189160975.pdf
- Physiological response to a boxing simulation (lactate per round) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10858063
- Performance and physiology in male amateur boxing, review — https://pmc.ncbi.nlm.nih.gov/articles/PMC8322614
