# Compound realism (P2-WLD-22)

Whole-campus realism audit and fixes, by the senior 3D/VR environment designer role. The gap list, method and
severities are in [QA/compound-realism/audit.md](QA/compound-realism/audit.md); the evidence (contact sheets per area
and time, desktop and phone, and the perf JSON) is in [QA/compound-realism/](QA/compound-realism/).

## Summary

The campus was well built but read as **empty, new and slightly flat**: nobody about unless players were online,
every wall one even value, flower beds turning into black smudges, flat green hedges and lawns, a washed-out volcano
backdrop, near-black shade, crude parked cars and an empty sky. Three rounds of audit → fix → re-shoot addressed the
high and medium gaps with procedural, licence-clean changes (no downloads):

| Area | What changed |
|---|---|
| Life | Ambient campus people (`world/CampusLife.tsx`, `world/campus-life.ts`): strollers between the hall doors, the fountain, the notice board, the water point, the viewpoint and the café; walkers on the three district walks; two friends talking on the fountain court; a person waiting at the bus stop. Same human models as the players, no name tag, not clickable, never in a hall. Moving traffic on Musanze Road: moto-taxis with green-helmeted riders, cars and a minibus, right-hand traffic. |
| Wildlife | `world/Wildlife.tsx`: black kites circling in thermals, a weaver flock crossing, butterflies over the beds, moths at the plaza lamps after dark. One instanced draw per kind, all motion in the vertex shader. |
| Sound | Night crickets (synthesised) after dusk, a road rumble by Musanze Road, no bird calls at night. |
| Materials / weathering | `world/weathering.ts` on the masonry, render, board, roof, thatch, paving and hedge materials: world-space macro breakup, a red-earth splash band at the foot of every wall (also grounds it like a contact shadow), faint rain streaks; leaf clumps on the clipped hedges. Same hook on the Fight lobby walls / floor and the Pool Hall micro-cement floor. |
| Vegetation | Flower and banana atlases bled (no black alpha fringes); plant cards and tree leaves lit from both faces (back faces were flipped to the ground and rendered black). Jacaranda avenue in violet bloom along the district walks, eucalyptus clumps and a eucalyptus windbreak inside the compound wall, acacias kept for the car parks; campus trees cast shadows; low shrub drifts on the north lawn (the volcano view stays open). |
| Lawn | Terrain shader: lusher / drier patches, a slight desaturation and faint mowing stripes on the campus lawn. |
| Horizon | The Virunga about 18 % taller and with less aerial haze (k 0.00046 → 0.00031, desaturation 0.45 → 0.35): a real backdrop by day, unchanged silhouettes at dusk and night. |
| Lighting | Daytime sky fill raised (hemisphere 0.45 → 0.6, environment 0.55 → 0.68 at the 17° morning; midday 0.65 / 0.7), so shade is dark, not black. Dark board-formed concrete a little lighter (#6f6c68 → #8a857e). |
| Set dressing | New parked-car model (extruded profile, glass house, arches, hubs, lamps, yellow rear plate), a minibus for the road. |
| Bugs | Crane hoist ropes thick enough to stay a continuous line and the crane lattices no longer cast streaky aliased shadows across the plaza. The ground seen through the Ludo / Pool windows is a mown-lawn texture and goes dark at night (it was a flat bright-green disc, bright at night too). |

## Decisions

1. **Ambient people, not bots.** They are scenery driven by the wall clock (identical on every screen), never listed,
   never clickable, never in halls, never near stakes (SRS FR-MM-03 / FR-REV-X1 stay true). No people were seated at
   hall game tables: they would read as opponents.
2. **Flag.** `NEXT_PUBLIC_FF_COMPOUND_LIFE=0` removes the people, the traffic, the wildlife and the road sound (the
   campus as before). Weathering, vegetation, horizon and lighting changes are visual polish, not behaviour, and are
   not flagged.
3. **Budget first.** Each person is ~20 draw calls (skinned body, clothes, hair, eyes), so at most 6 are drawn at
   once (3 on Lite), the nearest in view within 48 m (32 m Lite); shadows only within 16 m; hidden from high cameras.
   Weathered materials share one hook key so they keep colour-folding into the same static batches (separate keys
   cost +100 draw calls in round 2).
4. **No SSAO.** A screen-space AO pass was considered for contact shadows; the foot-of-wall weathering band plus the
   existing blob decals give most of the grounding at no cost on phones.
5. **Jacaranda from the acacia model.** Same fern-like leaves and spreading habit; violet tint in the shader. No new
   download.
6. **Lite path.** Lite keeps 3 people, half the traffic, kites only (no flock, butterflies or moths), no rain streaks.
   Reduced motion: no butterflies or moths.

## Performance (headless Chrome, M2 Pro, standard tier)

| viewport | time | area | draw calls before → after (median / max) | triangles before → after (median) | fps before → after (min) | texture MB after |
|---|---|---|---|---|---|---|
| desktop | 08:00 | campus (aerial) | 302 / 302 → 321 / 321 | 2.20M → 2.23M | 61 → 61 | 256 |
| desktop | 08:00 | campus (eye level) | 188 / 278 → 207 / 296 | 1.09M → 1.22M | 51 → 60 | 256 |
| desktop | 13:00 | campus (aerial) | 286 / 286 → 311 / 311 | 2.20M → 2.23M | 61 → 61 | 261.6 |
| desktop | 13:00 | campus (eye level) | 167 / 260 → 188 / 284 | 1.08M → 1.22M | 60 → 61 | 261.6 |
| desktop | 13:00 | fight | 50 / 68 → 51 / 82 | 0.04M → 0.03M | 60 → 37 | 368.4 |
| desktop | 13:00 | igisoro | 132 / 152 → 122 / 146 | 0.38M → 0.37M | 61 → 60 | 379.1 |
| desktop | 13:00 | ludo | 115 / 136 → 121 / 142 | 0.36M → 0.36M | 18 → 49 | 379.4 |
| desktop | 13:00 | pool | 131 / 143 → 131 / 146 | 0.36M → 0.36M | 61 → 60 | 360.6 |
| desktop | 18:30 | campus (aerial) | 290 / 290 → 319 / 319 | 2.20M → 2.23M | 61 → 61 | 261.2 |
| desktop | 18:30 | campus (eye level) | 176 / 263 → 191 / 289 | 1.10M → 1.21M | 60 → 61 | 261.2 |
| desktop | 21:30 | campus (aerial) | 304 / 304 → 315 / 315 | 2.20M → 2.23M | 60 → 61 | 255.7 |
| desktop | 21:30 | campus (eye level) | 190 / 276 → 191 / 286 | 1.09M → 1.22M | 60 → 60 | 255.7 |
| desktop | 21:30 | fight | 51 / 69 → 50 / 81 | 0.03M → 0.02M | 56 → 55 | 368.8 |
| desktop | 21:30 | igisoro | 124 / 144 → 134 / 158 | 0.37M → 0.37M | 41 → 39 | 379.1 |
| desktop | 21:30 | ludo | 125 / 129 → 115 / 136 | 0.36M → 0.36M | 60 → 61 | 379.4 |
| desktop | 21:30 | pool | 133 / 145 → 131 / 146 | 0.36M → 0.35M | 41 → 61 | 360.6 |
| phone | 13:00 | campus (aerial) | 292 / 292 → 323 / 323 | 2.21M → 2.24M | 60 → 61 | 255 |
| phone | 13:00 | campus (eye level) | 176 / 268 → 220 / 313 | 1.13M → 1.31M | 61 → 60 | 255 |
| phone | 13:00 | fight | 52 / 68 → 53 / 69 | 0.02M → 0.03M | 55 → 47 | 386.4 |
| phone | 13:00 | igisoro | 124 / 142 → 128 / 150 | 0.36M → 0.37M | 61 → 61 | 380.3 |
| phone | 13:00 | ludo | 118 / 124 → 116 / 135 | 0.36M → 0.36M | 49 → 58 | 380.6 |
| phone | 13:00 | pool | 138 / 145 → 141 / 151 | 0.37M → 0.36M | 40 → 58 | 361.8 |
| phone | 21:30 | campus (aerial) | 308 / 308 → 325 / 325 | 2.21M → 2.23M | 60 → 61 | 254.6 |
| phone | 21:30 | campus (eye level) | 192 / 282 → 204 / 299 | 1.11M → 1.23M | 60 → 60 | 254.6 |

Per pose: [QA/compound-realism/perf.json](QA/compound-realism/perf.json) (`qa/e2e/compound-realism.mjs`, fixed
poses, whole-frame `renderer.info` median over 1.5 s: shadow and post passes included).

- **fps:** the plaza holds 60 fps at every campus pose, desktop 1280×720 and phone 844×390 at DPR 2. The dips in the
  halls (37–49) are the first frames after the hall loads (the second pose of each run); the baseline shows the same
  (Ludo 18 before).
- **Draw calls:** eye level +15…+45 (the nearest ≤ 6 ambient people, shadow-casting campus trees, traffic, wildlife);
  the worst campus pose is 296 desktop / 313 phone (the forecourt with people, trees and bloom off), the campus aerial
  311–325 (286–308 before). Halls unchanged within noise.
- **Triangles:** eye level about +0.13M (people and campus trees near you), 1.21–1.31M median; the campus aerial was
  already 2.2M before (the farmland and countryside; unchanged by this task).
- **Textures:** +50 MB on the campus estimate is mostly the human models' textures now that people are about (they
  stream in after the first view anyway for other players); no new texture files.


## What's left

| Gap | Why left | Cost to close |
|---|---|---|
| Campus aerial over 300 draw calls / 2.2M triangles (before and after) | Countryside and farmland, out of this pass | 1–2 days: impostor / merged far farmhouses and trees, coarser far terrain LOD |
| Phone forecourt pose 313 calls | People + trees + the forecourt planting at once | 0.5 day: fewer people on phones (MAX_SHOWN 4), campus-tree shadows only on desktop |
| A thin dotted vertical line in the sky at midday from a few plaza poses (also in the baseline) | Not found by bisection in the time; not a world object hit by bounds tests (sub-pixel, time-of-day dependent) | 0.5 day with a GPU id-pick pass |
| World signs with hard-coded English (plot boards, help desk, totem map) and a blue map dot | Text belongs to their own tasks; noted for the i18n sweep | 0.5 day |
| Pool Hall exterior LED and name in the game blue | The game colour is a product decision (DESIGN-SPEC §5.3) | 1 h if the brand calls for warm-only signage |
| No people inside the halls, no hall staff beyond what exists | Seated strangers at game tables would read as opponents (no bots near stakes) | n/a by design; a barista / cleaner per hall ≈ 1 day |
| Close-up tree LOD0 (car-park acacias) look coarse at 2 m | Poly Haven LOD0 is thinned for performance | 1 day: a denser LOD0 or a closer-range crown card set |
| Screen-space AO | Cost on phones | 0.5 day to add N8AO on desktop standard only, behind the performance monitor |
| Weathering tuned by eye per material family | One shared key keeps batching | 0.5 day: per-family keys where batching allows |


## Off-limits areas (P3-FGT-18)

Not touched: `world/human/**`, `fight/BoxingHallScene.tsx` and the ring, `fight/present.ts`, `fight/camera.tsx`,
`fight/game/*`. Gaps noticed there: from the Fight lobby the Boxing doorway and its glimpse were not changed. No new gaps were measured inside the Boxing
hall (its interior was not shot, by scope). The ambient people use the same human bodies as the players, so any body or
skin issue there (P3-FGT-18) shows on the campus people too.
