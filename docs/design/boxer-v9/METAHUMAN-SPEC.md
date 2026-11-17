# Boxer v9: making the boxers in MetaHuman Creator (P3-FGT-21)

These steps are for the user, who has a free Epic Games account. Adults only: both boxers are 18 or older (SAFE-01,
an 18+ world). Menu names are taken from Epic's 5.6–5.8 documentation and may differ slightly in your version. If a
name differs, look for the closest match and note the difference in this file.

## 0. Before you start

- **Unreal Engine 5.7 or newer** (free), installed through the Epic Games Launcher. The MetaHuman Creator web app
  closed on 2026-11-05: creation now happens only inside Unreal Engine, and on macOS only from 5.7. The download is
  large (tens of GB; check the launcher's figure).
- Hardware: Epic recommends 16 CPU cores, 32 GB RAM and an RTX 3070 / RX 6800 XT / Apple M2 Ultra class GPU. An M2
  Pro is below that. It may work, slowly. If the editor is unusable, do this part on a Windows PC with a recent
  NVIDIA card.
- Read LICENCES.md (a) first: free under US$1M annual revenue, no AI training, and the files never go into the public
  repo.
- Reference photos: use only licensed photos of real amateur boxers, for proportions, skin and hair (see
  docs/AVATAR-REFERENCE-RWANDA.md, "Photo references"). The boxer is a new, invented person: **do not copy a real
  person's face**.

## 1. Project and plugin

1. Launcher, Unreal Engine, Library: install 5.7 (or the newest version). Launch it.
2. New project: Games, Blank, Blueprint, Desktop, quality "Maximum", no starter content. Name it `GukiranaMetaHumans`
   and keep it outside this repo (for example `~/Unreal/GukiranaMetaHumans`).
3. Edit, Plugins: search "MetaHuman". Enable **MetaHuman Creator** and any MetaHuman core plugin it asks for.
   Restart.
4. Known 5.7 issue: textures come out wrong in DCC exports. Workaround: in Project Settings, turn off **Substrate
   materials**, and under the MetaHuman Character plugin settings turn off **Virtual Textures**, before you assemble
   or export (Epic known-issues page, 5.7).

## 2. First boxer: adult man, 24–30, East African, athletic middleweight

Content Browser, right-click, MetaHuman, **MetaHuman Character**. Name it `MH_Boxer_M`. Double-click it to open
MetaHuman Creator.

### Face (realistic, invented, adult)

1. Presets, Library: pick 3–4 dark-skinned adult male presets that look East African. Use them as **blend
   sources**. In Face, Blend, mix them until no single preset is recognisable.
2. Aim for a lean athlete's face: visible cheekbones, a defined jaw, a little hollow under the cheekbones (low body
   fat). Nose and lips are natural and varied, never a caricature (docs/AVATAR-REFERENCE-RWANDA.md §2: wide natural
   variety).
3. Age 24–30: smooth skin with fine pores, faint creases at the eyes only. If the version has skin texture
   presets, take a young-adult one. No grey hair.
4. Small realism touches that read at a distance: a slightly flattened nose bridge and a faint scar line on one brow
   (subtle, as a skin texture detail, never gore). Both are optional.

### Skin

- Tone: deep brown. Pick a value inside the palette `#603a24` to `#3f2618` (AVATAR-REFERENCE-RWANDA §1). Keep
  the undertone warm.
- Roughness or specular: **matte**. The v8 skin was rated shiny. Raise roughness or lower specularity until the
  forehead and nose show only a soft, broad sheen. Pipeline step 7 also clamps the body roughness.
- Freckles 0, redness low, no makeup. If "Bake Makeup" is offered at export, leave it on so the export matches what
  you see.

### Eyes, brows, teeth

- Irises dark brown. Sclera warm off-white, never pure white.
- Brows: natural, dark, fairly full, with short hair.
- Teeth: natural. They are mostly hidden by the mouthguard.

### Hair (short)

- Head hair: **very short**, a buzz cut or crew cut close to the scalp, the most common style for amateur boxers.
  Facial hair: none, or light stubble.
- Why short matters: strand grooms do not export to a web game. A very short cut is carried by the scalp texture
  (hair colour and density painted into the skin) plus at most a thin card shell, which looks right at fight
  distance. Do two exports (§4): one **bald** (the clean scalp for texture painting) and one **with the buzz cut**
  (as a colour reference, and its hair cards if your version can export them; card export is **unconfirmed**).

### Body (athletic middleweight)

Use Body, Parametric (or the closest body controls) with these starting values, then judge by eye against boxer
photos:

| Measure | Value | Notes |
| --- | --- | --- |
| Height | 1.80 m | Olympic male boxers average about 1.76 m; middleweights are taller (docs/design/fighter-v8/SPEC.md §1) |
| Mass | 72–75 kg | Middleweight band |
| Body fat | about 10 % | Visible abdominals and shoulder separation, no bodybuilder bulk |
| Chest (relaxed) | 98–102 cm | |
| Waist | 76–80 cm | |
| Hips | 92–95 cm | |
| Upper arm (relaxed) | 33–35 cm | |
| Neck | 38–40 cm | A thick neck sloping into the trapezius is the first thing that reads as "boxer" (fighter-v8 SPEC §1) |

Shoulders broader than the hips, long arms (reach about height + 3 cm), lean calves, no exaggerated V.

### Clothing

Choose **no clothing**, or the plainest underwear the Creator offers. The singlet and trunks are simulated by the
pipeline (step 5), on the bare body.

Save the asset (Ctrl+S).

## 3. Second boxer (later): adult woman, 22–30, East African, athletic lightweight

Same steps, saved as `MH_Boxer_F`. Adults only.

| Measure | Value |
| --- | --- |
| Height | 1.66–1.68 m |
| Mass | 58–60 kg (lightweight band) |
| Body fat | 17–19 % (elite women about 17 %, fighter-v8 SPEC §1) |
| Chest / waist / hips | 86–88 / 66–70 / 90–94 cm |

- Face: invented, blended from 3–4 adult female presets, matte skin, natural brows, no heavy makeup.
- Hair: short and close to the scalp (a short natural cut, or neat cornrows close to the head) so the competition
  headgear fits over it. The same export rule applies.
- Clothing: none or plain underwear. Pipeline step 5 adds the singlet (over a sports bra layer, to be added as a
  garment later) and trunks.
- Women compete in headgear, so it is fitted in step 6 (ASSET-SOURCES.md §3).

## 4. Export (what files, which format)

The pipeline re-rigs the body with Mixamo and decimates it itself, so the export only has to deliver the
**highest-detail mesh in a neutral pose, with its textures**.

1. In MetaHuman Creator, Export:
   - **Geometry Export**: tick **Full Body Skeletal Mesh** (head and body in one), Project Path `/Game/Export/M/`.
     Run it.
   - **DCC Export**: External Path = a temporary folder; Bake Makeup on; Compress in Zip File off. Run it. This
     writes the head and body **textures as PNG** (plus `.dna` and `.json`, which we keep as a backup only).
     Textures: pick 4k in Texture Sources if offered. A known issue may cap DCC textures at 2k, which is still
     enough (the game uses 2k / 1k).
2. In the Content Browser, open `/Game/Export/M/`, right-click the full-body skeletal mesh, **Asset Actions, Export**,
   **FBX**. Options:
   - FBX Export Compatibility: FBX 2020 (or the newest offered);
   - Level of Detail: **off** (LOD0 only; UE 5.6 forum reports say only LOD0 exports anyway). The pipeline makes the
     LODs;
   - Morph Targets: on (harmless; face morphs can serve a later blink and mouth task);
   - Skeleton: it exports with the mesh. Pipeline step 1 removes it, because the default route re-rigs with Mixamo;
   - Collision, Vertex Color: off.
3. Optional backup: Export, **DNA Export** (head and body DNA) and keep it with the source files.

## 5. Where the files go

Run `node apps/web/scripts/boxer-v9/run.mjs --init` once. It creates the git-ignored `work/` folder. Then:

| File | Put it at |
| --- | --- |
| The full-body FBX (male) | `apps/web/scripts/boxer-v9/work/in/metahuman/m/boxer_m_full.fbx` |
| The DCC Export PNG textures (male) | `apps/web/scripts/boxer-v9/work/in/metahuman/m/textures/` |
| The bald and buzz-cut variants | `.../metahuman/m/boxer_m_full.fbx` (bald, used by the pipeline), `.../metahuman/m/boxer_m_buzz.fbx` (reference) |
| The same for the female boxer | `apps/web/scripts/boxer-v9/work/in/metahuman/f/` |
| A screenshot of the Creator view (front, 3/4, side) | `apps/web/scripts/boxer-v9/work/in/metahuman/m/ref-*.png` (for the CHECKLIST side-by-side) |

**Never** copy these into `apps/web/public/` or commit them. The repo is public (LICENCES.md, "Public repository").

Then tell the agent "MetaHuman export is in place". The next step is pipeline steps 1–2 (`run.mjs`) and the Mixamo
upload.
