# Realistic campus people (P2-AVA-12)

Scope: the player's own avatar on the plaza and campus, the other players, and staff / other people in halls and
lounges outside the boxing ring. The boxers (P3-FGT-17, `world/human/boxer/*`, `world/human/boxing/*`) are out of
scope. Rubric: docs/HUMAN-REALISM-RUBRIC.md (pass bar 4). Evidence: docs/QA/campus-humans/. Earlier rounds:
docs/HUMAN-REALISM.md (the ring people), docs/QA/human-realism/round-3.md (plaza person 2 on face, eyes, skin, hands,
clothing, expressions).

## 1. Review of the current people (baseline)

Assessed with the human lab (`/play/human-lab`) and `qa/e2e/human-assess/assess.mjs` (sections `lab`, `matrix`,
`lod` and the new `campus` section: headwear, clothing close-ups, walk / run / start-stop / jump strips, reactions):
day, sunset and night; desktop 1280 × 720 and phone 844 × 390 (DPR 2); skin tones 0 / 3 / 6 / 10 × ages young /
adult / senior × feminine / masculine bodies. Sheets: `docs/QA/campus-humans/before/sheets/`, data
`before/metrics.json`.

| Area | Defects found (baseline) |
| --- | --- |
| Face | Low-poly heads (1.3–1.4k triangles, Phong-tessellated near) with visible facets on the nose bridge; the light skin tones (10) read grey and mask-like with dark eye sockets; one face shape per base (only the sliders vary it) |
| Eyes | Painted on two small caps of the head mesh: a flat iris with no depth, no limbal ring or pupil detail, the catchlight a smear of the environment, no lid occlusion: the "doll" cue |
| Brows / lash line | Grainy grey speckle (the hairline break-up noise ran over the brows and the lash line); the feminine base's photo brows are light and read grey on every tone |
| Mouth / teeth | Lips fine at rest; the mouth never takes part in an emote (only talking moves the jaw) |
| Skin | Photo albedo with a crease filter (P2-AVA-11) but no pore-scale normal detail up close, one flat roughness value per zone, no transmission (ears never glow against the light) |
| Hair | Strands / shells per style (P2-AVA-10) work bare-headed; braids show a few spikes on the crown |
| Caps / headwear | **Braids and locs come through the cap and the bucket hat** (the strands kept their full thickness under the crown; the bucket hat's flat top was pressed ~2 cm into the skull); the cap sat high (4.6 cm above the brows) with a flat, paper-like brim |
| Hands | Low-poly but correctly posed; a lighter band where the hand texture meets the sleeve at the wrist (feminine) |
| Clothing | One garment per base body (masculine: canvas jacket + jeans, feminine: suit jacket + trousers, neutral: fleece zip jacket + jeans), recoloured by the look: "tee" and "hoodie" render as those jackets; the material reads painted (no weave, no cloth sheen); the skirt / long wrap is a flat, plastic cone with a star of folds |
| Idle | Good (seeded idle director, fidgets) |
| Walk / run | Good stride / speed match and foot locking (QA-HUM-01); no lean into curves, starts and stops have no weight shift |
| Turn / stop | Turning on the spot steps; stopping settles on a double-support plant, but the body never rocks over the feet |
| Jump | **Not available** (no control, no animation) |
| Reactions | Wave / clap / dance / cheer / "oh no" clips exist; the face stays blank in all of them; no surprise, no reaction to being bumped; in the lab the everyday-life clips never streamed (cheer, laugh, shrug showed as idle) |
| LOD | Two-level body LOD with hysteresis, throttled animation by distance: no visible pop (round-3 measurement holds) |

Baseline rubric (visual, plaza person): proportions 4, face 2, eyes 2, skin 2, hair 3, hands 2, clothing 2, motion 4,
expressions 2, lighting 3, LOD 4, performance 4 (docs/QA/human-realism/round-3.md; confirmed by this baseline).

## 2. Research: believable people inside a mobile budget

How real-time games and social VR apps get believable people, and what each technique costs us. "Phone budget" =
the plaza at 844 × 390, DPR 2, 60 fps with 20–40 people in view (today ≈ 230–276 draw calls, ≈ 1.1 M triangles).

### 2.1 Faces: topology and blend shapes

- **Topology.** Production faces use edge loops around the eyes and mouth, so lids close and lips stretch without
  tearing; game LOD0 heads run 8–20k triangles, crowd LODs 1–3k ([MetaHuman LOD specification][mh-lod]). The
  Rocketbox heads are 1.3–1.4k triangles with bone-driven lids, brows, cheeks, lips and jaw (the 2010s "Biped face"
  rig): enough loops for blinks and mouth shapes, too coarse for creases. We tessellate them (Phong, ×4) within 9 m.
- **Blend shapes.** The de-facto standard is Apple ARKit's 52 face blend shapes (`browInnerUp`, `eyeBlinkLeft`,
  `jawOpen`, `mouthSmileLeft`, `cheekSquintLeft` …) ([ARKit ARFaceAnchor.BlendShapeLocation][arkit]); Meta Avatars,
  VRChat, Ready Player Me and most VRM avatars use the same names so the face can be driven by a phone camera or by
  intent. On a bone face the same channels map to bone offsets (`browInnerUp` → inner brow bones up, `mouthSmile` →
  corners up / out, `cheekSquint` → cheek bones up, pushing the lower lid). That is what we do (§4, Expressions):
  a 4-channel intent set (joy, surprise, sadness, jaw) built from ARKit-named primitives, so a future 52-shape head
  takes the same inputs.
- **FACS-style combination.** Expressions read as real when several muscles act together with offsets in time: a
  real smile lifts the cheeks and narrows the eyes ("Duchenne"), surprise raises the whole brow and widens the lids
  before the jaw drops, sadness raises only the *inner* brow and pulls the corners down ([Ekman & Friesen, FACS][facs]).

### 2.2 Eyes

The single cheapest win for "alive vs. doll" ([Jimenez et al., Next-Generation Character Rendering, GDC 2013][jimenez];
[MetaHuman eye documentation][mh-eyes]; [Unity Digital Human eye shader][unity-dh]):

- a separate **eyeball** with a convex **cornea** over a concave **iris** (refraction, or a parallax offset of the
  iris texture along the view: `uv += view.xy · depth`), a sharp wet specular (roughness ≈ 0.02–0.05);
- a dark **limbal ring**, a sclera that is off-white, warmer and darker towards the corners, never pure white;
- **eye occlusion**: a soft shadow under the upper lid and lashes onto the eyeball (MetaHumans use a separate
  translucent "eye occlusion" mesh, games bake it into the sclera shading by eyelid distance);
- the **tear line** (lacrimal meniscus): a thin wet strip along the lower lid with its own highlight;
- life: blinks every 2–6 s (fast close ~70 ms, slower open), saccades of a few degrees every 0.5–3 s, the lids
  following the gaze, eyes leading the head in a turn.

### 2.3 Skin

([Penner, Pre-Integrated Skin Shading, GPU Pro 2 / SIGGRAPH 2011][penner]; [Jimenez, Separable SSS][jimenez-sss];
[d'Eon & Luebke, GPU Gems 3 ch. 14][deon]):

- albedo without baked light, a **detail normal** (pores, fine wrinkles) tiled over the base normal map and faded
  with distance; **roughness breakup** (oily T-zone, matte cheeks, broken by a low-frequency noise) and a specular F0
  of ≈ 0.028 rather than 0.04 (skin is not plastic);
- **subsurface scattering**: AAA uses a screen-space separable blur on a skin mask (≈ 1–1.5 ms at 1080p: over our
  phone budget, and it breaks the WebXR path); mobile uses **wrap lighting per colour channel** or a pre-integrated
  diffuse LUT (curvature × N·L), plus **thin-part transmission** (ears, nostrils, fingers glow red when backlit);
- the terminator stays warm: no grey shadows on skin.

### 2.4 Hair

- **Hair cards** (alpha-tested or alpha-to-coverage strips with a strand texture) with **Kajiya–Kay** anisotropic
  highlights (primary white shifted to the root, secondary tinted shifted to the tip) ([Scheuermann 2004][kk];
  [Tariq, NVIDIA 2008][tariq]); short / tightly coiled hair is better as a textured shell over the scalp plus a few
  cards at the hairline. We generate strands procedurally per style (world/human/hair.ts, 18 styles).

### 2.5 Garments

- Games author garments **on the body** (sculpted in the target pose, folds in the geometry and a baked **fold
  normal map** from a cloth simulation or sculpt), then add a tiling **fabric micro-normal** (knit, twill, fleece)
  and a physically based **sheen** lobe for cloth ([Estevez & Kulla, Production Friendly Microfacet Sheen, 2017][sheen];
  three.js `MeshPhysicalMaterial.sheen`). Hems and cuffs are modelled with thickness (a second edge loop folded in).
- Our Rocketbox bodies carry the clothes in the body mesh (one mesh, photo albedo + normal map with real folds, a
  recolour mask): no clipping by construction, but the material reads "painted" unless the fabric's own response
  (sheen, weave, denim's cool highlight, fleece's soft grazing light) is added.

### 2.6 Caps and headwear

- A cap is fitted to a **head cage** (the skull's outer envelope at the cap's band height), sits ≈ 2–3 cm above the
  brow line at the front and over the occipital bulge at the back; the **hair under it is compressed** (a
  per-vertex push of the scalp hair inside the band, so it never pokes through) and only shows below the band
  ([Unreal groom + "hair under hats" practice][ue-hat]); the brim is a stiff curved panel with thickness and a
  rounded edge, the crown has 6 panels with seams and a button.

### 2.7 Locomotion

- **Blend spaces** over speed (and direction) with a **shared normalised phase**, so blended clips' feet agree; the
  playback rate follows the ground speed so the stride matches it ([Unreal blend spaces / sync groups][ue-sync]).
- **Foot IK / locking**: planted feet pinned to the ground and the leg re-solved (two-bone IK) to remove skating.
- **Lean**: the body tilts into a curve by about the centripetal angle atan(v·ω/g) and into accelerations;
  the head stays level ([Holden et al., Phase-Functioned NNs, 2017][pfnn] measured this in mocap; GDC talks on
  procedural lean: [Bobby Anguelov, "Animation Bootcamp"][anguelov]).
- **Starts and stops**: start = lean in + first stride from the stance foot; stop = phase-matched plant on the
  nearest double support, a small rock back over the feet (a spring overshoot) ([Clavet, Motion Matching, GDC 2016][mm]).
- **Jump**: anticipation (crouch 0.15–0.25 s, arms back), take-off (extension, arms swing up), ballistic flight
  (h = v0² / 2g), landing absorption (knees / hips flex 0.1–0.3 s) — the classic animation principles
  (anticipation, follow-through) ([Thomas & Johnston, The Illusion of Life][illusion]).

### 2.8 Additive reactions

- Hit / bump / flinch reactions are **additive layers** (a delta pose on top of whatever the body is doing, weighted
  by a curve) or **physics-blended** (a spring per bone driven by an impulse: e.g. Uncharted / The Last of Us
  "hit reactions" ([Naughty Dog GDC talks][nd])); no state change, no snapping.

### 2.9 Crowds: LOD and impostors

- 3–4 mesh LODs by screen size, animation rate by distance (every 2nd / 4th frame), then **impostors** (an
  octahedral or 8–16-view billboard atlas baked from the animated mesh) beyond ≈ 30–40 m ([Ryan Brucks, Octahedral
  impostors][imp]; [Assassin's Creed Unity crowd, GDC 2015][acu]). Our plaza already has a 2-level mesh LOD, distance
  animation throttling, and the name tags / shadows by distance; impostors are listed in §7 (not needed at today's
  crowd sizes, measured in §6).

## 3. Licence-clean sources

Allowed: CC0, CC-BY (with credit), MIT / permissive. Excluded: Mixamo (project rule), anything NC or ND, anything
whose terms forbid shipping raw files to a browser. Nothing was bought.

| Source | What | Licence | Usable? | Notes |
| --- | --- | --- | --- | --- |
| MakeHuman 1.x system assets / MPFB2 (Blender) assets | Base meshes, targets, skins, eyes, proxies | **CC0** (assets; the MakeHuman / MPFB *code* is GPL/AGPL, the exported models and assets are CC0) ([MakeHuman licence][mh-lic]) | Yes | Already used for the ring people (docs/HUMAN-REALISM.md) |
| Microsoft Rocketbox | 115 rigged avatars (Biped skeleton, face bones), textures | **MIT** since Dec 2020 ([repo][rb]) | Yes | Limits: the release is "as is", the licence notice must ship with the files (apps/web/public/assets/characters/LICENSE-Rocketbox.txt); the 2010s topology (1.3–1.5k-triangle heads, 1024 px maps) caps close-up quality |
| Ready Player Me | Avatar creator / API | Proprietary terms; **service shut down 31 Jan 2026** after the Netflix acquisition ([pocketgamer.biz][rpm1]; [Genies][rpm2]) | No | Rejected: closed service, stylised, redistribution-restricted |
| CMU Graphics Lab Motion Capture Database | 2,600+ BVH clips (walks, runs, jumps, reactions) | Free for all uses incl. commercial; may not be resold as a mocap dataset ([CMU][cmu]) | Yes | Retarget onto Bip01 needed (offline, BVH → glTF); listed in §7 |
| Quaternius Universal Animation Library 1 / 2 | 120 + 130 game clips (locomotion, jump, emotes) on a universal humanoid rig | **CC0** ([Quaternius][quat]; [itch.io][quat2]) | Yes | Stylised timing; needs retargeting from its rig to Bip01 |
| Poly Haven | Fabric / leather / skin-adjacent PBR textures, HDRIs | **CC0** ([Poly Haven licence][ph]) | Yes | Candidate fabric scans for baked fold / weave maps |
| ambientCG | Fabric, leather, denim, knit PBR sets | **CC0** ([ambientCG licence][acg]) | Yes | Same |
| Mixamo | Characters / animations | Adobe terms | **No** (project rule) | — |
| Epic MetaHuman | Faces / grooms | Free < USD 1M revenue, other engines allowed since 2025 | No (project brief; 30–200 MB per character) | — |

Paid options (not bought; costs from public price pages, verify before buying):

| Option | Cost | What it gives |
| --- | --- | --- |
| Reallusion Character Creator 4 + Headshot 2 + SkinGen | CC4 ≈ USD 299; Headshot ≈ USD 199; in-game *customisation* needs an Enterprise licence (quote) | Production heads / bodies with game LODs, ARKit-52 expressions, hair cards |
| Scanned heads (3D scan stores, e.g. 3DScanStore, Ten24) | ≈ USD 50–300 per head | Real faces; needs retopology onto the Rocketbox / MakeHuman topology and baking (2–4 days per head) |
| Texturing.XYZ face maps | ≈ USD 30–150 per set | Multi-channel skin micro-detail |
| ActorCore / Reallusion mocap packs | ≈ USD 20–100 per pack | Clean commercial locomotion, jumps and reactions (game licence) |

## 4. Decision: improve the Rocketbox person in place (not migrate, in this task)

| | Improve in place (chosen) | Migrate the plaza to the MakeHuman human (the ring people's base) |
| --- | --- | --- |
| What the user sees change | Eyes, skin, brows, caps, fabrics, expressions, jump, lean, reactions on **every** campus person at once | Better base face / body topology and skin (the ring people score 3 on face / skin / clothing vs. 2 here) |
| Expected rubric gain | eyes 2→4, expressions 2→4, caps (hair) 3→4, motion 4→4+ (jump, lean, reactions), skin 2→3, clothing 2→3, face 2→3 | face 2→3, skin 2→3, clothing 2→3, hands 2→3 (round-3 estimate); eyes / expressions / motion need the same work as in place on top |
| Cost | ≈ 1 agent-session (this task) | 2–3 agent-weeks: retarget 24 base + 17 life clips Bip01 → MakeHuman rest pose, re-fit 7 seat profiles and the hand-rest layer, rebuild 30+ outfit items as draped garments, refit 18 hair styles and 5 headwear kinds to a new skull, face sliders onto MakeHuman targets, LOD1 + impostors |
| Per-person budget | 2.5–5.6k body / head triangles + hair (≈ 12–29k incl. the near tessellated head), 3 draw calls (+1 for the eyes within 12 m) | 56–60k triangles near, would need a 6–8k LOD1 and impostors for 30+ people |
| Risk | Low: behind `NEXT_PUBLIC_FF_CAMPUS_HUMANS`, the old shader / geometry paths kept intact | High: every seat, emote and outfit has to be re-verified; the boxer files are being changed in parallel by P3-FGT-17 (`world/human/boxer/*`, off-limits here) |
| Coordination | The new pieces are shared modules (`world/human/skin/skin-shading.ts`, `world/human/eyes.ts`, `world/human/motion-layer.ts`) the ring people can adopt | Would fork or touch the boxer pipeline mid-change |

Evidence: the baseline shows the biggest *perceived* gaps on the plaza are not the base mesh but the eyes (painted
caps), the blank face during emotes, hair through hats, the painted look of the clothes and the missing jump / lean /
reactions. All of those are fixable in place; the base-mesh gap (face / skin / clothing 3 instead of 4) is not, and
§7 lists what closes it (the migration, or paid scanned heads).

## 5. What was built (behind `NEXT_PUBLIC_FF_CAMPUS_HUMANS`, default on; `0` = the people as before)

Everything applies to every campus person rendered by `world/Avatar.tsx`: your own avatar, other players, NPCs,
hall staff and lounge people (not the boxers).

**Eyes** (`world/human/eyes.ts`): real eyeballs fitted to each base head's painted eye caps (least-squares sphere
through the eye bone's vertices; the caps are pulled inside), rigid on the eye bones (blinks, saccades, gaze still
work): a cornea bulging 2.2 mm under a wet clear coat, a parallax iris (the iris plane ≈ 2 mm under the cornea, offset
along the view in the iris' derivative tangent frame) with radial fibres, crypts, a collarette and a dark limbal
ring, an 11.7 mm iris whatever the fitted sphere, a warm off-white sclera with faint vessels that darkens into the
corners and along the lids, lid occlusion (upper lid / lashes shade the top of the eyeball for direct and ambient
light) and a sky catchlight scaled by the ambient light (never shines at night). One skinned mesh for both eyes (one
draw call, ≈ 1.8k triangles), drawn within the near LOD (12 m).

**Skin** (`world/human/materials.ts` + the shared `world/human/skin/skin-shading.ts`): pore / micro-wrinkle detail
normal (the in-house `human-detail.webp` tile, faded to its mean below a pixel), two-scale roughness breakup, thin-part
transmission (backlit ears and nose wings go red), light tones kept warm (they read grey before), and the brows and
lash line no longer carry the grey grain (the scalp break-up noise is confined to the scalp, every brow is drawn as
hair strands ≥ 60 % dense).

**Expressions** (`world/human/face-rig.ts` `emotion`, driven by `motion-layer.ts`): joy (corners up and out, cheeks up
pushing the lower lids: smiling eyes, a slight brow lift), surprise (whole brow up, upper lids up: eyes wide, jaw
drops), sadness (inner brows up only, corners down, heavier upper lids), plus the jaw for cheering / laughing / a
startle. Each emote has its face: wave / clap / thumbs-up / photo smile, laugh and cheer open the mouth, "Oh no" is
sad, surprise is a startle.

**Caps and headwear** (`head-fit.ts`, `headwear.ts`, `hair.ts`): braids, locs and twists are pressed flat (half
thickness, inside the hat's clearance) everywhere under a crown and come out below the band at full thickness (a 2 cm
blend) — nothing pokes through a cap, bucket hat or kufi any more; the cap sits 1.5–2 cm above the brows (was 4.6 cm)
with a pre-curved brim (sides bent down, pitched flatter); the bucket hat's flat top no longer sinks ~2 cm into the
skull (a soft knee 4 mm below the dome's top).

**Clothes**: the fabric of each base garment now reads as what it is: knit / jersey micro-normal, denim 3/1 twill with
slubs, fleece pile, wool suiting, cotton twill (chinos), leather grain — with a physical cloth sheen lobe per weave
(soft grazing light on fleece / knit, a cool lift on denim) and per-fabric roughness. The skirt / long wrap: irregular
drape folds deepening to the hem (72 × 12 segments), cotton-twill weave, cloth sheen, a turned hem with a stitch line,
the inside darker.

**Movement** (`world/human/motion-layer.ts`, additive after the clips; springs and eased weights, no snapping):
- lean into curves by the centripetal angle atan(v·ω/g) × 0.85 (≤ 11°), 65 % of it the whole body tilting from the
  feet, the rest in the spine, the head kept level;
- starts and stops: an underdamped spring on the torso pitch driven by the measured acceleration (lean into a start,
  rock back and settle over the feet on a stop);
- **jump** (`ACT.jump` = 32, Space / the Jump button, `NEXT_PUBLIC_FF_JUMP`): anticipation (0.2 s crouch, arms back,
  feet planted by leg IK), take-off (extension, arms swing through), ballistic flight to 0.30 m standing / 0.36 m
  running (v0 = √(2gh)), knees tucked; a running jump holds the gait phase in the air (no cycling legs mid-air);
  landing absorption (knees / hips flex 9–13 cm, torso folds, recovers in 0.26–0.32 s). Cosmetic: the server's
  position rules are unchanged, everyone sees it through the `anim` code;
- reactions: **being bumped** (`world/human/crowd.ts`: someone closing in faster than 0.7 m/s within 0.52 m; a damped
  stagger away from the contact in the spine, head and arms, a startled face, a glance at whoever did it; computed
  on every screen from positions, no message), **surprise** (`ACT.surprise` = 33, in the emote picker: shoulders up,
  head and torso back, hands lift), **disappointment** ("Oh no": a slump, head down, shoulders forward, a sad face),
  cheer / wave / laugh with their faces. The jump and the startle keep the idle director from starting a fidget in
  the middle of them.

**Lab and tooling**: `/play/human-lab` gained `act` (any action code, also while walking), `walk.turn` (walk a
circle), `crowd=<n>` (a crowd for perf), `people=v1` (the old people side by side), `rhoff=` (switch single parts off
to measure them), headwear / waist / jump camera presets, and it now streams the everyday-life clips (before, cheer /
laugh / shrug never played in the lab). `qa/e2e/human-assess/assess.mjs` has a `campus` section (headwear, clothing
close-ups, walk / run / start-stop / jump / running-jump strips, reactions and their faces); `crowd-perf.mjs`
measures fps / draw calls / triangles for v1 vs v2.

### Shared skin module (for the coordinator / P3-FGT-17)

`world/human/skin/skin-shading.ts` holds engine-neutral GLSL for `onBeforeCompile` shaders and the shared detail
texture loader. To use it in another human shader (e.g. `boxer-material.ts`):

1. prepend `GK_SKIN_GLSL.detailNormal`, `.breakup`, `.transmission` and/or `.fabric` to the fragment shader (they
   only define functions; `gkDetailN` is the same function the boxer shader already has, so drop that copy);
2. bind `skinDetailTexture()` as a sampler and tile it ≈ 1 tile per 1.5–2 cm of skin (RG) or 1 cm of jersey (BA);
3. after `normal_fragment_maps`: `normal = gkDetailN(normal, -vViewPosition, uv * tile, dn, k * gkDetailLod(uv, tile, 96.0))`;
4. in the per-light diffuse (inside `RE_Direct_Physical`): `reflectedLight.directDiffuse += gkTransmit(geometryNormal,
   geometryViewDir, directLight.direction, directLight.color, thin, material.diffuseColor) * 0.25;` with `thin` = ear
   / nostril / finger weight;
5. on a `MeshPhysicalMaterial` with `sheen > 0`: `vec4 s = gkFabricSheen(FABRIC id, material.diffuseColor);
   material.sheenColor = s.rgb; material.sheenRoughness = s.a;`.
The eyeball (`world/human/eyes.ts`) is likewise reusable: `fitEyes` / `eyeballGeometry` / `makeEyeMaterial` need only
a skinned head geometry with two eye bones and the face's forward / up.

## 6. Results

Three assess → fix → re-assess rounds; the scores per round, the performance table and every contact sheet are in
[docs/QA/campus-humans/README.md](QA/campus-humans/README.md). Final (round 3, min of automatic and visual):
eyes 4, motion 5, expressions 4, LOD 4 pass; face 3, skin 3, hair 3, hands 3, lighting 3; clothing 2 (automatic cap:
garments are the body surface; visual 3); performance 3 (per-person draw calls 7 → 12 near; the 30-person crowd costs
≈ 11 % fps: 349 → 310 desktop, 331 → 290 phone DPR 2 on the test machine, far above 60 fps).

Not reaching 4 (face, skin, hair, hands, clothing) is the base mesh's limit, as round 3 of QA-HUM-01 predicted; §7
lists what closes each gap.

## 7. Remaining gaps and what closes each

| Gap | Now | What closes it | Cost |
| --- | --- | --- | --- |
| The outfit item does not change the garment's *shape*: "tee" / "hoodie" render as each base body's jacket (canvas / suit / fleece) | clothing 3 | More Rocketbox bases (MIT; the library has ~115 adults in tees, hoodies, shirts, dresses) built through the same FBX → glTF → recolour-mask pipeline, chosen per top kind; or the migration below with draped garments per item | 3–5 days (5–8 bases, masks, outfit mapping, seat / hand-rest re-check) |
| Faces at head-and-shoulders (base topology 1.4k triangles, one face per base) | face 3 | Migrate the plaza to the MakeHuman human (2–3 agent-weeks, §4) and/or scanned heads retopologised to it (paid, ≈ USD 50–300 per head, 2–4 days each) | see §4 / §3 paid table |
| Skin up close (no screen-space SSS, 1024 px head maps) | skin 3 | Desktop-only separable SSS on a skin mask (≈ 1.5 ms at 1080p) + 2K head maps on desktop | 3–4 days; phones keep wrap + transmission |
| Box braids / locs are tubes (thick, sparse on the crown; a few root ends flick up at the front) | hair 3 | Braid cards with a strand texture and alpha-to-coverage, denser partings, Kajiya–Kay highlights; a groom per style | 3–5 days |
| Expressions are bone offsets on a coarse lip rig (a smile reads, but no teeth / cheek creases) | expressions 3–4 | ARKit-52 blend shapes on a new head (needs the migration or scanned heads); on Rocketbox: corrective normal-map creases blended with joy / sad | 2–3 days (creases) |
| A pale strip above the feminine base's brows (texture-based; survived three shader attempts: not specular, not the hair shell) and a lighter band at her wrists | face 3 | Repaint the brow region and the wrist seam of `feminine_head` / `feminine_body` in the offline texture build (the same TGA → WebP step as P2-AVA-11) | ½–1 day |
| Fighters on the plaza body (`fight/*`, `BoxingLab`: `<Avatar rigLayer>`) get the new eyes / skin / fabric shading but **not** the motion layer (their rig layer owns pose and face) | — | Coordinator: decide with P3-FGT-17 whether the ring wants the eyeballs / skin module (it is shared, §5) | — |
| Real-phone GPU numbers | — | Profile on a mid-range Android (Mali / Adreno) and an iPhone; drop the sheen lobe on phones if it costs > 1 ms | ½ day with devices |
| Impostors for very large crowds (> 60 people) | not needed today | 8-view billboard atlas baked per look beyond 40 m | 2–3 days |
| Jump over obstacles / onto things | cosmetic only | Server-side vertical state and collision (`apps/realtime` world room); out of scope by rule (server-authoritative movement unchanged) | 2–3 days + design |

## Sources

[mh-lod]: https://dev.epicgames.com/documentation/en-us/metahuman/metahuman-lod-specifications
[arkit]: https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation
[facs]: https://www.paulekman.com/facial-action-coding-system/
[jimenez]: https://www.iryoku.com/stare-into-the-future/
[mh-eyes]: https://dev.epicgames.com/documentation/en-us/metahuman/metahuman-eyes
[unity-dh]: https://github.com/Unity-Technologies/com.unity.demoteam.digital-human
[penner]: https://www.slideshare.net/slideshow/penner-preintegrated-skin-rendering-siggraph-2011-advances-in-realtime-rendering-course/8647484
[jimenez-sss]: https://www.iryoku.com/separable-sss/
[deon]: https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-14-advanced-techniques-realistic-real-time-skin
[kk]: https://history.siggraph.org/wp-content/uploads/2022/12/2004-Talks-Scheuermann_Practical-Real-Time-Hair-Rendering-and-Shading.pdf
[tariq]: https://developer.download.nvidia.com/presentations/2008/SIGGRAPH/RealTimeHairRendering_SponsoredSession2.pdf
[sheen]: https://blog.selfshadow.com/publications/s2017-shading-course/imageworks/s2017_pbs_imageworks_sheen.pdf
[ue-hat]: https://dev.epicgames.com/documentation/en-us/unreal-engine/hair-rendering-and-simulation-in-unreal-engine
[ue-sync]: https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-sync-groups-in-unreal-engine
[pfnn]: https://theorangeduck.com/media/uploads/other_stuff/phasefunction.pdf
[anguelov]: https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach
[mm]: https://www.gdcvault.com/play/1023280/Motion-Matching-and-The-Road
[illusion]: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
[nd]: https://www.gdcvault.com/play/1020583/
[imp]: https://shaderbits.com/blog/octahedral-impostors
[acu]: https://www.gdcvault.com/play/1022141/Massive-Crowd-on-Assassin-s
[mh-lic]: https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html
[rb]: https://github.com/microsoft/Microsoft-Rocketbox
[rpm1]: https://www.pocketgamer.biz/netflix-acquires-avatar-creation-platform-ready-player-me
[rpm2]: https://genies.com/blog/ready-player-me-shutdown
[cmu]: http://mocap.cs.cmu.edu/faqs.php
[quat]: https://quaternius.com/packs/universalanimationlibrary.html
[quat2]: https://quaternius.itch.io/universal-animation-library
[ph]: https://polyhaven.com/license
[acg]: https://docs.ambientcg.com/license/

Links checked on 2026-11-16 (the Ready Player Me, Quaternius and Rocketbox facts by search; the rest are the
standard references for each technique).
