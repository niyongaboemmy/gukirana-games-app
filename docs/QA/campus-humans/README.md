# Campus people realism — evidence (P2-AVA-12)

Design / research / decision: [docs/CAMPUS-HUMAN-REALISM.md](../../CAMPUS-HUMAN-REALISM.md). Rubric:
[docs/HUMAN-REALISM-RUBRIC.md](../../HUMAN-REALISM-RUBRIC.md) (pass bar 4; a criterion's score = min(auto, visual)).

Produced with `node qa/e2e/human-assess/assess.mjs --only campus,lab,matrix,lod --out docs/QA/campus-humans/<round>`
(human lab, day / sunset / night, desktop 1280 × 720 and phone 844 × 390 DPR 2, skin tones 0 / 3 / 6 / 10 × young /
adult / senior × feminine / masculine) and `node qa/e2e/human-assess/crowd-perf.mjs` (30-person crowd, v1 vs v2).

| Folder | What |
| --- | --- |
| `before/` | Baseline (P2-AVA-11 people): all sheets, `metrics.json`, `scores.json`, `realism-report.json` |
| `round-1/` | After eyes, skin / fabric shading, caps, expressions, jump, lean, reactions (kept: caps, clothes, faces, reactions) |
| `round-2/` | After stronger reactions, light-skin warmth, far-LOD material, crowd mode (some shots were taken during hot reloads: indicative only) |
| `round-3/` | Final, clean run (code frozen): all sheets, `metrics.json`, `scores.json`, `realism-report.json` |
| `compare/` | Before (top) / after (bottom) sheets: faces of every tone × age × body (day, sunset, night), caps (desktop, phone), clothing close-ups (desktop, phone), reaction faces, jump strips, lab views, eye close-ups |
| `closeups/` | Standing jump strip, running jump strip, lean into a curve (before / after, from behind), expressions (neutral / joy / surprise / sad) |
| `perf.json` | Crowd fps (median of 3 interleaved runs), draw calls, triangles, textures; character asset bytes |

Round-3 sheets of note: `round-3/sheets/caps-*`, `clothes-*`, `motion-*-{walk,run,startstop,jump,runjump}.jpg`,
`reactions-*.jpg`, `matrix-{day,sunset,night}-*-faces.jpg`, `lab-{desktop,phone}-*`.

## Scores (plaza / campus person)

| Criterion | Before | Round 1 | Round 2 | Round 3 (final) |
| --- | --- | --- | --- | --- |
| Proportions | 4 | 4 | 4 | 3* |
| Face | 2 | 3 | 3 | 3 |
| Eyes | 2 | 4 | 4 | **4** |
| Skin | 2 | 3 | 3 | 3 |
| Hair (incl. under headwear) | 3 | 3 | 3 | 3 |
| Hands and fingers | 2 | 3 | 3 | 3 |
| Clothing | 2 | 2 (visual 3) | 2 (visual 3) | 2 (visual 3)† |
| Motion | 4 | 5 | 5 | **5** |
| Expressions | 2 | 3 | 4 | **4** |
| Lighting response | 3 | 3 | 3 | 3 |
| LOD transitions | 4 | 4 | 4 | **4** |
| Performance | 4 | 4 | 4 | 3‡ |

\* The automatic proportion check measured 6.86 heads in round 3: the lab now streams the everyday-life clips, and the
measurement caught an idle fidget (head down, phone check); the bodies are unchanged (7.5 heads in the baseline).
† The automatic rule caps clothing at 2 while garments are part of the body surface (the Rocketbox bases).
‡ Per-person maximum 12 draw calls incl. shadow (was 7: + the eyeballs, the headwear and the hair on the near level)
and 60k triangles near (the tessellated head); the 30-person crowd costs 11 % fps (below).

## Performance (30-person crowd, M2 Pro, headless Chrome, uncapped fps, median of 3)

| | v1 (before) | v2 (after) |
| --- | --- | --- |
| Desktop 1280 × 720 fps | 348.8 | 310.4 |
| Phone 844 × 390 DPR 2 fps | 330.6 | 289.8 |
| Draw calls (whole frame) | 203 / 207 | 220 / 224 |
| Triangles (whole frame) | 316.7k | 358.4k |
| Textures in GPU memory | 118 | 119 (+ `human-detail.webp`, 512 px) |
| Shader programs | 15 | 17 |
| GLB / texture bytes shipped | 17 MB (`assets/characters`) | unchanged (no new files; `human-detail.webp` 240 KB is now also fetched on the plaza) |

The machine was shared with another agent: single samples ranged ±30 %; the medians are what is reported. Real-phone
GPUs are far slower than this desktop GPU: profile on devices before widening the crowd (see the doc's §7).
