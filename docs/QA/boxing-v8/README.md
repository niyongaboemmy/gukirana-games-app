# Boxing v8 evidence: fighter v8 (P3-FGT-19B)

The write-up is in `docs/FIGHT-REALISM-V8.md`. The flag is `NEXT_PUBLIC_FF_BOXER_V8`. It is on unless set to `0`, which
falls back to v7. In development builds, add `?boxer=v7|v8` to a lab URL to choose the generation for that page.

| Folder | What |
| --- | --- |
| [final/](final) | **The after run.** v7 \| v8, shot by shot: [sheets/broadcast.jpg](final/sheets/broadcast.jpg) (the user's view: practice ring, side camera, desktop and phone), `duel.jpg`, `action.jpg` (guard, jab, cross, hook, uppercut, body shot, block, clinch, hit reaction, knockdown), `turnaround.jpg`, `closeup.jpg`, `checks.jpg` (the SPEC §15 pose checks). [report.md](final/report.md) has the acceptance table item by item; `report.json` has every metric for both phases. |
| [e2e/](e2e) | **Real practice fights on v8.** [hall.jpg](e2e/hall.jpg): the Boxing hall, desktop and phone. [fight-lab.jpg](e2e/fight-lab.jpg): HUD, punches, knockdown with the referee's count, the corner at the rest, phone touch controls. `*-perf-*.json`: fps per moment. |
| [baseline-v7/](baseline-v7) | The Phase 0 run of the v7 people through the first harness. |

To regenerate, run a dev server of the web app on a free port, then:

```
node qa/e2e/fighter-v8/run.mjs --web http://localhost:<port> --out docs/QA/boxing-v8/<run> [--phases v7,v8] [--only checks] [--quick]
node qa/e2e/fighter-v8/static.mjs          # the static checks alone (GLBs, KTX2 set, sources)
node qa/e2e/fighter-v8/fit-pose.mjs        # the guard / jab / hook fitter (real rig and bodies)
```

The e2e runs use `qa/e2e/boxer-hall.mjs` and `qa/e2e/boxer-fight-lab.mjs` against an own stack (web, API, realtime).
Raw PNGs are written to `$TMPDIR/fighter-v8/<label>/` and are not committed.
