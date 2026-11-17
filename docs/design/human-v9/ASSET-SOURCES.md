# Human v9: scanned-people sources (P2-AVA-13)

Searched on 2026-11-17/18. The goal: free, photogrammetry-scanned, clothed adults that a public, commercial web game
may use (CC0, or CC BY 4.0 with credit), downloadable **without a login**.

## The source bar (set after the first review)

A scan qualifies only if it has **all** of:

- a colour texture of **4k or more** (2k is visibly soft on a face close-up, 1k is mush);
- a source mesh of **about 100k triangles or more** (so the bake has real folds and facial shape to transfer);
- a **face with clear eyes, lips and ears** in the texture and the shape;
- a capture pose with the **arms away from the body** (A-pose, T-pose or a free walking pose; arms clamped to the
  sides or hands on the hips glue the skin weights of arm and torso together);
- a licence that allows commercial use in a published web game (CC0 or CC BY; not NC, not "research only").

## Result: no qualifying no-login source

| Route | What was found | Verdict |
| --- | --- | --- |
| Sketchfab | The best free CC BY scans are there, but every download needs a signed-in account (the download API answers 401). | login required |
| Objaverse 1.0 mirror (Hugging Face `allenai/objaverse`, no login) | Redistributes ~800k Sketchfab CC files published up to 2022 under each creator's own licence. All 160 metadata files were searched for scanned, clothed, full-body people under CC BY / CC0 and the candidates were opened. The textured full-body ones are phone or depth-sensor captures: in3D "Woman" and "Dima" (14-17k triangles, 1k texture), fwild "Full body" (200k triangles, 1k texture, arms close to the body), dwsd "Robert Full Body" (1M triangles, but its vertex colours are blank white). About 230 IUPUI "Birthday Bash" person scans are in the mirror but **have been removed from Sketchfab** (404), so their licence can no longer be checked on the official page and the people may have withdrawn consent: rejected. deep3dstudio's high-quality scans (below) are not in the mirror. | none passes the bar |
| Artec 3D gallery (CC BY 3.0) | "Full body scan" (a man of 50+ in a plaid shirt and jeans, high-res texture) has his **hands on his hips**; "Body scan" is a man in underwear (not everyday clothing). The site refuses automated fetching. | near miss, fails the pose rule |
| Poly Haven, ambientCG, Smithsonian Open Access (CC0) | No scanned living people. | nothing |
| Research datasets (THuman, CAPE, BUFF, RenderPeople research sets, SMPL family, FAUST) | Non-commercial or research-only licences. | rejected |
| Scanlab "Generic Man / Woman" (Sketchfab, CC BY) | 35k triangles, almost nude. | fails (and login) |

The three Objaverse scans that were built (in3D Woman, in3D Dima, fwild Full body) are kept only as **pipeline test
inputs** (git-ignored); they fail the bar and are not candidates for the game.

## Better sources that need a login (in priority order)

Each takes a free account and a few minutes. Put the downloaded file at
`apps/web/scripts/human-v9/work/in/scans/<id>/source.glb` (GLB, FBX or OBJ), add an entry to
`apps/web/scripts/human-v9/people.json`, and run `node apps/web/scripts/human-v9/run.mjs --person <id> --publish`.

1. **Your own scans of consenting Rwandan adults** (best fit by far: real Rwandan faces, skin and everyday clothes).
   A LiDAR iPhone with a photogrammetry app (Polycam, KIRI Engine, Scaniverse), the subject in an A-pose, arms 30-45
   degrees out, export GLB/OBJ with a **4k or 8k** texture and the full-resolution mesh. Get written consent (a model
   release) from each person. How to shoot: see the boxer agent's guide
   [`docs/design/boxer-v9/SCAN-GUIDE.md`](../boxer-v9/SCAN-GUIDE.md) (written in parallel; not duplicated here).
2. **deep3dstudio, "FREE DOWNLOAD Athletic African man walking 223"**,
   <https://sketchfab.com/3d-models/free-download-athletic-african-man-walking-223-f9a8e3b108f04e998815593f78f163b1>,
   CC BY 4.0 (checked on the page 2026-11-17). Studio photogrammetry (a rig of Canon 200D cameras), 100k triangles, 3
   textures, a young adult man of African appearance in a walking pose (arms free). Clothing: tank top, shorts,
   trainers (sportswear: fine for a jogger or the gym, less so for the plaza). Check the texture size in Blender: it
   must be 4k+.
3. **deep3dstudio, "FREE DOWNLOAD: Attractive African woman 236"**,
   <https://sketchfab.com/3d-models/free-download-attractive-african-woman-236-f2c29b6947f34237a0bfdc777120ef28>,
   CC BY 4.0. Same studio rig, 100k triangles, a young adult woman of African appearance in a dress, standing pose.
   Check the arms are free of the body and the texture is 4k+.
4. **MetaHuman** (Epic, free with an Epic account; see `docs/design/boxer-v9/LICENCES.md` and `METAHUMAN-SPEC.md`):
   not a scan, but film-quality faces and bodies built from scan data, any skin tone and age, and the licence now
   allows use outside Unreal. Clothing has to be made separately (a weakness for campus people).
5. **Renderpeople free rigged samples** (<https://renderpeople.com/free-3d-people/>, free account): real scans of
   clothed people, rigged, high-res textures. **Licence caution**: the Renderpeople EULA is written for renderings;
   whether a downloadable web game counts as permitted use (the files end up in the browser) must be confirmed with
   them in writing before shipping. Use for evaluation first.
6. **Mixamo** (Adobe ID) for motion only: see the clip list in [PIPELINE.md](PIPELINE.md#mixamo-equivalents).

Rejected outright: anything CC BY-NC, SMPL / SMPL-X based bodies, FAUST, research-only scan sets, and models whose
author has removed them.
