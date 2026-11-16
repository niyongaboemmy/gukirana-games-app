# Fighter v8: design spec for the implementer (P3-FGT-19A → P3-FGT-19B)

Status: design prototype done (dev only). P3-FGT-19B builds the game assets from this spec. Nothing in the game's
runtime boxer code was changed by P3-FGT-19A.

The user's verdict on v7 was "persons are not real, … not normal persons". After the first v8 drafts they added "still
not accurately designed a person/human, even for the clothing; clothes are not realistically designed". So v8 changes
the method as well as the numbers:

- the garments are **simulated from sewing patterns** instead of being sculpted;
- the body gets a **regional anatomy pass and a skin bake** (pores, colour zones, veins, roughness break-up);
- the face gets **lashes, brow hair and athlete face targets**;
- everything is judged in **path-traced renders** against written reference situations.

Sheets (best first): `01-hero-guard.jpg`, `04-guard-side-broadcast.jpg`, `06-closeups.jpg`, `02-turnaround-male.jpg`,
`03-turnaround-female.jpg`, `05-jab-hook.jpg`, `07-skin-tones.jpg`, `08-colour-materials.jpg`,
`09-weight-classes.jpg`, `10-sewing-patterns.jpg`, `iterations/01-v7-vs-v8.jpg` (v7 → sculpted-cloth draft →
simulated cloth), `iterations/02-gloves-before-after.jpg` (the glove fix).

Prototype code (dev only, never shipped): `qa/fighter-v8/` (see §13 for how to rebuild). Reusable source assets:
`apps/web/scripts/boxer/source-v8/` (§12).

## 1. Research highlights (sources in §14)

### Anthropometry by weight class (adult athletes, 18+)

| Class | Stature | Mass | Body fat | Notes |
| --- | --- | --- | --- | --- |
| Male welterweight (63.5–67 kg) | 1.74–1.78 m | 66 kg | 8–10 % | England internationals 9–10 % [S7]; Cuban Olympic boxers under 75 kg are ectomorphic mesomorphs [S5]; Olympic male mean 1.76 m [S8] |
| Male heavyweight (86–92 kg) | 1.85–1.90 m | 90 kg | 12–15 % (unverified for amateurs) | Heavyweight champions: 1.87 m, chest 109 cm relaxed, biceps 39.8 cm, forearm 33.3 cm, waist 87.9 cm (pro data) [S4] |
| Female lightweight (57–60 kg) | 1.63–1.66 m | 57.5 kg | 18 % | Korean national team, lightweight group: 1.63 m, 57.5 kg, 18.4 % fat, BMI 21.6 [S3] |
| Female middleweight (70–75 kg) | 1.70 m | 73.8 kg | 23 % | Korean national team, middleweight group: 1.70 m, 73.8 kg, 22.8 % fat, BMI 25.5 [S3]; Olympic women 1.68 m [S8]; elite women about 17 % fat [S14] |

High-level boxers of both sexes tend to low body fat and high mesomorphy [S6].

### What reads as a real boxer at broadcast distance

Ranked by the order the eye picks them up:

1. A thick neck sloping into the upper trapezius.
2. A rounded deltoid cap past the acromion.
3. Lats that widen the back under the arm hole.
4. A waist only a little narrower than the hips: WHR ♂ 0.83–0.88, ♀ 0.70–0.75. A pinched waist reads as a mannequin.
5. Forearm flexor mass in the upper third of the forearm.
6. Calves with the medial gastrocnemius head lower than the lateral.
7. The vastus medialis teardrop above the knee.
8. Serratus slips are only visible lean and close up.

From docs/FIGHT-REALISM-V7.md (R9, R10) and art anatomy; there is no single game source that ranks these
**(unverified)**.

### The kit: IBA Technical & Competition Rules, 15 April 2026 [S1]

**Uniform (49.3).**

- Men wear a vest and shorts; women wear a vest and shorts or a skirt.
- The shorts are not shorter than mid-thigh, never cover the knee, and are never worn above the belt line.
- Colours are solid red (Pantone 185, 199 or 485) or blue (Pantone 286, 293 or 661).
- The belt line is a contrasting colour, **6–10 cm wide**, running from the navel to the top of the hips, and must
  not cover the navel.
- No tape on the uniform.

**Gloves (45).**

- Elite and youth men: 10 oz from minimum weight to 67 kg, 12 oz from 71 kg up. IBA-owned events may use 8 oz / 10 oz.
- Women: 10 oz in every class.
- Weights 227 / 284 / 340 g, ±5 %.
- Velcro closure, covered by **one layer of 5 cm glove tape**.
- The thumb is fixed to the glove body by its top, with a gap of 10 mm or less.
- Logo areas are limited.

**Headguard (46).**

- Not used in IBA elite (men and women since 1 June 2024); worn in all other IBA competitions, red or blue.
- At most 450 g, four sizes, Velcro closure, **padding at least 2–3 cm**.
- No restriction on hair length; long hair must be tied. Without a headguard, hair below the neckline needs a net.

The game keeps headgear: the amateur and grassroots look, and the brief.

**Bandages (47.1.4).** 2.5–4.5 m long, **5.7 cm wide**, stretch cotton.

**Elite professional wraps (47.2).** 5 cm gauze plus 2.5 cm zinc-oxide tape. The tape never covers the knuckles.

**Other (49.4, 49.5).**

- Boxing footwear without spikes or heels. Socks no higher than the knee.
- A gumshield is mandatory and must not be red.
- A beard or moustache is allowed up to 10 cm, as long as it does not cover the neck (4.4.5).

### Stance and guard

- Coaching sources put the weight split anywhere from 50 / 50 to 55 / 45 rear-heavy, and some put it front-heavy.
  None of this is peer-reviewed **(unverified)**.
- Stance width is shoulder width or a little wider.
- Trunk rotation drives the straight punches (Chulalongkorn thesis).
- The fundamentals as v7 recorded them (R7):
  - torso bladed 30–45°;
  - knees soft;
  - chin behind a raised lead shoulder;
  - elbows over the ribs;
  - gloves at the cheekbone or brow;
  - rear heel up.

### Skin under arena light

- Skin specular is a dielectric reflection at the oil–air interface: IOR ≈ 1.4, F0 ≈ 0.028. Its parameters vary with
  age, sweat and makeup more than with skin type [S10].
  - Rule: use the **same specular for every tone**.
  - Deep skin reads real when its highlights stay bright and slightly cool while its albedo stays warm. It reads
    "ashy" or grey when the albedo is desaturated or a grey fill lifts the shadows.
- Pipelines tuned for light skin over-lighten dark skin. Frontal flat light makes it worst [S11]. Hence the
  broadcast key from above, the deep falloff, and no flat front fill.
- Practitioners tint melanin with a mask between a base tint and a melanin tint, never a flat multiply [S17].
- Sweat:
  - EA UFC 5 uses a dual-lobe skin shader, and sweat and blood bead and roll on it [S12].
  - Fight Night Champion sold sweat with a roughness break-up (HUMAN-REALISM-VR-RESEARCH.md [10]).
  - The v8 prototype uses a patchy clearcoat (forehead, chest centre, shoulders and traps, upper back, forearms) that
    rises with the rounds.

### Faces under headgear

- A lean face:
  - cheek volume down;
  - cheekbones up;
  - a firm, square jaw;
  - head fat down.
- Brows sit at the headgear's opening edge, so they must read: brow hair, not a painted smudge.
- Lashes are mandatory for a "person" read up close; without them the eye reads as a doll's.
- Mid-fight:
  - slight puffiness under the eyes and on the cheekbones;
  - the mouthguard pushes the lips forward a few millimetres;
  - effort shows as a lowered, knitted brow, narrowed eyes and a clenched jaw.

### How shipping fighting games get believable athletes

| Title | Method |
| --- | --- |
| EA UFC 5 (Frostbite) | Dual-lobe skin and eye shading, strand hair, new facial animation ("Facerig": winces, an eye closing under damage), 8 damage regions × 5 levels [S12] |
| Undisputed (Steel City) | Every boxer scanned (Ten24 among the partners), then sculpted ("every muscle, vein, hair, and bead of sweat"); legends de-aged by sculpting; mocap for footwork, punches, slips and taunts [S13] |
| Fight Night Champion / Round 4 | Skin shader cost trade-offs (GDC 2010), muscle flex in blended normal maps (HUMAN-REALISM-VR-RESEARCH.md [8]–[10]) |
| Creed VR, Thrill of the Fight | Stylised or basic fighters: the VR titles accept stylisation (same doc [16][17]) |

Our bar is above the VR titles and below a scanned AAA pipeline. The scan is the one thing a browser-only toolchain
cannot replace (§11).

## 2. Target proportions (bind pose, measured by `measure.mjs`)

The prototype's own audit output (`node qa/fighter-v8/measure.mjs`):

| Measure | Male welter | Male heavy | Female light | Female middle | Target / tolerance |
| --- | --- | --- | --- | --- | --- |
| Stature (m) | 1.76 | 1.87 | 1.65 | 1.70 | ±0.005 |
| Heads tall | 7.91 | 8.05 | 7.53 | 7.69 | 7.3–7.9. The heavy head is 3 % small: add `head-scale-*-incr` 0.1 |
| Chin–notch / H | 0.053 | 0.050 | 0.054 | 0.053 | 0.050–0.056 |
| Neck girth (m) | 0.41 | 0.48 | 0.40 | 0.46 | ♂ ≥ 0.40, ♀ 0.36–0.42 |
| Bideltoid / H | 0.351 | 0.347 | 0.313 | 0.311 | ♂ 0.34–0.36, ♀ 0.30–0.32 |
| Chest girth (m) | 1.03 | 1.06 | 0.89 | 0.93 | ♂ welter 0.98–1.05, heavy 1.05–1.12 |
| Waist girth (m) | 0.79 | 0.87 | 0.69 | 0.72 | heavy ≈ 0.88 [S4] |
| Hip girth (m) | 0.96 | 0.99 | 0.93 | 0.95 | — |
| **Waist-to-hip** | **0.83** | **0.87** | **0.75** | **0.75** | ♂ 0.83–0.88, ♀ 0.70–0.76 |
| Upper arm, mid (cm) | 35.7 | 39.4 | 30.2 | 32.7 | heavy ≈ 39.8 [S4] |
| Forearm, proximal (cm) | 26.5 | 29.2 | 24.9 | 26.7 | heavy ≈ 33 (pro) |
| Thigh, upper (cm) | 54.8 | 55.9 | 50.4 | 52.7 | — |
| Calf, max (cm) | 33.4 | 37.2 | 31.6 | 35.4 | — |

How the prototype gets there (`qa/fighter-v8/lib/body.mjs`; the target lists are exported to
`source-v8/shape-targets.json`):

- MakeHuman macro: muscle 0.9–1.0, weight 0.38–0.6, proportions 1, age 25–27 years, ethnic mix african 0.8.
- Regional targets: v-shape, dorsi, pectoral, stomach tone, neck, waist circumference, deltoid, arm, forearm, thigh
  and calf muscle.
- Face targets: cheekbones up, cheek volume down, head fat down, jaw and chin; for women, thinner lips and narrower
  nostrils.
- **Our sculpt layer.** 14 anisotropic volumes anchored to the joints, pushed along the normal and limited by skin
  weight:
  - deltoid (lateral, anterior and posterior heads);
  - upper trapezius;
  - lats;
  - 3 serratus slips;
  - triceps long head and biceps;
  - forearm flexor mass;
  - VMO and the lateral quad sweep;
  - both gastrocnemius heads;
  - glutes.

  Amplitudes are for the male welterweight. The other classes scale them by 1.25 (heavy), 0.7 (female light) and
  0.85 (female middle).
- Stature: a uniform scale after the morph, so the ratios are untouched.

## 3. Muscle landmarks to show (game mesh + bake)

| Landmark | In the mesh (silhouette) | In the bake (normal / cavity) |
| --- | --- | --- |
| Trapezius slope neck → acromion | yes | border with the deltoid |
| Deltoid cap and its insertion | yes | the three heads' separation |
| Lats under the arm hole | yes (back width) | lower border |
| Pectoral shelf (male) | yes | lower border and sternum line |
| Serratus slips | no | 3 slips, only below the arm hole |
| Biceps / triceps | yes (volume) | the borders between them |
| Forearm flexors / brachioradialis | yes (proximal mass) | **superficial veins** (cephalic, basilic, median; 3 sinuous lines) |
| Abdominals | no | only under a lifted vest; mostly hidden |
| VMO, quad sweep | yes | VMO border |
| Gastrocnemius heads | yes | the medial / lateral split |
| Clavicles, sternal notch | small | yes |
| Knuckles, elbows, knees | — | darker colour zone (hyperpigmented creases on deep skin) |

## 4. Topology, triangle budget, LODs

The prototype runs at about 107k triangles for the body (one Catmull-Clark level on hm08) plus SDF kit at about 0.6M
triangles. That is the high-poly source for bakes, not a game mesh.

**Game budget per person (LOD0 ≈ 30k triangles, one draw call merged, ≤ 4 bone influences):**

| Part | LOD0 | LOD1 (8–15 m) | LOD2 (> 15 m) | Notes |
| --- | --- | --- | --- | --- |
| Body (skin visible: arms, legs, neck, face) | 12k | 6k | 2.5k | hm08 base (~26.8k tris) with the trunk under the singlet core and the feet under the boots removed (≈ −35 %); the face keeps two edge loops round the eyes and mouth |
| Eyes + lashes + brow cards | 1.2k | 0.4k | 0 (painted) | lashes as 2 alpha-tested cards per lid, brows as 2–3 cards; LOD2 painted only |
| Singlet | 3.5k | 1.6k | 0.6k | retopologised from the sim (quads along the folds), single layer + 1-loop turned hem |
| Trunks + band | 4k | 1.8k | 0.7k | the band is its own 2-loop strip |
| Gloves (2) | 3k | 1.2k | 0.4k | — |
| Headgear | 3.5k | 1.4k | 0.5k | the face-opening rim keeps 3 loops |
| Boots (2) | 2.5k | 1k | 0.3k | — |
| **Total** | **≈ 29.7k** | **≈ 13.4k** | **≈ 5k** | — |

- Transitions: dithered cross-fade.
- The sculpt stays out of the triangles below LOD0. Every LOD shares the same baked maps.

## 5. Baked maps and texel density

UV: MakeHuman's own layout for the body; a pattern-space layout for the garments (the pattern panels are the UVs).

| Map | Body | Garments | Kit | Content |
| --- | --- | --- | --- | --- |
| Albedo (sRGB) | 2048² desktop / 1024² phone, per tone (4) | 1024², with prints and trim | 1024² | skin from the CC0 photo detail re-toned (§6), colour zones; garment trim, piping, hem stitching, logos |
| Normal (tangent) | 2048² / 1024² | 1024² **fold normal baked from the simulation** (sim minus its 2 cm smoothing) + weave tile | 1024² | pores (procedural plus photo high-pass), anatomy (§3), veins, braids on the women's scalp |
| ORM (AO, roughness, metal = 0) | 1024² | 512² | 512² | roughness zones: T-zone 0.40, lips 0.34, palms 0.62, scalp 0.70, base 0.52 ± 0.06 break-up |
| Cavity | in the normal map's B or a separate 512² | — | — | darkens grooves |
| Sweat mask | 512² (single channel) | — | — | forehead, temples, nose, upper lip, chest centre, traps, upper back, forearms, with patchy noise |
| Detail tiles | pore micro-normal 256² tiled ×20 (face), ×40 (body) | knit 256² ×60, satin warp 256² ×60/40, rib 256² ×40 | leather grain 512² ×20 | — |

Texel density:

- body ≈ 4.5 px/cm at 2K (≈ 2.3 at 1K);
- face ≈ 8 px/cm;
- garments ≥ 3 px/cm;
- kit ≥ 3 px/cm.

Mip-mapped. KTX2 / Basis (ETC1S for albedo, UASTC for normals) on phones and XR.

## 6. Skin shader model (phone-safe)

- **Specular.** GGX, F0 0.028 (IOR 1.4) for every tone. Roughness from the ORM map.
  - Second lobe: a clearcoat-like lobe, roughness 0.12–0.28, weight = `sweat × sweatMask`.
  - Sweat = 0.2 + 0.5 × fatigue + 0.14 per round. Dry at the first bell, as in v7.
- **Diffuse.** The pre-integrated approximation already in boxer-material.ts: wrap N·L per channel, widening with
  curvature (R 0.36, G 0.15, B 0.10 × curvature). Keep the terminator warm.
- **No grey ambient on deep skin.**
  - Ambient = environment SH × AO².
  - Add a cool, low rim from the truss lights so dark skin keeps its contour.
- **Albedo targets (mean torso, linear-safe sRGB).** These are display colours warmed slightly as albedo. A neutral
  grey-brown albedo is what makes deep skin render ashy.

  | Tone | Albedo | Monk swatch |
  | --- | --- | --- |
  | T1 deep | #46302a | MST 9 #3a312a |
  | T2 dark brown | #664234 | MST 8 #604134 |
  | T3 brown | #895c42 | MST 7 #825c43 |
  | T4 light brown | #a77b55 | MST 6 #a07e56 |

- **Colour zones** (in the albedo):
  - cheeks, nose and ears warmer / redder, scaled by 0.1 + 0.25 × tone lightness, so it is barely visible on deep skin;
  - knuckles, elbows and knees 22 % darker;
  - palms and soles lighter and warmer;
  - lips darker and cooler (mauve-brown), **never lighter than the face**.
- **Hair.**
  - Men: close natural crop, painted.
  - Women: cornrows front to back, in the albedo plus normal; any visible hair at the nape is tied (IBA 46.3).
- **Phone (Lite) path:** no clearcoat lobe (sweat goes into roughness only), 1K maps, no detail tile beyond 16 m.

## 7. Garments: construction per item

**Method.** Each garment is cut from a sewing pattern and simulated.

- **Patterns** (`source-v8/patterns-<fighter>.json`, drawn on `10-sewing-patterns.jpg`):
  - singlet front and back;
  - trunks leg × 2 (mirrored);
  - elastic band.
- **Simulation** (`qa/fighter-v8/lib/cloth.mjs`, `cloth-sim.mjs`). Position-based dynamics in small substeps (8 per
  frame at 60 Hz):
  - stretch and shear on every triangle edge;
  - isometric bending across every interior edge;
  - seams that close over the first 110 frames, with gravity off until they close;
  - gravity;
  - body collision with friction (thickness 2.8 mm);
  - approximate self-collision (3.5 mm, spatial hash);
  - soft grips: the band on the body, the tucked hem, the straps on the trapezius.
- **Draping and posing.** The garments drape on the rest body and are then carried into each pose in three stages
  (skin to 34 %, 67 % and 100 % of the pose, relaxing at each stage).
  - Each trunks leg follows only its own leg.
  - The singlet ignores the arm bones.
- **Game:**
  1. Retopologise the guard-pose sim (and the stand pose for the blend).
  2. Bake the fold normal.
  3. Skin to the body with smoothed weights, using the same rules (no arm bones on the singlet, one leg per trunks
     leg, 18 % of the leg weight moved to the pelvis so the cloth lags).
  4. Delete the hidden body under each garment core (more than 3 cm inside the cut edges).

| Item | Pattern (male welter) | Fabric | Thickness / hem | Fit and behaviour |
| --- | --- | --- | --- | --- |
| Singlet (revised after the fourth review) | 2 panels, **tapered**: width at the chest = chest × 1.06 / 2 (55 cm), at the hem = waist × 1.08 / 2 (43 cm); length = notch − hem + 6 / 7.5 cm (front / back); hem tucked 3 cm under the band top; arm hole 20 cm from the strap top (♀ 18), so its bottom lands 2–4 cm under the armpit; strap 5.6 cm (♀ 5.0); neck half-width 8.5 cm; scoop front 11 cm (♀ 10), back 4.5 cm | polyester jersey, about 150 g/m² (solver density; product weight unverified); soft bend | 1.4 mm, 1 cm bound arm holes and neck with a rolled bead (chocolate binding) | snug to relaxed over the chest and back; tucked into the band (IBA bouts); soft folds under the raised arms in guard; every seam sewn both ways (no slits) |
| Trunks (2 legs) | top 55 cm per leg (hip × 1.16 / 2); crotch extensions 5.5 cm front, 10 cm back; opening ≥ thigh × 1.32 (72 cm); inseam to a hem 10 cm above the knee joint; rise = band bottom − crotch + 5 cm | polyester satin, 120 g/m²; crisper bend (bigger folds) | 1.4 mm, rolled hem, twin-needle hem stitching | loose: the leg moves inside the opening; seams: inseams, centre front and centre back; top edge longer than the band → **gathers** |
| Elastic band (revised) | 0.94 × the body girth at the band (6 % negative ease) × **8.5 cm** | ribbed elastic, 450 g/m², grips the body (follows the waist curvature) | 2.6 mm, both edges rolled | contrasting cream with two woven kit-colour stripes; the trunks gather into it; no slab |
| Gloves (rebuilt after the third review, §7a) | 10 oz: fist block 11.8 cm wide × 11.6 cm deep round a wrapped fist; striking face 14.7 cm in front of the wrist joint; cuff 10.4 cm behind it (≈ 26.5–27 cm overall along the back); knuckle roll Ø 5.2 cm | leather, roughness 0.5, grain normal, clearcoat 0.25 | SDF solid | white scoring panel on the knuckle face only, raised piping; thumb along the radial / palm side; palm bulge, grip hollow, palm seam; side seam; cuff opening, bound edge, Velcro strap under 5 cm tape, creases at the wrist |
| Headgear | padding: crown 2.1, brow roll 3.6, cheeks 2.8, ears 2.6, back 2.3 cm (IBA ≥ 2–3 cm); open face from the brow to below the chin; cheek pads down to the mouth corners; ear boss with a sound hole; webbing chin strap; Velcro strap across the back | leather, roughness 0.66, light clearcoat | SDF solid | quilted crown channels with stitch lines; ring seam round the crown cap |
| Boots | high-top, shaft 22 cm, laced along the front with 9 eyelets, padded collar | leather / suede upper, gum sole 1.2 cm with toe spring | SDF solid over the foot | body under the boot deleted |
| Hand wraps (close-ups and walk-out) | 5.7 cm bands, 2.5 mm over the hand (wrist, palm, knuckles, thumb base) | stretch cotton | 1.5 mm | diagonal band texture |

### 7b. The arm passes through the arm hole (fifth user review)

The user's words: *"this arm is not placed properly, it is hidden in the cloth"*. In the guard the singlet panel
wrapped the upper arm like a sleeve. The cause was in the collision: the full body, arms included, was one collider.
When the elbow came forward over the ribs, the closest surface for a singlet particle was the outside of the arm, so
the cloth was pushed round it.

**The rule now** (`lib/cloth.mjs`, `cloth-sim.mjs`). The singlet collides with the torso without the arms. The arms
are capsules, upper arm (starting a quarter of the way down, clear of the strap) and forearm. Singlet cloth that
enters a capsule is moved towards the torso axis until it is clear, so it always stays between the arm and the ribs.
The drape starts in the A-pose with the arms clear of the panels, then the cloth is carried into each pose in three
stages with these colliders active. The singlet's skin weights carry no arm bone.

**Game.**

- Skin the singlet without arm bones.
- In the runtime, use a capsule push from the torso side for the arm-hole ring: a vertex shader or CPU correction,
  as v7 did for the vest edge.
- Delete the hidden body under the singlet core only, never under the arm-hole band.
- Keep the binding ring round the shoulder joint and armpit.

**Automated check** (`qa/fighter-v8/armtest.mjs`):

- For guard, jab and hook, from the front, both broadcast sides and the 3/4 camera, cast rays to every
  camera-facing outer upper-arm vertex.
- A ray that hits singlet cloth within 4 cm in front of the skin counts as "covered".
- Fail above 2 %.
- Results are on `iterations/04-arm-outside-singlet.jpg`.

### 7a. Gloves: construction and fit (third user review)

The user's words: *"hands gloves are not properly handled"*. The first v8 glove was one smooth tube from the cuff to
the tip. Its white cap covered half of it, the thumb read as a separate finger, and the glove was bent sideways at
the wrist. The rebuilt glove (`gloveSDF()` in `qa/fighter-v8/lib/kit.mjs`; sheet
`iterations/02-gloves-before-after.jpg`) follows the product's construction.

- **Fist block.** Sized round a wrapped fist (fingers curled 80° / 95° / 65°, thumb 25° / 35°).
  - 11.8 cm across the knuckles, 11.6 cm deep.
  - A flat striking face 14.7 cm in front of the wrist joint.
  - A knuckle roll (Ø 5.2 cm) across the top of the striking end.
  - Back-of-hand padding behind it.
- **Scoring panel.** White, on the knuckle face only: the plane through the knuckle roll, above the palm. A raised
  piping bead with a pressed groove behind it.
- **Thumb.** A lobe Ø 3.8 → 3.3 cm lying along the radial / palm side, joined over its length (IBA 45.8.5: fixed
  by its top, gap ≤ 10 mm), with a crease under it.
- **Palm.**
  - The curled-finger bulge near the front.
  - A grip hollow behind it.
  - A palm seam.
  - A side seam on the little-finger side.
- **Cuff.**
  - 10.4 cm long, hugging the wrist (outer Ø 7.8 cm at the hand, 9 cm at the flared end).
  - An open end for the forearm.
  - A bound edge.
  - A Velcro strap raised 2 mm, under a 5 cm tape band (IBA 45.8.3).
  - Creases where the cuff meets the hand.
- **Skin.** Rigid to the hand (wrist bone). The last 6 cm of the cuff blend up to 35 % into the forearm twist bone,
  so there is no gap and no thin-into-fat jump at the forearm.
- **Wrists.** Straight in every pose: the glove continues the forearm (`glove()` in `lib/pose.mjs`). The pose
  specifies the glove centre, the elbow and the back-of-hand direction, never a bent wrist.
- **Game mesh.**
  1. Retopologise the SDF glove (about 1.5k triangles each at LOD0).
  2. Bake the seams, piping and grain into its normal map.
  3. Keep the panel split in the UVs: leather, white panel, tape.

## 8. Kit dimensions (the numbers the implementer's tests use)

- Band: 8.5 cm wide (amateur trunks 8–10 cm; IBA belt line 6–10 cm). Top at 0.6 × stature − 0.8 cm (just under the
  navel).
- Trunks hem: knee joint + 10 cm. Never above mid-thigh, never on the knee.
- Glove: 285 g (10 oz) class.
  - Overall length 26–29 cm.
  - Knuckle width 11.8 ± 0.5 cm, depth 11–12.5 cm.
  - Cuff 8–11 cm.
  - Tape 5 cm.
  - The fist block at least 1.35 × the cuff diameter.
- Headgear padding at least 2 cm everywhere it covers. Brow roll ≥ 3.2 cm. Total mass class 450 g (visual only).
- Strap width 5–6 cm. Arm hole bottom 2–4 cm below the armpit fold. The singlet is tucked into the band.
- Boot shaft 22 ± 2 cm.

## 9. Stance and guard (prototype values, `qa/fighter-v8/lib/pose.mjs`)

The opponent is towards +z. Orthodox stance (left lead). Distances scale with the stature (k = H / 1.76).

| Pose | Values |
| --- | --- |
| Stand (turnarounds) | Hips 0.5 cm down. Feet ±12 cm, toes 7° out. Arms hang 7 cm out and 10 cm forward of the shoulder with the gloves forward. Chin slightly down. |
| Guard | Hips 5.5 cm down, 1 cm across. Hip yaw −38°, tilt 3.4°. Chest a further −6°, lean 9°, side 1.7°. Head yaw −8°, pitch 14° (chin tucked). Clavicles: lead up 11° and forward 5°, rear up 5°. Lead foot +11 cm x, +24 cm z, toe −18°, heel 4°. Rear foot −12 cm x, −24 cm z, toe −58°, heel 26°. Knees pushed slightly out. Clavicles (revised): lead up 11° and forward 13°, rear up 7° and forward 10° (shoulders raised and rolled forward); hip yaw −36°, head pitch 11.5°, yaw −10°. **Rear glove** centre at the cheekbone / jaw, beside the face: head + (−9.5, −9, +11) cm; elbow down and in near the ribs at shoulder + (+8 in, −27, +2) cm. **Lead glove** a fist in front between eye and chin height: head + (+7.5, −6.5, +29) cm; elbow at shoulder + (−5, −26, +10) cm. Forearms rise at ~60–70°, angled slightly in. Wrists straight, knuckles forward, thumbs up and in. Both eyes stay visible over the gloves. The shoulder girdle (`shoulder01`) takes 30 % of each upper arm's swing, so the deltoid and armpit move with the arm. |
| Jab | Hip yaw −46°, chest −16°, lean 11°, side 4.6°. Lead shoulder up 17° and forward 11°. Weight 4 cm forward. Rear heel 34°. Lead glove centre 66 cm forward of the shoulder at shoulder height (≈ 95 % extension), knuckles flat, palm down, wrist straight. The rear glove stays on the cheek. |
| Lead hook | Hip yaw −8°, chest +22° (turned through), lean 10°. Lead heel up 22°, lead toe 15°. Lead elbow at shoulder height, 24 cm forward of the shoulder. Forearm level across the body (elbow ≈ 90°), glove 27 cm across from the elbow, palm down, wrist straight. The rear glove stays on the cheek. |

The game's keyed-arm system and clips stay. These values are the art target for its guard (`GUARD_V8`): the hip drop,
blade, chin tuck and clavicle shrug are larger than v7's (hips −2 cm, 33°, shrug 0.48).

## 10. Face and expression set

| Set | Content |
| --- | --- |
| Neutral focus (default) | Brows level, upper lids at the iris top, lips closed over the mouthguard (+3 mm forward) |
| Effort (on punch) | Brows lowered 2 mm and knitted, lower lids raised 1.5 mm, jaw clenched, nostrils flared 1 mm |
| Hit (reaction) | Eyes squeezed (lids 70 %), head snap, mouth corners pulled |
| Fatigue (late rounds) | Mouth slightly open, breathing, upper lids 20 % down |
| Mid-fight swelling (per round) | Under-eye and cheekbone puffiness +1–2 mm (blend shapes), a little redness on lighter tones |

- Blend shapes run only at LOD0 and are driven from the game state.
- Lashes and brow cards ride on the head.

## 11. Lighting assumptions, and what caps the realism

- **Broadcast ring:**
  - overhead key 1.4 × 1.4 m at 6.2 m, slightly towards the camera;
  - four truss fixtures at about 55° elevation from the corners;
  - dark room with deep falloff, no flat front fill;
  - canvas floor, light warm grey.
- **Studio (sheets):** large soft key front-left at 40°, a soft fill at 1/6, two rims.
- Tone mapping: Khronos PBR Neutral (keeps the kit's red saturated; AgX and ACES pushed the red to pink or salmon).

**What still caps realism in this browser-only toolchain:**

1. **No scanned athlete.** The body is MakeHuman's averaged sculpt plus our volumes, and the skin detail comes from a
   2K CC0 photo skin plus procedural pores. Pores, wrinkles and tendons at head-and-shoulders range cannot be invented
   convincingly.
   - Removes the cap: a licensed athletic scan (for example a 3D Scan Store athletic body, about £70 plus the
     commercial licence, HUMAN-REALISM-VR-RESEARCH.md §11), or a CC0 / CC-BY athlete scan wrapped to hm08.
2. **No real subsurface scattering in the renders.** three-gpu-pathtracer has no skin SSS. The game shader
   approximates it (§6).
   - Removes the cap: Blender Cycles random-walk SSS, if the user installs Blender themselves.
3. **No captured motion.** The poses are keyed.
   - Removes the cap: markerless phone-video capture, retargeted.
4. **No strand hair, no eyelid thickness or tear line beyond cards.**
   - Removes the cap: MetaHuman-style groom and eye meshes. Not licence-clean for us. A CC0 eye-and-lid kit is the
     clean path.

## 12. Reusable source assets (`apps/web/scripts/boxer/source-v8/`)

| File | What | Licence |
| --- | --- | --- |
| `shape-targets.json` | Per fighter: the macro values, the MakeHuman regional and face target list with weights, the sculpt volumes (joint anchors, radii, amplitudes) | targets referenced are MakeHuman CC0; the values are original work |
| `patterns-<fighter>.json` | The sewing patterns (singlet front / back, trunks leg, band) in metres, with the derived dimensions | original work |
| `garments-<fighter>-guard.glb` | The simulated singlet, trunks and band in the guard pose (pattern UVs) as retopology and bake source | original work |
| `skin-<sex>-normal.webp`, `skin-<sex>-roughness.webp`, `skin-<sex>-sweat.webp`, `skin-<sex>-albedo-t<n>.webp` | Prototype skin maps in MakeHuman UV | derived from MakeHuman CC0 skins; original work |

Large intermediates (the high-poly GLBs at about 30 MB each, the raw renders) are not committed. They rebuild from
`qa/fighter-v8` (§13).

## 13. Rebuild the prototype

1. Install: `npm install --prefix qa/fighter-v8`.
2. Build the bodies and kit:
   `MH_DIR=<makehuman checkout>/makehuman/data node qa/fighter-v8/build.mjs mW,fL,mH,fM` (MakeHuman commit `a8bc2d54…`).
3. Simulate the garments: `node qa/fighter-v8/cloth-sim.mjs mW stand,guard,jab,hook`, the same for `fL`, and
   `stand,guard` for `mH` and `fM`.
4. Check that the arms stay outside the singlet: `node qa/fighter-v8/armtest.mjs mW,fL` (exits 1 on failure).
   Then write the shot list: `node qa/fighter-v8/shots.mjs`.
5. Render with the path tracer (headless Chrome, port 3987): `node qa/fighter-v8/shoot.mjs qa/fighter-v8/raw/shots.json`.
6. Compose the sheets: `node qa/fighter-v8/sheets.mjs`.
7. Export the reusable assets: `node qa/fighter-v8/export-source.mjs`.
8. For live inspection: `node qa/fighter-v8/serve.mjs`, then open `http://127.0.0.1:3987/?f=mW&pose=guard&light=arena&ring=1&az=60`.

## 14. Sources

| # | Source |
| --- | --- |
| S1 | IBA Technical & Competition Rules, effective 15 April 2026: Art. 4.4.5, 45, 46, 47, 49, weight categories — https://www.iba.sport/wp-content/uploads/2026/06/20260415-IBA-Technical-Competition-Rules.pdf |
| S2 | IBA Guidelines for the Approval of Boxing Equipment (2025) — https://www.iba.sport/wp-content/uploads/2025/09/IBA_Equipment_Guidelines_FV.pdf |
| S3 | Kim K-J, Rhyu H-S, Yoon DH (2024). Physical fitness profile of Korean women's national amateur boxers by weight category. J Exerc Rehabil 20(2):51–57 — http://e-jer.org/journal/view.php?number=2013601029 |
| S4 | Han et al. (2020). Secular trends in adiposity and musculoskeletal dimensions of elite heavyweight boxers. Sport Sci Health — https://link.springer.com/article/10.1007/s11332-019-00598-2 |
| S5 | Yáñez-Sepúlveda R et al. (2025). Anthropometric profile and weight control strategies in a world boxing champion. Front Sports Act Living 7:1606856 — https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1606856 |
| S6 | Chaabène H et al. (2015). Amateur boxing: physical and physiological attributes. Sports Med — https://doi.org/10.1007/s40279-014-0274-7 |
| S7 | Smith MS (2006); Khanna GL, Manna I (2006). Journal of Sports Science and Medicine, Combat Sports Special Issue — https://jssm.org |
| S8 | Topend Sports, anthropometry of Olympic boxers (London 2012 / Rio 2016 heights) — https://www.topendsports.com/sport/boxing/anthropometry.htm |
| S9 | Monk Skin Tone scale (Google, CC BY 4.0) — https://skintone.google |
| S10 | Weyrich T et al. (2006). Analysis of human faces using a measurement-based skin reflectance model. ACM TOG 25(3) — https://cseweb.ucsd.edu/~henrik/papers/skin-analysis/ |
| S11 | Schneider GF et al. (2026). True to Tone? Skin tone fidelity in photographic-to-virtual human pipelines. arXiv:2604.02055 — https://arxiv.org/abs/2604.02055 |
| S12 | EA SPORTS UFC 5 presentation (dual-lobe skin, sweat and blood, damage system, Facerig) — https://www.ea.com/games/ufc/ufc-5/news/ufc-5-presentation |
| S13 | PlayStation Blog: "Undisputed launches Oct 11 – how body scans deliver boxing authenticity" — https://blog.playstation.com/?p=396984 |
| S14 | Hausen et al. (2024). Physical capacities and combat performance characteristics of male and female Olympic boxers — https://lida.sport-iat.de/ta/Record/4088434 |
| S15 | Stance coaching (unverified, not peer-reviewed) — https://expertboxing.com/the-perfect-boxing-stance ; https://pressbooks.cuny.edu/homefitness/chapter/basic-boxing-stance-and-guard/ |
| S16 | docs/HUMAN-REALISM-VR-RESEARCH.md (86 sources: MetaHuman LODs, Penner pre-integrated skin, Jimenez SSS, Fight Night skin, Quest budgets) and docs/FIGHT-REALISM-V7.md (R1–R14, Drillis & Contini) |
| S17 | Melanin-tint practice for skin albedo (practitioner blog, crediting a Horizon Forbidden West GDC talk; unverified) — https://woogity.artstation.com/blog |

No copyrighted image was committed. Reference photos were studied online only.

## 15. Acceptance checklist (P3-FGT-19B tests)

Measured items run in vitest on the built GLBs or in the QA sheet script. Visual items are checked on the QA sheets
against this spec's sheets.

**Body**

1. Stature within ±0.5 cm of the class value (1.76 / 1.87 / 1.65 / 1.70 m).
2. Waist-to-hip ♂ 0.83–0.88 and ♀ 0.70–0.76 (measure.mjs, bind pose).
3. Bideltoid / stature ♂ 0.34–0.36 and ♀ 0.30–0.32. Neck chin–notch / stature 0.050–0.056.
4. Heads tall 7.3–7.9 for every class.
5. Neck girth ♂ ≥ 0.40 m. Upper-arm mid girth within ±1.5 cm of §2.
6. Deltoid visible at 3 m: in the guard side shot at 1280×720, a luminance step of at least 8 % across the
   deltoid–arm border under the broadcast key (sampled along a line across the border).

**Garments**

7. Interpenetration check pass: at most 1 % of garment vertices inside the skin in each of the stand, guard, jab
   and hook poses, and no singlet vertex outside the band within the band height (garment–garment). The
   prototype's sim measures 0–0.4 % (`info.pushedFraction` in the shoot logs). v7 was 7.6 %.
8. No arm-hole cavity is visible from the broadcast camera: in the guard side shot, no pixel inside the vest outline
   shows the vest's inner face.
9. The singlet hem sits under the band: the band's outer surface is at least 1 mm outside every singlet vertex within
   the band height.
10. The band is 8–10 cm wide, follows the waist (radial deviation from the body under it ≤ 8 mm), contrasting (ΔE ≥ 40 against the kit colour), and its top is below the navel (≥ 0.5 cm).
11. The trunks hem is between mid-thigh and the knee top in the stand pose.
12. The trunks leg opening circumference is at least 1.25 × the thigh girth at the hem.
13. Gathers: the band seam carries at least 1.15 × its length of trunks edge (pattern lengths).
14. The garment meshes are separate from the body. Hidden body triangles under the garment cores and inside the boots
    and gloves are deleted (count reported).

**Kit**

15. Gloves (measured on the mesh in the hand frame):
    - overall length 26–29 cm;
    - knuckle width 11.8 ± 0.5 cm and depth 11–12.5 cm;
    - cuff 8–11 cm, tape band 5 cm;
    - the fist block at least 1.35 × the cuff diameter (no tube);
    - the white panel on the knuckle face only (no white vertex with dorsal height below −3.5 cm or more than 6 cm
      behind the striking face);
    - the thumb lobe present on the radial / palm side.

14a. Arms outside the garment: in guard, jab, hook and block, no arm vertex lies inside a garment panel, and for
    the outer upper arm at most 2 % of camera-facing vertices are covered by singlet cloth within 4 cm of the skin.
    This is ray-tested from the front, both broadcast sides and the 3/4 camera (port `qa/fighter-v8/armtest.mjs`
    into the P3-FGT-19B harness).

15a. Guard, jab and hook angles (measured on the posed skeleton):
    - in guard, the forearms are 55–75° from horizontal and the elbows inside the shoulder width, at least 22 cm below
      the shoulders;
    - in guard, the eyes are visible from the front camera: no glove pixel covers either eye's projected centre;
    - wrist deviation (forearm axis against the glove's wrist → knuckle axis) at most 12° in guard, jab and hook;
    - in guard, the rear glove centre is within 4 cm of the cheek surface;
    - in guard, the lead glove centre is at eye height ± 4 cm and 20–30 cm in front of the face;
    - in guard, both elbows are at least 18 cm below their shoulders and inside the shoulder width;
    - in the jab, the palm normal points down (dot with −y ≥ 0.8) and the arm is 90–98 % extended;
    - in the hook, the elbow angle is 80–100°, the elbow is at shoulder height ± 5 cm, and the palm is down or in.
16. Headgear padding at least 2.0 cm (sampled thickness over the covered area); brow roll at least 3.2 cm; the face
    opening shows both eyes, the nose and the mouth from the front camera.
17. The mouthguard is not red (IBA 49.5.2).

**Skin**

18. The four tone albedos (torso mean, sRGB) are within ΔE 6 of the §6 targets.
19. No grey cast on T1: the mean chroma of lit skin in the guard close shot is at least 60 % of the albedo target's
    chroma.
20. The same specular F0 for every tone (shader uniform check).
21. Sweat is off at the first bell and rises with rounds (exists in v7; keep the test).

**Performance**

22. Per person: LOD0 ≤ 31k triangles, 1 draw call (+1 shadow), ≤ 4 influences per vertex.
23. 60 fps in the practice ring at 1280×720 and at 844×390 DPR 2 on the M2 Pro headless baseline.
24. Phone textures ≤ 14 MB per person (KTX2).

**People**

25. Adults only: age macro 0.5–0.55 (25–27 years). No child or teen features.
26. Respectful and non-sexualised: women in a full singlet over a sports bra, trunks per IBA.
27. Natural hair under the headgear (crop / cornrows), tied.
