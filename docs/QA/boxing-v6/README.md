# Boxing v6 evidence — the rebuilt ring bodies (P3-FGT-17)

Research and approach: `docs/HUMAN-REALISM-VR-RESEARCH.md`. Flag `NEXT_PUBLIC_FF_BODY_V6` (on unless `0`). Every sheet
puts **before** (the P3-FGT-16 bodies and shading, `glb=before` in the labs) beside **after**.

| Sheet | What |
| --- | --- |
| [body.jpg](body.jpg) | full body front / side / back — masculine deep tone (index 1), feminine medium tone (5); 3/4 views of both bodies in the light tone (9) |
| [actions-desktop.jpg](actions-desktop.jpg) | two-fighter lab, 1280×720: guard, jab, lead hook, clinch (side camera), guard (close), jab (front) |
| [actions-phone.jpg](actions-phone.jpg) | the same at 844×390, DPR 2: guard, jab, lead hook, clinch |
| [closeups.jpg](closeups.jpg) | shoulder (guard, jab), arm hole (hook, guard), waistband (m, f), gloves + headgear (m, f), face (m, f), back, chest |
| [assess/sheets/](assess/sheets) | the rubric's boxer shot list (`qa/e2e/human-assess`, `--only boxer`), desktop + phone, after |
| [fight-lab/](fight-lab) | the practice ring in the fight lab (engine-driven round): guard / jab / lead hook / rest, desktop + phone, frame numbers |

Regenerate: `node qa/e2e/boxing-v6-sheet.mjs docs/QA/boxing-v6` (dev server, `QA_WEB`), `node qa/e2e/human-assess/assess.mjs
--web <url> --out docs/QA/boxing-v6/assess --only boxer` + `report.mjs`, `SIZE=… node qa/e2e/boxer-fight-lab.mjs
docs/QA/boxing-v6/fight-lab` (needs `NEXT_PUBLIC_FF_FIGHT=1`).

## What changed, against the user's screenshot

| Seen before | After |
| --- | --- |
| Torso a smooth tube, no taper; chest cones | Athletic sculpt (lats V, narrower waist, pectoral shelf, smaller firm bust under a sports-bra shape for the feminine body); a fitted singlet drape (0.55 m/m) so the taper shows through the vest; the vest lies on the smoothed body at the tuck (no navel / abs printing) |
| No deltoid / trapezius / neck-to-shoulder line; arm a cylinder; no forearm taper | Deltoid, upper-arm, forearm and calf muscle targets, thicker neck sloping into the trapezius; the baked anatomy map adds the separations (deltoid borders, pectoral line, serratus, abdominal segments, forearm bellies) where skin shows |
| Vest stands off; dark cavity and the shell's inside at the arm hole | The lower arm hole is blended onto the body (2 mm over the skin at the edge); a facing turned in under the binding closes the view into the shell at the neckline and straps; fold normals (tuck ripples, jersey wrinkle) |
| Thick blocky white waistband; stiff tube trunks | 11 mm waistband (was 17), 4.5 cm band (was 6); legs fall loose from the thigh into five flutes at the hem; vertical fold / hip crease normals |
| Gloves and headgear smooth oversized blobs; headgear swallows the face | Glove at product size (≈ 28.5 cm, 11.6 cm at the knuckles, 8.8 × 7 cm cuff, domed knuckle pad; × 0.94 for the feminine 10 oz) with the white competition scoring panel; headgear opening ±53° and over the brows, no visor, thinner cheek pads |
| Flat skin | Analytic pre-integrated-style diffuse (warm terminator), anatomy normal + cavity, roughness and tonal breakup |

## Rubric scores (docs/HUMAN-REALISM-RUBRIC.md; boxers)

Before = the P3-FGT-16 boxers re-read against the user's screenshot (round 3's numbers where measured). A score is the
lower of the automatic and visual scores.

| Criterion | Before | After | Notes |
| --- | --- | --- | --- |
| Proportions | 4 auto / 3 visual (mannequin trunk) | **4** (auto 4, visual 4) | 7.7–7.9 heads, segments within 9–12 % |
| Arms (P3-FGT-16 measure) | 4 | **4** | keyed anatomical arms unchanged (hinge elbows 0° sideways); now with deltoid / forearm form |
| Clothing | 2 (cavity, blocky band, tube trunks) | **3** visual (4 at gameplay distance); auto **2** for the rubric's subject set, **3** for the boxers alone | boxers: rest 0 % / 0.13 % (round 3: 2.0 % / 2.4 %), in the pose 1.95 % / 2.92 % inside (round 3: 4.5 % / 3.5 %). The auto 2 comes from the referee shirt / staff polo in the idle pose (6.3–8.1 %, the sleeve pressed into the chest under the arm — hidden in the armpit) |
| Skin | 3 | **3** | better at 1–3 m; close-up 4 needs scanned detail (paid) — see the research doc §11 |
| Hands (gloves) | 3 | **4** | product-sized competition glove; tells: no stitching / laces |
| Motion | 3 | **3** | unchanged (hand-keyed); 4 needs captured boxing motion |
| Performance | 4 | **5** | below |

Targets not reached and why: **skin 4** (needs scanned skin detail — the CC0 MakeHuman skin is a 2K whole-body photo;
3D Scan Store body scan £69.99 + £499.99 licence, or Texturing.xyz $299.90 per face), **clothing 4 in close-up**
(needs authored garments with sculpted / simulated folds baked to normal maps — Marvelous Designer licence ≈ $50/month
or an artist, 3–5 days), **motion 4** (captured boxing motion: a studio day or a licensed pack). The research doc §11
lists the options with their licences.

## Performance (M2 Pro, headless Chrome, ANGLE / Metal)

| | Before (P3-FGT-16) | After |
| --- | --- | --- |
| One boxer, merged skinned mesh (m / f) | 27.6k / 27.2k tris | **28.3k / 28.1k** (budget ≈ 30k) |
| Draw calls per person | 1 + shadow | 1 + shadow |
| Lab duel frame (two boxers + ring) | 11 calls, 126.9k tris | 11 calls, 130.2k tris |
| Clinch with the referee | 13 calls, 182.4k tris | 13 calls, 185.7k tris |
| Practice ring, round (`fight-lab`) | 8 calls, 93.5k tris, 60 fps | **8 calls, 98.8k tris, 60 fps** at 1280×720 and at 844×390 DPR 2 (58–59 fps for one frame while the stool is carried in) |
| GLB | 3.22 / 3.16 MB | 3.24 / 3.20 MB |
| New texture | — | `body-detail-{m,f}.webp` 1024², 249 / 227 KB on disk, 5.3 MB on the GPU with mips |
| Textures per person on the GPU | 24 MB desktop (2K skin) | 29.3 MB desktop, ≈ 13.3 MB phone (1K skin) |

KTX2 / Basis was not adopted in this task: the repository ships WebP and has no KTX2 transcoder or encoder set up
(`toktx` / `basisu` not installed). Converting the skin and anatomy maps to UASTC / ETC1S KTX2 would cut their GPU
memory roughly 4× (1K ≈ 1.3 MB with mips) — a follow-up that touches every human texture, not just this one.

Frame numbers: `frames.json` (the sheets), `fight-lab/perf-*.json`, `assess/metrics.json`.
