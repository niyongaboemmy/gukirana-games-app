# Halls realism and stability review (P2-HAL-10)

Scope: the interiors of the Pool Hall, Ludo Lounge, Igisoro Court, Administrative Block and Tournament Arena, plus
the shared hall controller (rooms/RoomPlayer.tsx), other people (social/RemotePlayers.tsx, social/motion.ts) and the
avatar motion stack (world/Avatar.tsx, world/human/*). Evidence: desktop 1280×720 screenshots before / after at fixed
camera poses (`__gkRoomQA.cam`), frame sequences at typical spots, a code read of the per-frame paths. Seating
(P2-AVA-06) and faces / blinking (P2-AVA-07) were reviewed as the base and are not changed.

## What already holds (kept as is)

- Locomotion: speed-driven blend with one phase-synced gait cycle advanced by ground speed / stride (no foot sliding),
  foot-plant settle on stopping, step-turns in place, reverse walk cycle (world/human/animator.ts).
- Staged sit / stand at hall chairs (walk to the stand point, turn, lower; rise, step out to a free spot), seat fit
  per seat kind, remote people glide onto their chair, soft separation between rendered people, ghost fade-out at
  doors, the multi-level arena ground (rake, stairs) with its own walkable test and camera clamp.
- Camera: never inside furniture, lamps or walls; stays inside the hall; Leave always gets you out (watchdog).

## Gaps found

| Hall | Gap | Kind |
| --- | --- | --- |
| Ludo | Seated players sit bolt upright with their hands in their lap, half a metre from the board: nobody looks like they are playing. | activity |
| Igisoro | Same on the low stools: the board (0.84 m ahead) is ignored, no leaning over it, no sowing. | activity |
| Pool | Seated players stare straight ahead, not at the table beside them; spectators standing at a busy table (`watch`) look ahead instead of at the game. | look-at |
| Admin | The receptionist is a frozen seated pose: no seat fit for her task chair, 0.65 m from her work top, no keyboard, the monitor 0.8 m off to the side, no reaction when you walk up, no "talking" while her chat reply arrives. | activity / props |
| Admin | Officers at the desk do nothing; the office keyboards lie 0.76 m from the officer (out of reach). Visitors and meeting chairs: no listening / nodding. | activity / props |
| Arena | Seated spectators: no engagement (eyes are not on the stage, no leaning in). | look-at |
| All | Seat / exit / person prompts have a hard range: standing at the edge (or between two chairs) makes the prompt flash on and off and swap targets. | stability |
| All | The desktop control hint shows through the bottom seat panel / prompt (two text layers on top of each other). | stability / UI |
| Arena | The seat panel's "Eye view" chip wraps to two lines when the focus label changes (layout shift). | stability / UI |
| All | Per-frame allocations in the hot path: camera target + lerp vectors, collision arrays, wall list, a quaternion per avatar head turn, a hall-table map rebuilt every frame (GC hitches = visible stutter). | stability / perf |

Checked and fine: no z-fighting seen at the review poses (decals already lifted / offset), lighting matte, no glare
on table cloths or floors, no avatar falling through floors (ground follows the rake), doors never trap (the Leave
watchdog), seated people can always stand (walking input stands you up).

## What was implemented

1. **Seated activities** (world/human/activity.ts, world/human/seated-layer.ts, rooms/seat-activity.ts): a
   deterministic schedule per person (seed + wall clock, no Math.random, no network messages) drives a layer after the
   seat fit: torso lean, head pitch / nods, two-bone arm IK to the table.
   - Ludo: lean in, forearms on the table edge, reach out and move a counter now and then, sometimes sit back.
   - Igisoro: lean over the board, the right hand sows along the row with a dip at every pit.
   - Officer's desk and the receptionist: typing at the keyboard (fingers tapping), pauses to read, notes.
   - Visitor chairs: upright, nodding in conversation; meeting table: forearms on the table, nods.
   - Pool lounge chairs, arena seats: eyes on the table / the stage, leaning in at times.
   Everyone else sees the same: remote avatars derive the activity from the seat they sit on (server seat map), so
   no protocol change was needed. The layer follows the seated blend (no pop while sitting down / standing up) and
   steps back while the seated look-around clip plays.
2. **Receptionist** (rooms/AdminBlock.tsx): task-chair seat fit, chair pulled in to the work top, a keyboard in
   front of her and the monitor turned towards her; she types, and when you come up to the counter (or open the
   chat) she sits up and looks at you, types while your question is being looked up and talks (jaw) when her reply
   arrives. Clearly staff, not a player.
3. **Office keyboards** moved to the near edge of every desk (where the officer's hands are).
4. **Look-at**: seated people's eyes rest on their activity's focus (board, screen, stage) when nobody is talking;
   remote spectators at a busy table look at the game.
5. **Stability** (rooms/stability.ts, see below): prompt hysteresis for the hall seat / exit / person prompts and
   the plaza spot prompts; frame-rate independent camera smoothing; the hall control hint hides under seat panels
   and prompts; nowrap seat-panel chips; per-frame allocations removed from RoomPlayer, Avatar and RemotePlayers.

## Stability rules (keep these when changing halls)

All in `apps/web/src/rooms/stability.ts`, unit tested in `stability.test.ts`:

- **Prompts**: `stickyNearest(current, ids, dist, range, margin, gain)`: a prompt appears inside `range`, stays
  until `range + margin`, and another candidate takes over only when nearer by `gain`. `stickyZone` does the same for
  zones (the exit prompt). Ranges live in `PROMPT`. One prompt at a time (RoomOverlay already orders seat > exit).
- **Camera**: smoothing via `damp(rate, dt)` (= 1 − e^(−rate·dt)), rates in `CAM_RATE` (follow 6/s, glides 4/s), so
  the camera feels the same at any frame rate and never shakes from frame-time noise.
- **Decals / rugs / signs** on another surface: a material `polygonOffset` (factor / units −1 … −2) or a real
  gap of ≥ 4 mm, never coplanar faces.
- **Activities / motion**: anything cosmetic that others must see the same way is a pure function of a seed and the
  wall clock (activity.ts), continuous over time (tested: no step > 0.2 between 60 fps frames, also across periods).
- **Hot paths**: no `new THREE.*`, array spreads or maps inside `useFrame`; reuse module / ref scratch objects.
- **Moving parts in StaticMerge**: `userData={{ noMerge: true }}` (the receptionist group keeps it).

## Measurements

- Draw calls / triangles (desktop, dev build, the same pinned camera inside each door, median of 3 s, main → this
  change): Pool 118 / 343k → 118 / 343k, Ludo 98 / 346k → 98 / 346k, Igisoro 111 / 320k → 111 / 320k,
  Admin 124 / 103k → 124 / 103k, Arena 128 / 333k → 128 / 333k (unchanged: the activity layer adds no meshes, the
  reception keyboard is merged into the static batch).
- Prompt boundary wobble (Ludo, standing ±0.14 m around the 1.5 m edge of a chair, 60 samples): the "Sit down"
  prompt flipped 6 times on main, once (appears, then stays) with the hysteresis.

## Left for later

- Pool: chalking / leaning over the table for seated players waiting for their turn (the lounge chairs are away
  from the table; the standing spectator already chalks a cue).
- Arena: crowd reactions synced to the stage events (the reactions bar exists; a clap wave over the seated crowd
  would need an event channel).
- Stair step animation on the arena rake (the gait is foot-locked on the slope but has no dedicated step clip).

---

# P2-HAL-11 anomalies (interiors review 2)

Method: a fixed pose set per hall (wide from the door corner, wide from the far corner, high overview, low eye level,
close-up of table 1, seated side / behind on seat 1, looking back at the door) with the camera pinned through
`__gkRoomQA.cam`, plus the arena's own poses (the five reported shots, VIP eye views, every zoom target, a lower-bowl
and an upper back-row seat, desktop 1280×720 and phone landscape 844×390). Screenshots (before `b*`, after `a*`, sweep
`s-*`, phone `p-*`) are in the session scratchpad `halls11/`. The arena sightlines are now audited in code
(`arena/sightlines.ts`, tested over all 1,224 seats).

## The five reported issues

| id | hall | what | cause | fix | shots |
| --- | --- | --- | --- | --- | --- |
| H11-01 | Arena | timber slat wall shows broken black / brown blocks and missing slats | coplanar walls: every VIP box side was drawn twice in the same plane (the box's warm interior wall, double-sided, and a timber wall; between V1/V2 and V3/V4 both boxes added theirs), and the upper-tier end walls faced away from their own seats (back-face culled → see-through "missing slats") | one wall per face: tier end walls face their seats (and the gap, except where a VIP box is), the box interior is front-facing only, shared box walls are warm on both sides; slat texture joints warm brown instead of black, anisotropy 8 (calm at a distance) | b1-* → a1-* |
| H11-02 | Arena (all halls) | person behind the front wall / glass shows one trouser leg | (a) the glass balustrades just stopped at the aisle openings — no post — so a person at an opening showed one leg crisp and the other frosted; the frosting (0.22) also hid dark trousers almost completely; (b) the avatar near / far body switch never found the body meshes (they sit under a `RootNode`), so the detailed body AND its low-poly copy were drawn on top of each other everywhere | glass end posts on every balustrade run (concourse, upper fascia, VIP fronts, gantry), lighter frosting (0.15) so the whole figure reads softly; `partOf` finds the nearest named ancestor: one body level drawn at a time, hair cards hide under hats as intended | b2-* → a2-* |
| H11-03 | Arena | seated from behind: shirt shows under the seat back | the stadium profile left the buttocks 2 cm inside the back pad (the "back" distance in SEAT_FURNITURE was 0.12 m; measured from the seat geometry it is 0.108 m) and the clearance test allowed 3 cm of penetration | stadium `hipFwd` 0.05, VIP 0.03, measured backs (0.108 / 0.13 m), the test now demands ≥ 1 cm clear for every seat kind plus a test that re-measures the arena back pad from the geometry | b3-seated-behind → a3-seated-behind |
| H11-04 | Arena | angular dark block near the stair / tier with dark streaks on top, a slanted wedge meeting a box | the players' tunnel cheeks were a 4° wedge (`top` at 0.9 m) overlapping an instanced box with the same top height (coplanar → z-fighting streaks); the VIP stair had open stepped sides; the upper fascia kerb was coplanar with the row-1 riser (0–0.24 m) | one clean solid cheek wall each side (tunnel face, row-end face along the 190° / 170° ray, a slim stone cap sloping from the front barrier's top to the concourse balustrade's top, closed ends); every stair is a real flight between cheek walls with stone caps, handrails on end posts, LED nosings; no riser drawn where a barrier / fascia already is | b4-*, b5-tunnel → a4-* |
| H11-05 | Arena | "Players' tunnel" card and the "E · Players' tunnel" prompt at once; big 3D letters read through the card | the arena prompt ignored open venue windows; the 3D "PLAYERS ONLY" floated in mid-air over the tunnel mouth; the modal scrim only dimmed 28 % | no prompt while a venue window or the event card is open; "PLAYERS ONLY" is a floor marking at the tunnel mouth; `.pscrim` (every modal, both themes) dims 36 % and blurs the scene 6 px | b5-tunnel → a5-tunnel(-v2) |

## VIP sightlines, stage zoom, every seat audited (coordinator addition)

- **Sightline audit** (`arena/sightlines.ts` + test): from each seat's seated eye (1.2 m over the seat floor) to the
  stage centre and its four corners, the line must clear the front barrier, the concourse balustrade, the upper
  fascia, the VIP fronts, the stair handrails and the tunnel cheeks, and pass ≥ 0.06 m (C-value) over the eyes of
  every row in front. **Before: 878 of 1,224 seats failed** (front barrier 308, concourse balustrade 342, heads in
  front 228; all 480 upper seats and all 24 VIP seats). **After: 0 failures.**
- Geometry changes that got there: a compact stage (16.4 × 7.2 → 12 × 4.8 m, tables re-spaced with ≥ 1 m of play room)
  so its corners are ≥ 4 m inside the front barrier; the lower rake is 0.38 m per row from row 1 at −2.4 m (the back
  row 0.5 m under the concourse, behind a 0.9 m balustrade; its aisles climb to the concourse in three 0.167 m steps);
  the upper tier is raised 1.1 m (row 1) with a stone fascia wall carrying the LED ribbon and a 6-step stair up from
  the concourse at every aisle; the VIP boxes are raised to 1.7 m with a LOW glass front (0.8 m), a 10-step stair
  each; section signs moved out of the eye lines (lower ones onto the balustrade face, upper ones onto the fascia);
  totems moved beside the stair mouths (50°, 130°, 230°, 310°); the concourse walking line moved to r 18.1.
- **VIP = best view**: VIP eyes are higher than every upper front row, the box front is ≥ 0.3 m under the seated eye,
  nothing stands between the box and the floor.
- **Stage zoom** (`arena/spectate.ts`, `SpectatorControls`): targets Stage / Pool / Ludo / Igisoro / Desk; a tap glides
  the look point onto the target and fits the lens to it from that seat (a real FOV change, always sharp; Ludo
  from the back row U3-5-6 ≤ 12°), − / + zoom steps (1×, 1.5×, 2×, 3×) on top, wheel / pinch still work, drag looks around within
  the old limits, glides use `damp(CAM_RATE.glide)`. VIP seats start framed on the stage with a "VIP view" label. The
  target is centred in the space above the seat card (the card's share of the screen is measured), so on phone
  landscape the card never covers what you zoomed onto. One row each, no wrapping.
- Seats also audited: evenly spaced (≤ 2 cm spread per row, ≥ 0.5 m apart, VIP ≥ 0.62 m), every seat faces the
  centre and stands on its own tread / box floor, no seat on a walking line, every walking line climbs in steps
  ≤ 0.2 m (upper aisle half-steps 0.24 m, unchanged), routes to every seat still walkable (existing tests).

## Sweep (Pool, Ludo, Igisoro, Administrative Block, Arena)

| id | hall | what | cause | fix |
| --- | --- | --- | --- | --- |
| H11-06 | all | every person drew both body levels | `partOf` (see H11-02) | fixed (affects everyone everywhere: fewer triangles per person, no low-poly limbs poking through clothes) |
| H11-07 | all | scene text competed with modal windows | weak scrim | `.pscrim` blur + dim (H11-05) |
| H11-08 | Arena | lower section letters (1.5 m high) and the upper ones stood in front-row eye lines | placement | moved (see above) |
| H11-09 | Arena | wayfinding totem stood in the U1–U8 aisle mouths | placement | moved beside the stairs |
| H11-10 | Arena | VIP box roof slab open at its ends; kerb ends open at the aisle openings | missing faces | end caps added |
| H11-11 | Arena | lower aisle → concourse: one 0.5 m step after the rake change | geometry | three equal steps (geometry + `groundAt`) |
| — | Pool, Ludo, Igisoro, Admin | checked at the seven poses: no z-fighting, no see-through walls, no props floating / sinking, seated people clear of chair backs (lounge, armchair, stool, sofa) | — | nothing to fix beyond H11-06 / H11-07 |

## Measurements (qa/e2e/perf.mjs, desktop, standard + fx)

| hall | arrival calls / tris | wide calls / tris |
| --- | --- | --- |
| Pool | 138 / 341k | 115 / 339k |
| Ludo | 117 / 343k | 114 / 341k |
| Igisoro | 131 / 318k | 105 / 308k |
| Arena | 148 / 335k | 107 / 299k |
| Admin | 136 / 95k | 137 / 94k |

Draw calls stay ≤ 150 at the standard poses (the new arena geometry is merged into the existing per-material bowl
meshes; posts, handrails and nosings join the existing instanced meshes). The far-corner overview pose of the sweep
reaches 154–158 calls in Pool / Igisoro / Admin (unchanged by this task). Triangles over 300k in Pool / Ludo / Igisoro
/ Arena are as before (P2-HAL-10 measured the same).

## Left for later

- Triangle budget (> 300k) in four halls: needs LOD on the hall models, out of scope here.
- A second signed-in person for the occlusion check: done with your own avatar behind the glass (the same renderer
  path; remote avatars additionally use the distance LOD that H11-06 repaired).
