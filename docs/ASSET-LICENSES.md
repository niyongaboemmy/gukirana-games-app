# Third-party asset licences

Every third-party file shipped under `apps/web/public/assets/` is listed here with its source, author, licence
and the modifications we made. Assets are downloaded and optimised at development time and served from our own
origin — nothing is loaded from an external CDN at runtime.

Licence policy: CC0 or permissive (MIT / CC-BY with attribution) only. Not allowed: files whose licence forbids
redistributing the raw asset (Mixamo downloads, Ready Player Me, MetaHuman, paid-store assets) or anything with an
unclear licence.

## Characters — `apps/web/public/assets/characters/` (payload 4.06 MB + 1.22 MB lazy life clips)

| File | Source asset | Author | Licence |
| --- | --- | --- | --- |
| `masculine.glb` (432 KB) | `Assets/Avatars/Adults/Male_Adult_12` | Microsoft Rocketbox Avatar Library (Microsoft Research) | MIT |
| `feminine.glb` (604 KB) | `Assets/Avatars/Professions/Business_Female_01` | Microsoft Rocketbox Avatar Library | MIT |
| `neutral.glb` (380 KB) | `Assets/Avatars/Adults/Male_Adult_17` | Microsoft Rocketbox Avatar Library | MIT |
| `guard.glb` (689 KB) | `Assets/Avatars/Professions/Security_Male_01` (non-player gate staff) | Microsoft Rocketbox Avatar Library | MIT |
| `anim-m.glb` (983 KB) | `Assets/Animations/all_animations_max_motextr_*/m_*.max.fbx` (12 clips, below) | Microsoft Rocketbox Avatar Library | MIT |
| `anim-f.glb` (969 KB) | `Assets/Animations/all_animations_max_motextr_*/f_*.max.fbx` (12 clips, below) | Microsoft Rocketbox Avatar Library | MIT |

- Source: https://github.com/microsoft/Microsoft-Rocketbox (licence changed to MIT in November 2020; the full
  licence text ships next to the files as `LICENSE-Rocketbox.txt`).
- Copyright (c) 2020 Microsoft. MIT licence: use, copy, modify, distribute permitted with the copyright notice.
- Clips (male `m_` / female `f_`): `idle_neutral_01`, `walk_neutral_01`, `walk_fast_01`, `run_neutral_01`,
  `run_fast_01`, `wave_01`, `claphands_01`, `dancing_neutral`, `sit_chair_idle_neutral_01`, `sit_down_chair_01`,
  `sit_stand_up_chair_01`, `gestic_talk_neutral_01`.

Modifications (pipeline run with FBX2glTF 0.9.7, `@gltf-transform/*` 4.x, `meshoptimizer`, `sharp`):

1. FBX → glTF (FBX2glTF, 30 fps animation bake). Specular maps and the `_facial` variants are not used.
2. Textures: 2048 px TGA → 1024 px WebP (colour q82, normal maps 1024 px body / 512 px head q80); the hair/lash
   opacity map keeps its alpha channel.
3. A per-texel recolour mask (512 px lossless WebP, stored in the emissive slot with emissive factor 0) generated
   from skin weights, UV islands and skin-colour classification: body R skin / G top / B bottom / none shoes; head
   R skin / G hair / B collar. Used at runtime to apply the player's skin tone, hair colour and outfit colours.
4. Female opacity mesh split into `haircards` (own node, toggled by hair style) and `lashes`.
5. Added `lod1`: the body mesh simplified to ~30 % (meshopt simplifier); vertex colours removed; meshopt
   (EXT_meshopt_compression, quantised) geometry compression.
6. Animations: merged into one animation-only glb per skeleton set; only bone rotations plus the root translation
   are kept; locomotion root motion removed (in place) after measuring each clip's native ground speed; looping
   clips trimmed to 5–11 s with a 0.6 s blend back to the first frame; seated clips re-based so the pelvis sits on a
   0.46 m seat centred on the avatar origin; keyframes resampled and meshopt-compressed.

### Everyday-life clips: `life-m.glb` (0.61 MB) and `life-f.glb` (0.61 MB)

These load lazily, after the base set: avatars run on the base set until the life clips have streamed in.
See docs/PEOPLE-BEHAVIOUR.md.

| Key | Source clip, from `Assets/Animations/all_animations_max_motextr_static/` (m_ / f_) | Use |
| --- | --- | --- |
| `idle2` | `idle_neutral_02` | weight-shift idle variant |
| `look` | `idle_look_around_01` | look around |
| `phone` | `cell_phone_textmessage` (start and end spliced) | phone check |
| `stretch` | `idle_stretch_arms_01` | stretch |
| `dust` | `idle_dust_01` | brush down clothes |
| `fold` | `idle_angry_01` (hands-on-hips section only) | hands on hips, watching a table |
| `nod` / `shake` | `gestic_listen_accept_01` / `gestic_listen_deny_01` | nod / shake head |
| `laugh` | `gestic_laugh_loud` (trimmed) | laugh |
| `shrug` | `gestic_shrug_01` | shrug |
| `think` | `gestic_thoughtful_01` | thinking |
| `cheer` | `cheer_03` | celebrate |
| `listen` | `gestic_listen_neutral_01` (first 16 / 12 s) | listening in a conversation |
| `drink` | `drink_drinking` | coffee |
| `photo` | `take_picture` | photo with the phone |
| `sitb` / `sitlook` | `sit_chair_idle_relaxed_01` / `sit_chair_idle_look_around` | seated variants |

- Source, author and licence are the same as above: Microsoft Rocketbox Avatar Library, MIT.
- **Pipeline:**
  1. Parse the FBX with three.js `FBXLoader` (Node).
  2. Keep the body bones only: no face bones, no `MotionExtractionHelper`.
  3. Convert cm to m. Cut segments and splice them with 0.25 s cross-fades. Loops ease back to their first frame
     over 0.6 s.
  4. Re-base the seated clips onto the 0.46 m seat (the same offset as `sit`).
  5. Sample at 30 fps, build a glTF with gltf-transform, then `resample` (lossy keyframe reduction, tolerance
     1e-3) and `meshopt` (quantised, EXT_meshopt_compression).
- **No new assets for the procedural actions.** The handshake, fist bump, hug, thumbs-up, pointing and cue
  chalking are procedural layers on the same skeleton, and the props (phone, paper cup, cue, chalk) are built
  from primitives at runtime.
- **No new assets for footsteps.** Footsteps are synthesised at runtime from noise; no samples.

## Environment — `apps/web/public/assets/env/` (payload 5.3 MB)

All from Poly Haven (https://polyhaven.com), licence **CC0 1.0** (public domain, no attribution required;
credited here anyway). Used only in the distant landscape outside the compound (the compound itself is
landscaped with procedural flower beds, see below).

| File | Source asset | Author(s) on Poly Haven | Licence |
| --- | --- | --- | --- |
| `acacia.glb` (2.6 MB), `acacia-imp.webp` | https://polyhaven.com/a/jacaranda_tree (model + `leaves_alpha` map) | Poly Haven | CC0 |
| `eucalyptus.glb` (1.3 MB), `eucalyptus-imp.webp` | https://polyhaven.com/a/tree_small_02 (model + `leaves_alpha` map) | Poly Haven | CC0 |
| `bush.glb` (0.79 MB) | https://polyhaven.com/a/searsia_lucida (model + `Alpha` map) | Poly Haven | CC0 |
| `rock.glb` (0.10 MB) | https://polyhaven.com/a/rock_07 | Poly Haven | CC0 |
| `boulder.glb` (0.17 MB) | https://polyhaven.com/a/namaqualand_boulder_04 | Poly Haven | CC0 |
| `ground-grass.webp`, `ground-grass-n.webp` (0.4 MB) | https://polyhaven.com/a/leafy_grass (texture) | Poly Haven | CC0 |

Modifications: downloaded at 1k (glTF + JPG + the separate leaf **alpha** maps, which the glTF JPGs do not carry —
merged into RGBA WebP so leaf cards are alpha-cut, `alphaMode: MASK`, cutoff 0.5, double-sided); node transforms
baked; leaf cards thinned to a deterministic subset, each enlarged about its centroid (LOD0 / LOD1); wood
sloppy-simplified (meshoptimizer) after a position-only weld; textures resized to 512 px (models) / 1024 px (ground)
WebP; meshopt geometry compression; renamed by role (the "acacia" is the jacaranda model with green foliage, the
"eucalyptus" is tree_small_02 stretched for woodlots). `*-imp.webp` are 8-view impostor atlases rendered by us from
the LOD0 models (derivative of the CC0 originals).

**Compound flowers (no downloaded assets).** Agapanthus, lavender, roses, allium, tulips, strelitzia, canna,
salvia, ornamental grass, gaura, coreopsis, bougainvillea and groundcover are painted procedurally at runtime into
one alpha-cut atlas (`world/Flowers.tsx`) — original work, no third-party content.

## Assets evaluated and rejected (vegetation)

| Candidate | Why not used |
| --- | --- |
| Poly Haven `pine_tree_01`, `fir_tree_01`, `island_tree_01/03` | Not Northern-Rwanda species / far too heavy (8–17 M tris) |
| Stylised CC0 tree packs (Quaternius, Kenney) | Licence fine, look is low-poly, not "real trees" |
| Banana and bamboo models | No CC0 / CC-BY source of acceptable quality found; bamboo groves stay procedural |
| Poly Haven flowers (gazania, ursinia …) | Single small flowers, heavy per plant; procedural atlas cards give massed beds for a fraction of the cost |
| Flowering-tree variants (jacaranda bloom, flame tree) | Built and evaluated, then dropped: the compound brief is "no trees, modern flowers" |

## Assets evaluated and rejected (humans)

| Candidate | Why not used |
| --- | --- |
| Mixamo characters / animations | Adobe terms forbid redistributing the raw files |
| Ready Player Me, MetaHuman | Licences forbid redistribution / restricted to their platforms |
| three.js example models (Xbot, Michelle, Soldier) | Derived from Mixamo — same restriction |
| Quaternius / Kenney animated characters (CC0) | Licence fine, but stylised low-poly — does not meet the "real person" brief |
| Khronos sample models (CesiumMan, RiggedFigure) | Licence fine, far too simple |
| VRoid / VRM samples | Anime style, VRM-specific licence terms |

## Interiors — `apps/web/public/assets/interiors/` (payload 4.0 MB total, lazy-loaded per hall)

All interior assets come from **Poly Haven** (https://polyhaven.com) and are **CC0 1.0** (public domain, no
attribution required — credited here anyway). Downloaded at development time through the Poly Haven API
(`https://api.polyhaven.com/files/<id>`), 1k source files. Each hall only fetches what it uses: Pool Hall ≈ 0.6 MB (since the P1-WLD-05 redesign),
Ludo Lounge ≈ 1.1 MB, Igisoro Court ≈ 1.7 MB.

### Models — `models/*.glb`

| File (size) | Poly Haven asset | Author | Used in |
| --- | --- | --- | --- |
| `mid_century_lounge_chair.glb` (104 KB) | https://polyhaven.com/a/mid_century_lounge_chair | Kuutti Siitonen | Pool (player chairs, lounge; matte override) |
| `wine_bottles_01.glb` (83 KB) | https://polyhaven.com/a/wine_bottles_01 | Rico Cilliers, Jurita Burger | Pool (back bar) |
| `sofa_02.glb` (73 KB) | https://polyhaven.com/a/sofa_02 | Kirill Sannikov | Pool (lounge sofa) |
| `Ottoman_01.glb` (82 KB) | https://polyhaven.com/a/Ottoman_01 | Caspian Fortune | Ludo |
| `potted_plant_02.glb` (189 KB) | https://polyhaven.com/a/potted_plant_02 | Rico Cilliers | all halls, entrance |
| `modern_arm_chair_01.glb` (110 KB) | https://polyhaven.com/a/modern_arm_chair_01 | Vibrant Nordic | Ludo (table armchairs) |
| `modern_ceiling_lamp_01.glb` (68 KB) | https://polyhaven.com/a/modern_ceiling_lamp_01 | James Ray Cock | Ludo (globe pendants) |
| `potted_plant_04.glb` (139 KB) | https://polyhaven.com/a/potted_plant_04 | James Ray Cock | Ludo (counter succulents) |
| `throw_pillows_01.glb` (192 KB) | https://polyhaven.com/a/throw_pillows_01 | Serhii Khromov | Ludo (sofas) |
| `wooden_stool_02.glb` (143 KB) | https://polyhaven.com/a/wooden_stool_02 | Kuutti Siitonen | Igisoro (player stools, scaled to a 0.46 m seat) |
| `wicker_basket_01.glb` (143 KB) | https://polyhaven.com/a/wicker_basket_01 | Kuutti Siitonen | Igisoro |
| `wicker_basket_02.glb` (180 KB) | https://polyhaven.com/a/wicker_basket_02 | Kuutti Siitonen | Igisoro |
| `wooden_bowl_01.glb` (91 KB) | https://polyhaven.com/a/wooden_bowl_01 | Oliver Harries | Igisoro (seed bowls) |

Modifications (`@gltf-transform/cli` 4.5.1 `optimize`): glTF + 1k JPG → single GLB; flatten / join / weld / prune;
meshopt simplification (ratio 0.1–0.5, error ≤ 0.05 — e.g. bottles 28.8k → 3.0k triangles, plant 70k → 5.6k);
textures resized to 512 px (bottles 256 px) and re-encoded as WebP; `EXT_meshopt_compression` with quantisation.
At runtime some materials are tinted or given emissive glass (lamps), and props are instanced.

### PBR textures — `tex/<id>_{diff,nor,rough}.webp`

| Texture set (size) | Poly Haven asset | Author | Used in |
| --- | --- | --- | --- |
| `velour_velvet` (64 KB, normal + roughness only) | https://polyhaven.com/a/velour_velvet | colormass, Rico Cilliers | Pool cloth / acoustic panels / banquettes, Ludo sofas |
| `herringbone_parquet` (126 KB) | https://polyhaven.com/a/herringbone_parquet | Jenelle van Heerden, Sergej Majboroda | Ludo floor |
| `white_plaster_02` (41 KB) | https://polyhaven.com/a/white_plaster_02 | Rob Tuytel | Ludo walls; Pool walls and micro-cement floor (normal only) |
| `oak_veneer_01` (58 KB) | https://polyhaven.com/a/oak_veneer_01 | Jenelle van Heerden | Ludo tables, ceiling baffles, counter; Pool table rails |
| `terracotta_floor_tiles` (73 KB) | https://polyhaven.com/a/terracotta_floor_tiles | Dimitrios Savva | Igisoro floor |
| `clay_plaster` (97 KB) | https://polyhaven.com/a/clay_plaster | Amal Kumar | Igisoro walls, planter |
| `thatch_roof_angled` (523 KB) | https://polyhaven.com/a/thatch_roof_angled | Rob Tuytel, Dimitrios Savva | Igisoro ceiling |
| `rough_wood` (74 KB) | https://polyhaven.com/a/rough_wood | Rob Tuytel | Igisoro posts, beams, benches |
| `tatami_mat` (19 KB) | https://polyhaven.com/a/tatami_mat | Charlotte Baglioni | Igisoro woven mats |
| `bark_brown_02` (170 KB) | https://polyhaven.com/a/bark_brown_02 | Rob Tuytel | Igisoro courtyard tree |
| `wood_table_worn` (39 KB) | https://polyhaven.com/a/wood_table_worn | Dimitrios Savva, Rico Cilliers | Igisoro tables and boards |

Modifications (ImageMagick 7): 1k JPG → WebP (diffuse q78, normal q82, roughness greyscale 512 px q72); floor /
wall sets kept at 1024 px, small-surface sets resized to 512 px. Normal maps are the OpenGL (`nor_gl`) variant.

Procedural (no third-party source, generated at runtime in `src/rooms/room-textures.ts`): Imigongo panels and
friezes, Kitenge prints, club rug, Pool Hall table carpet (`loungeRug`), billiard cloth, numbered pool-ball atlas, Ludo board, dice, Agaseke weave,
leaf cards, chalk menu. The view through the windows is the plaza's own procedural landscape (`src/world/Landscape.tsx`).

### Plaza exterior realism pass (P1-WLD-03)

No new downloaded assets. Generated at runtime (no third-party source): lava-rock rubble, granite paving slabs and the
plaza wear map, curtain-wall glazing, grass thatch, brushed aluminium, hall-glimpse and door-badge signs, arena posters
(`src/world/textures.ts`); fountain ripple normal map, water streams and droplets (`src/world/Fountain.tsx`); cumulus
cloud billboards (`src/world/Clouds.tsx`). Default avatar looks are a deterministic hash of the account id over the
existing outfit catalogue (`src/world/outfits.ts`, `apps/api/src/modules/identity/default-look.ts`).

### UI fonts (P1-HUD)

| Font | Source | Licence | Use |
| --- | --- | --- | --- |
| Chakra Petch (500, 600, 700; latin, latin-ext) | https://fonts.google.com/specimen/Chakra+Petch (Cadson Demak) | SIL Open Font License 1.1 | display: titles, chips, buttons, numerals |
| Inter (variable; latin, latin-ext) | https://fonts.google.com/specimen/Inter (Rasmus Andersson) | SIL Open Font License 1.1 | UI / body text |

Fetched by `next/font/google` at build time and served from the app's own origin (no runtime request to Google).
Unmodified. OFL allows bundling and redistribution with the app; the fonts are not sold on their own.
