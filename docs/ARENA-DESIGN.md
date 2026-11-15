# Tournament Arena: exterior and interior design (P2-WLD-17)

> Companion to `WORLD-ARENA-DESIGN.md` (district, research), `ARENA-REQUIREMENTS.md` (access and events) and
> `DESIGN-SPEC-3D-VR.md` (§5 art direction, §16 budgets). This document holds the design review of the Tournament
> Arena as it stood before P2-WLD-17, the concept we chose, and the acceptance criteria we built and tested against.
> Code: `apps/web/src/world/District.ts` (`tournamentArena`), `world/Plaza.tsx` (`ArenaScreen`, door sign),
> `world/Ambience.tsx` + `world/rwanda-flag.ts` (flags), `rooms/TournamentArena.tsx` (interior),
> `arena/bowl.ts` (walking, ground, routes), `arena/textures.ts` (boards, ribbons, floor).

---

## 1. Purpose

The arena is where the playground's tournaments happen (SRS: watch live finals, take a bowl seat, VIP boxes, players
walk out through the tunnel to the feature stage). It is the building people see first when they arrive on the plaza
(it stands on the door ring due north, straight across the fountain from the gate), and it is the landmark on the
aerial view. It must read as the most important building on the campus without shouting.

## 2. Review of the arena before P2-WLD-17 (gaps)

### 2.1 Exterior

| Area | Gap |
| --- | --- |
| Identity | Purple dominates: LED rings, door trim, the screen (purple-blue gradient), two of four flags, the foyer seen through the glass. The app's primary colour is chocolate; the arena looked like a different product. |
| Massing / roof | A plain white slab ring and a bright aluminium dome. From above, three thin steel **rings floated over the dome** with a purple LED torus hanging above its crown: they read as loose hoops, not as a roof. No eave, no edge detail, no skylight: the top of the most important building was its weakest view. |
| Facade | One layer only: tilted panels with a high-contrast black / white / rust diamond print. At plaza distance it shimmered as a busy checkerboard (moiré) and did not read as a refined perforated screen. White fascia bands top and bottom made the drum look like a stack of rings. |
| Base | Grey basalt plinth only 1.2 m high, no warm material at the human scale where people walk. |
| Entrance | A thin white canopy on four columns, a small glass box. Its side returns stopped 0.8 m short of the drum (a visible slot from oblique views). The canopy columns and the four flagpoles stood on the walkable plaza strip with **no collision**: you walked straight through them. |
| Signage | The building name was a 0.4 m purple LED line under the canopy, barely legible from the fountain. "GUKIRANA PLAYGROUND" in saturated yellow floated above the screen, unrelated to the facade. "TICKETS" and the crown letters were hard-coded English, not i18n strings. |
| Screen | A purple-blue gradient, the loudest element of the plaza. |
| Flags | Generic coloured cloths (sky blue, yellow, green, purple), not a flag; proportion 18:11 instead of 3:2. Only the Administrative Block flew Rwanda's flag, and its sun had no blue ring. |
| Lighting | No warm accent at all: LEDs were purple; nothing grazed the facade at dusk. |
| From other halls | The doorway glimpse (`rooms/PlazaGlimpse.tsx`) drew the arena as a white drum under a grey dome. |

### 2.2 Interior

| Area | Gap |
| --- | --- |
| Palette | Purple seats in the lower bowl, slate-violet upper seats, a purple stage edge and walk-in carpet, lavender-tinted LED ribbons, violet scoreboard and totem art: the house chocolate palette appeared only on the timber walls. |
| Walking | Three **unreachable seams** found by a new flood-fill test of the walking surface (§6.2): (1) a 0.2 m unwalkable band at the top of the players' tunnel stair, (2) another at its foot, between the tunnel and the competition floor (the controller reverts any step onto unwalkable ground, so a participant walking out to the stage stopped dead at the tunnel); (3) standing against the drum wall in the lobby read the upper tier's top walkway behind it, a **3 m jump** in body height along the lobby wall. |
| Signage | English strings hard-coded in the 3D scene (PHOTO SPOT, EXIT · PLAZA, PLAYERS ONLY, MEDIA GANTRY, COMMENTARY, RESTROOMS, the bowl directory, TICKETS · INFO, the ribbon words). |
| VIP routes | Inside a VIP box, a tap from the floor behind the seats to a seat front walked straight into the row and stopped (found by the browser walk test); the route now rounds the end of the row. |
| Flicker | The scene scan (qa/e2e/zscan) found coplanar tops at the entry portal (portal blocks and the lit frame flush with the soffit, y 3.4) and the stage Ludo board 2 mm over its tray. |
| Screens | The commentator monitors glowed blue. Data was already real (status, occupancy, the current / next event) and stays so. |

What was already sound and is kept: the bowl geometry and seat model (1,224 seats from the contract, sightline audit
P2-HAL-11), stepped aisles, stair cheeks and handrails, glass balustrades with end posts, the merged / instanced draw
structure, the frosted low-glare glass, eye-comfort rules, the seat-finder and PaperCard HUD (already house style).

## 3. References and principles

Inspiration for quality and language only (no building or brand is replicated):

- **A modern East African arena**: a curved drum wrapped in a perforated decorative metal screen with traditional
  geometric patterns, over a continuous glass band at the concourse level; a deep entrance colonnade; big letters over
  the entrance; ticketing and gated entries at the base.
- **A world-class sports hall**: a dramatic cantilevered roof edge, sculpted volumes, a layered facade, a warm masonry
  base, strong shadow lines.

Principles we design by:

1. **One primary, one accent.** Dark chocolate and bronze carry the building; warm amber light is the only accent.
   Cream and warm stone are the neutrals. No purple, no blue chrome (the flag's blue is a national symbol).
2. **Layers, not stripes.** Base → glass → screen → crown → roof, each a different material and depth, so the drum
   reads as built, not printed.
3. **Pattern by perforation.** Imigongo is expressed the way a real perforated screen does it: round holes on a grid
   whose size draws the motif. It stays calm at distance (no moiré), rich up close.
4. **Closed and finished from every view**, including straight down.
5. **Human scale at the base**: warm brick, a deep soffit, cut letters, level access.
6. **Stable**: no flicker, no z-fighting, no popping, no motion except the flags and slow screen messages.

## 4. Concept: the exterior

### 4.1 Massing and roof

- The elliptical drum (22 × 19 m half-axes, 20 m to the crown) is kept: it fits the plaza plot and the interior bowl.
- **Cantilevered eave**: the roof sails 1.7 m beyond the screen, edged by a 0.9 m dark-bronze fascia with a warm
  hairline. Its underside is a warm timber soffit with a ring of downlights.
- **Shallow standing-seam dome**: dark chocolate-bronze metal with radial seams rising 3.4 m from the eave to a glazed
  **oculus lantern** (Ø ≈ 9 m; the cream stone lid tops out at about 25.5 m, just under the aerial label) under a closed bronze cap with an amber halo. The roof is one continuous closed shell:
  nothing floats, nothing is open from above.

### 4.2 Facade layers (bottom to top)

| Level | Layer | Material |
| --- | --- | --- |
| 0 – 1.3 m | Plinth | warm brown brick, a cream stone coping |
| 1.3 – 7.2 m | Concourse glass band | continuous glazing, dark bronze mullions every ~2.7 m |
| 7.2 – 7.9 m | Concourse slab edge | dark chocolate fascia, amber LED line under its lip |
| 7.9 – 19.2 m | Perforated screen | pleated bronze panels, Imigongo chevrons and diamonds drawn by hole size, dark chocolate inner drum behind, an amber grazing line at the foot |
| 19.2 – 21 m | Crown and eave (roof above to ~25.5 m) | dark chocolate crown band, bronze roof fascia with the amber hairline |

### 4.3 Entrance

- A deep **cantilevered canopy** (24 × 9.4 m, dark chocolate with a bronze fascia) over the glazed foyer, on four
  slender bronze columns; timber soffit with a grid of downlights.
- **TOURNAMENT ARENA** in 0.9 m cut letters (cream with a warm glow) on the canopy fascia, from the door label in
  `world/layout.ts` (the i18n source).
- The foyer glass (P2-WLD-15 interior mapping) now shows the new foyer: bronze turnstiles, chocolate banners with gold,
  a chocolate-to-amber video wall. The side returns run into the drum (no slot). Bronze mullions and transom.
- Ticket window with a cream "TICKETS" sign (i18n), bronze door surround with an amber trim.
- **Level access**: the foyer floor is level with the plaza paving (no steps, so no handrails are needed: step-free
  access for everyone). A flush stone forecourt with brass joints marks the entrance.
- Collision: canopy columns and flagpoles are solid plaza obstacles.
- Flags: poles 2.4 m apart (a 1.8 m cloth never overlaps its neighbour), flying above the canopy.

### 4.4 Screen and lettering

- The big screen keeps its place on the drum, now in a dark chocolate frame with a bronze edge, and a header bar above
  it carrying **GUKIRANA PLAYGROUND** in slim cream-gold letters (replacing the floating saturated yellow).
- Content: welcome messages only (Tournament Arena / Murakaza neza / Gukirana Playground / Play · Meet · Win), white
  and amber on a deep chocolate field; one message every 12 s (unchanged pacing). Strings in `world/strings.ts`.

### 4.5 Flags

Rwanda's national flag on all four arena poles (and the Administrative Block's middle pole), from one pure spec
(`world/rwanda-flag.ts`, unit-tested):

- proportion 2:3; sky blue `#00A1DE` top half, yellow `#FAD201` quarter, green `#20603D` quarter;
- golden sun `#E5BE01` in the upper fly corner, centre at (5/6 W, 0.2375 H): 24 straight rays (outer radius 0.161 H),
  a golden disc ringed in blue;
- painted at 768 × 512 with mipmaps and anisotropic filtering (crisp, no shimmer); a gentle travelling wave, pinned at
  the hoist. The poles stand either side of the canopy, outside the walking line.

### 4.6 Palette

| Role | Colour | Where |
| --- | --- | --- |
| Primary: dark chocolate | `#3b2416` / `#4a2e1e` | crown, canopy, slab fascia, inner drum, seats |
| Bronze (chocolate metal) | `#7a4e33` → `#9b6a48` (app primary 600 / 500) | screen panels, mullions, fascias, columns |
| Accent: warm amber light | `#d6a06c` (app primary 400) | LED lines, door trim, oculus halo, sign glow |
| Cream / stone | `#efe4d2`, `#d8cbb8` | lettering, coping, signs |
| Brick | warm brown brick | plinth |
| Timber | `#b98a5e` | soffits |

`GAME_COLORS.arena`, the arena's door colour and the hall colour move from purple to the amber accent.

## 5. Concept: the interior

Kept: the plan (lobby → entry portal → concourse ring → lower bowl A–L / upper tier U1–U8 / VIP boxes V1–V4 →
competition floor with the feature stage, players' tunnel, media gantry). Changed:

- **Palette**: dark chocolate lower-bowl seats, espresso upper tier, cognac VIP; bronze stage edge, chocolate walk-in
  carpet; warm (not lavender) LED ribbons; scoreboard, totems, event board, menus and floor graphics repainted in
  chocolate, copper and gold; warm commentator monitors; warm darks for rails, frames, soffits and the lantern.
- **Wayfinding**: every scene string is an i18n string (`arena/strings.ts` `V.sign.*`): directory over the portal,
  exits, restrooms, players only, media gantry, commentary, tickets & info, photo spot, ribbon words.
- **Walking**: the three seams above are fixed in `arena/bowl.ts` (`walkable` / `groundAt`), guarded by the
  walking-graph test.

### Entry sequence and accessible routes

Door → foyer (ticket & info kiosk, event board, concessions, restrooms) → entry portal (6 m wide, level) → concourse
ring (level, 3 m wide, all round) → any section: lower bowl down its aisle steps, upper tier and VIP boxes up short
stairs with handrails, media gantry up six steps. The whole lobby and concourse are step-free; seats are taken from the
legroom in front of them (contract seats, server-confirmed). The floor and tunnel are for participants and staff.

## 6. Acceptance criteria

### 6.1 Exterior

- [x] No purple anywhere on the arena exterior; LEDs warm amber.
- [x] A closed roof from every view, including straight down; no floating rings; eave, fascia, soffit, oculus.
- [x] Layered facade: brick plinth, glass band with mullions, perforated bronze screen with an Imigongo-derived
  pattern, chocolate crown.
- [x] Deep canopy, columns, cut letters "TOURNAMENT ARENA" (door label), ticket sign (i18n), foyer glass restyled.
- [x] Rwanda's flag on every arena pole: 2:3, official colours, 24-ray sun with the blue ring (unit test).
- [x] Columns and flagpoles collide.
- [x] Plaza draw calls not worse than before (§7).

### 6.2 Interior

- [x] Walking graph (0.1 m grid, flood fill from the door, max rise one riser): every walkable spot reachable, for
  spectators and for participants (`arena/walk-graph.test.ts`).
- [x] Every seat front, every aisle, every stair top and the media gantry in the door's walking graph.
- [x] Stairs rise in equal steps ≤ 0.2 m and land flush; lower aisles never step more than 0.2 m; tunnel steps
  continuous.
- [x] Existing route, sightline, seat and venue tests still pass.
- [x] Chocolate palette; no hard-coded scene strings; hall draw calls within the previous numbers.

## 7. Verification (measured)

**Draw calls** (Standard tier, desktop 1280 × 720, `renderer.info` calls per frame, median of ~30 frames, the same
stack and camera poses; "before" = current main without P2-WLD-17):

| View | Before | After |
| --- | --- | --- |
| Plaza, follow camera | 227 | 224 |
| Arena front from the plaza | 169 | 171 |
| Arena from the fountain | 212 | 214 |
| Oblique (east) | 179 | 181 |
| Close entrance | 148 | 151 |
| Flags close-up | 140 | 144 |
| Aerial oblique / top / side | 148 / 204 / 184 | 149 / 206 / 186 |
| Hall: entry / bowl / stage / follow | 131 / 121 / 99 / 135 | 131 / 121 / 99 / 135 |

The exterior adds three materials (dark chocolate, the perforated screen, the standing-seam roof) and removes one
(the dark diamond drum) and the separate arena LED key (all arena LEDs share `led-halo`): +2 to +4 calls only where the
arena is in view, fewer in the plaza follow view; the hall is unchanged (slightly fewer triangles).

**Flicker scan** (`qa/e2e/zscan-lib.js`: up-facing horizontal surfaces overlapping within 4 mm; run over the whole
height range): arena interior 3 hits before → **0**; arena exterior 0 before → **0** (the two remaining plaza hits
are on other buildings, outside this task).

**Walk test** (browser, routed like a tap, spectator): lobby west / east, portal, concourse east and north, a lower
aisle, two lower-bowl seat fronts, an upper aisle, an upper seat front, the top walkway, a VIP box, a VIP seat front,
the media gantry and back to the door: all reached, body height following the steps (lower bowl −1.6 m, upper tier
3.02 m, boxes 1.7 m, gantry 1.6 m).
