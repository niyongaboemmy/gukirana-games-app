# Time of day — realistic, smooth transitions (P2-WLD-19)

The campus shows the real sky over Musanze: the sun and moon where they really are, the short equatorial twilight,
a starry night with the street lights on. By default it follows the real Kigali clock; a player can pick Morning,
Midday, Sunset or Night instead (only for themselves). Changes never cut: the clock runs to the new time over a few
seconds and everything — sky, sun, shadows, fog, clouds, lamps, windows — passes through the real states in between.

Code: `apps/web/src/world/time-of-day/` (model, store, sky, environment, hooks), `world/Lighting.tsx`,
`world/NightLights.tsx`, `hud/TimeOfDayChip.tsx`. Flag: `NEXT_PUBLIC_FF_TIME_OF_DAY` (`1` on, `0` off; unset = on in
development, off in production builds — off keeps the classic hand-tuned morning and hides the chip).

## 1. Site

| | |
| --- | --- |
| Place | Gukirana campus, Musanze, Northern Province, Rwanda |
| Coordinates | 1.5° S, 29.6° E, ~1,850 m (station pressure ≈ 0.81 atm) |
| Clock | CAT, UTC+2, `Africa/Kigali`, no daylight saving |
| Terrain | Virunga volcanoes to the north-west … north-east (Karisimbi, Bisoke, Sabyinyo, Gahinga, Muhabura) |

Near the equator the sun rises and sets almost vertically: day length stays 12 h 05–12 min all year, twilight is
short (civil ≈ 21–22 min, nautical ≈ 25 min more), and solar noon wanders between 11:46 and 12:16 with the equation of
time. The sun passes within 2° of the zenith in March and September and stays ≥ 65° high at noon all year.

## 2. Solar and lunar model (`solar.ts`)

* **Sun** — NOAA solar calculator (Meeus ch. 25): Julian century → mean longitude / anomaly, equation of centre,
  apparent longitude, obliquity → declination and equation of time; true solar time → hour angle → altitude /
  azimuth; standard refraction near the horizon. Accuracy ≈ 1′, sunrise / sunset ≈ 1 min.
* **Moon** — the short lunar series (Meeus ch. 47, largest terms, as in Astronomy Answers / suncalc): ecliptic
  longitude / latitude / distance → RA / Dec → local hour angle from the sidereal time → altitude / azimuth.
  ≈ 0.5°, ample for a 0.5° disc. Illuminated fraction from the sun–moon elongation; waxing / waning.
* **Stars** — local sidereal time → a world → equatorial matrix: the fixed star field turns with the real sky (it
  rises in the east, the celestial poles sit 1.5° below the north / above the south horizon).
* World axes: x east, y up, −z north (as `Lighting.tsx` always had).

Computed with the model (Kigali clock):

| date | astro. dawn | naut. dawn | civil dawn | sunrise | solar noon (alt.) | sunset | civil dusk | naut. dusk | astro. dusk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-01-15 | 04:51 | 05:17 | 05:43 | 06:05 | 12:11 (70.4°) | 18:17 | 18:39 | 19:05 | 19:31 |
| 2026-03-20 | 04:57 | 05:21 | 05:45 | 06:06 | 12:09 (88.6°) | 18:13 | 18:33 | 18:57 | 19:21 |
| 2026-06-21 | 04:47 | 05:14 | 05:40 | 06:02 | 12:03 (65.1°) | 18:05 | 18:27 | 18:53 | 19:19 |
| 2026-09-23 | 04:42 | 05:06 | 05:30 | 05:50 | 11:54 (88.7°) | 17:58 | 18:18 | 18:42 | 19:06 |
| 2026-11-15 | 04:28 | 04:53 | 05:19 | 05:40 | 11:46 (73.0°) | 17:52 | 18:14 | 18:39 | 19:04 |
| 2026-12-21 | 04:38 | 05:04 | 05:31 | 05:53 | 12:00 (68.1°) | 18:06 | 18:29 | 18:55 | 19:21 |

(So "sunrise ≈ 06:00–06:15" holds from December to April; in October–November the sun is up by 05:40 and sets at
17:50. The Sunset preset therefore uses the day's real sunset, not a fixed clock time.)

Unit tests (`solar.test.ts`) check sunrise / sunset against Musanze almanac values for six dates (±10 min), the
rising / setting azimuths, noon altitude and side (south in November, north in June), the civil twilight length,
the Kigali clock, full / new / first-quarter moons of November 2026 and the celestial pole directions.

## 3. Phases

From the sun's altitude *h* (refracted) and whether it is rising (`look.ts phaseOf`):

| phase | band | what it looks like |
| --- | --- | --- |
| night | h < −12° | stars, moon (if up), street lights and lamp halos, warm windows, dark ridges |
| dawn / dusk | −12° ≤ h < −0.83° | nautical then civil twilight: deep blue zenith, glow band on the sun's horizon, Belt of Venus over Earth's shadow opposite; lights on |
| sunrise / sunset | −0.83° ≤ h < 4° | the orange disc on the horizon, long shadows fading in / out, photocells switching |
| golden hour | 4° ≤ h < 10° (evening) | warm low sun, long shadows, peach haze and clouds (the morning equivalent counts as morning) |
| morning / afternoon | otherwise | clear highland blue, crisp shadows (the hand-tuned P1-WLD-03 morning is h = 17°) |
| midday | h ≥ 60° | high sun, short shadows, deepest blue (≈ ±2 h around solar noon here) |

Example day, 15 Nov 2026 (the evidence shots): 05:28 dawn (−3.7°), 05:47 sunrise (+1.1°), 08:00 morning (32°),
12:30 midday (70°), 17:15 golden hour (8°), 17:48 sunset (+0.5°), 18:05 dusk (−3.9°), 21:00 night (−44°, a 34 %
waxing moon 27° up in the west).

## 4. Sky (`sky.ts`)

A tuned analytic gradient sky replaces the fixed Preetham `<Sky>` (Preetham goes black ~2° below the horizon: no
blue hour, no twilight glow; and it cannot show a night sky). One draw at the far plane (`gl_Position = p.xyww`),
centred on whatever camera draws it (plaza, environment cube, hall window capture).

* zenith → horizon gradient (`pow(y, 0.42)`), a hazier strip right on the horizon;
* twilight / sunset glow: a band on the horizon toward the sun's azimuth plus a wider warm wash, following the sun
  below the horizon; Henyey–Greenstein (g = 0.78) halo round the sun;
* Belt of Venus (pink) over Earth's shadow (darker blue) on the anti-solar horizon in civil twilight;
* sun disc (≈ 0.86°, limb-darkened, HDR → it blooms), coloured by the atmospheric transmittance (§5);
* moon disc: the lit side is shaded from the *real* sun direction, so phase and terminator tilt are right for the
  date and hour; maria noise, earthshine, a soft halo; a pale daytime moon when it is up by day;
* stars: two layers of a procedural field on a 3D cell grid in equatorial coordinates (≈ a few thousand visible),
  energy-conserving anti-aliased points (≥ 1 px, constant energy: no sparkle when the camera moves), colour
  temperature variety, extinction near the horizon, a subtle twinkle (off on Lite and with `prefers-reduced-motion`),
  the Milky Way band brightening towards Sagittarius (Standard only);
* ±½ LSB dither: no banding in dark gradients;
* guarded maths: no NaN anywhere (a single NaN texel at the zenith turned the whole filtered environment black during
  development — the azimuth term is now defined everywhere).

Sky colours per phase (sRGB keyframes over *h*, linearly interpolated with smoothstep; `look.ts KEYS`):

| h | zenith | horizon | glow | fog / haze | hemisphere sky × I | clouds |
| --- | --- | --- | --- | --- | --- | --- |
| ≤ −18° | `#04070f` | `#0d1422` | – | `#111926` | `#6a7ea8` × 1.9 | `#121620` 34 % |
| −12° | `#081126` | `#1a2640` | `#27304c` | `#1b2537` | `#6f84ad` × 1.8 | `#1c2130` |
| −8° | `#112147` | `#394c72` | `#7d6378` | `#323f5a` | `#7a8eb8` × 1.45 | `#3e4058` |
| −4° | `#1f3b76` | `#76819f` | `#d98c68` | `#66718d` | `#95a5c8` × 1.1 | `#8a7a88` |
| −1° | `#2f5c9e` | `#b2a5a6` | `#ff965a` | `#a09ca4` | `#b4b6cc` × 0.78 | `#d9a28d` |
| 2° | `#4677ba` | `#dcbfa3` | `#ffad6e` | `#cabdb1` | `#cfc6c4` × 0.6 | `#f2c6a3` |
| 6° | `#5386c6` | `#e2d6c6` | `#ffcd98` | `#cdcfcb` | `#d2d4d8` × 0.5 | `#f6dfc6` |
| 12–17° | `#578dcd` | `#c6d4de` | `#fff2e2` | `#c4d2dc` | `#c9def0` × 0.56–0.6 (P2-WLD-22; was 0.45) | `#f4f6f8` |
| 40° | `#4f88cf` | `#c2d3e2` | | `#c5d3de` | `#c9def0` × 0.48 | |
| 90° | `#4a84cf` | `#c0d3e4` | | `#c6d5e0` | `#cce0f2` × 0.5 | |

Evenings are slightly warmer than mornings (dust and smoke after the day; mornings carry the cool valley mist). A
moon that is up lifts the night zenith, horizon, fog and clouds a little (up to ×2.5 at full moon) and dims the stars.

## 5. Light, units and exposure

**Pre-exposed values.** Physically, noon (≈ 100 000 lux) is ~400 000× a full moon night and ~10⁸× starlight. A
display — and a VR headset, where sudden brightness changes are uncomfortable — cannot show that, and players must be
able to walk at night. So the tables are what an eye-adapted camera records (`look.ts`):

* the 17° morning is the reference (sun 2.6; hemisphere 0.6 and environment 0.68 since P2-WLD-22 — 0.45 / 0.55 left shaded facades near black, docs/COMPOUND-REALISM.md);
* the **sun** colour comes from the real atmospheric transmittance: Kasten–Young air mass × Rayleigh optical depths at
  680 / 550 / 440 nm scaled to 0.81 atm, plus a light highland aerosol (Ångström β 0.04) — white at noon, cream in the
  morning, deep orange at the horizon. Its intensity follows the transmittance, compressed (^0.4 below the reference,
  ^0.6 above) and capped at 2.75: midday a touch brighter than morning, never blown out;
* the **moon** is a cool (`#b3c4e2`) key light of up to 0.34 × fraction^1.3 once the sky is dark;
* the **hemisphere** fill rises at night (×1.9 of a dim blue — the eye's scotopic shift), so the plaza at night is
  ≈ 10–15 % of day, blue-grey and readable, never black;
* **tone mapping stays fixed** (ACES filmic, exposure 1, both with and without the bloom composer): no exposure uniform
  is animated, so the bloom threshold (1.0) keeps meaning "real emitters only" — the sun / moon discs, LEDs, lit lamp
  diffusers and halos — and nothing else blooms at night;
* far terrain (volcanoes) is dimmed at night (`uGkFar` → 0.4) so the ridges read as dark silhouettes against the sky
  even though the near fill is raised.

**One key light.** The sun and the moon share the one shadow-casting directional light (adding or removing a light
would recompile every lit shader). Its intensity reaches zero at h ≈ −1° before it switches body at −2° (the moon only
takes over below −3°): no visible jump. Its shadow strength (`LightShadow.intensity`) fades in from 0.5° to 8°; moon
shadows are faint (≤ 0.45 × fraction) and none without a moon. The key direction never drops below 6° (lower, the
shadows would streak across the campus) while its intensity fades.

**Stable shadows.** The shadow frustum stays texel-snapped; the key light is re-aimed only when it moved ≥ 0.1° since
it last was (≈ every 25 s on the real clock — a 3 cm shift 20 m from a caster, under one 4.5 cm shadow texel), so the
shadow map never swims. During a transition it follows every frame (motion is expected then). The throttled aerial
shadow map re-renders when the light moved, and not at all when there is nothing to see (night without a moon).

## 6. What changes per phase

| asset | how | cost |
| --- | --- | --- |
| sky, sun, moon, stars | `sky.ts` uniforms | 1 draw (as before) |
| key light (sun / moon), hemisphere | colour / intensity / shadow intensity per frame | none |
| image lighting (PBR reflections) | `TodEnvironment`: sky + sun disc + sky panel + ground rendered into a 128² cube (32² Lite) and pre-filtered (`PMREMGenerator.fromCubemap` into one persistent target) — only when the sun moved ≥ 0.5° / the moon rose, every 6th frame during a transition, once at its end | 18 small draws + PMREM on those frames only |
| fog, volcano haze | fog colour; the volcano shader's haze colour `uGkHaze` and far dimming `uGkFar`; mist density from the shown hour × `fogK` | none |
| clouds | colour / opacity (white → peach → orange-pink → dark blue-grey, thinner at night) | none |
| mist banks, tree impostors, fountain spray | unlit daylight-baked materials tinted by the `unlit` colour (`tintByDaylight`, `uGkUnlit`) | none |
| street lights, plaza / walk lamps, hall doors, gate, forecourt | `NightLights`: one instanced draw of additive warm light pools on the ground + one of camera-facing HDR halos round the lamp heads (≥ a few px from the aerial view); each lamp has its own photocell threshold — a staggered wave over ~1 min of dusk, off again at dawn; hidden (0 draws) by day | +2 draws after dusk (+1 on Lite: pools only, half the walk lamps) |
| lamp diffusers (`lampHead`) | emissive intensity uniform `uGkLamp` 0.15 → 3.75 (blooms) | none |
| facade window panes (`glass`, `glassCool`: lit interior panes) | emissive multiplier `uGkWin` 1 → ~4.2 | none |
| LED signs, trims, Player of the Day, arena screen | unchanged (they are already emitters; against the dark they read brighter by themselves) | none |
| smoked hall glazing (P2-WLD-18) | its forecourt reflection is retaken when the phase settles (`invalidateCaptures("reflections")`) | one capture per phase change |
| hall window views (`rooms/OutdoorView`) | captured per settled phase (sky, sun / moon light and environment of that time), cached like before, the previous view kept up until the new one is ready | one capture per phase change while a hall is mounted |
| plaza through a hall's door (`rooms/PlazaGlimpse`) | its baked daylight × `uGkGlimpse` (daylight tint, with a warm floor from the plaza lamps at night) | none |
| hall interiors | lit by their own lights: unchanged | none |

**Merge safety.** The outdoor `StaticMerge` batches meshes by their materials' *value signature* and takes a mesh out
of the batch for good when its material's signature changes. So nothing here writes `emissiveIntensity` / `color` /
`opacity` on a plain merged material: the changing values are uniforms behind shader hooks (a hooked material is keyed
by its uuid), or live on materials that already had hooks (clouds, impostors, mist) or are outside the batch. The LED
palette colour-folds into one draw call and is deliberately left alone (a hook would split it into ~15 draws).

**No recompiles.** Every programme involved is compiled at mount: hooks are set before first use, the night meshes are
drawn (at zero brightness) on their first frames whatever the hour, the environment texture object never changes, the
light count never changes. A transition only changes uniforms.

## 7. Transitions (`clock.ts`, `store.ts`)

* The shown time is a timestamp. Picking a preset animates it from where it is to the preset time on the nearest day
  (the short way round the clock: 23:00 → Morning goes forward 9 h through dawn) over **3.5 s** (**5 s in VR**) with a
  quintic smootherstep (zero velocity and acceleration at both ends — no visible snap at the start or the end). Going
  back to "Now" runs to the moving real clock the same way.
* Everything derives from that one clock each frame, so the sky, the sun's path, shadows, the photocells and the fog
  always agree. Midday → Night passes golden hour, sunset (the disc touches the horizon), civil and nautical twilight,
  then night: an 8.5 h day in 3.5 s, with the brightness falling smoothly over ~2 s — no flash.
* In "Now" mode the clock is re-sampled once a second (the sun moves 0.004°/s), the key light re-aimed per §5.
* Captures (glass reflections, hall windows) follow the **settled** phase (no transition running, same phase ≥ 1 s):
  a transition through four phases re-captures once, at the end.

## 8. HUD

A chip at the top right beside the Stars pill: a lucide icon of the sky (Sun / Sunrise / Sunset / Moon) and the shown
Kigali time ("21:00"). It opens a PaperCard (cream in light theme, near-black glass with white text in dark): **Now in
Rwanda** (Clock icon, "21:04 in Musanze"), **Morning** 08:00, **Midday** 12:30, **Sunset** (today's sunset), **Night**
21:00 — the chosen row in the chocolate selected style (`button.prow-pick[aria-checked="true"]` in `app/paper.css`),
a radio group for screen readers, Esc / outside tap closes. A test scrubber (any minute, instant) appears in
development builds or with `?tod=1`. All text from `world/time-of-day/strings.ts` (keys `hud.time.*`), no emojis.
The choice is per device (`localStorage gk.timeOfDay`, every access in try/catch; a broken or blocked storage falls
back to "Now"), client side only: no server, game or economy effect.

Dev hook (not in production): `window.__gkTod.pin(minutes, instant)`, `.preset(name, instant)`, `.state()`.

## 9. Performance per tier

Measured on the QA stack (Chrome headless, Metal, 1280×720, Standard tier, bloom off by the performance monitor),
whole-frame draw calls at the plaza ground pose (`qa/e2e/time-of-day.mjs`, avenue end looking north) and the campus
aerial pose. Baseline before this task: ground 243, aerial 281.

| phase | ground | aerial |
| --- | --- | --- |
| dawn (lights on) | 252 | 279 |
| sunrise | 240 | 279 |
| morning | 238 | 277 |
| midday | 236 | 277 |
| golden hour | 241 | 279 |
| sunset | 243 | 279 |
| twilight | 238 | 279 |
| night | 239 | 279 |

(Ground varies ±8 with the people walking through the view; the night meshes add 2 draws, the removed drei
`<Environment>`'s per-frame overhead and the shadow-pass skip at night offset them.) Lite: simpler sky (no Milky Way),
no twinkle, a 32² environment cube, light pools only (no halos) and half the walk-lamp pools. In XR: no post
processing (as before), slower transitions, no flashes.

## 10. For P2-WLD-18 / other consumers

* `onTimePhaseChange(cb)` (`world/time-of-day/store.ts`) — called with the new phase when it settles.
* `useTimeOfDay(s => s.settledPhase | s.phase | s.label | s.mode)` — zustand store.
* `tod` — the per-frame sample (sun / moon / key directions, `look` with every colour and intensity, star matrix).
* `todUniforms` (`hooks.ts`) — shared uniforms (`uGkLamp`, `uGkWin`, `uGkHaze`, `uGkFar`, `uGkUnlit`, `uGkGlimpse`),
  `emissiveByTime()`, `tintByDaylight()`, `glimpseByTime()`.
* The driver calls `invalidateCaptures("reflections")` on each settled phase change.

## 11. Not done / follow-ups

* Night ambience audio (crickets, fewer birds) and day/night crowd behaviour are not part of this task.
* Car headlights / lit vehicle interiors, lit house windows in the countryside villages.
* The smoked hall glazing shows no interior glow at night by design (P2-WLD-18: ~5 % transmission); a faint warm
  emissive band could be added there by its owner via `todUniforms.uGkWin` if wanted.
* ~~The scene-level `fogExp2` declared in `Lighting.tsx` attaches to the `lighting` group, not the scene~~ — fixed in
  P2-WLD-21: the scene fog is installed on the area's scene (docs/NIGHT-LIGHTING.md §6). The night lighting itself
  (washes, accents, the Agaseke, the arena show) is documented there.

## 12. Evidence

`docs/QA/evidence/p2-wld-19/` (from `qa/e2e/time-of-day.mjs` on an isolated stack, 15–16 Nov 2026):
`sheet-plaza.jpg` / `sheet-aerial.jpg` (the same plaza ground view and campus aerial view at dawn 05:28, sunrise
05:47, morning 08:00, midday 12:30, golden hour 17:15, sunset 17:48, dusk 18:05, night 21:00), `sheet-strip.jpg`
(a Midday → Night preset transition, one frame every ~0.5 s), `hud-*` (chip and menu, desktop 1280×720 and phone
844×390), `sheet-hall.jpg` (Pool Hall at 11:00 and 21:00: the window view follows the time, the interior keeps its
own light), `plaza-night-lite.jpg` (Lite tier), `results-last-run.json`. z-scan of the plaza (`qa/e2e/zscan.mjs`):
0 flat and 0 wall z-fighting hits.

Lite tier draw calls (same poses): ground 191–192, aerial 262–264 at every phase.
