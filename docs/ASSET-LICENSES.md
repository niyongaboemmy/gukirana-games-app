# Third-party asset licences

Every third-party file shipped under `apps/web/public/assets/` is listed here with its source, author, licence
and the modifications we made. Assets are downloaded and optimised at development time and served from our own
origin — nothing is loaded from an external CDN at runtime.

Licence policy: CC0 or permissive (MIT / CC-BY with attribution) only. Not allowed: files whose licence forbids
redistributing the raw asset (Mixamo downloads, Ready Player Me, MetaHuman, paid-store assets) or anything with an
unclear licence.

## Characters — `apps/web/public/assets/characters/` (payload 4.06 MB)

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

## Environment — `apps/web/public/assets/env/` (payload 8.8 MB)

All from Poly Haven (https://polyhaven.com), licence **CC0 1.0** (public domain, no attribution required;
credited here anyway).

| File | Source asset | Author(s) on Poly Haven | Licence |
| --- | --- | --- | --- |
| `acacia.glb` (2.6 MB), `acacia-imp.webp` | https://polyhaven.com/a/jacaranda_tree | Poly Haven | CC0 |
| `broadleaf.glb` (1.9 MB), `broadleaf-imp.webp` | https://polyhaven.com/a/island_tree_02 | Poly Haven | CC0 |
| `eucalyptus.glb` (1.3 MB), `eucalyptus-imp.webp` | https://polyhaven.com/a/tree_small_02 | Poly Haven | CC0 |
| `bush.glb` (0.75 MB) | https://polyhaven.com/a/searsia_lucida | Poly Haven | CC0 |
| `shrub.glb` (1.3 MB) | https://polyhaven.com/a/searsia_burchellii | Poly Haven | CC0 |
| `grass.glb` (0.2 MB) | https://polyhaven.com/a/grass_medium_02 | Poly Haven | CC0 |
| `fern.glb` (0.13 MB) | https://polyhaven.com/a/fern_02 | Poly Haven | CC0 |
| `rock.glb` (0.09 MB) | https://polyhaven.com/a/rock_07 | Poly Haven | CC0 |
| `boulder.glb` (0.16 MB) | https://polyhaven.com/a/namaqualand_boulder_04 | Poly Haven | CC0 |
| `ground-grass.webp`, `ground-grass-n.webp` (0.4 MB) | https://polyhaven.com/a/leafy_grass (texture) | Poly Haven | CC0 |

Modifications: downloaded at 1k (glTF + JPG); node transforms baked; leaves thinned to a deterministic subset of
individual leaves, each enlarged about its centroid (LOD0 / LOD1); wood sloppy-simplified (meshoptimizer) after a
position-only weld; textures resized to 512 px (models) / 1024 px (ground) WebP; meshopt geometry compression;
renamed by role (the "acacia" is the jacaranda model used as an umbrella-crowned tree, the "eucalyptus" is
tree_small_02 stretched for woodlots). The `*-imp.webp` files are 8-view impostor atlases rendered by us from the
LOD0 models (derivative of the CC0 originals).

## Assets evaluated and rejected (vegetation)

| Candidate | Why not used |
| --- | --- |
| Poly Haven `pine_tree_01`, `fir_tree_01`, `island_tree_01/03` | Not Northern-Rwanda species / far too heavy (8–17 M tris) |
| Stylised CC0 tree packs (Quaternius, Kenney) | Licence fine, look is low-poly, not "real trees" |
| Banana and bamboo models | No CC0 / CC-BY source of acceptable quality found; bamboo groves stay procedural |

## Assets evaluated and rejected (humans)

| Candidate | Why not used |
| --- | --- |
| Mixamo characters / animations | Adobe terms forbid redistributing the raw files |
| Ready Player Me, MetaHuman | Licences forbid redistribution / restricted to their platforms |
| three.js example models (Xbot, Michelle, Soldier) | Derived from Mixamo — same restriction |
| Quaternius / Kenney animated characters (CC0) | Licence fine, but stylised low-poly — does not meet the "real person" brief |
| Khronos sample models (CesiumMan, RiggedFigure) | Licence fine, far too simple |
| VRoid / VRM samples | Anime style, VRM-specific licence terms |
