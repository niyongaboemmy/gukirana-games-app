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
