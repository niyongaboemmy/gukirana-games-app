# Compound realism audit (P2-WLD-22)

Role: senior 3D/VR environment designer. Scope: the whole campus (plaza, fountain, halls' exteriors, gate, frontage,
walks, lawns, sky / volcano backdrop, life, sound, time of day) plus the Ludo Lounge, Igisoro Court, Pool Hall and
Fight Games lobby interiors. Not in scope (another agent, P3-FGT-18): the Boxing hall interior, its lighting, the
ring, `world/human/**`; gaps seen there are listed at the end only.

## Method

`qa/e2e/compound-realism.mjs` (puppeteer, headless Chrome, Metal) pins the Kigali clock (`__gkTod`), the plaza camera
(`__gkPlazaCam`) and the hall camera (`__gkRoomQA.cam`), hides the HUD and shoots 19 campus poses (eye level at every
hall front, the fountain, the court, the gate, the forecourt, Musanze Road, the car park, a district walk, the outer
promenade, the volcano view; two aerials) and 5 poses per interior (door, corner, far corner, high, low). Desktop
1280×720 and phone 844×390 at DPR 2; 08:00, 13:00, 18:30 (dusk) and 21:30 (night). Each pose records draw calls,
triangles, fps and the uploaded texture megabytes (`perf-*.json`).

Contact sheets (this folder): `sheet-campus-<viewport>-<hhmm>.jpg` and `sheet-halls-<viewport>-<hhmm>.jpg`, each row a
pose, **left = before (round 0), right = after (final round)**, in the pose order of `qa/e2e/compound-realism.mjs`.
Pose names below refer to those rows. Per-pose numbers: `perf.json`.

Severity: **high** = seen at once by every visitor, breaks the illusion; **med** = noticed on a second look or in one
area; **low** = polish.

## Gap list

| # | Category | Where | Gap (round 0) | Sev | Fix proposed | Status |
|---|---|---|---|---|---|---|
| G01 | materials / bug | every flower bed, planter, forecourt bed | Flower and groundcover cards render with **black fringes**; from 10 m on whole beds read as dark smudges (`desktop-1300-forecourt`, `spawn-north`). Cause: the procedural canvas atlas is premultiplied, every transparent texel is black and bleeds in through filtering and mips. | high | Bleed colour into the transparent texels (padding) before upload (`world/alpha-bleed.ts`); same for the banana leaf atlas. Round 1 showed the real cause of most of the black: the double-sided cards' back faces had their normals flipped to the ground, so the cards were lit from below. Both faces are now lit as foliage. | fixed R1–R2 |
| G02 | life | whole campus | **Nobody is there** unless other players are online: an empty plaza, empty walks, an empty road. Only the gate guard and parked moto riders. | high | Ambient campus people (strollers between doors, fountain, notice board, café; walkers on the district walks; two friends talking; a person at the bus stop) on the existing human models, wall-clock driven, flag `NEXT_PUBLIC_FF_COMPOUND_LIFE`. Moving traffic on Musanze Road (moto-taxis with riders, cars, minibuses). | fixed R1 |
| G03 | weathering | every facade, planter, wall, kerb | Everything is **evenly new**: one flat value over a 40 m wall, nothing at wall feet, no streaks; tiling repeats visible on long walls. | high | World-space weathering hook (`world/weathering.ts`): macro tone breakup, a red-earth splash / dirt band on the foot of vertical faces (also grounds every wall like a contact shadow), faint rain streaks. No textures, no draws. | fixed R1 |
| G04 | vegetation | campus lawns, walks, north corridor | Only acacias inside the compound (the savanna tree of eastern Rwanda, not the Musanze highlands); large lawns and the growth band are bare; no jacaranda (in bloom in November). | high | Jacaranda avenue along the district walks (acacia crown model re-tinted violet: fern-like leaves, the right silhouette), eucalyptus clumps on the lawns and a eucalyptus windbreak inside the compound wall (the Musanze field-edge tree), acacias kept only in the car parks. | fixed R1 |
| G05 | horizon | volcano view, aerials, every northern sightline | The Virunga read **small and washed out** by day (≈ 60 % haze at 2 km, half desaturated): from the plaza they are a pale grey band, the defining Musanze backdrop is lost. | high | Less aerial haze on the volcanoes (k 0.00046 → 0.00031), a little more height (≈ +18 %), still within the photographed angular size. | fixed R1 |
| G06 | materials | forecourt, frontage verges | **Hedges are flat green boxes** (plain `#2f6b33`, no texture / breakup); road verges flat saturated green. | med | Procedural leafy hedge texture + bump, weathered (macro variation, darker base). | fixed R1 |
| G07 | materials | campus lawns (aerial, district walks) | The lawn is one **neon, uniform green** from the air. | med | Lawn macro variation in the terrain shader: lusher / drier patches, a slight desaturation, faint mowing stripes. | fixed R1 |
| G08 | lighting | every shaded facade (Igisoro porch, Pool hall, Fight lobby front) | Shade is **near black** at midday: daylight fill (hemisphere 0.45–0.5, env 0.55) too low for an equatorial sky at 1,850 m. | med | Daytime fill raised (hemisphere ≈ 0.62, environment ≈ 0.7 at sun ≥ 17°); key unchanged; dusk / night unchanged. | fixed R1 |
| G09 | set dressing | car parks, road | Parked **cars are crude boxes** (no bonnet, windscreen or roof shape; flat wheels). | med | New car model (extruded side profile with bonnet / screen / roof / boot, glass house, wheel arches, hubs, lamps) and a minibus (Rwandan "twegerane") for the road. | fixed R1 |
| G10 | life | sky | **Empty sky**: no birds except the pigeons on the court. | med | Black kites soaring in thermals, a weaver flock crossing, butterflies over the beds, moths at the lamps after dark (one GPU-animated instanced draw each). | fixed R1 |
| G11 | sound | night campus, frontage | Night is silent apart from wind; no road sound at the frontage. | med | Night bed: crickets and tree frogs (synthesised, after dusk), a distant road / moto murmur by Musanze Road. | fixed R2 |
| G12 | consistency / bug | Ludo Lounge, Pool Hall windows | The ground seen through the hall windows is a **flat bright green disc** (a plain district-ground stand-in), and it stays bright green at night. | med | Mown-lawn texture, dark after dusk. | fixed R2 |
| G13 | materials | Pool Hall floor | Plain flat light floor between the table rugs (no grain, reads as a placeholder). | low | World-space trowel clouding / tone breakup on the micro-cement (weathering hook). Fight lobby walls and floor got the same worn-in breakup. | fixed R2 |
| G14 | set dressing | north view corridor, growth band | 100 m of empty mown lawn north of the arena. | med | Windbreak and clumps beside the corridor (not in it: the volcano view stays open). | fixed R2 (shrub drifts; view kept open) |
| G15 | consistency | signs | World signs with hard-coded English (`HALL PLOT n COMING SOON`, `HELP DESK · CAFE`, the totem map's "You are here") and a blue fountain dot on the welcome map. | low | Move to `W` strings / i18n keys; warm the map dot. | open (noted) |
| G16 | life | halls | Halls are empty of other guests unless players are in; seating NPCs at game tables would read as opponents (no bots near stakes). | low | Not done on purpose (see COMPOUND-REALISM.md). | won't fix |
| G17 | lighting | plaza floor | No ambient occlusion where benches, planters and walls meet the paving (only the blob decals). | med | The weathering foot band darkens the vertical side; a screen-space AO pass was evaluated and not added (cost on phones). | partly |
| G19 | bugs | plaza floor near the inner construction plots, sky | Tower-crane lattices and 8–12 mm ropes cast **streaky, aliased shadows** across the plaza; the ropes broke up into dots. | med | Ropes 22–30 mm in a non-shadow-casting dark metal; crane lattice (`paint-yellow`) casts no shadow. | fixed R2–R3 |
| G20 | bugs | sky, a few plaza poses at midday | A **dotted vertical line** in the sky (`court-east`, `spawn-north` right edge) at 13:00, not at 08:00; present in the baseline. Not the crane rope (still there after G19), not the Go To beacon (suppressed), not hit by a bounds scan. | low | GPU id-pick pass to name it. | open |
| G21 | perf (regression found in R2) | everywhere | Round 2 cost +100 draw calls: different weathering keys stopped materials colour-folding into the same static batches; ambient people were not culled (their meshes are never frustum-culled one by one). | high | One shared weathering key for masonry / render / board; people culled per person (view + 48 m), at most 6 drawn, shadows within 16 m, hidden from high cameras. | fixed R3 |
| G18 | transitions | Fight lobby "far" pose | The far-corner camera of the audit lands outside the lobby (it is a narrow foyer); not a game bug. | — | Audit pose only. | n/a |

## Rounds

- **R0** baseline: desktop 08:00 / 13:00 / 18:30 / 21:30 campus, desktop 13:00 / 21:30 halls, phone 13:00 / 21:30 campus,
  phone 13:00 halls.
- **R1** weathering, flower bleed, campus life, wildlife, trees, volcano, fill light, cars, hedges, lawn → re-shot
  13:00 campus: beds still partly black (G01 root cause), cars better, people present.
- **R2** foliage normals, leaf lighting, jacaranda tint, dark concrete, shrubs, window lawn, crane ropes, sound, Pool /
  lobby floors → re-shot 13:00 + 21:30: visuals right, +100 draw calls (G21).
- **R3** shared weathering key, people culling and cap, crane lattice shadows, fewer shrubs, wildlife templates parked
  (zscan) → final full matrix (`perf.json`, sheets).

## Off-limits areas (reported, not touched)

- Boxing hall / fight code was not changed. From the Fight Games lobby the boxing doorway shows the hall's warm-up
  state only; nothing new was seen there in this audit (its interior was not shot: it is another agent's area).
