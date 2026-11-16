# Night lighting — well lit, attractive, alive (P2-WLD-21)

After P2-WLD-19 the campus had a real night sky, but the night itself was mostly dark: lamp pools on the paving and
little else. This task audits every location at night and dusk and gives the campus a proper architectural lighting
design: layered light, a lit Agaseke, a slow animated show on the Tournament Arena and a night identity for every
hall — without real lights, without shader recompiles and within a few draw calls.

Code: `apps/web/src/world/night/` (`show.ts` timing and photocells, `rig.ts` the fixtures, `material-hooks.ts` the
shader hooks), `world/NightLights.tsx` (the instanced pools / halos / washes), `world/Fountain.tsx` (basin and jet
lights), `world/time-of-day/TimeOfDay.tsx` (the show clock), `world/Lighting.tsx` (scene fog). Evidence script:
`qa/e2e/night-lighting.mjs`. Follows the time of day (`NEXT_PUBLIC_FF_TIME_OF_DAY`); with the flag off the campus
keeps its daytime look and none of this shows.

## 1. Audit (before: 21:00 and 18:30, Standard tier, 1280 × 720)

At 18:30 the sun is ~4° below the horizon: civil twilight is almost over and the campus already reads as night (the
equatorial twilight is short), so both audit times showed the same problems.

| location | what was there | what was missing (what a real campus has) |
| --- | --- | --- |
| plaza | lamp pools, lamp diffusers, totem screens, wayfinding LEDs | benches and planters unlit (no low accents), the notice board unreadable, lamp heads with a halo but nothing on the paving between the furniture |
| fountain / Agaseke | the sculpture in the hemisphere fill only: a dark grey cone, the weave invisible; the water a flat dark disc; the jets faint | uplights grazing the woven body, underwater lights, lit jets, a glint at the lid |
| Tournament Arena | the amber LED lines, the big screen at full day brightness (glare), canopy diffusers | the perforated bronze screen and the whole upper drum dark; no light on the forecourt under the canopy; the lantern unlit |
| Pool Hall | LED lines, sign, glass panes | the dark concrete facade invisible: no facade wash |
| Ludo Lounge | LED lines, sign | the brick piers and walls dark (brick wants grazing light) |
| Igisoro Court | green LED line, white walls in fill light | no uplight on the lime walls, frieze or eaves; the lettered fascia board unlit |
| Fight Games / Boxing | red / blue lines, FIGHT GAMES and BOXING signs | the hall front either side of the sign dark; the canopy forecourt unlit |
| Administrative Block | door pool, diffusers | the limestone piers and the lettered fascia dark (unreadable), the forecourt under the canopy unlit |
| café pavilion | blue sign, interior through glass | no festoon / terrace light, the interior barely glowing |
| construction sites | static red crane boxes | safety beacons on the site gates and aviation lights on the cranes |
| arrival / entry gate, frontage | lit gate sign, canopy pools, guard posts | the basalt pylons with their Imigongo inlays dark; the forecourt bollards dark |
| campus walks, roads | walk lamps, street lights (P2-WLD-19) | benches along the walks unlit; long stretches fine (lamps every ~25 m) |
| aerial | lamp dots and pools | buildings indistinguishable: no facade light, no landmark |

No walkable area was pitch black (the P2-WLD-19 night fill and lamp pools hold), but there was nothing to look at.

## 2. Design principles

* **Layers.** Ambient (the moonlit sky fill of P2-WLD-19) → task light on the ground where people walk and gather
  (lamp pools, canopy downlights, doorsteps) → accent light that gives each building its identity (washes, grazing,
  the arena show) → the visible sources themselves (lamp heads, bulbs, fixture glints) for sparkle.
* **Colour temperature.** Walkways and heritage surfaces 2700 K (`#ffb46b`), the campus standard 3000 K (`#ffc985`),
  the Pool Hall's cooler 4000 K wash (`#ffe2c4`); accents per building in the campus' warm brand language (amber,
  chocolate; red / blue only on the Fight Games lines). No blue chrome.
* **Uplight grazing** for textured walls (brick, lime plaster, basalt, the Agaseke's coils): fixtures close to the
  wall, light running up it, scallops between fixtures — texture and relief show.
* **Downlight scallops / wall washing** for smooth or dark facades (Pool Hall), **even sign washes** for lettering
  (Admin fascia, Igisoro fascia board, notice board).
* **Glare control.** The arena's big screen drops to ~60 % at night; lamp halos stay small close up; animated light
  moves slowly and never goes dark.
* **Readability.** Every walkable area keeps at least the P2-WLD-19 fill plus pools within ~12 m; doorsteps are the
  brightest pools on each façade (doors are findable); faces near lamps read.

## 3. The rig per location (`night/rig.ts`)

| location | layer | fixtures |
| --- | --- | --- |
| plaza | task | lamp pools and heads (3000 K); every bench a low 2700 K strip pool; planter uplights (Standard) |
| | accent | totem screens spill on the paving; notice board sign light (downlight wash) + pool |
| fountain | accent | six grazing uplights on the plinth top (shader: the coils catch the light, the black motifs stay black), a glint and a soft halo at the knot; underwater spots under the Agaseke and under each nozzle (water shader, wavering with the ripples); the jets lit from the nozzles (bright at the nozzle, fading along the arc); a warm glow on the court round the basin |
| Tournament Arena | show | light rising through the perforated bronze screen, the Imigongo lozenges swelling in sequence, the roof-edge line and lantern breathing (§4); the big screen at night levels |
| | task | the canopy's downlight grid on the forecourt, ground glints and pools at the flagpoles |
| Pool Hall | accent | 4000 K downlight scallops on the hall's front shoulders, warm light up the timber fins, an even wash on the fascia band |
| Ludo Lounge | accent | 2700 K grazing up every brick pier and the lounge's brick shoulders; the giant die in a soft spot |
| Igisoro Court | accent | 2700 K uplight scallops up the white lime walls to the Imigongo frieze and the thatch eaves; the fascia board lettering lit |
| Fight Games / Boxing | show | red and blue lines pulsing slowly, half a period apart (§4); red / blue spill on the forecourt (Standard) |
| | accent | wall washers either side of the FIGHT GAMES sign, uplight on the timber slats, canopy downlight pools |
| Administrative Block | accent | calm 3000 K: grazing on the limestone piers, an even wash on the lettered fascia, the canopy's three downlight pools |
| café pavilion | accent | warm interior pool behind the glass, a terrace pool, festoon string lights along the fascia with a faint shimmer |
| construction sites | safety | amber beacons on every site gate (0.5 Hz, soft), a red aviation light on every crane |
| gates, frontage | accent | the basalt pylons grazed on both faces, canopy and forecourt pools, guard-post lights, a low light on every forecourt bollard (Standard) |
| walks, roads | task | walk lamps (2700 K), street lights (3000 K), bench strip pools along the walks (Standard) |

## 4. Animation and photosensitivity (`night/show.ts`)

* One show clock for the whole campus (`todUniforms.uGkShowT`, seconds, wraps at 840 s — every period divides it,
  so the wrap is invisible) and one motion amplitude (`uGkShowK`). The animation is client-side (each client runs
  its own clock; nothing is synced or sent).
* Periods: arena wave 12 s, lozenge sequence 20 s, breathing 7 s, Fight Games pulse 8 s, festoon shimmer 10 s,
  beacons 2 s. Every curve is sine-eased (`breath`, `wave`, `swell`): no steps, no strobing.
* **Photosensitivity:** the fastest light on the campus changes at 0.5 Hz, far under the 3 flashes / s limit of WCAG
  2.3.1. Unit tests check every mode by period and by counting flashes (Harding-style opposing transitions of ≥ 10 %)
  in every 1 s window of 10 s sampled at 60 fps, that no frame-to-frame change exceeds 5 %, and that no animated
  light drops below 25 % (a breath, never a blink).
* **Reduced motion** (`prefers-reduced-motion`) and the **Lite** tier: amplitude 0 — every animated light holds its
  static warm state. The show also only starts once the sky is dark (`lights ≥ 0.8`), fading in over the end of dusk.
* **Tournament Arena.** The perforated screen's holes (the texture's dark cells) emit the warm light of the inner
  drum. A soft band of light rises up the drum and turns round it (12 s); the Imigongo lozenges (four per panel, cells
  round the drum) swell one after another in three chases (20 s); the bronze between the holes is grazed by the amber
  line at its foot. The roof-edge line breathes (7 s), the lantern half a breath later (line + halo). Static state:
  an even warm glow through the screen.

## 5. Switch-on and transitions

* Photocell groups over the time-of-day `lights` value (P2-WLD-19 `lightsOn`): signs 0.02–0.12, lamps 0.04–0.38,
  facades 0.18–0.5, accents 0.3–0.6; each fixture gets a deterministic threshold inside its window (stable hash) and
  fades in over 0.2 (a lamp warming up). At dusk the campus lights up in a wave — signs, then street lights, then
  the facades, then the low accents — over ~10 minutes of real dusk (~1.5 s of a preset transition); at dawn the
  reverse.
* The material hooks follow the same `lights` value (`uGkNight`), so the Agaseke, the arena screen and the basin
  lights come up together with the fixtures around them.

## 6. Realism review of the transitions, and the fog

* **Dusk walk** (17:40 → 18:40 in 6-minute pins, `sheet-dusk-switch-on.jpg`) and a Midday → Night preset: the sky,
  the key light and the lights pass through every state in between; the campus switches on in its staggered wave
  (signs → lamps → facades → accents); the arena show only starts moving once the sky is dark and fades in. Nothing
  pops: every night value is a continuous function of `lights`, every hook is multiplied by it.
* **Sky banding:** none visible — the sky shader already dithers ±½ LSB (P2-WLD-19).
* **Lights all at once:** fixed — four photocell groups with per-fixture thresholds (P2-WLD-19 had one stagger
  window for every lamp, and the buildings had no lights to switch).
* **Scene fog — enabled.** The `<fogExp2 attach="fog">` in `Lighting.tsx` attached itself to the "lighting" group,
  never to the scene, so neither the haze nor the morning mist (`PlazaActivities` MorningMist sets its density) ever
  showed. `SceneFog` now installs it on the area's scene before its first frame (programs compile once with fog; the
  root scene copies it per area as before) and removes it with the area; colour per phase as before (`FogTint`),
  density = the tier's base × the morning mist × `look.fogK`. At these densities (0.00085, Lite 0.0012) it barely
  touches the campus (≈ 2 % at 200 m) and softens the far countryside (≈ 40 % at 1 km) — atmospheric perspective at
  dawn and a soft night horizon; the volcanoes keep their own haze shader (`fog: false`) so nothing is hazed twice;
  the night fixtures fade with the same density in their own shaders. Turning it on surfaced one latent bug, fixed:
  the fountain droplets' vertex shader included `fog_vertex` without an `mvPosition` (it failed to compile with fog
  on). A tour of every view at night, dusk and midday with the console watched shows no other shader error.
  Cost: +1 draw call or less, no recompiles during transitions.

## 7. Performance and stability

Measured on the isolated stack (Chrome headless, Metal, 1280 × 720, `docs/QA/evidence/p2-wld-21/perf.json`); the
baseline is main at the merge base with this task's files checked out, same stack and poses:

| view | baseline midday | after midday | baseline night | after night |
| --- | --- | --- | --- | --- |
| plaza ground, Standard | 242 | 242 | 259 | 261 |
| aerial, Standard | 285 | 286 | 287 | 290 |
| plaza ground, Lite | 193 | 196 | 194 | 199 |
| aerial, Lite | 268 | 271 | 269 | 274 |

* The night meshes cost **exactly 4 draws** (pools, halos, washes, the washes' additive twin; checked by toggling
  them in the same frame: 261 → 257). By day they are hidden (0 draws). The hooked Fight Games lines leave the LED
  colour fold (+1–2 by day); the arena screen, Agaseke, arena LEDs and big screen were their own batches already.
* **No recompiles:** the program count stays at 273 through a dusk walk and a Midday → Night preset; the night
  meshes are drawn on their first frames whatever the hour; hooks are installed before first use; the show is
  uniforms only.
* **z-scan** (`qa/e2e/zscan.mjs`, run at night): plaza 0 flat / 0 wall hits, gate 0 / 0 (the night meshes use a
  polygon offset and sit 5 cm off the walls).
* 60–61 fps in every view (desktop) and on the phone viewport (844 × 390).
* **Lite:** pools and washes only (no halos), half the walk-lamp pools, no bench / planter / bollard accents, no
  Fight Games spill, static lights (no show), the same hooks at a static level.

## 8. Not done / follow-ups

* The hall glazing (P2-WLD-20 smoked glass, door leaves, lobbies) was left to its owner; its lobby downlights and
  lit sensors already glow at night and are not duplicated here.
* Fight Games: the BOXING roof sign and FIGHT GAMES letters are lit by their own materials (fight/FacadeBoard, not
  edited); the red / blue lines pulse through the district material hooks (fight/exterior.ts not edited).
* Real-time shadows from the night fixtures (none: zero real lights by design); lamp light on avatars comes from the
  night fill only — a per-avatar warm rim near lamps would be a follow-up.
* Countryside villages and vehicles stay unlit (P2-WLD-19 follow-up).
* The show runs on each client's own clock (not synced between players; not needed for a visual show).

## 9. Evidence

`docs/QA/evidence/p2-wld-21/` (from `qa/e2e/night-lighting.mjs`, 16 Nov 2026): `sheet-night-before-a/b.jpg` and
`sheet-night-after-a/b.jpg` (plaza, Agaseke, fountain from above, arena, Pool, Ludo, Igisoro, Fight Games / café,
construction site, Admin, gate inside / outside, campus walk, car park road, aerial — 21:00, same poses),
`sheet-dusk-before/after.jpg` (18:30), `sheet-midday-after.jpg` (daytime unchanged), `sheet-dusk-switch-on.jpg`
(17:40 → 18:40), `agaseke-night-before/after.jpg`, `sheet-arena-show-frames.jpg` (the drum every 0.75 s for 9 s)
and `arena-show-aerial.jpg`, `sheet-phone-night.jpg` (844 × 390), `sheet-lite-night.jpg`, `perf.json`.
