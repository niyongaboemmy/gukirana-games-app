# Boxing v7 evidence: the art-director pass (P3-FGT-18)

The write-up is in `docs/FIGHT-REALISM-V7.md`. Flag: `NEXT_PUBLIC_FF_BOXER_V7` (on unless set to `0`).

In every sheet:

- **before** is a dev server running with the flag at `0` (the P3-FGT-17 people);
- **after** is the flag on.

| Sheet | What |
| --- | --- |
| [broadcast.jpg](broadcast.jpg) | The user's view: the practice ring in the fight lab, side camera, 1280×720 and 844×390 DPR 2 |
| [duel.jpg](duel.jpg) | Two-fighter lab under the ring rig (`light=ring`): guard / jab / hook / clinch side, close (f and m), phone, front |
| [closeups.jpg](closeups.jpg) | Studio light: full body (side, 3/4, back, front), strap, shoulder blade, arm hole, trunks and band, headgear 3/4 and back, gloves |
| [base.jpg](base.jpg) | Base decision: MakeHuman boxer vs the Rocketbox body, same guard and light |
| [edges-before.jpg](edges-before.jpg), [edges-after.jpg](edges-after.jpg) | Vest edge close-ups over 5 poses (`qa/e2e/boxer-edges.mjs`) |
| [broadcast-round1-vs-after.jpg](broadcast-round1-vs-after.jpg), [duel-round1-vs-after.jpg](duel-round1-vs-after.jpg) | Iteration round 1 against the final round |
| [assess/](assess) | Rubric boxer shot list, metrics and `realism-report.json` (with `scores.json`) |
| `frames-*.json` | Draw calls, triangles and fps per shot |

To regenerate:

```
node qa/e2e/boxing-v7-sheet.mjs docs/QA/boxing-v7 shoot before   # server run with NEXT_PUBLIC_FF_BOXER_V7=0
node qa/e2e/boxing-v7-sheet.mjs docs/QA/boxing-v7 shoot after    # server run with the flag on
node qa/e2e/boxing-v7-sheet.mjs docs/QA/boxing-v7 sheet
```

Raw PNGs are not committed.
