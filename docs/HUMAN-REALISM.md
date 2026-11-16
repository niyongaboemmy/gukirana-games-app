# Realistic humans in the browser (P3-FGT-15, phase 1)

Status: implemented for every ring person (boxers, referee, corner team, judges, hall staff) and as an everyday person
(the `casual` outfit); the plaza player avatar stays on the Rocketbox base in this task (see §6). Evidence:
`docs/QA/evidence/p3-fgt-15/`. Builds on docs/FIGHT-REALISM-V3.md / V4.md (the MakeHuman body pipeline).

## 1. The complaint, in the user's words and in ours

"The persons are designed wrongly … cartoon-style, plastic skin, the vest painted onto the body so the chest shows
through, generic faces." Our own reading of the P3-FGT-14 ring (`before-*` evidence):

| Gap | Cause |
| --- | --- |
| Vest painted on the body: the chest anatomy reads through it | The vest was a shell offset 5–11 mm along the body's normals: it followed every curve of the bust and the muscles, and the cavity bump of the body was drawn on it too |
| Plastic skin | No textures at all: one flat colour per person, a noise bump, a rim-light "SSS" |
| Generic, doll-like faces, dead eyes | No skin detail; the eyes were a procedural disc on the base mesh's helper ball |
| Helmet hair | The hair was a 1–2 cm bowl from the head's outer envelope |

## 2. Research: what real-time realistic humans need, and what the web can do

State of the art (games / Unreal MetaHuman / Unity Digital Human, ideas only):

- **Skin** is the biggest single factor. Photogrammetry albedo (no baked light), a high-frequency normal map (pores,
  wrinkles) plus a tiling micro-normal for close-ups, a cavity / AO term, and a roughness map (oily T-zone, matte
  cheeks). Shading: subsurface scattering (screen-space separable SSS in AAA; pre-integrated / wrap lighting on mobile),
  two specular lobes (a rough sheen and a sharper oily lobe), no grey shadows (the terminator stays warm red).
- **Eyes**: separate sclera / iris / cornea, refraction or a parallax iris, a wet cornea reflection, a "wet line" at the
  lid, eye occlusion (soft shadow from the lids), saccades and blinks.
- **Hair**: strand cards with alpha-to-coverage (MSAA) or dithered alpha, Kajiya-Kay / Marschner anisotropic highlights
  (primary + shifted secondary); short hair as a scalp texture plus sparse cards.
- **Hands**: real finger bones and poses (idle curl, gesture), knuckle creases.
- **Animation**: locomotion with foot IK and no sliding (speed-matched clips, phase-locked stops), idle variety, eye
  saccades, blinks, facial expressions driven by intent (effort, pain, relief, joy).

What WebGL2 / three.js r187 gives us cheaply: `MeshPhysicalMaterial` (clearcoat = a second specular lobe, sheen for
cloth, anisotropy), derivative-based detail normals, alpha hash / alpha-to-coverage, skinned meshes with morph targets.
Not affordable here: screen-space SSS passes (an extra full-screen blur and a separate skin buffer: ruins the phone
budget and the WebXR path), strand hair, ray-traced eye refraction.

**Bases and licences evaluated** (commercial web app, assets shipped to the browser):

| Option | Quality | Size | Licence | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| MakeHuman 1.x base mesh + targets + skeleton (already ours) | Good anatomy, real quad topology, a full face rig after our merge | 3 MB GLB / gender incl. garments | CC0 | — | **Kept** |
| MakeHuman 1.2 system assets: skins (young / middle-aged / old × light / dark × m / f), eye proxy + textures, hair, brows, lashes, clothes | Photo-sourced 2K skins (pores, lighter palms and soles, natural hairline), real eye textures | 2K PNG 3–4 MB each (we ship WebP 1.5–1.8 MB, 1K for phones 0.4–0.5 MB) | **CC0** (each file: "explicitly released as CC0 in september 2020") | Low: same UV layout as the base mesh | **Used** (dark-skinned skins, eye texture, high-poly eye proxy) |
| MakeHuman community skins (OpenGameArt mirror, "Toigo" packs) | Light skin only | 2K | CC0 | Low | Evaluated, superseded by the system skins (dark skin fits our players) |
| Microsoft Rocketbox (plaza today) | Photo textures, 2010s topology, no skin detail maps | 0.6–0.8 MB | MIT | — | Kept for the plaza (§6) |
| Epic MetaHuman | Best available | 30–200 MB per character, 8K maps, 600k+ tris LOD0 | Since June 2025 Epic says MetaHumans may be used in other engines (seat licence above $1M revenue). **This project's rule: not used** (the brief excludes them; also far over the web budget and the export path is Unreal-centric) | Very high | Rejected |
| Reallusion Character Creator 4 exports | Very good, game LODs | 5–20 MB | Paid; in-game character customisation needs an Enterprise licence | High | Paid upgrade (§7) |
| 3D scan stores (heads / bodies) | Excellent faces | 50–300 MB raw, needs retopo + baking | Paid per asset, game use allowed by most | Very high | Paid upgrade (§7) |
| Mixamo / Ready Player Me / VRoid | Stylised or redistribution-restricted | — | Not allowed / stylised | — | Rejected (as before) |
| CMU mocap (boxing / locomotion) | Real motion | BVH | Free for all uses (CMU) | Retarget work | Not needed this task: the boxing rig is IK-driven (§BOXING-V5) |

## 3. Decision

One realistic human pipeline for everyone who is not the plaza player avatar: the MakeHuman CC0 body we already build
(`apps/web/scripts/boxer/build.mjs`), now **with MakeHuman's own UV layout**, **photo skin from the CC0 dark-skinned
system skins** (tone-relative, so every skin tone of the avatar editor keeps the photo's detail), **MakeHuman's eye
proxy and eye texture**, garments that hang as cloth, and a shader that does the cheap 80 % of a digital-human shader.
Budget held: one skinned mesh and one material per person (one draw call + shadow), ≈ 56–60k triangles at close range,
three textures shared by everyone.

## 4. What was built

**Skin texture** (`apps/web/scripts/boxer/skin_textures.py`, outputs `skin-{m,f}.webp` 2K and `-1k.webp`):
- source: `young_darkskinned_{male,female}_diffuse.png` (CC0, 2048 px, photo-sourced);
- stored **relative to the skin's median colour** (RGB × 0.5: 128 = the mean), after flattening the photo session's
  lowest frequencies, so the shader multiplies the avatar's own tone: `albedo = tone · lum(ratio)^2.2 · chroma(ratio)`;
  on darker tones the light skin's pink lips / cheeks become a deeper brown flush (chroma eased);
- alpha = fine height (luminance high-pass: pores and creases) for bump mapping;
- the groin is filled with the surrounding skin (always under clothing anyway: no anatomical detail ships);
- the scalp carries the source's natural close-cropped hairline (it becomes the player's hair colour, matte, in the
  shader).

**Detail tile** (`human-detail.webp`, 512 px, generated): RG = a pore / micro-wrinkle normal (jittered Worley pits on
fine noise and crossing micro-grooves), tiled ×56 over the body UV; BA = a knit normal for jersey (vest, tee, polo,
shirt), tiled ×70. Faded with distance (`uDetail` off beyond 16 m).

**Shader** (`world/human/boxer/boxer-material.ts`, `MeshPhysicalMaterial` + `onBeforeCompile`):
- skin: the texture as above; bump from the fine height; the micro-normal on a derivative tangent frame; roughness from
  the height (pores rougher) and sweat; **second specular lobe** through the clearcoat (thin oily layer, grows with
  sweat); **subsurface approximation** (warm deep-red light at grazing angles and a little warm fill on the shadow side,
  never grey); facial **flush** with effort / work done; hit redness (head / torso; never blood or injury);
- eyes: MakeHuman's high-poly **eye proxy** fitted with MakeHuman's own `.mhclo` maths (`mh.mjs readProxy`), its UV on
  the eye texture (veined sclera, photographic iris turned to luminance and tinted with the player's eye colour,
  pupil), under a fully wet cornea (clearcoat 1, roughness 0.02); the proxy's separate cornea layer is dropped;
- lashes: the base mesh's lash helpers drawn as strands (stochastic discard), not black ribbons;
- hair: a close crop — the photo scalp hairline plus a 2–5 mm shell of strands over it (stochastic coverage thinning
  out towards the hairline: `_ao` carries the distance from the hairline), matte, in the player's hair colour;
- fabric: knit micro-normal on jersey, physical sheen per slot (satin trunks strongest), leather / satin clearcoat.

**Garments are real geometry** (`build.mjs`):
- the vest now hangs as cloth: the referee shirt's drape (per height slice the body's outer envelope, the cleavage and
  the spine groove bridged, small bumps never printed: 1.4 cm over the smoothed body; at most 0.22 m/m of inward
  slope below the chest), tucked under the trunks' waistband; 5 mm of fabric, a 6 mm bound edge at the neckline and arm
  holes; the body under it is not drawn. Draped garments no longer take the body's muscle-cavity bump (`flatAo`);
- the everyday person (`outfit="casual"`): a draped tee in the look's top colour, trousers in its bottom colour
  (catalogue colours), shoes.

**Animation / face** (kept from P3-FGT-13/14, verified on the new body): finger poses (referee count, gloves' fists,
relaxed idle hands), blinks and focus / effort / wince / smile / breathing channels; P3-FGT-15 adds the flush. The
everyday person walks with the motion library's walk (IK feet on the canvas).

## 5. Results and honest realism assessment

Before / after close-ups, the everyday person and the ring people: `docs/QA/evidence/p3-fgt-15/`
(`human-*`, `face-*`, `vest-*`).

- **Better, clearly:** real skin detail and colour variation (pores, lips, palms, a natural hairline), eyes that read as
  eyes (iris, highlight), no anatomy through the vest, hair that reads as a real close crop instead of a helmet,
  shading without plastic shadows.
- **Still not photoreal, and why:** (1) the MakeHuman base head is a generic sculpt with ~1 cm geometric detail —
  a scanned head would carry the real micro-shape of nose, lids and lips; (2) no screen-space SSS, no eye refraction,
  no lid occlusion / tear line; (3) skin textures are 2K for the whole body (the face gets ~512 px); a 4K face map
  alone would exceed the phone budget; (4) clothes have no simulated folds (the drape is a static shape with
  procedural folds); (5) the gloves and headgear are procedural shapes with leather shading, not scanned products.
  Within a 60k-triangle, one-draw-call, 2K-texture, phone-safe budget this is close to what real-time web gets without
  scanned assets; "live-action" realism needs the paid assets of §7 and a heavier renderer than our phones allow.

## 6. The plaza avatar (not migrated in this task)

The plaza player avatar (Rocketbox MIT bodies, `world/Avatar.tsx`) carries the avatar editor (looks, hair styles,
outfits, face sliders, age ranges), seated poses on every seat profile, the conversation / life clips and the crowd
LODs. Moving it onto the new human is a migration of its own (retarget the Rocketbox clips onto the MakeHuman rig or
re-author them, map the 30+ outfit items onto draped garments, rebuild the hair styles as cards, re-fit the seat
profiles, LOD / impostors for 250-draw-call crowds, look migration). Not done here; the hall staff, the referee, the
corner team, the judges and every fighter (including the player's own fighter, with their look: tone, eye colour,
brows, facial hair, face shape, gender, age) are on the new human.

## 7. Paid upgrade options (not bought; for the coordinator to ask the user)

| Option | Cost (2025–26 public info, verify before buying) | Licence terms that matter | What it would improve |
| --- | --- | --- | --- |
| Reallusion Character Creator 4 + Headshot 2 (photo → head) + SkinGen | CC4 ≈ USD 299 (launch price; current pricing on reallusion.com), plugins extra | Exported characters may ship in games under the Standard / Extended export licence; **in-game character creation / customisation needs an Enterprise licence** (ask Reallusion, developer@reallusion.com) | Production-grade faces and bodies with game LODs, 4K skin with SkinGen detail layers, real hair cards, expression blend shapes (ARKit 52) |
| Scanned head / body packs (3D scan stores) | ≈ USD 50–300 per head / body | Usually allowed in games when embedded (not redistributable as raw files); read each store's game clause | Real faces and real micro-shape; needs retopology to our rig and baking (several days per character) |
| Texturing.XYZ multi-channel face maps | ≈ USD 30–150 per face set | Game use allowed embedded in a product | 16K-source skin displacement / albedo for the face; would replace our 2K face area with baked 1–2K face-only maps |
| MetaHuman | Free below USD 1M revenue; Unreal seat above | Epic changed the licence in 2025 to allow other engines, **but this project's brief forbids MetaHumans**; also far over the web budget | Best faces / grooms; would still need heavy decimation for the web |

Recommended if the user wants to go further: CC4 for 4–6 hero characters (referee, corner coach, the AI opponents)
with an Enterprise-licence question first, keeping our CC0 pipeline for the player's own fighter (customisation).

## Sources

- MakeHuman system assets (CC0 since September 2020), MakeHuman Community 1.2.0 release — http://download.tuxfamily.org/makehuman/releases/
- MakeHuman community skins mirrored on OpenGameArt (CC0) — https://opengameart.org/content/toigo-natural-male-skin · https://opengameart.org/content/makehuman-system-assets-eyes
- three.js subsurface scattering approaches — https://discourse.threejs.org/t/skin-shading-with-screen-space-sub-surface-scattering/83939 · https://threejs.org/docs/pages/module-SubsurfaceScatteringShader.html
- Real-time hair: Scheuermann, Practical Real-Time Hair Rendering and Shading (SIGGRAPH 2004) — https://history.siggraph.org/wp-content/uploads/2022/12/2004-Talks-Scheuermann_Practical-Real-Time-Hair-Rendering-and-Shading.pdf ; Tariq, Real-Time Hair Rendering (NVIDIA 2008) — https://developer.download.nvidia.com/presentations/2008/SIGGRAPH/RealTimeHairRendering_SponsoredSession2.pdf
- MetaHuman licence change (June 2025) — https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/ · https://www.metahuman.com/en-US/license
- Reallusion content / export licences — https://www.reallusion.com/license/content.html · https://forum.reallusion.com/PrintTopic550716.aspx
- CMU motion capture database (free for all uses) — https://www.roboticscenter.ai/datasets/cmu-mocap/
