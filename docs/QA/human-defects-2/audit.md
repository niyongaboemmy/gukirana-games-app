# P2-AVA-16 — campus human close-up pass 2

Follows P2-AVA-15 (`docs/QA/human-defects/audit.md`, its open items #13, #14 and #15). Scope: the current campus people
(`apps/web/src/world/Avatar.tsx`, `world/human/*`) with the realistic campus people flag on (`NEXT_PUBLIC_FF_CAMPUS_HUMANS`,
default on). Every change is gated on that existing flag (`campusHumansOn()`); `?people=v1` still shows the older people.
No new flag, no new assets, no item ids changed (saved looks decode exactly as before).

## How it was checked

- Dev human lab (`/play/human-lab`), day light rig, 560×560 close-ups, Chrome driven over raw CDP (no packages). The page's
  clock (`performance.now`, `Date.now`, rAF timestamps) is replaced by a virtual frame clock frozen 240 frames after load,
  so before and after show the same idle pose (a few shots differ slightly where the idle director picked a fidget).
- Head turn / nod: the head and neck bones are rotated on top of the frozen pose (head 60 %, neck 40 % of 0.9 rad turn /
  0.6 rad nod) before every render.
- Geometry was also inspected offline: the base meshes were dumped from the lab (bind pose, UVs, skin weights, textures)
  and rendered with a small software rasteriser (wireframe, mask regions, open borders, turned-over triangles).
- Matrix looked at: neutral × short / afro / locs / bald / twists × none / cap / beanie / kufi; every top in the catalogue
  on the feminine body (tee, white tee, imigongo tee, jersey, hoodie, track top, kitenge sun / leaf shirts, both sashes,
  navy / cream blazers); kitenge shirts and blazers on the masculine and neutral bodies.

## Fixed

| # | Defect (P2-AVA-15 #) | Fix | Code |
|---|----------------------|-----|------|
| 1 | Pale arc across the forehead of the neutral body without a hat (#13): the removed baked cap brim left a thin open crescent (42 border edges, ≤ 9 mm wide) between the forehead skin and the old crown; the sky showed through from every angle | The new holes a clean-up opens are found (open borders that were not borders before) and thin ones (≤ 16 mm) are bridged with real triangles: the loop is split into two rims and zipped (shorter diagonal first). The strip has its own vertices: the crown-side rim keeps its hair UVs, the forehead rim's UVs continue the crown island's 3D → UV mapping a short way, so the hairline sits where the brim met the forehead (no smear across texture islands). Skin weights are copied, the triangles face the way of the surface round them, and the head's normal smoothing / tessellation run after it (no seam in the lighting). Near and far heads. | `world/human/seam-fill.ts`, `Avatar.tsx prepareBase` |
| 2 | Shirt collar / lapel geometry low-poly, no stand, no thickness (#14) | A modelled collar for collared tops (kitenge shirts on every body; the shirt collar inside a blazer; a stand collar on the track top and a rolled hood on the hoodie for the feminine cuts): one closed cross-section swept round the neck — a stand (3.2 cm at the back → 2.4 cm in front), a fall folded over it with a rounded fold, a finished lower edge with 2.4 mm cloth thickness and points at the front — capped at both ends. It is fitted to this body's neck (cross-sections of the neck skin at its own height all round) and, in front, to the top's own chest panel so it lies on the chest instead of cutting into it. Skinned to the upper chest (base) and the neck (stand top / fall), so it turns and nods with the neck; no clipping into the chin in the turn / nod shots. 650 triangles (shirt; 430 for the stand or hood), appended to the body mesh (no new draw call); its UVs sit on a plain back panel of the body texture shifted by +2 in u (the texture repeats), so the print stays continuous (tri-planar in metres, P2-AVA-15) and the shader knows a collar fragment; under a blazer it takes the shirt colour. | `world/human/garment-fit.ts buildCollar / appendCollar` |
| 3 | The feminine body always showed its baked blazer and shirt whatever top was chosen (#15) | Every top now has a feminine cut (`TOP_CUTS`): scoop neck + short sleeves (tees), V neck (jersey), crew + rolled hood (hoodie), stand collar (track top), open collared neck + elbow sleeves (kitenge shirts), scoop + elbow sleeves (sashes), the base blazer kept for the blazers. Per base body and cut (shared by everyone wearing it): the blazer's whole front (lapels and their edge strips, the shirt V, the collar and pocket flaps, the trousers showing in the front opening) is removed and replaced by one clean panel laid over a depth map of the front (front-most surface, upper convex envelope per row so cloth spans the hollows, blurred 2 cm), its top edge on the chosen neckline, its sides settling onto the kept sides, its edges turned into the body (no gap from any angle), skin weights taken barycentrically from the surface it replaced. The shirt's collar band folds down into the neck at the neckline; short sleeves are taken in to the arm below the hem. In the shader: the blazer photo's own details are calmed (one even garment, the chosen fabric's weave: knit for tees, fleece for the hoodie, twill for shirts), the skin is painted above the neckline and below the sleeve hem (with a turned hem and a neckband rib), the head mesh's chest below the neckline becomes the top, the collar band / pocket islands the mask had wrong are part of the top. | `world/human/garment-fit.ts`, `materials.ts`, `Avatar.tsx applyTopCut` |

## Evidence (`docs/QA/human-defects-2/*.jpg`, before | after, same look, camera, light and frozen pose)

- `01-forehead-short_{front,profile,q34,below}`, `01-forehead-{afro,locs,bald}_*` — the pale arc is gone (no hat);
  `01-forehead-{cap,kufi}_q34` — unchanged with headwear (the fill sits under the hats).
- `02-collar-f-kitenge_{front,profile,q34,below,turn,nod}` — feminine, collared kitenge shirt;
  `02-collar-m-kitenge_*` — masculine; `02-collar-n-kitenge_q34`, `02-collar-n-blazer_{q34,turn}` — neutral.
- `03-tops-f-tee_{front,q34,profile,below,neck,full}` — the feminine tee no longer shows the blazer;
  `03-tops-f-{teewhite,jersey,hoodie,track,kitenge,imigongo,sash,blazer}_*` — the other tops.

## Performance (human lab crowd mode, 20 people, median of 3, headless Chrome / Metal, frame rate uncapped)

| viewport | before fps | after fps | draw calls | triangles | geometries |
|----------|-----------:|----------:|-----------:|----------:|-----------:|
| desktop 1280×720 DPR 1 | 402.7 (393.0 / 407.9 / 402.7) | 426.4 (426.4 / 439.2 / 393.9) | 165 → 165 | 341 785 → 375 149 | 100 → 107 |
| phone 844×390 DPR 2 | 439.5 (392.5 / 439.5 / 441.8) | 432.3 (439.1 / 409.7 / 432.3) | 168 → 168 | 341 791 → 375 155 | 100 → 107 |

The machine is shared and the frame rate uncapped, so single samples swing by ±7 %: the medians are within that noise
(desktop +5.9 %, phone −1.6 %). Draw calls and textures are unchanged; the crowd draws +33 k triangles (+9.8 %).

The near feminine body with a refit top has ~1.6 k more triangles (the front panel 18 × 24 cells + turned edges) and a
collared top 430–650 more; the far body level gets the panel without the collar. The geometries are built once per base body
and cut at load and shared. No new draw calls, no new textures or programs beyond the look shader's new cache key.

## Not fixed / left

- The feminine shoulders keep a few small folds where the blazer's collar roll met the shoulder (pressed onto the
  shoulder line, but not rebuilt); the hoodie / track top corners at the shoulder tips show a small notch in silhouette.
- The blazer's sleeve cuffs remain as a slightly larger ring at the wrist (painted skin on the short-sleeve cuts: a faint
  band).
- The sash tops are a printed fitted top: the umushanana's drape over one shoulder is not modelled.
- Masculine / neutral tees, hoodies and jerseys still recolour their base jacket (canvas jacket over a tee, zip fleece with a
  hood); only collared tops got the modelled collar there. The neutral body's bald scalp still carries the old cap crown's
  folds (P2-AVA-10 scalp, not part of this pass).
