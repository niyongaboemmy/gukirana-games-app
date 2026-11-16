# Fighter v8 harness report

Run `baseline`, 2026-11-16T16:38:30.988Z, web http://localhost:3971, git da543b7. Phases: v7 (loaded v7).
Scored phase: **v7** — 15 pass, 2 fail, 10 unset (the design's checklist sets them), 0 missing.

| Item | Threshold | v7 | Status (v7) |
| --- | --- | --- | --- |
| the v8 people are loaded (not the v7 fallback) | = v8 | v7 | fail |
| triangles per fighter, LOD0 (m) | ≤ 30000 | 28347 | pass |
| triangles per fighter, LOD0 (f) | ≤ 30000 | 28064 | pass |
| fps, broadcast, 1280x720 | ≥ 58 | 60 | pass |
| fps, broadcast, 844x390 DPR 2 | ≥ 58 | 60 | pass |
| draw calls, broadcast frame (desktop) | unset | 19 | unset |
| draw calls of one fighter alone | unset | 1 | unset |
| texture MB per fighter (desktop) | unset | 29.33 | unset |
| heads tall (m) | 7.2 … 7.9 | 7.39 | pass |
| heads tall (f) | 7.2 … 7.9 | 7.35 | pass |
| neck chin-to-notch / stature (m) | 0.045 … 0.06 | 0.05 | pass |
| neck chin-to-notch / stature (f) | 0.045 … 0.06 | 0.053 | pass |
| waist-to-hip (m) | 0.83 … 0.88 | 0.84 | pass |
| waist-to-hip (f) | 0.7 … 0.75 | 0.7 | pass |
| neck girth m (boxers 0.40+) | ≥ 0.4 | 0.418 | pass |
| waist girth (m) | 0.78 … 0.84 | 0.802 | pass |
| waist girth (f) | 0.65 … 0.7 | 0.649 | fail |
| hip girth (m) | 0.95 … 1 | 0.959 | pass |
| hip girth (f) | 0.92 … 0.97 | 0.926 | pass |
| garment vertices inside the skin, worst pose (share) | unset | 0.0753 | unset |
| garment vertices inside the skin, guard (share) | unset | 0.0405 | unset |
| inside of the body visible (share of the person's pixels), worst shot | unset | 0.0036 | unset |
| inside of the garments visible from the broadcast camera (share) | unset | 0.0023 | unset |
| inside of the garments visible, worst shot (share) | unset | 0.0109 | unset |
| joint-limit violations, all measured poses | ≤ 0 | 0 | pass |
| foot sliding: worst single plant (cm) | unset | 15.22 | unset |
| foot sliding: planted travel per second (cm/s) | unset | 2.34 | unset |

## Joint-limit violations (first 40)

- v7: 0

## Sheets

- docs/QA/boxing-v8/baseline-v7/sheets/broadcast.jpg
- docs/QA/boxing-v8/baseline-v7/sheets/duel.jpg
- docs/QA/boxing-v8/baseline-v7/sheets/turnaround.jpg
- docs/QA/boxing-v8/baseline-v7/sheets/closeup.jpg
- docs/QA/boxing-v8/baseline-v7/sheets/action.jpg
