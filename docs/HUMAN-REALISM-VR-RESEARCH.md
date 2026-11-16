# Believable real-time humans for VR / 3D on a phone budget — research and the boxer rebuild (P3-FGT-17)

Status: phase 1 (research) and phase 2 (build) done. Presentation only: the server-authoritative engine, the money
paths and the keyed-arm animation system of P3-FGT-16 are untouched. Feature flag `NEXT_PUBLIC_FF_BODY_V6` (on unless
`0`; off falls back to the P3-FGT-16 bodies `boxer-{m,f}-v5.glb` and their shading). Evidence: `docs/QA/boxing-v6/`.

The user's verdict after P3-FGT-15, QA-HUM-01 and P3-FGT-16: *"person human parts are not properly built for
realistic. thus, do deep research on how to design a human realistic in VR and it more accurately handled."* The
screenshot named a smooth mannequin torso (no taper, ribs, abs, lats), cone chest, no deltoid / trapezius line, arms
like cylinders pushed into the trunk, a vest standing off the body with a dark cavity at the arm hole, a thick blocky
waistband, stiff tube trunks, blob gloves, a headgear that swallows the face, flat skin.

Sources are listed at the end (§12); each claim carries its source number in brackets. Items we could not verify
are marked **unverified**.

## 1. How production pipelines get believable real-time humans

| Pipeline | What it does that matters for us |
| --- | --- |
| Epic MetaHuman [1][2][3] | Published LOD table (vertex counts, guidelines): face 24k → 130 vertices LOD0–7, body 30.5k / 7.6k / 3.35k / 1.5k LOD0–3; corrective shapes only at LOD0–1; 12 skin influences at LOD0–2, 4 at LOD6–7; 669 face blend shapes only at LOD0. Materials drop features by LOD: micro skin-detail normals off at LOD1, animated (wrinkle) maps off and AO baked into colour at LOD2, a **baked normal map approximating the LOD0 shape** at LOD3, plain lit shading from LOD4. iOS / Android: best LOD is LOD3, textures capped at 2048, hair cards only. "Scalable normals" = tiling maps + region masks to cut memory. |
| Reallusion CC4 / CC5 game base [4][5] | Marketed as a ~10k-polygon game base with LOD1 ≈ 7k, LOD2 ≈ 0.8k (exact spec sheet **unverified**). Micro-normal defaults: tiling 20 on the face, 42 on the body [6]. Hides / deletes the body under clothing on export ("Delete Hidden Mesh") [7]. |
| EA Fight Night Round 4 / Champion [8][9][10] | GDC 2010 "Blood, Sweat, and Tears" (Vicki Ferguson): the skin shader's lighting model and its cost trade-offs. Champion: muscle flex, deformation and fat jiggle tied to physics; muscle definition mostly blended normal maps (forum claim, **unverified**). EA MMA (sister title): about a dozen texture channels into the skin shader, specular maps separating oily vs dry skin and selling sweat, SSS, SSAO, Kelemen specular, photo textures shot with a Macbeth chart. |
| Activision (Call of Duty) [11][12] | Next-gen character rendering (Jimenez, von der Pahlen): two specular lobes, pore-level normal detail, separable SSS. Wrinkle maps (Jimenez et al., GPU Pro 2): wrinkle normal maps weighted 0–1 per region by masks, over the base normal [13]. |
| Naughty Dog, The Last of Us Part II [14][15] | GDC 2021 "Character Technology" and SIGGRAPH 2020 slides: character authoring, shaders, optimisation (no public wrinkle-map specifics found: **unverified**). |
| VR boxing (Creed: Rise to Glory, The Thrill of the Fight) [16][17] | No published budgets. Survios describes its fighters as "between realistic and stylized"; Thrill of the Fight is a solo project with basic graphics. The take-away: shipping VR boxing titles accept stylisation; our bar (the user's) is higher than theirs on the figure, so the budget must go into silhouette, cloth contact and shading, not triangles. |
| Meta Quest / WebXR [18][19][20] | Quest 2 / Pro 750k–1M triangles per frame, Quest 3 / 3S 1.3–1.8M; draw calls 80–200 (Quest 2) / 200–300 (Quest 3) in a busy scene; skinning eats into the draw-call budget; WebXR: KTX 2.0 / Basis textures, one light with PBR, animation updated at ~30 Hz staggered, shadow maps counted in the budget. three.js `KTX2Loader.detectSupport` picks ASTC / ETC2 / BC at runtime; `renderer.xr.setFoveation`. |

What all of them share, and what we lacked: **(a)** a body whose large forms carry the anatomy (silhouette and
landmarks), **(b)** detail that is not in the triangles — baked normal / cavity maps from a sculpt, plus a tiling
micro-normal, **(c)** skin shading that keeps the terminator warm (SSS or an approximation) and breaks the specular
up, **(d)** clothes authored on the body that touch it where real clothes touch it, with the body removed underneath,
**(e)** props (gloves, headgear) at true product size.

## 2. Base mesh: topology and the landmarks that sell a body at a distance

- **Deformation topology** [21]: two full edge loops at each joint (one per bone) so the joint creases instead of
  collapsing; extra edges fanned to the inside of the bend; loops as rings, not spirals; test by binding early.
  MakeHuman's hm08 base mesh is a quad mesh authored for this (loops at the shoulder, elbow, wrist, hip, knee) and
  ships with its own default skeleton and weights [23]; it is the deformation base we keep (CC0 [24]).
- **Landmarks** [22]: the deltoid's three heads hang from the clavicle, acromion and scapular spine; the scapular spine
  sits between the trapezius and the deltoid; deltoid, trapezius and latissimus frame the "triangular window" of the
  back. In art-anatomy practice (no single game source ranks them: **unverified** as a game standard) the forms that
  read at 3–8 m are: the clavicle line and the trapezius slope from the neck into the shoulder, the rounded deltoid
  cap, the V of the lats into a narrower waist, the pectoral shelf, the ribcage-to-waist step, the glutes and the
  calf mass.
- **What MakeHuman offers for this (CC0)** [24][25]: regional targets — `torso/torso-vshape-*`,
  `torso-muscle-dorsi-*` (lats), `torso-muscle-pectoral-*`, `armslegs/*-upperarm-shoulder-muscle-*` (deltoid),
  `*-upperarm-muscle-*`, `*-lowerarm-muscle-*`, `*-upperleg-muscle-*`, `*-lowerleg-muscle-*` (calf),
  `stomach/stomach-tone-*`, `measure/measure-waist-circ-*`, `neck/neck-back-scale-depth-*` (the nearest thing to a
  trapezius target; there is none dedicated), `buttocks-volume-*`, and the breast cup / firmness macro targets. The
  P3-FGT-13…16 bodies used the macro targets only, which is why the trunk read as a smooth tube.

## 3. Detail without triangles

- High-to-low baking: normals first (check the cage), then AO / thickness / curvature / cavity [26][27]; MetaHuman's
  LOD3 uses exactly such a baked normal map to keep the LOD0 shape [2].
- Pores are too fine for the base normal map: a tiling micro-normal overlaid on it [6][28].
- **For us**: we have no licensed sculpt. The CC0 path is to treat MakeHuman's *most-defined* macro shape (max
  muscle, minimum fat — the sculptors' own muscle separations) plus the athletic regional targets as the "high", band
  -pass it along the normal (a difference of Laplacian smoothings: muscle separations, not the limb's roundness, not
  facets), subtract what the game mesh already shows, and rasterise the result into MakeHuman's UV layout as a
  tangent-space detail normal and a cavity map. The existing tiling pore normal stays on top.

## 4. Skinning

- Linear blend skinning (three.js `SkinnedMesh`, 4 influences) collapses volume at twisting joints (candy wrapper);
  dual-quaternion skinning removes that for ~7 more vertex instructions but bulges at bent joints and flips the long
  way round past 180° [29][30]; optimised centres of rotation fix the bulge offline [31]. three.js has no DQS; a
  community `onBeforeCompile` patch exists [32].
- Twist / helper bones: the UE mannequin and MetaHumans use two forearm twist joints; weight mostly to the twist bone
  near the wrist; never let a vertex's twist + parent weight exceed 1 [33][34].
- Pose-space deformation (Lewis et al. 2000) and corrective blend shapes driven by joint angles (Unreal's RBF Pose
  Driver on the clavicle / upper arm / lower arm) are how films and games keep shoulders and elbows in shape [35][36].
  The cheap three.js equivalent is CPU-evaluated angle → weight curves feeding `morphTargetInfluences`.
- **For us**: P3-FGT-14/16 already carry a shoulder helper (half the arm's swing, with a weight corrective round the
  joint) and a forearm twist bone (half the hand's roll), driven by the keyed anatomical angles with joint limits;
  P3-FGT-16 measured that the arms deform cleanly with correct angles. Research gives **no reason to replace** the
  keyed-arm system; DQS would add bulging at the elbows in the guard (130° flexion) for no visible gain under a vest.
  Pose-driven correctives are recorded as the next step for the trapezius in a shrug (§10).

## 5. Skin shading on a phone budget

| Technique | Cost | Verdict |
| --- | --- | --- |
| Screen-space separable SSS (Jimenez 2009 / 2015) [37][38][39] | < 0.5 ms desktop (2015), 1.06 ms on a GTX 580 (2012); an extra full-screen pass and a skin buffer — expensive on tiled mobile / Quest GPUs | Not on phones / XR |
| Pre-integrated skin (Penner, SIGGRAPH 2011 / GPU Pro 2) [40][41] | A 2D LUT by N·L × curvature, no extra pass | The model we follow |
| Wrap lighting (GPU Gems 1, ch. 16) [42] | A few ALU | The analytic core of our approximation |
| Fast translucency (Barré-Brisebois, DICE 2011) = three.js `SubsurfaceScatteringShader` [43][44] | Thickness map + view term | Possible for ears / fingers; gloves cover the fingers |
| `MeshPhysicalMaterial` transmission [45][46] | Re-renders the opaque scene into a transmission target | Avoid for skin |
| Two specular lobes (Unreal dual specular 0.75 / 1.3 / 0.85; Kelemen / Szirmay-Kalos in NVIDIA's d'Eon & Luebke) [47][48][49] | One more GGX term | Already in (the clearcoat lobe grows with sweat) |

Skin roughness starts around 0.4 in Unreal's guidance [48]; d'Eon uses ~0.3 on the face [49]; roughness breakup
(oily vs dry zones) is what EA used to sell sweat [10].

**For us**: a per-channel wrap of N·L that widens with curvature (red widest: R 0.36, G 0.15, B 0.10 × curvature;
the head 1.0, the body 0.65) shaped with a smooth step — Penner's look without the LUT texture — for the direct light
only, specular unchanged; a gentle tonal breakup (a few cm) and a specular roughness breakup; the cavity map
darkens grooves; the old indirect "scatter fill" is dropped to a thin rim (it lifted the whole body orange).

## 6. Clothing

- Garments are authored on the body (Marvelous Designer on the base body, zero gravity to avoid baked T-pose
  creases; quad retopology) [50][51]; skin weights transferred from the body by closest point / inpaint, border
  vertices (shoulder, waist, knee) copied from the nearest body vertex so poses do not open gaps [52][53].
- The body under clothing is removed (CC4 "Delete Hidden Mesh") — saves cost and prevents poke-through [7].
- Standard practice (**unverified**, no authoritative citation found): a turned-in hem strip one or two loops deep
  so edges read as thick; arm-hole / neckline interiors closed with an inward strip; folds of tight, stretchy garments
  baked into normal maps; simulation only for loose trunks / robe hems (on Quest: a few bones or a vertex wobble).
- **For us**: our vest is a shell on a radial drape of the body (P3-FGT-15) with a bound edge (P3-FGT-16) and the body
  dropped ≥ 2.2 cm inside its edges. Its faults were all "shirt, not singlet": the drape bridged the armpit hollow
  from the chest's outer envelope (the dark cavity at the arm hole), let the cloth come in by only 0.22 m per metre of
  height (a tube, no taper), and the inside of the garment was visible through the neckline and arm holes.

## 7. Boxing kit: real dimensions

- Glove weights by bodyweight in AIBA-era amateur boxing: 10 oz for 48–64 kg, 12 oz for 69–91+ kg; red or blue to
  match the corner [54][55]. 16 oz is the standard adult sparring glove [56]. Measured masses: 10 oz = 278 g, 16 oz =
  455 g [57]. Manufacturers (Cleto Reyes, Winning, Everlast) do not publish length / width / cuff measurements
  (**unverified**; retailer "dimensions" are packaging). Product photographs and our own estimate: a 10–12 oz
  competition glove is ≈ 27–29 cm overall, 11.5–12 cm across the knuckles, narrower at the heel of the palm, a
  hook-and-loop cuff ≈ 6 cm long and a white scoring area over the knuckles on competition gloves.
- Competition headgear is open-face: forehead bolster, cheek and temple pads, ear coverage, red / blue [58][59].
  World Boxing is the governing body now; a November 2025 proposal would make headgear mandatory for elite men too
  (adoption **unverified**) [60].
- **For us**: the P3-FGT-16 glove was one width (13 cm) from the wrist to the knuckles on a 10 cm cuff, 32 cm long —
  a blob; the headgear's opening ended just above the eyes with thick cheek pads.

## 8. Athletic adult anatomy (both sexes, 18+, respectful)

- Elite Olympic boxers are predominantly mesomorphic; body fat ≈ 17 % (women) and ≈ 5 % (men) in a small sample
  (Hausen et al. 2024; 4 women, 10 men) [61]; high-level boxers tend toward low body fat, male boxers toward high
  mesomorphy (Chaabène et al. 2015) [62]; size rises with weight class [63]. No boxer shoulder-to-waist ratio study
  was found (**unverified**).
- Depiction: a lean, functional mesomorph varied by weight class, never exaggerated; women's kit covers like real
  competition kit (singlet over a sports bra, trunks). Our feminine sculpt adds a smaller, firmer, less pointed bust
  (a sports bra under the vest) and the same muscle groups at lower weights than the masculine one; nothing is
  sexualised, and the bodies stay adult (age macro 25–30 y).

## 9. LOD and impostors for VR

Octahedral impostors (Brucks 2018, Fortnite) suit distant static crowds, not an animated opponent [64][65]; dithered
cross-fades between LODs avoid pops (Unity LODGroup) [66]; three.js `LOD.addLevel(object, distance, hysteresis)` [67].
Our ring people are one skinned mesh and one draw call each (+ shadow) at ≈ 28–30k triangles; the far crowd is not
these bodies. The anatomy map is a single 1K texture per gender for every distance; MetaHuman drops its detail
normals at LOD1 — the shader fades the pore micro-normal beyond 16 m already (`uDetail`).

## 10. Licence-clean asset sources (commercial web game, assets shipped to the browser)

| Source | Commercial web game? | Terms that matter |
| --- | --- | --- |
| MakeHuman 1.x assets (base mesh, targets, skeleton, weights, system skins) [24] | **Yes** (CC0) | Repo LICENSE: assets CC0; "no output from MakeHuman contains any trace of program logic" (the AGPL code does not reach exports). Old `.mhmat` headers still say AGPL; the repo-level licence overrides. System skins are **diffuse only** (no normal / roughness maps) [68]. |
| MPFB2 [69][70] | **Yes** for assets (CC0); code GPLv3 | Its "enhanced skin" is a Blender node tree with procedural normals — nothing baked to export. |
| Smokeworks Skins Vol.0 (MakeHuman UV, normal + ORM) [71] | Yes with attribution (CC-BY 4.0) | A credits line; evaluated, not used (we needed anatomy, not another albedo). |
| Poly Haven [72] | **Yes** (CC0) | No human skin in the library. |
| ambientCG [73] | **Yes** (CC0) | "You can include the raw files in your project, for example a video game"; no human skin. |
| Fab / Megascans (Standard licence) [74] | **Yes** | Not limited to Unreal; no standalone redistribution. The full library has been free since 12 Nov 2026 [75] — worth a look for fabric detail. |
| 3D Scan Store free samples [76] | **No** without written permission | "Use commercially or for profit a free download or giveaway product without expressed permission" is prohibited. |
| Texturing.xyz free items [77] | **No** without permission | Same clause. |
| Sketchfab CC-BY body scans / gloves / headgear [78][79] | Yes, with credits (CC-BY 4.0) | §2(a)(5)(B) forbids "effective technological measures" on the shared material (grey area for obfuscated assets). No CC0 full-body scans found; CC-BY examples: "Athletic African man walking 223" (100k faces, `f9a8e3b1…`), boxing gloves 2–4k faces (`5b464201…`, `58b8fd62…`, `a44ac1f1…`), headgear 13–19k faces (`49838776…`, `9a43d176…`). Raw scans need retopology to our rig. |
| Renderpeople (free and paid) [80] | Games allowed, **risky in a browser** | §4.3(b) forbids making the 3D data available so third parties can easily extract it — a GLB in a web page arguably does. |
| Microsoft Rocketbox [81] | **Yes** (MIT) | The plaza bodies today. |
| Epic MetaHuman [82] | Allowed outside Unreal since June 2025 (press; binding EULA behind a login: **unverified**) | **This project's brief excludes MetaHumans**; also far over the web budget. |

Paid options are listed in §11 for the user's decision; nothing was bought.

## 11. Decision, build and results

### Chosen approach (all CC0, in-house)

1. **Athletic sculpt** from MakeHuman's regional CC0 targets on top of the macro model (§2), per gender, scaled on
   the heavy / slim / mature body-type morphs (`build.mjs ATHLETIC`).
2. **Baked anatomy detail map** (`anatomy-bake.mjs`, §3): `body-detail-{m,f}.webp`, 1K, RG = tangent-space detail
   normal, B = cavity, near-lossless WebP (227–249 KB); faded off the face and the hands / feet.
3. **Skin pass** (§5): the analytic pre-integrated-style diffuse, roughness and tonal breakup, cavity, no orange fill.
4. **Garments that behave like a singlet and trunks** (§6): the arm hole's lower half lies on the body (the cloth is
   blended from the drape onto the skin within ~6 cm of the edge, 2 mm over it); a fitted drape (0.55 m/m) so the
   V-taper shows; a facing turned in under the binding (as long as the gap, ≤ 1.6 cm, skinned with the edge) so the
   inside of the shell is never seen through the neckline; the vest lies on the smoothed body at the tuck (no navel /
   abs printing); trunks with a snug 11 mm waistband (was a 1.7 cm ring) and a 4.5 cm band (was 6), legs falling loose
   into five broad flutes at the hem; procedural fold normals (vest tuck ripples and jersey wrinkle; trunks' vertical
   folds and hip creases).
5. **Kit at product size** (§7): the glove re-proportioned (cuff 8.8 × 7 cm, 6 cm of cuff, 9.6 cm at the heel of the
   palm widening to 11.6 cm at the knuckles, a domed knuckle pad, ≈ 28.5 cm; × 0.94 for the 10 oz feminine glove)
   with the white competition scoring panel drawn as an anti-aliased mask on the glove's own coordinates; the
   headgear's face opening widened to ±53° and raised over the brows, the brow bolster starting above it (no visor),
   thinner cheek pads, a softer edge roll.
6. Kept: the keyed anatomical arms and joint limits (P3-FGT-16), the shoulder / forearm helper bones, the MakeHuman
   skeleton and weights, the photo skin textures, one skinned mesh + one material per person.

Why this path: it attacks every item in the user's screenshot with assets we may ship, inside the phone budget, and
it is the same structure production uses (sculpted forms → baked detail → layered shading → body-authored cloth).
What it cannot do is replace a sculptor: the "high" is MakeHuman's generic athletic sculpt, not a scanned athlete
(§11, paid options).

### Results

Full tables and sheets: `docs/QA/boxing-v6/README.md`. In short:

- **Rubric (boxers)**: proportions 4 → 4 (now also visually: taper, deltoid, neck / trapezius); hands / gloves 3 → 4;
  clothing 2 → 3 (4 at gameplay distance; boxers' garment vertices inside the skin in a pose 3.5–4.5 % → 2.0–2.9 %,
  at rest ≈ 2 % → 0–0.13 %); skin 3 → 3 (better at 1–3 m, not a close-up 4); arms 4 (unchanged system); motion 3
  (unchanged); performance 4 → 5.
- **Budget**: 28.3k / 28.1k triangles per boxer, one draw call + shadow; practice ring 8 calls, 98.8k triangles,
  60 fps at 1280×720 and 844×390 DPR 2; GLBs 3.24 / 3.20 MB; the anatomy map 1K WebP 249 / 227 KB (5.3 MB on the GPU);
  textures per person 29.3 MB desktop / ≈ 13.3 MB phone.
- **Not reached without paid assets** (evidence in the sheets' close-ups): skin 4 at head-and-shoulders (scanned skin
  detail), clothing 4 in close-up (authored, sculpted / simulated fold maps), motion 4 (captured boxing motion).
- **Rebuild**: `MH_DIR=<makehuman checkout>/makehuman/data node apps/web/scripts/boxer/build.mjs` (commit
  `a8bc2d54…`; `cwebp` on the PATH writes the anatomy WebP; `V5=1 ATHLETIC=0 BAKE=0` switches the P3-FGT-17 build changes off — the P3-FGT-16 GLBs themselves are kept as `boxer-{m,f}-v5.glb`).

### Paid options (not bought; for the user to decide)

| Option | Cost (public info, verify before buying) | Licence terms that matter | Expected gain |
| --- | --- | --- | --- |
| 3D Scan Store "Animation Ready" retopologised athletic body scans (Male 04 / 06 / 36, Female 01–04) [83] | £69.99 each list (often discounted) **+ £499.99 Commercial Single Project licence** (R&D licence £199.99 does not cover shipping) | One project per licence; bans use in "any character maker programme whereby the results can be exported" — ask in writing whether an in-game look editor without export is allowed | A real athlete's anatomy as the bake source: muscle, tendon and skin folds from a scan instead of MakeHuman's generic sculpt. Retopology / wrap to hm08 so rig, garments and morphs keep working: ≈ 3–5 days. Skin 3→4 and proportions / anatomy 4→4+ at close range. |
| Texturing.xyz VFace (e.g. #148) [84] | $39.90 personal / **$299.90 commercial** per face | Games and VR allowed embedded; no raw redistribution | 16K albedo / displacement → baked 1K face detail maps: face and skin close-up 3→4 for hero characters. |
| Reallusion CC5 (CC4 is no longer sold) + Headshot 3 [85] | CC5 $299 perpetual ($99/yr); Headshot 3 $199; SkinGen price **unverified**; **Enterprise licence by quote** for in-game character customisation | Standard / Extended export licences cover fixed characters; a player look editor needs Enterprise | Production faces, bodies, hair cards and game LODs for 4–6 hero characters (referee, coaches, AI opponents); the player's own fighter stays on the CC0 pipeline. |
| CGTrader / Superhive game-ready gloves + headgear [86] | $5–35 per set | Royalty-free standard licence (check each listing) | Hand-modelled stitching / laces / logos-free leather maps; small gain over the procedural kit, which is now product-sized. |
| Boxing mocap (studio day or a commercial pack with a game licence) | Studio day ≈ $1–3k (**unverified**) | Must permit retargeting and shipping | Motion 3–4 → 4+ (captured rhythm and secondary motion); retarget onto the keyed angle channels. |

## 12. Sources

1. MetaHuman platform support and LOD specifications — https://dev.epicgames.com/documentation/en-us/metahuman/platform-support-and-lod-specifications-for-metahumans
2. MetaHuman materials and textures — https://dev.epicgames.com/documentation/metahuman/metahuman-materials-and-textures?lang=en-US
3. MetaHuman scalable normals — https://dev.epicgames.com/documentation/metahuman/scalable-normals-assembly-in-metahuman-creator?lang=en-US
4. Reallusion game pipeline — https://www.reallusion.com/Character-Creator/game-pipeline.html
5. Reallusion LOD characters — https://cdn-www.reallusion.com/character-creator/lod-characters.html
6. CC4 manual, micro normal — https://manual.reallusion.com/Character-Creator-4/Content/ENU/4.0/15_Digital_Human_Shader/Skin/Micro_Normal.htm
7. CC4 manual, hiding inner meshes — https://manual.reallusion.com/Character-Creator-4/Content/ENU/4.0/08_Cloth/Hiding_Specific_Inner_Meshes.htm
8. GDC Vault, Fight Night Round 4 skin shaders — https://gdcvault.com/play/1012956/
9. EA, Fight Night Champion art — https://www.ea.com/en-gb/news/fight-night-champion-art
10. CGW, "Keeping It Real" (EA MMA) — https://www.cgw.com/Press-Center/Web-Exclusives/2011/Keeping-It-Real.aspx
11. Next-Gen Character Rendering (Activision) — https://www.scribd.com/document/438787655/Next-Gen-Character-Rendering
12. Material advances in Call of Duty: WWII — https://research.activision.com/publications/archives/material-advances-in-call-of-dutywwii
13. Jimenez et al., wrinkle maps — https://www.iryoku.com/wrinkles
14. GDC Vault, Character Technology of The Last of Us Part II — https://gdcvault.com/play/1027376/Character-Technology-of-The-Last
15. Naughty Dog at SIGGRAPH 2020 — https://www.naughtydog.com/blog/naughty_dog_at_siggraph_2020
16. Survios character art (Creed) — https://dkwoods.artstation.com/projects/v11Xka
17. Meta, The Thrill of the Fight on Quest — https://www.meta.com/blog/come-out-swinging-in-the-thrill-of-the-fight-available-now-on-oculus-quest/
18. Meta Quest performance (Unity) — https://developers.meta.com/horizon/documentation/unity/unity-perf/
19. Meta WebXR performance best practices — https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/
20. three.js KTX2Loader / web texture formats — https://threejs.org/docs/pages/KTX2Loader.html · https://www.donmccurdy.com/2024/02/11/web-texture-formats/
21. Polycount, limb topology — https://polycount.com/discussion/comment/2642414/
22. Anatomy for sculptors, shoulder bony landmarks — https://anatomy4sculptors.com/blog/shoulder-bony-landmarks/
23. MakeHuman default skeleton and weights (data/rigs) — https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data/rigs
24. MakeHuman LICENSE (assets CC0) — https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md
25. MakeHuman targets tree — https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data/targets
26. Frozenbyte baking workflow — https://wiki.frozenbyte.com/index.php/3D_Asset_Workflow:_Baking
27. Marmoset Toolbag baking — https://docs.marmoset.co/?p=1383
28. Epic, creating human skin — https://dev.epicgames.com/documentation/unreal-engine/creating-human-skin-in-unreal-engine
29. Kavan et al., dual quaternion skinning — https://users.cs.utah.edu/~ladislav/dq/
30. Kavan et al. 2008, approximate DQ blending — https://users.cs.utah.edu/~ladislav/kavan08geometric/kavan08geometric.html
31. Le & Hodgins, optimized centers of rotation — https://la.disneyresearch.com/wp-content/uploads/Real-time-Skeletal-Skinning-with-Optimized-Centers-of-Rotation-Paper.pdf
32. three.js forum, DQS — https://discourse.threejs.org/t/having-a-hard-time-figuring-out-tsl-for-webgpu-support-dqs-implementation/84845
33. Polycount, twist bones — https://polycount.com/discussion/comment/2681188
34. Unreal forums, wrist twist collapse — https://forums.unrealengine.com/t/wrist-twist-collapse-in-editor/430689
35. Lewis, Cordner, Fong 2000, pose space deformation — https://www.scribblethink.org/Work/PSD/PSD.pdf
36. Unreal Pose Driver — https://docs.unrealengine.com/4.27/AnimatingObjects/SkeletalMeshAnimation/AnimPose/PoseDriverNode/
37. Jimenez et al. 2009, screen-space skin — https://graphics.unizar.es/papers/Screen-Space-Perceptual-Rendering-of-Human-Skin.pdf
38. Separable SSS 2015 — https://diglib.eg.org/handle/10.1111/cgf12529
39. Separable SSS tech report 2012 — https://graphics.unizar.es/papers/s4_techreport12.pdf
40. Penner, pre-integrated skin (SIGGRAPH 2011) — https://www.slideshare.net/slideshow/penner-preintegrated-skin-rendering-siggraph-2011-advances-in-realtime-rendering-course/13966747
41. Notes on skin shading (LUT errata) — https://jonmoore.squarespace.com/blog/2014/4/19/notes-on-skin-shading.html
42. GPU Gems 1 ch. 16 — https://developer.nvidia.com/gpugems/gpugems/part-iii-materials/chapter-16-real-time-approximations-subsurface-scattering
43. DICE fast translucency — https://ea.com/frostbite/news/approximating-translucency-for-a-fast-cheap-and-convincing-subsurface-scattering-look
44. three.js SubsurfaceScatteringShader — https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/shaders/SubsurfaceScatteringShader.js
45. three.js MeshPhysicalMaterial — https://threejs.org/docs/pages/MeshPhysicalMaterial.html
46. three.js WebGLRenderer (transmission pass) — https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/WebGLRenderer.js
47. Unreal digital humans / subsurface profile — https://docs.unrealengine.com/4.26/Resources/Showcases/DigitalHumans · https://docs.unrealengine.com/5.0/en-US/PythonAPI/class/SubsurfaceProfileStruct.html
48. Epic, creating human skin (roughness) — https://dev.epicgames.com/documentation/unreal-engine/creating-human-skin-in-unreal-engine
49. GPU Gems 3 ch. 14 / d'Eon GDC 2007 — https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch14.html · https://developer.download.nvidia.com/presentations/2007/gdc/Advanced_Skin.pdf
50. Marvelous Designer user spotlight — https://www.marvelousdesigner.com/learn/userspotlight/post/9aba618a803e4e5eb7adb3f7ac375ee9
51. 80.lv, Marvelous Designer tutorials — https://80.lv/articles/80-level-ratings-great-youtube-tutorials-on-marvelous-designer
52. Unreal, transfer skin weights — https://dev.epicgames.com/documentation/unreal-engine/create-an-action-utility-for-transferring-skin-weights-in-unreal-engine?lang=en-US
53. Unreal forums, fitting clothing to MetaHumans — https://forums.unrealengine.com/t/fitting-armour-clothing-to-metahumans-in-ue-5-8-3-best-workflow-to-avoid-hours-of-manual-fitting-per-set/2839852
54. Adidas AIBA gloves listing — https://www.budoonline.co.uk/products/adidas-aiba-boxing-gloves-leather-10oz-12oz-sparring-aibag1-red-blue
55. Boxing 101 equipment — https://www.wptv.com/news/boxing-101-equipment
56. Cleto Reyes size guide — https://made4fighters.com/pages/cleto-reyes-training-gloves-size-guide
57. Glove mass measurements — https://file.scirp.org/Html/10-1560718_94445.htm
58. Adidas amateur competition headgear — https://us.adidascombatsports.com/products/adidas-amateur-competition-boxing-headgear
59. AIBA contest headguards — https://www.geezersboxing.co.uk/boxing-headguards/aiba-contest-headguards
60. World Boxing rulebook amendment proposal (Nov 2025) — https://worldboxing.org/wp-content/uploads/2025/11/10.-Proposal-for-Rulebook-amendments-bundle.pdf
61. Hausen et al. 2024 — https://lida.sport-iat.de/ta/Record/4088434?lng=en
62. Chaabène et al. 2015 — https://doi.org/10.1007/S40279-014-0274-7
63. Japanese boxers anthropometry — https://pmc.ncbi.nlm.nih.gov/articles/PMC4155226
64. Octahedral impostors — https://smailikhappy.github.io/posts/Octahedral_imposters/
65. three.js octahedral impostors — https://discourse.threejs.org/t/octahedral-impostors-for-three-js/80318
66. Unity LODGroup — https://docs.unity3d.com/6/Documentation/Manual/class-LODGroup.html
67. three.js LOD — https://threejs.org/docs/pages/LOD.html
68. MakeHuman skins (py3 assets mirror) — https://github.com/dmaugis/makehuman-py3-assets/tree/master/base/skins
69. MPFB2 licence — https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md
70. MPFB2 enhanced skin / MakeSkin — https://github.com/makehumancommunity/mpfb2/blob/master/docs/entities/material/enhancedskinmaterial.md · https://github.com/makehumancommunity/mpfb2/blob/master/docs/ui/create_assets/makeskin.md
71. Smokeworks Skins Vol.0 — https://rpatterson-smokeworks.itch.io/skins-vol0
72. Poly Haven licence — https://polyhaven.com/license
73. ambientCG licence — https://docs.ambientcg.com/license/
74. Fab EULA — https://www.fab.com/eula
75. CG Channel, Megascans free — https://www.cgchannel.com/?p=179945
76. 3D Scan Store terms — https://www.3dscanstore.com/terms-and-conditions-licensing
77. Texturing.xyz terms — https://texturing.xyz/pages/terms-of-service
78. CC BY 4.0 legal code — https://creativecommons.org/licenses/by/4.0/legalcode.en
79. Sketchfab search API (body scans, gloves, headgear) — https://api.sketchfab.com/v3/search?type=models&q=boxing%20gloves&downloadable=true
80. Renderpeople terms — https://renderpeople.com/general-terms-and-conditions/
81. Microsoft Rocketbox — https://github.com/microsoft/Microsoft-Rocketbox
82. CG Channel, MetaHuman licence change — https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/
83. 3D Scan Store animation-ready Male 04 — https://www.3dscanstore.com/retopologised-body-models/animation-ready-body-scans/animation-ready-body-scan-male-04
84. Texturing.xyz VFace #148 — https://texturing.xyz/collections/vface/products/vface-yan-148
85. Reallusion pricing / Headshot 3 — https://www.reallusion.com/plan-and-pricing/individual/perpetual?product=cc · https://www.cgchannel.com/2026/07/reallusion-releases-headshot-3-0/
86. CGTrader / Superhive gloves — https://www.cgtrader.com/3d-models/sports/equipment/boxing-gloves-and-head-gear · https://superhivemarket.com/products/boxing-gloves-game-ready3d-model
