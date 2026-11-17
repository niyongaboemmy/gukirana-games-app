# Boxer v9: free asset sources (P3-FGT-21)

Searched on 2026-11-17, mainly through Sketchfab's public search API (downloadable models, licence filter CC BY and
CC0; no CC0 boxing gear exists there), plus Microsoft Rocketbox and MakeHuman for reference. Polycounts are the
triangle counts Sketchfab reports.

How the candidates were inspected: Sketchfab downloads need a logged-in account, which the agent must not create, so
**no model was downloaded**. Each shortlisted model was judged from its official preview images, fetched through the
API into a scratch folder and deleted afterwards, and from its metadata: polycount, texture count, PBR flag,
description, tags. The user downloads the approved picks with a free Sketchfab account. Every pick must be checked
again by eye in Blender before it goes into the pipeline. Nothing third-party is committed.

Ranking rule: realism in a broadcast-distance fight first, then how much work it needs to fit the pipeline, then
polycount.

## 1. Adult bodies (fallback if MetaHuman is not used)

MetaHuman is allowed (LICENCES.md (a)), so it stays plan A. These are plan B, and also reference material for
anatomy and skin.

| Rank | Model | Author | Licence | Polycount / textures | Realism | What it needs to fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [FREE DOWNLOAD Athletic African man walking 223](https://sketchfab.com/3d-models/free-download-athletic-african-man-walking-223-f9a8e3b108f04e998815593f78f163b1) | deep3dstudio | CC BY 4.0 | 100k tris, 3 textures | High: a real photogrammetry scan ("custom built 3D scanner equipped with Canon 200D cameras") of an athletic young adult man of African appearance. Real skin, real muscle on arms and legs. | Clothes are baked into the scan (striped tank top, shorts, red sneakers), so the torso texture has to be repainted under our singlet. It is in a walking pose, not rigged, so it needs re-posing to an A-pose, then Mixamo auto-rig. The head is the most valuable part. Adult, looks about 20 to 30. |
| 2 | [Generic Man](https://sketchfab.com/3d-models/generic-man-9b4527d4bc524c31bed48054f0c04b71) | Scanlab Photogrammetry Inc. | CC BY 4.0 (author: "Commercial use credit: Scanlab Photogrammetry, Inc.") | 35k tris, 3 materials, 12 textures | Medium: "an amalgamation of about 50 scans". Real proportions, almost bare (underwear), bald, light skin. The average build is not athletic. | Already in an A-pose and nearly nude, so it is the easiest to rig. Re-tint the skin to East African tones (docs/AVATAR-REFERENCE-RWANDA.md palette). Sculpt or bake athletic definition. The author warns that the textures "are a bit all over the place". |
| female 1 | [Generic Woman](https://sketchfab.com/3d-models/generic-woman-ff5571cf3b484f4385c305e0cd70ad21) | Scanlab Photogrammetry Inc. | CC BY 4.0 | 35k tris, 12 textures | As the Generic Man. | As the Generic Man. |
| ref | [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) | Microsoft Research | MIT | 115 rigged avatars, Bip01 skeleton | Low by 2026 standards (2019 game avatars), though diverse, with African adults included. | Same skeleton naming as our runtime. Useful only as a rig test dummy. |
| ref | MakeHuman / MPFB (CC0) | MakeHuman community | CC0 | the v8 base | The base the user rated about 0 % real. | Not a v9 source. |

Rejected: scanned people in jeans or hoodies (OverseerThuror, 3dfarm, Renderpeople "Eric"), because baked clothing
cannot be removed for a bare-armed boxer. in3D iPhone scan (37k): low texture quality. Renderpeople free models: their
licence for real-time games is unclear.

### No-login bodies (P3-FGT-23, searched 2026-11-17)

| Model | Author | Licence | Source | Verdict |
| --- | --- | --- | --- | --- |
| [Body scan](https://www.artec3d.com/3d-models/body-scan) | Artec 3D (Artec Leo scanner) | CC BY 4.0 on the page (the `license.txt` in the zip says CC BY 3.0 Unported; both allow commercial use with credit) | 765k triangles, one 8192 px texture, OBJ, direct CDN download, no account | **Used for the first scan test.** An athletic adult man (white European, about 30), nearly bare (tight black briefs), real face with clear eyes, lips and ears. But: double-biceps flex pose (re-posed by step 0; the armpits were never scanned), fists, not African. The test result does not beat v8 (docs/QA/boxing-v9/scan-test/). A real person's likeness: fine for a dev test, not for shipping without thought. |
| [Full body scan](https://www.artec3d.com/3d-models/full-body-scan) | Artec 3D | CC BY 4.0 | OBJ / PLY, no login | Rejected: an older man in a loose shirt and jeans, hands on hips (baked clothing, arms against the body). |
| Deep3D Studio "Basic" free pack (Dropbox link, via cgchannel) | Deep3D Studio | "licensed for commercial use", no licence text | no login | Rejected: unclear terms, and all four are clothed white adults. |

Nothing African, athletic, in an A-pose and CC0 / CC BY was found as a no-login download. The best login-required
picks remain rank 1 and 2 of the table above (Sketchfab, the user's own free account): deep3dstudio's athletic African
man (CC BY 4.0, 100k triangles, real photogrammetry, but baked clothes and a walking pose) and Scanlab's Generic Man
(CC BY 4.0, A-pose, nearly bare, not athletic). Their texture resolution must be checked after download: reject
anything under 4k. **The best route is the user's own iPhone scan of a real Musanze boxer (SCAN-GUIDE.md).**

## 2. Boxing gloves (laced or velcro, thumb attached)

| Rank | Model | Author | Licence | Polycount / textures | Realism | What it needs to fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Challenger boxing glove](https://sketchfab.com/3d-models/challenger-boxing-glove-b9b8b6aebfd146b8a11f840b2f8d0cca) | alban | CC BY 4.0 | 107k tris, 3 materials, 3 textures | **Real 3D scan** (tag "3dscan") of a red leather glove: real creases, worn leather, attached thumb, wrapped cuff. The best surface realism found. | It is a single glove, so the left is mirrored from it (06_fit_gear.py --mirror). The cuff label "CHALLENGER" and the print must be painted out. The author says "The top part was too shiny hence the weird spot", so repaint that area and cap the roughness. Decimate to 2.5k tris and bake normal plus colour from the scan. The style is older and plumper than a modern competition glove. |
| 2 | [Boxing Gloves (3d scan)](https://sketchfab.com/3d-models/boxing-gloves-9936731c919c466196a7b53c54c94ab5) | andrey_belovodsky | CC BY 4.0 | 25k tris, 1 diffuse at 4096 px | **Real scan** of a modern velcro training pair: red with a black and white cuff, the closest look to a modern amateur glove. | It was scanned lying on a board, so the undersides and palms are probably fused with the board. Cut them free (--cut-below), rebuild the palm, or mirror the better glove. Larsen brand logos must be painted out. Diffuse only, so the normal map comes from the scan geometry. |
| alt | [Boxing gloves](https://sketchfab.com/3d-models/boxing-gloves-f76fcadeb6524896b14325696354965b) | ule71 | CC BY 4.0 | 114k tris (2 sets: high 56k/glove, low 1.1k/glove), 6 textures (diffuse, normal, roughness) | Modelled, not scanned: clean quads, a good shape, a softer CG look. | The easiest to fit (left and right, quads, UVs). Use it if the scans are too messy, and bake scan leather detail onto it later. |
| alt | [Boxing Gloves - Left / Right Handed](https://sketchfab.com/3d-models/boxing-gloves-right-handed-1ae09e8e4959418b9c4274f9515c5d29) | Gohar.Munir | CC BY 4.0 | 85k tris with LODs | Stylised, plasticky. | Not recommended for realism. |

Competition note (amateur rules): gloves are red or blue to match the corner, with a white target area on the
knuckles. The scans are red. The blue corner is a hue shift of the baked albedo plus a painted white knuckle area.

## 3. Amateur headgear

Amateur boxing rules have not used headgear for elite men since 2013. Women and youth still wear it, and so does
everyone in sparring (AIBA rule change; check the current IBA or World Boxing rule before shipping). So headgear is
needed for the female boxer, for the gym and for sparring, but not for the male bout.

| Rank | Model | Author | Licence | Polycount / textures | Realism | What it needs to fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Boxing Headgear Helmet (Low Poly)](https://sketchfab.com/3d-models/boxing-headgear-helmet-low-poly-498387769b0347f292ab1bdbddbfe719) | ARTEL_3D_STUDIO | CC BY 4.0 | 13k tris, 1 texture | Modelled, not scanned. It has the right open-face competition shape with cheek pads, ear holes and a chin strap, but it is glossy red plastic. | Matte leather roughness (0.55 to 0.7), stitch and seam normal detail, a blue variant. Fit with --mode headgear. Decimate to about 2k. |
| 2 | [Boxing headgear fbx](https://sketchfab.com/3d-models/boxing-headgear-fbx-9a43d1767d9e4296bdd0e8b51f80d20a) | Chillax | CC BY 4.0 | 18.7k tris, no textures | A plain grey shape with forehead and cheek coverage. | Needs UVs and full texturing. Use only if rank 1 fails. |

Rejected: 3DWorkbench "Boxing helmet" (26k), a sci-fi concept design and not real gear.

## 4. Boxing shoes (optional)

| Rank | Model | Author | Licence | Polycount / textures | Realism | What it needs to fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Boxer - Boots](https://sketchfab.com/3d-models/boxer-boots-e843e3e83750425db83a92ea77f900b7) | Ginny Sutton (suttonj94) | CC BY 4.0 | 4.6k tris, 4 PBR textures (metalness workflow) | A good modern high-top laced boxing boot, game-ready (Substance-textured). | Mirror for the other foot. Fit with --mode shoe (weights from the body's foot and toe). Hide the feet faces. Replace the logo-like stripe if it reads as a brand. |
| 2 | [Yrjö Saarela's Wrestling Boot](https://sketchfab.com/3d-models/yrjo-saarelas-wrestling-boot-376c999be8944df4bc8e5302f95750df) | urheilumuseo (Finnish Sports Museum) | CC BY 4.0 | 77k tris, 1 texture | A real museum scan of a 1911 leather wrestling boot. Real material, antique look. | Only as a leather detail source, or for a retro gym poster prop. |

## 5. Mouthguard (optional)

| Rank | Model | Author | Licence | Polycount / textures | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | [Mouth Guard](https://sketchfab.com/3d-models/mouth-guard-31a01b18d16b4a7f83f9a56b4f8a0fcf) | pigarev.art | CC BY 4.0 | 27.8k tris, 1 texture | Decimate to about 300 tris. Mostly hidden behind the lips; it shows in the wince and effort faces. |
| 2 | Our own (a 300-tri U shape, clear or coloured) | - | ours | - | No licence question. Recommended unless the scan reads clearly better. |

## Credits to add when a pick is approved

Add each approved pick to `docs/ASSET-LICENSES.md` and to the in-game credits, in the CC BY 4.0 form given in
LICENCES.md (d). Example: "Challenger boxing glove" by alban
(https://sketchfab.com/3d-models/challenger-boxing-glove-b9b8b6aebfd146b8a11f840b2f8d0cca), CC BY 4.0, modified
(retopologised, re-textured, logo removed, fitted to our boxer).
