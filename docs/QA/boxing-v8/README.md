# Boxing v8 evidence: fighter v8 (P3-FGT-19B)

The write-up is in `docs/FIGHT-REALISM-V8.md`. The flag is `NEXT_PUBLIC_FF_BOXER_V8` (off by default). In development
builds, add `?boxer=v7|v8` to a lab URL to choose the generation for that page.

| Folder | What |
| --- | --- |
| [baseline-v7/](baseline-v7) | The **before** run: the shipped v7 people through the full fighter-v8 harness. Contents: `report.md` (the acceptance table), `report.json` (every metric) and `sheets/*.jpg` (broadcast, duel, turnarounds, close-ups, action frames). |

To regenerate, run a dev server of the web app on a free port, then:

```
node qa/e2e/fighter-v8/run.mjs --web http://localhost:<port> --out docs/QA/boxing-v8/<run> [--phases v7,v8] [--quick] [--label <name>]
```

Raw PNGs are written to `$TMPDIR/fighter-v8/<label>/` and are not committed. Thresholds live in
`qa/e2e/fighter-v8/acceptance.json`.
