# Fighter v8 harness report

Run `after`, 2026-11-17T02:03:45.734Z, web http://localhost:3971, git 908d093. Phases: v7 (loaded v7), v8 (loaded v8).
Scored phase: **v8** — 80 pass, 5 fail, 2 unset (the design's checklist sets them), 0 missing.

| Item | Threshold | v7 | v8 | Status (v8) |
| --- | --- | --- | --- | --- |
| the v8 people are loaded (not the v7 fallback) | = v8 | v7 | v8 | pass |
| 1. stature within ±0.5 cm of the class value (worst of 4 classes, m) | ≤ 0.005 | – | 0 | pass |
| 2. waist-to-hip ♂ ≥ 0.83 | ≥ 0.83 | – | 0.84 | pass |
| 2. waist-to-hip ♂ ≤ 0.88 | ≤ 0.88 | – | 0.87 | pass |
| 2. waist-to-hip ♀ ≥ 0.70 | ≥ 0.7 | – | 0.75 | pass |
| 2. waist-to-hip ♀ ≤ 0.76 | ≤ 0.76 | – | 0.75 | pass |
| 3. bideltoid / stature ♂ ≥ 0.34 | ≥ 0.34 | – | 0.345 | pass |
| 3. bideltoid / stature ♂ ≤ 0.36 | ≤ 0.36 | – | 0.35 | pass |
| 3. bideltoid / stature ♀ ≥ 0.30 | ≥ 0.3 | – | 0.311 | pass |
| 3. bideltoid / stature ♀ ≤ 0.32 | ≤ 0.32 | – | 0.313 | pass |
| 3. neck chin–notch / stature ≥ 0.050 | ≥ 0.05 | – | 0.051 | pass |
| 3. neck chin–notch / stature ≤ 0.056 | ≤ 0.056 | – | 0.054 | pass |
| 4. heads tall ≥ 7.3 (every class) | ≥ 7.3 | – | 7.53 | pass |
| 4. heads tall ≤ 7.9 (every class) | ≤ 7.9 | – | 7.83 | pass |
| 5. neck girth ♂ ≥ 0.40 m | ≥ 0.4 | – | 0.408 | pass |
| 5. upper-arm mid girth within ±1.5 cm of §2 (cm) | ≤ 1.5 | – | 0.2 | pass |
| 6. deltoid–arm luminance step under the broadcast key (guard side shot) | ≥ 0.08 | 0.805 | 0.51 | pass |
| 7. garment vertices inside the skin, stand (share) | ≤ 0.01 | 0.001 | 0.0041 | pass |
| 7. garment vertices inside the skin, guard (share) | ≤ 0.01 | 0.0384 | 0.042 | fail |
| 7. garment vertices inside the skin, jab (share) | ≤ 0.01 | 0.0144 | 0.0077 | pass |
| 7. garment vertices inside the skin, hook (share) | ≤ 0.01 | 0.0135 | 0.0058 | pass |
| 7. singlet vertices outside the band within its height, any pose | ≤ 0 | 0 | 0 | pass |
| 7. garment vertices inside the skin, worst sampled frame (guard, jab, cross, hook, block, clinch, knockdown; 13 samples each) | ≤ 0.01 | 0.062 | 0.0766 | fail |
| 7. tucked singlet vertices past the band, worst sampled frame | ≤ 0 | 0 | 0 | pass |
| 8. vest inner face visible inside the vest outline, guard side shot (px) | ≤ 0 | 84 | 83 | fail |
| 8. vest inner face visible, practice-ring broadcast camera (px) | ≤ 0 | 144 | 185 | fail |
| 9. singlet vertices not ≥ 1 mm inside the band (bind) | ≤ 0 | – | 0 | pass |
| 10. band width ≥ 8 cm | ≥ 0.08 | – | 0.0822 | pass |
| 10. band width ≤ 10 cm | ≤ 0.1 | – | 0.085 | pass |
| 10. band follows the waist (95th pct deviation, m) | ≤ 0.008 | – | 0.0073 | pass |
| 10. band contrast ΔE against the kit colour | ≥ 40 | – | 76.1978 | pass |
| 10. band top below the navel (m) | ≥ 0.005 | – | 0.0066 | pass |
| 11. trunks hem between mid-thigh and the knee top (stand) | = true | – | true | pass |
| 12. leg opening ≥ 1.25 × thigh girth at the hem | ≥ 1.25 | – | 1.505 | pass |
| 13. gathers: trunks edge / band length | ≥ 1.15 | – | 1.3267 | pass |
| 14. garment meshes separate from the body (hidden body tris deleted) | = true | – | true | pass |
| 14a. outer upper arm covered by singlet within 4 cm (worst camera, guard / jab / hook / block) | ≤ 0.02 | 0.082 | 0.0207 | fail |
| 15. glove overall length (along the back) ≥ 26 cm | ≥ 0.26 | – | 0.2658 | pass |
| 15. glove overall length ≤ 29 cm | ≤ 0.29 | – | 0.2668 | pass |
| 15. knuckle width ≥ 11.3 cm | ≥ 0.113 | – | 0.1212 | pass |
| 15. knuckle width ≤ 12.3 cm | ≤ 0.123 | – | 0.1219 | pass |
| 15. knuckle depth ≥ 11 cm | ≥ 0.11 | – | 0.1231 | pass |
| 15. knuckle depth ≤ 12.5 cm | ≤ 0.125 | – | 0.1235 | pass |
| 15. cuff ≥ 8 cm | ≥ 0.08 | – | 0.1049 | pass |
| 15. cuff ≤ 11 cm | ≤ 0.11 | – | 0.1052 | pass |
| 15. tape band 5 cm (≥ 4.5) | ≥ 0.045 | – | 0.0554 | pass |
| 15. tape band 5 cm (≤ 6) | ≤ 0.06 | – | 0.0563 | pass |
| 15. fist block ≥ 1.35 × cuff diameter (no tube) | ≥ 1.35 | – | 1.365 | pass |
| 15. white panel on the knuckle face only | = true | – | true | pass |
| 15. thumb lobe on the radial / palm side | = true | – | true | pass |
| 15a. guard forearms ≥ 55° from horizontal | ≥ 55 | 61.2735 | 63.828 | pass |
| 15a. guard forearms ≤ 75° from horizontal | ≤ 75 | 78.4534 | 67.7752 | pass |
| 15a. guard elbows inside the shoulder width | = true | true | true | pass |
| 15a. guard elbows ≥ 18 cm below the shoulders (m) | ≥ 0.18 | 0.1803 | 0.183 | pass |
| 15a. guard eyes visible from the front camera (no glove on either eye) | = true | false | true | pass |
| 15a. wrist deviation ≤ 12° (guard, jab, hook) | ≤ 12 | 0 | 0 | pass |
| 15a. guard rear glove within 4 cm of the cheek surface (m) | ≤ 0.04 | 0.076 | 0.04 | pass |
| 15a. guard lead glove at eye height ± 4 cm (m) | ≤ 0.04 | 0.0383 | 0.0164 | pass |
| 15a. guard lead glove ≥ 20 cm in front of the face (m) | ≥ 0.2 | 0.1065 | 0.2407 | pass |
| 15a. guard lead glove ≤ 30 cm in front of the face (m) | ≤ 0.3 | 0.1335 | 0.2615 | pass |
| 15a. jab palm down (dot with −y) | ≥ 0.8 | -0.7991 | 0.9057 | pass |
| 15a. jab extension ≥ 90 % | ≥ 0.9 | 0.8572 | 0.924 | pass |
| 15a. jab extension ≤ 98 % | ≤ 0.98 | 0.8575 | 0.924 | pass |
| 15a. hook elbow angle ≥ 80° | ≥ 80 | 85 | 87 | pass |
| 15a. hook elbow angle ≤ 100° | ≤ 100 | 85 | 87 | pass |
| 15a. hook elbow at shoulder height ± 5 cm (m) | ≤ 0.05 | 0.0124 | 0.0246 | pass |
| 15a. hook palm down or in | ≥ 0.5 | 0.9114 | 0.6647 | pass |
| 16. headgear padding ≥ 2.0 cm over the covered pads (2nd pct, m) | ≥ 0.02 | – | 0.0222 | pass |
| 16. brow roll ≥ 3.2 cm (m) | ≥ 0.032 | – | 0.0384 | pass |
| 16. face opening shows both eyes, the nose and the mouth (front camera) | = true | true | true | pass |
| 17. mouthguard / mouth not red | = true | – | true | pass |
| 18. tone albedos within ΔE 6 of the §6 targets (worst of 8) | ≤ 6 | – | 1.7325 | pass |
| 19. no grey cast on T1: lit skin chroma / albedo target chroma | ≥ 0.6 | 1.656 | 1.584 | pass |
| 20. the same specular F0 for every tone (shader constant + uniforms) | = true | – | true | pass |
| 20. F0 uniform equal across the people in the ring | = true | true | true | pass |
| 21. sweat off at the first bell, rising with rounds (unit test fight/sweat.test.ts) | = true | true | true | pass |
| 22. LOD0 triangles per person ≤ 31k (worst of m / f) | ≤ 31000 | – | 29316 | pass |
| 22. one draw call per person (isolated render) | ≤ 1 | 1 | 1 | pass |
| 23. fps, practice ring, 1280×720 | ≥ 58 | 60 | 60 | pass |
| 23. fps, practice ring, 844×390 DPR 2 | ≥ 58 | 60 | 60 | pass |
| 24. phone textures per person (KTX2, MB, measured) | ≤ 14 | 13.33 | 12.21 | pass |
| 24. phone textures per person (KTX2, MB, from the files) | ≤ 14 | – | 11.5 | pass |
| 25. adults only: age macro ≥ 0.5 | ≥ 0.5 | – | 0.5 | pass |
| 25. adults only: age macro ≤ 0.55 | ≤ 0.55 | – | 0.52 | pass |
| joint-limit violations, all measured poses | ≤ 0 | 0 | 0 | pass |
| foot sliding: worst single plant (cm) | unset | 15.27 | 15.9 | unset |
| foot sliding: planted travel per second (cm/s) | unset | 2.45 | 2.44 | unset |

## Joint-limit violations (first 40)

- v7: 0
- v8: 0

## Sheets

- /private/tmp/claude-501/-Users-m2pro-dev-projects-gukirana-games-app/76f56e52-b01c-48ed-bf43-b1235bed43ef/scratchpad/fin5/sheets/broadcast.jpg
- /private/tmp/claude-501/-Users-m2pro-dev-projects-gukirana-games-app/76f56e52-b01c-48ed-bf43-b1235bed43ef/scratchpad/fin5/sheets/duel.jpg
- /private/tmp/claude-501/-Users-m2pro-dev-projects-gukirana-games-app/76f56e52-b01c-48ed-bf43-b1235bed43ef/scratchpad/fin5/sheets/turnaround.jpg
- /private/tmp/claude-501/-Users-m2pro-dev-projects-gukirana-games-app/76f56e52-b01c-48ed-bf43-b1235bed43ef/scratchpad/fin5/sheets/closeup.jpg
- /private/tmp/claude-501/-Users-m2pro-dev-projects-gukirana-games-app/76f56e52-b01c-48ed-bf43-b1235bed43ef/scratchpad/fin5/sheets/action.jpg
- /private/tmp/claude-501/-Users-m2pro-dev-projects-gukirana-games-app/76f56e52-b01c-48ed-bf43-b1235bed43ef/scratchpad/fin5/sheets/checks.jpg
