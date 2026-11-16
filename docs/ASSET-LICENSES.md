# Third-party asset licences

Every third-party file shipped under `apps/web/public/assets/` is listed here with its source, author, licence
and the modifications we made. Assets are downloaded and optimised at development time and served from our own
origin — nothing is loaded from an external CDN at runtime.

Licence policy: CC0 or permissive (MIT / CC-BY with attribution) only. Not allowed: files whose licence forbids
redistributing the raw asset (Mixamo downloads, Ready Player Me, MetaHuman, paid-store assets) or anything with an
unclear licence.

## Characters — `apps/web/public/assets/characters/` (payload 4.55 MB + 1.22 MB lazy life clips)

| File | Source asset | Author | Licence |
| --- | --- | --- | --- |
| `masculine.glb` (559 KB) | `Assets/Avatars/Adults/Male_Adult_12` | Microsoft Rocketbox Avatar Library (Microsoft Research) | MIT |
| `feminine.glb` (768 KB) | `Assets/Avatars/Professions/Business_Female_01` | Microsoft Rocketbox Avatar Library | MIT |
| `neutral.glb` (575 KB) | `Assets/Avatars/Adults/Male_Adult_17` | Microsoft Rocketbox Avatar Library | MIT |
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

### Head textures rebuilt (P2-AVA-08)

The three player heads (`masculine`, `feminine`, `neutral`) were rebuilt from the original 2048 px Rocketbox TGAs
(`m007_head_*`, `f014_head_*`, `m022_head_*` in the same MIT repository; same author and licence as above). The
meshes, skins and the guard are unchanged.

1. Head normal map 512 → 1024 px WebP (q84): the pore and wrinkle detail of the original map is back (the 512 px
   map was nearly flat, which made the faces read as smooth plastic masks).
2. The original specular map (512 px) is stored in the alpha channel of the recolour mask (lossless WebP): skin
   roughness follows the real oil distribution (soft sheen on forehead / nose, matte cheeks).
3. `neutral` only: the baked goatee, moustache and stubble of `Male_Adult_17` were removed from the albedo, normal
   and specular maps over the whole lower face. The skin colour is rebuilt from the skin between the hairs, with
   the dense cores filled from their surroundings (no halo). It takes the clean cheeks' hue and most of their
   brightness, shading slightly towards the neck. Pores come from clean forehead skin, matched to the cheeks'
   amplitude. The beard texels of the recolour mask are skin again. Clean-shaven is now really clean; facial hair
   is only what the player chooses (drawn in the head shader).
4. Packed back into the existing glbs (images replaced, binary chunk re-packed; meshopt geometry untouched).
   Added payload: +0.49 MB.

Scripts (Python + numpy / Pillow, Node): `clean_neutral.py` + `clean_neutral2.py`, `build_textures.py`, `repack.mjs`; kept with the task
notes, not in the repo. At load time the head geometry is also smoothed and tessellated (see
`apps/web/src/world/human/head-geometry.ts`); no new geometry files are shipped.

### Hair mask, hairline and skull template (P2-AVA-10)

Same three heads, same licence; derived data only.

1. Hair mask (G of the head recolour mask) cleaned per body: stray specks removed (the brows kept), pinholes filled,
   nothing on the ears, the outline smoothed into one hairline with a ~1.5 texel soft edge; skin (R) takes over what
   hair gives up. `masculine`: the receded front corners filled into a natural hairline. `neutral`: the baked cap's
   six crown gores and its band strip are scalp hair now (plain hair albedo); the brim triangles are dropped at load.
2. Albedo: stray photo hairs on temple / sideburn skin and on the ears inpainted from the surrounding skin (pores
   from nearby skin); texels that became hair take the colour of the hair around them.
3. Skull template (`apps/web/src/world/human/skull.ts`, generated): the masculine head's outer surface (ears left
   out) as a 15 × 32 radius grid in the face frame, plus a per-body fit (centre + scale) to each head's forehead /
   temple skin and short back hair. Hair shells, hats and the deflated neutral crown / feminine bob sit on it.
4. Packed back into the glbs as before (+0.06 MB over P2-AVA-08).

Scripts (Python + numpy / Pillow, Node): `hairtex.py`, `posmap.py`, `skull.py`, `gen_skull_ts.py`, `dumphead.mjs`,
`repack.mjs`; kept with the task notes, not in the repo. Hair and headwear geometry is generated at load time
(`hair.ts`, `headwear.ts`), cached per body / style.

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

## Ring people (boxers, referee, corner staff, judges) — `boxer-m.glb`, `boxer-f.glb` (P3-FGT-13, ~3.3 MB each, lazy)

| File | Source assets | Author | Licence |
| --- | --- | --- | --- |
| `boxer-m.glb`, `boxer-f.glb` | MakeHuman 1.x: `makehuman/data/3dobjs/base.obj` (base mesh hm08), `data/targets/macrodetails/*.target` (gender / age / muscle / weight / height / proportions / ethnic macro targets), `data/rigs/default.mhskel` + `default_weights.mhw` (skeleton and skin weights), and (P3-FGT-14) face targets from `data/targets/head`, `eyes`, `nose` and `mouth` (the player's face shape on the boxer head) — https://github.com/makehumancommunity/makehuman at commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` | MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier and contributors) | **CC0 1.0** (`LICENSE.ASSETS.md` of that repository; every target / weights file carries the CC0 notice) |

- **What we made from them** (`apps/web/scripts/boxer/build.mjs`, run with `MH_DIR=<checkout>/makehuman/data`):
  - the body: the base mesh's `body` group plus the eye, eyelash and teeth helpers, morphed with the macro targets to
    an adult (25–30 y) athletic build per gender (muscle 0.92 / 0.84, weight 0.42 / 0.44); three body-type morph
    targets (heavy, slim, mature) are stored with the matching joint offsets;
  - the skeleton: the 163 MakeHuman bones merged into 64 bones named like the Rocketbox `Bip01` rig (so the boxing
    rig layer drives it), keeping jaw, eyelids, brows and mouth corners for the face; skin weights merged
    accordingly (top four per vertex); P3-FGT-14: the reference rig's hierarchy (clavicles under the neck, the spine
    pivots at the reference heights), four corrective helper bones (shoulder helpers, forearm twists) with a shoulder
    weight corrective (docs/FIGHT-REALISM-V4.md §1);
  - 16 sparse face-shape morph targets (face shape, eyes, nose, lips choices of the avatar), each a weighted sum of
    MakeHuman face targets; the morph targets are stored as normalised int16 (KHR_mesh_quantization);
  - the garments, generated from the body itself (no third-party clothing): vest with arm holes and neckline,
    knee-length trunks (from the `helper-tights` group), high boots (a lofted last), socks, hand wraps, laced gloves,
    padded open-face headgear, the referee's shirt / collar / bow tie / trousers / shoes (P3-FGT-14: draped cloth
    volume, a stand collar with wings, straight-leg trousers), the staff polo and a short hair cap;
  - vertex data for our own shader: material slot, cavity (muscle definition), hit zones, face paint (lips, brows,
    eye sockets, beard). No textures were shipped in P3-FGT-13/14 (P3-FGT-15 below adds skin and eye textures).
- P3-FGT-13/14: MakeHuman skins, proxies, clothes and hair were not used. P3-FGT-15 adds the skin and eye assets
  below (CC0). Nothing from Mixamo or any store.
- P3-FGT-16: regenerated from the same MakeHuman commit (`a8bc2d54…`, CC0) with our own changes only: the boxing gloves
  and headgear are new procedural shapes (`apps/web/scripts/boxer/kit-shapes.mjs`, original work), the vest's arm hole,
  neckline, skin weights and body cover margin changed (`build.mjs`). boxer-m.glb 3.19 MB, boxer-f.glb 3.13 MB.

### Realistic humans (P3-FGT-15) — `skin-{m,f}.webp`, `skin-{m,f}-1k.webp`, `eye-iris.webp`, `human-detail.webp`, eye proxy in the boxer GLBs

| File | Source asset | Author | Licence |
| --- | --- | --- | --- |
| `skin-m.webp` (2048, 1.8 MB), `skin-m-1k.webp` (0.48 MB) | MakeHuman 1.2 system skin `data/skins/textures/young_darkskinned_male_diffuse.png` (in the MakeHuman Community 1.2.0 release, http://download.tuxfamily.org/makehuman/releases/makehuman-community-1.2.0-windows.zip) | MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier) | **CC0 1.0** ("This asset was explicitly released as CC0 in september 2020", in each system-asset file) |
| `skin-f.webp` (2048, 1.5 MB), `skin-f-1k.webp` (0.37 MB) | same, `young_darkskinned_female_diffuse.png` | same | CC0 1.0 |
| `eye-iris.webp` (512) | MakeHuman `data/eyes/materials/brown_eye.png` (code repository, commit `a8bc2d54…`; also mirrored on OpenGameArt "MakeHuman system assets eyes") | MakeHuman team | CC0 1.0 |
| eye geometry inside `boxer-{m,f}.glb` | MakeHuman `data/eyes/high-poly/high-poly.obj` + `.mhclo` (code repository, same commit) | MakeHuman team | CC0 1.0 |
| `human-detail.webp` (512) | generated (`skin_textures.py`: pores / micro-wrinkles and a knit, seeded noise) | Gukirana | original work |

- **What we made from them** (`apps/web/scripts/boxer/skin_textures.py`): the skin stored relative to its median colour
  (any avatar skin tone is applied in the shader), the photo session's lowest frequencies flattened, the groin filled
  with surrounding skin (no anatomical detail ships, whatever is worn), a fine-height alpha channel; WebP (q82, exact
  colour under alpha). The eye texture's iris turned to luminance (tinted with the player's eye colour at runtime) with an
  iris mask in alpha. The eye proxy fitted to each body with MakeHuman's own proxy maths (`mh.mjs readProxy`), its clear
  cornea layer dropped. The body GLBs now carry MakeHuman's UV layout (from `base.obj`).
- **P3-FGT-17** (docs/HUMAN-REALISM-VR-RESEARCH.md): the bodies rebuilt from the same commit — new sources are
  MakeHuman's regional targets (CC0, same repository and commit `a8bc2d54…`): `data/targets/torso/torso-vshape-incr`,
  `torso-muscle-dorsi-incr`, `torso-muscle-pectoral-incr`, `measure/measure-waist-circ-decr`,
  `stomach/stomach-tone-incr`, `neck/neck-scale-horiz-incr`, `neck/neck-back-scale-depth-incr`,
  `buttocks/buttocks-volume-incr`, `armslegs/{l,r}-{upperarm-shoulder,upperarm,lowerarm,upperleg,lowerleg}-muscle-incr`,
  `breast/female-young-maxmuscle-averageweight-mincup-maxfirmness`, `breast/breast-point-decr`. New files:

  | File | Source | Author | Licence |
  | --- | --- | --- | --- |
  | `boxer-m.glb`, `boxer-f.glb` (rebuilt, 3.24 / 3.20 MB) | as above + the regional targets listed | MakeHuman team; build Gukirana | CC0 1.0 (sources) / original work (build) |
  | `body-detail-m.webp`, `body-detail-f.webp` (1024², 249 / 227 KB) | baked by `apps/web/scripts/boxer/anatomy-bake.mjs` from MakeHuman's max-muscle macro shape + the regional targets (band-passed height → detail normal + cavity in MakeHuman's UV) | Gukirana (from CC0 MakeHuman data) | original work |
  | `boxer-m-v5.glb`, `boxer-f-v5.glb` (3.22 / 3.16 MB) | the P3-FGT-16 bodies, kept as the `NEXT_PUBLIC_FF_BODY_V6=0` fallback | as above | CC0 1.0 / original work |

  Evaluated in the research, **not used**: 3D Scan Store free samples and Texturing.xyz free items (commercial use
  needs written permission), Renderpeople (its terms forbid making the 3D data easily extractable — a GLB served to a
  browser), Sketchfab CC-BY body scans / gloves / headgear (usable with credits, but raw scans need retopology to the
  rig and we had no gain over the product-sized procedural kit), Smokeworks Skins Vol.0 (CC-BY 4.0, MakeHuman UV,
  normal + ORM: an albedo set, not the anatomy we needed), MetaHuman (excluded by the brief). Nothing was bought; the
  paid options are listed in docs/HUMAN-REALISM-VR-RESEARCH.md §11.
- **P3-FGT-18** (docs/FIGHT-REALISM-V7.md): the bodies rebuilt again from the same MakeHuman commit (`a8bc2d54…`,
  CC0). New sources, all MakeHuman CC0 regional targets of that repository: `data/targets/measure/measure-waist-circ-incr`,
  `measure-shoulder-dist-decr`, `measure-neck-circ-incr`, `measure-neck-height-decr`, `data/targets/head/head-scale-vert-incr`,
  `head-scale-horiz-incr`, `head-scale-depth-incr` (the proportion fixes of the anthropometric audit). Everything else
  is our own build code: the loose trunk drape, the vest's tuck / hug / stand-off, product-thick headgear, baked vertex
  ambient occlusion (`vertex-ao.mjs`), headgear / glove / waistband stitching drawn in the shader. **No new texture,
  no third-party asset, nothing bought.** Runtime: the N8AO pass ships inside the already-installed
  `@react-three/postprocessing` dependency (`n8ao` 2.0.1, MIT licence, N8python).

  | File | Source | Author | Licence |
  | --- | --- | --- | --- |
  | `boxer-m.glb`, `boxer-f.glb` (rebuilt, 3.25 / 3.20 MB) | as above + the targets listed | MakeHuman team; build Gukirana | CC0 1.0 (sources) / original work (build) |
  | `boxer-m-v6.glb`, `boxer-f-v6.glb` (3.24 / 3.20 MB) | the P3-FGT-17 bodies, kept as the `NEXT_PUBLIC_FF_BOXER_V7=0` fallback | as above | CC0 1.0 / original work |

  Evaluated as an alternative base, **not adopted** (renders in `docs/QA/boxing-v7/base.jpg`): the Microsoft Rocketbox
  athletic bodies already shipped for the campus people (MIT) — photo-sourced textures, but every body is dressed in its
  texture (jacket / jeans: no bare arm and leg skin to show under a vest and trunks) and a boxing kit cannot be layered
  on it without re-texturing; the MPFB2 skin system — the same hm08 base and CC0 skins as ours, its gain is Blender's
  node shader, which does not port to WebGL.
- Evaluated, not shipped: MakeHuman community "Toigo" light skins (CC0, OpenGameArt mirror) — superseded by the system
  dark-skinned skins; MakeHuman system hair / brows / lashes / clothes proxies (CC0) — not used yet (alpha cards cost a
  second draw call per person; the close crop is the scalp texture plus a shell).

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

### Boxing motion reference (P3-FGT-16) — no motion file shipped

The boxers' arms are **keyed joint angles authored in code** (`apps/web/src/world/human/boxing/clips.ts`, `pose.ts`;
docs/FIGHT-REALISM-V5.md): no third-party motion data is stored in the repository or sent to the browser. As a
measurement reference during authoring we read:

| Source | Takes | Licence | What we took |
| --- | --- | --- | --- |
| CMU Graphics Lab Motion Capture Database, http://mocap.cs.cmu.edu/ (ASF/AMC) | boxing: 13_17, 13_18, 14_01–14_03, 15_13, 17_10; punching: 144_13/14/20/21, 86_*, 141_14, 143_23 | Free for all uses, including commercial products; the raw data may not be resold (CMU's stated terms). "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." | Numbers only: straight-punch extension times (62 % → full extension 0.06–0.12 s, return 0.15–0.2 s), the guard → impact → guard rhythm and the shoulder-to-wrist reach at full extension. Downloaded to a scratch folder, deleted after use |

Evaluated, not used for motion: **Bandai Namco Research Motiondataset** (CC BY-NC-ND 4.0 — non-commercial, no
derivatives: excluded); **Mixamo** (Adobe terms forbid redistributing the raw animation files; the project rejects it);
**Quaternius** Universal Animation Library (CC0, but stylised game moves — no boxing set); the CMU takes themselves as a
retarget source (amateur subjects in everyday clothes: parallel feet, bare-hand guards that a 12 oz glove would pass
through, no hooks to the body, no clinch / reactions / knockdown — keyed poses with joint limits gave a cleaner result
for this cast; see FIGHT-REALISM-V5.md §3).

## Assets evaluated and rejected (humans)

| Candidate | Why not used |
| --- | --- |
| Mixamo characters / animations | Adobe terms forbid redistributing the raw files |
| Ready Player Me, MetaHuman | Licences forbid redistribution / restricted to their platforms |
| three.js example models (Xbot, Michelle, Soldier) | Derived from Mixamo — same restriction |
| Quaternius / Kenney animated characters (CC0) | Licence fine, but stylised low-poly — does not meet the "real person" brief |
| Khronos sample models (CesiumMan, RiggedFigure) | Licence fine, far too simple |
| VRoid / VRM samples | Anime style, VRM-specific licence terms |
| A new, denser CC0 base head (MakeHuman exports, CC0 scans) — evaluated for P2-AVA-08 | Licence fine, but it would have to be re-rigged to the Rocketbox face bones (blinks, jaw, lips, the Face tab's proportions), stitched to three bodies with matching skin textures and re-fitted to every seated pose: a new character pipeline, not a fix. The Rocketbox heads were kept and improved instead: 2048 px source textures, load-time smoothing + Phong tessellation, a skin shading model and shader-drawn hair. |

## Interiors — `apps/web/public/assets/interiors/` (payload 4.0 MB total, lazy-loaded per hall)

All interior assets come from **Poly Haven** (https://polyhaven.com) and are **CC0 1.0** (public domain, no
attribution required — credited here anyway). Downloaded at development time through the Poly Haven API
(`https://api.polyhaven.com/files/<id>`), 1k source files. Each hall only fetches what it uses: Pool Hall ≈ 0.6 MB (since the P1-WLD-05 redesign),
Ludo Lounge ≈ 0.8 MB (since its P1-WLD-05 redesign), Igisoro Court ≈ 0.95 MB (since its P1-WLD-05 redesign: clay-tile floor, stools, Agaseke pendants, boards and seeds are procedural).

### Models — `models/*.glb`

| File (size) | Poly Haven asset | Author | Used in |
| --- | --- | --- | --- |
| `mid_century_lounge_chair.glb` (104 KB) | https://polyhaven.com/a/mid_century_lounge_chair | Kuutti Siitonen | Pool (player chairs, lounge; matte override); Igisoro (spectator lounge) |
| `wine_bottles_01.glb` (83 KB) | https://polyhaven.com/a/wine_bottles_01 | Rico Cilliers, Jurita Burger | Pool (back bar) |
| `sofa_02.glb` (73 KB) | https://polyhaven.com/a/sofa_02 | Kirill Sannikov | Pool (lounge sofa); Igisoro (spectator lounge) |
| `Ottoman_01.glb` (82 KB) | https://polyhaven.com/a/Ottoman_01 | Caspian Fortune | Ludo (watchers' poufs; matte, re-coloured) |
| `potted_plant_02.glb` (189 KB) | https://polyhaven.com/a/potted_plant_02 | Rico Cilliers | all halls, entrance |
| `modern_arm_chair_01.glb` (110 KB) | https://polyhaven.com/a/modern_arm_chair_01 | Vibrant Nordic | Ludo (player armchairs, lounge chairs; matte, oatmeal cushions) |
| `potted_plant_04.glb` (139 KB) | https://polyhaven.com/a/potted_plant_04 | James Ray Cock | Ludo (bar shelf plants) |
| `wicker_basket_01.glb` (143 KB) | https://polyhaven.com/a/wicker_basket_01 | Kuutti Siitonen | Igisoro (lounge baskets) |

Modifications (`@gltf-transform/cli` 4.5.1 `optimize`): glTF + 1k JPG → single GLB; flatten / join / weld / prune;
meshopt simplification (ratio 0.1–0.5, error ≤ 0.05 — e.g. bottles 28.8k → 3.0k triangles, plant 70k → 5.6k);
textures resized to 512 px (bottles 256 px) and re-encoded as WebP; `EXT_meshopt_compression` with quantisation.
At runtime some materials are tinted or given emissive glass (lamps), and props are instanced.

### PBR textures — `tex/<id>_{diff,nor,rough}.webp`

| Texture set (size) | Poly Haven asset | Author | Used in |
| --- | --- | --- | --- |
| `velour_velvet` (64 KB, normal + roughness only) | https://polyhaven.com/a/velour_velvet | colormass, Rico Cilliers | Pool cloth / acoustic panels / banquettes, Ludo sofas |
| `herringbone_parquet` (126 KB) | https://polyhaven.com/a/herringbone_parquet | Jenelle van Heerden, Sergej Majboroda | Ludo floor (desaturated in the shader to a calm natural oak) |
| `white_plaster_02` (41 KB) | https://polyhaven.com/a/white_plaster_02 | Rob Tuytel | Ludo walls (normal only); Pool walls and micro-cement floor (normal only) |
| `oak_veneer_01` (58 KB) | https://polyhaven.com/a/oak_veneer_01 | Jenelle van Heerden | Ludo table tops, bar front and shelving, game library, coffee tables; Pool table rails; Igisoro tables, boards, stools |
| `clay_plaster` (97 KB) | https://polyhaven.com/a/clay_plaster | Amal Kumar | Igisoro walls, planter |
| `rough_wood` (74 KB) | https://polyhaven.com/a/rough_wood | Rob Tuytel | Igisoro glulam beams, benches, shelves |
| `tatami_mat` (19 KB) | https://polyhaven.com/a/tatami_mat | Charlotte Baglioni | Igisoro woven mats, woven sisal ceiling |
| `bark_brown_02` (170 KB) | https://polyhaven.com/a/bark_brown_02 | Rob Tuytel | Igisoro courtyard tree |

Modifications (ImageMagick 7): 1k JPG → WebP (diffuse q78, normal q82, roughness greyscale 512 px q72); floor /
wall sets kept at 1024 px, small-surface sets resized to 512 px. Normal maps are the OpenGL (`nor_gl`) variant.

Procedural (no third-party source, generated at runtime in `src/rooms/room-textures.ts`): Imigongo panels and
friezes, Kitenge prints, club rug, Pool Hall table carpet (`loungeRug`), billiard cloth, numbered pool-ball atlas, Ludo board, dice, Agaseke weave, Igisoro clay-tile floor,
leaf cards, chalk menu. Ludo Lounge (P1-WLD-05, `src/rooms/ludo-textures.ts`): the table board (the game's real
15 × 15 track, home columns, safe-square stars, seat shapes, in a calm palette), Kitenge prints for rugs / cushions /
textile art, the bar menu and the table-number atlas; the sofas, globe pendants, acoustic baffles, bar, stools and game
library are procedural geometry. The view through the windows is the plaza's own procedural landscape (`src/world/Landscape.tsx`).

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

### Realistic campus people (P2-AVA-12)

No new downloaded assets, nothing bought, no download checkouts left on disk. Everything added is procedural or reused:

| What | Where | Source | Licence |
| --- | --- | --- | --- |
| Eyeballs (cornea, parallax iris, sclera, occlusion, catchlight) | `src/world/human/eyes.ts` | Generated at runtime, fitted to the Rocketbox heads' own eye caps | In-house (project code) |
| Skin pore / micro-wrinkle detail normal, jersey knit normal | `public/assets/characters/human-detail.webp` (existing, 240 KB, now also used by the plaza people) | Generated in-house by `apps/web/scripts/boxer/skin_textures.py` (P3-FGT-15) | In-house (project asset) |
| Fabric weave normals (denim twill, fleece, suiting, cotton twill, leather grain), sheen tints | `src/world/human/skin/skin-shading.ts` | Procedural GLSL | In-house (project code) |
| Jump, lean, start / stop, reactions, expressions | `src/world/human/motion-layer.ts`, `src/world/human/face-rig.ts` | Procedural on the Rocketbox clips (MIT, above) | In-house (project code) |

Evaluated and not used (docs/CAMPUS-HUMAN-REALISM.md §3): MakeHuman / MPFB2 assets (CC0), CMU mocap (free for all
uses), Quaternius Universal Animation Library (CC0), Poly Haven and ambientCG fabric scans (CC0). Excluded: Mixamo
(project rule), Ready Player Me (service shut down January 2026), MetaHuman (project brief), anything NC / ND.
