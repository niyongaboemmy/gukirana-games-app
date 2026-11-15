# Campus master plan: gate on the edge, growth away from it

Task P2-WLD-12. Written 2026-11-15 by the coordinator (senior 3D/VR architect role) for the implementing agent.
Read with `apps/web/src/world/layout.ts`, `footprints.ts`, `District.ts`, `gate/Gate.tsx`, `Landscape.tsx`, `beds.ts`.

## 1. What is wrong today

The campus is **concentric around the fountain**. Coordinates: north = −z, bearings clockwise from north.

| Element | Today |
|---|---|
| Plaza | r 37 m, eight inner halls on the door ring (r 38.5) |
| Plaza entry gate | z = 40.5 |
| Arrival gate (sign-in) | z = 57 (`GATE_Z = ENTRY_Z + 16.5`) |
| Avenue | runs on south from the arrival gate to the ring road (z 57 → 158) through empty lawn |
| Outer promenade | full ring r 100–105 |
| Expansion plots | ring r 108, bearings ±35 … ±155, **including both flanks of the gate approach** |
| Fight Games hall | bearing 140°, r 108–156: **south-east of the gate**, z up to ≈ 120 |
| Ring road / compound | full circle r 158–165 / r 172 |

The result (user's screenshot, aerial view): the arrival gate sits about a third of the way out from the fountain,
with campus on every side of it. Every new plot on the ring, south of the gate included, makes the gate more central.
That isn't how a real campus works. The gate belongs on the boundary, on a public road, and the campus grows away
from it. A secondary problem: the 110 m of avenue and lawn south of the gate do nothing, and the Fight hall's walk
is long (≈ 87 s).

## 2. Principles

1. **The gate is on the boundary.** The arrival gate faces a public road outside the campus. Nothing is ever built
   south of the gate line.
2. **One growth direction.** Districts grow east, west and north (a fan behind the plaza), never towards the gate.
3. **Keep the heart.** The plaza, its eight inner halls, the fountain, the plaza entry gate, the arrival gate
   building and the 16.5 m avenue between them stay exactly as they are (geometry, tests, door mapping, sign-in
   flow, spawn). Only what lies outside the heart moves.
4. **A clear road hierarchy.** public road → gate forecourt (drop-off, parking) → arrival gate → plaza (pedestrian
   heart) → district walks → hall forecourts. Service traffic uses a separate campus loop road, never the plaza.
5. **Easy access.** Every hall door is ≤ 60 s on foot from the plaza edge at normal pace (2.2 m/s, ≤ 132 m of
   path), with a signed walk and a wayfinding totem at every junction.
6. **Keep the volcano view.** The north corridor (bearings −25° … +25°) behind the arena stays low: no hall plots,
   only landscape and a future outdoor stage.

## 3. New structure (numbers for the implementer)

```
                        N (volcanoes)            Growth band B (r 175–235, bearings −100…+100), later
             . - - - - - - - - - - - - - - - - .
         .'   NW district  | view  |  NE district  '.     <- campus loop road (arc r ≈ 152)
       .'   plots on r 108 |corridor| plots on r 108   '.
      |  W district        ( ARENA )        E district  |
      |  plots −95, −65    PLAZA + 8 halls  Fight hall  |  <- district walks from plaza exits W / NW / NE / E
      |                    ( fountain )     (moved, 80°)|
       '.__________________ entry gate ______________.'   <- loop south straight (z ≈ 70) + forecourt parking
   ========== boundary wall with the ARRIVAL GATE (z ≈ 57–78) ==========
   ----------------- public road "Musanze Road" (z ≈ 86–96) ------------- bus / moto-taxi stop, crossing
```

### 3.1 South frontage (new)

| Item | Spec |
|---|---|
| `FRONTAGE_Z` | 80: the boundary line. The boundary wall runs E–W along it (lava-stone base, rendered upper wall, steel railing panels; height 2.2 m; gaps only at the gate and a service gate). |
| Arrival gate | Stays at `GATE_Z` = 57. Its forecourt (z 62–78) becomes the **gate forecourt**: a drop-off loop for cars and moto-taxis, a pedestrian plaza to the turnstiles, and a guard post at the boundary opening. |
| Parking | Inside the wall, east and west of the forecourt (x ±34 … ±80, z 64–78): marked car bays and a motorbike and bicycle row, shade trees in planters between rows. |
| Public road | `PUBLIC_ROAD`: z 86–96, straight E–W, runs off into the farmland both ways. Two 3.5 m lanes with a dashed centre line, 1.5 m footpaths and kerbs both sides, street lights every 30 m, a zebra crossing at the gate, a bus / moto-taxi shelter by the crossing. |
| Removed | The avenue south of z 78 and the ring road's southern half. |

### 3.2 Districts (outside the heart)

| District | Bearings | Contents |
|---|---|---|
| East | +60 … +115 | **Fight Games hall moved here**: merged plots 07 + 08, site centre about 80°, r 108; the door faces the plaza; same building and interior. Room for a sports/esports plot at ≈ +110. |
| West | −115 … −60 | Plots −95 and −65 (future Cards, Draughts …). |
| North-east | +30 … +60 | Plot +35. |
| North-west | −60 … −30 | Plot −35. |
| View corridor | −25 … +25 | Landscape, viewpoint, future outdoor stage; no halls. |
| Growth band B | r 175–235, −100 … +100 | Reserved for later halls (plots defined but not built). The compound's north arc grows to r ≈ 245. |

`EXPANSION_PLOTS` becomes `{-95, -65, -35, 35}` plus the Fight site at 80°, plus `GROWTH_PLOTS` in band B. All
plots south of bearing ±115° are removed, because they would sit beside or behind the gate.

### 3.3 Roads and walks

| Element | Spec |
|---|---|
| Campus loop road | Replaces the ring road. A 6 m service and shuttle road with 2 m footpaths. It leaves the forecourt east and west through barrier arms, runs along z ≈ 70 inside the wall (south straight), then follows an arc r ≈ 152 around the districts. Districts are served from it by short spurs to each hall's back (service yard). Low speed, signed, street lights, kerbs, gullies. |
| Outer promenade | The pedestrian ring r 100–105 is kept only north of the gate line (bearings −115 … +115). It ends at the east and west district walks. |
| District walks | Paved pedestrian walks from the plaza edge to each district: four plaza exits in the gaps between the inner halls (halls stand at 0, ±44, ±88, ±122, ±144°): W (−105°, between Igisoro and the west pavilion), NW (−66°, between Pool and Igisoro), NE (+66°, between Ludo and the Administrative Block) and E (+105°, between the Administrative Block and the service pavilion). Check each against the real footprints and shift a few degrees if a wing is in the way. They join the outer promenade. The current Fight walk (133°) is replaced by the E walk. Each walk is walkable ground, with click-to-walk routing, the same as today's `FIGHT_WALK`, generalised to a small graph `CAMPUS_WALKS`. |
| Wayfinding | A totem at every junction (district name, arrow, metres and walk time), consistent with the plaza totems. |

### 3.4 Realism checklist

- Asphalt with tone variation, kerbs, lane markings, drains, manholes; worn edges near junctions.
- Parked cars and motorbikes (low-poly, instanced, deterministic colours), a moto-taxi stand with green-helmet
  riders as static props; buses only as a stop sign and shelter (no traffic simulation in this task).
- Street lights (instanced) along the public road and the loop, lit at night with the existing light system.
- Boundary wall with a lit gate sign "GUKIRANA PLAYGROUND", a guard post, flags, a planted verge.
- Lawns with mown stripes and tree clusters along the walks, shrubs at hall entrances. Farmland and villages
  continue right up to the public road on the far side.

## 4. Implementation phases (one agent, commit after each)

1. **Data** (`layout.ts`, new `campus.ts` if cleaner):
   - add `FRONTAGE_Z`, `PUBLIC_ROAD`, `CAMPUS_LOOP` (polyline), `DISTRICTS`, `CAMPUS_WALKS`, the new
     `EXPANSION_PLOTS`, `GROWTH_PLOTS`, the Fight site at 80°, `COMPOUND` shape (south line plus north arc);
   - keep the old names where other code imports them, as aliases.

   Tests (`footprints.test.ts`, a new `campus.test.ts`):
   - nothing but the frontage lies south of the gate line;
   - every plot footprint lies inside the compound and outside the heart;
   - no overlaps between plots, roads and walks;
   - every hall door is ≤ 132 m of walk from the plaza edge;
   - the volcano corridor is empty;
   - the inner layout is unchanged (the existing tests stay green).
2. **Fight hall move**: re-site the building at 80° (facade, door, `FIGHT_WALK` → E walk, door mapping, preload).
   The hall interior and the ring positions do not change (realtime `boxing-rings.ts` is in hall-local
   coordinates; check it).
3. **Frontage**: boundary wall, gate forecourt with drop-off and parking, guard post, public road with crossing and
   shelter. Remove the south avenue and the southern ring road.
4. **Loop road and walks**: campus loop, spurs, the four district walks, the trimmed promenade, wayfinding totems;
   walkable ground and click-to-walk routing on the walks (generalise the Fight walk code in `Player.tsx` /
   `obstacles.ts`).
5. **Realism pass**: road materials, markings, street lights, parked vehicles, lawn and trees, `Landscape.tsx`
   clearing and flattening for the new compound shape (trees and farmland outside the wall, none on roads).
6. **Aerial labels and performance**: move the `CampusLabels` positions to the new sites, add district names. Draw
   calls: plaza ground view no worse than today; aerial ≤ today (≈ 300), aiming lower. Use instancing, the outdoor
   `StaticMerge`, and camera-height visibility.

## 5. Decisions taken (recommended defaults; changeable)

1. The Fight Games hall **moves** from 140° to the east district at 80°. Its current site would sit beside and
   behind the gate. The interior, rings and game code are unchanged.
2. The arrival gate stays where it is (z 57), so the sign-in flow, spawn and walk to the plaza don't change. The
   boundary is drawn just behind it, rather than moving the gate 100 m out, which would add a long walk.
3. Four plots south of ±115° are dropped. Capacity comes back in growth band B (north), which is reserved, not built.
4. There is no vehicle traffic simulation in this task. Parked vehicles and road furniture only.

## 6. Out of scope

- Inner plaza layout, inner halls and their interiors.
- Hall interiors (including the Boxing hall).
- New halls on the plots.
- Night lighting changes beyond the new street lights.

## 7. P2-WLD-13 access review (2026-11-15)

Fight Games is the main reason most people visit, so it has to be the easiest place on campus to reach.

### 7.1 Measured walks (from the arrival spawn, normal pace 2.2 m/s)

| Door | Before | After |
|---|---|---|
| Cards / Esports pavilions (±144°) | 22 m · 10 s | unchanged |
| Draughts (−122°) | 34 m · 15 s | unchanged |
| Igisoro / Administrative Block (±88°) | 50 m · 23 s | unchanged |
| Pool / Ludo (±44°) | 65 m · 30 s | unchanged |
| Tournament Arena (0°) | 70 m · 32 s | unchanged |
| **Fight Games** (80°, r 108) | **144 m · 65 s** (86 m · 39 s from the plaza exit) | **131 m · 59 s** (73 m · 33 s from the plaza exit) |

Go To "Walk there" from the spawn to inside the Fight lobby (`hall:fight`), including the door transition, measured
in Chrome: **40.4 s and 40.9 s** in two runs. Before the auto-jog pace fix it took 58.7 s.

### 7.2 Why the Fight hall felt hard to reach

1. **Hidden.** The Administrative Block (88°, 37 m wide, 43 m deep) stands exactly between the plaza and the Fight
   door. From the plaza, nothing of the Fight hall is visible, and its door sits on the line of the Block's north wall.
2. **No signed way in.** The only exit towards it is a 3 m gap between the Ludo Lounge and the Block. It was marked by a
   totem that named the district, not the hall.
3. **A detour.** The walk went north-east to 63° (towards the north-east plot), then doubled back along the promenade
   from 76° to 80°. That made it 20 % longer than the straight line.
4. **Wrong numbers.** The fountain-court signs gave the straight-line distance (≈ 105 m), not the walk.

### 7.3 What changed

- **The Fight Games walk** (`layout.ts FIGHT_WALK`, `campus.ts DISTRICT_WALKS` id `fight`): the campus's main walk,
  4 m of paving (the other district walks are 3 m). It leaves the plaza at 68°, goes between the hall corners, runs
  straight east along the Block's north side (`FIGHT_WALK_TURN`), then onto the hall's forecourt at 80°. The door
  faces the walk (24° off its axis). It is now only 3 % longer than the straight line. The north-east walk forks off
  it behind the halls.
- **Gateway arch** (`FIGHT_GATEWAY`) just past the plaza's perimeter wall: lava-stone posts, red LED strips, and a lit
  lintel that reads "FIGHT GAMES · 75 m · 35 s walk", facing the plaza and readable from the fountain.
- **Lit walk:** low warm bollards every 4.5 m, staggered along both kerbs (`FIGHT_WALK_LIGHTS`).
- **Wayfinding:** a totem at the fork. The totems at the plaza exit and the fork list Fight Games first. The
  fountain-court signs give the walking distance over the walks.
- **Auto-jog pace:** the default walking pace setting is "slow" (1.4 m/s), so a long tap-to-walk route used to jog at
  only 2.5 m/s. Long routes now jog at least at the normal pace's jog (3.96 m/s).
- **Go To** (HUD button "Go To", key M; `hud/GoToModal.tsx`, state in `world/goto.ts`, kill switch
  `NEXT_PUBLIC_FF_GOTO=0`). Pure client navigation, nothing goes to the server.
  - **The window:** a PaperCard with a search field. Fight Games comes first under "Most popular", with one-tap
    "Walk there" and "Show on map". Below it are Halls (every plaza-ring hall and pavilion, with open / closed /
    opening-soon status from the buildings API) and Places (plaza and fountain, main gate, help desk and café, the
    five districts). Every row shows metres and walking time.
  - **Accessibility:** Esc closes, Tab is trapped in the window, and focus goes back to the button.
  - **Picking a place:** the person and the camera turn towards it. Gold chevrons run along the route on the
    ground, drifting towards the place, and a light beacon stands over it (`world/GoToGuide.tsx`). A guide card shows
    the live distance and two actions:
    - **Walk there** follows the walks (jogging while the route is long) to the doorstep, then through the door if
      it opens for you. A closed hall stops at its doorstep, where the door notice explains why.
    - **Show on map** goes up into the aerial view, framing the place from your side, until "Back to me".
  - **Inside a hall:** the window explains that you have to walk out through the door first, and the items are
    disabled. That is the simplest robust choice: halls have their own exits and seats.
- **First-visit guide:** about 2.5 s after the plaza first appears, a card reads "Fight Games is this way", with the
  route line on the ground and Walk there / Not now. It is shown once per user per device (localStorage).
- **One data source:** `world/destinations.ts` holds `DESTINATIONS`, `FEATURED` and `FIRST_VISIT_DEST`. Change what
  players are guided to there.
- **Fight lobby:** lit red floor chevrons run from the plaza door, straight ahead, then left to the Boxing doorway.
  Within the Boxing hall, finding a ring stays with the hall's own ring finder; its interior belongs to another task.

### 7.4 Moving the Fight hall closer: evaluated, not done

The hall is 94 m wide and 42 m deep (93 × 30 m Boxing hall). It can't take an inner-ring slot: the widest gap on the
door ring is about 10° (6–7 m), and the inner halls stay unchanged under principle 3. The only open ground closer to
the plaza is east and south-east of it (bearings 100–150°, r 60–100). There the building's south end would reach past
z = 57, beside the arrival gate, which breaks principle 1 and is the reason it moved off 140° in P2-WLD-12. The
straight-line distance from the spawn to the present door is 116 m, and the new walk is only 3 % longer than that.
So the remaining time is the plaza crossing, and moving the hall wouldn't clearly beat the straightened, signed walk.

### 7.5 Invariants (campus.test.ts "easy access to every hall")

- The Fight door is ≤ 45 s at 2.2 m/s from its plaza exit, and ≤ 5 % longer than the straight line.
- It is ≤ 135 m from the spawn.
- The Fight walk is the widest district walk.
- Every inner hall is ≤ 75 m from the spawn.
- The arch and the bollards are clear of every building.
- The exit and fork totems list Fight Games first.
