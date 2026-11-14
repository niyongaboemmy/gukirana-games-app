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
