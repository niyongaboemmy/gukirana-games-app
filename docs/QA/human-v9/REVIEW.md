# Human v9 review (P2-AVA-13): quality gate FAILED

The v9 test people against the current campus people in the dev human lab (`/play/human-lab`), same camera, same
"day" light rig (ACES tone mapping, sun + sky fill, as on the plaza), 1280 × 720. Scans and credits:
[CREDITS.md](CREDITS.md). Captured with `qa/e2e/human-assess/v9-compare.mjs`.

**Verdict: the current people win every comparison. v9 is not a candidate; the flag stays off.**

| Image | What it shows | Judgement at full size |
| --- | --- | --- |
| [before-after-face.jpg](before-after-face.jpg) | Face close-up | Current: modelled eyes, lids, lips, skin detail. v9: smeared 1k photo texture on a ~1k-triangle head, no readable eyes or lips (Dima, Woman); fwild's face is better but pale and soft, and her hair is a solid shell. **Current wins clearly.** |
| [before-after-full.jpg](before-after-full.jpg) | Standing, idle clip | v9 proportions are real, but the clothes are soft blobs, hands are fists, the Woman's hair bun reads as a hood. **Current wins.** |
| [before-after-walk.jpg](before-after-walk.jpg) | Walking, 1.2 m/s | The CMU walk reads naturally at this distance; feet are on the floor, the head no longer tips back (fixed in the retarget). Up close the texture gives it away. **Current wins**, by less. |
| [v9-talk-sit-wave.jpg](v9-talk-sit-wave.jpg) | Talking, sitting (no bench in the lab, so the seated clip floats at chair height), waving | **Defect:** fwild's long hair is part of her body mesh and is weighted to her arm: waving tears a black sheet out of the hair. The talking pose is fine; the sitting clip (CMU 114_05) crosses the legs. |
| [crowd-20-lab.jpg](crowd-20-lab.jpg) | 20 people round the lab person | At crowd distance the v9 people read as people; still flatter than the current ones. |

Not produced: a crowd shot at a real campus location (the campus caps ambient people at 3 / 6 on screen, and the
quality gate already failed, so v9 was not put on the campus).

## Defects found and what was done

| Defect | Status |
| --- | --- |
| Head and neck tipped back in walk / wave (retarget aligned the scan's short neck bones to the CMU T-pose) | **Fixed**: `04_retarget_clips.py --keep-rest` for spine, neck, head, clavicles |
| Face camera aimed above the face (head joint too high) | **Fixed**: head joint at 86.2 % of the height |
| Clips not playing in development (React's double mount stopped the mixer, the breathing layer then drifted) | **Fixed** in `ScannedPerson.tsx` |
| Shiny trousers in the Blender preview | Preview-only (Workbench studio light); the runtime material is matte cloth (roughness 0.9) with a knit micro-normal, skin from the shared skin module |
| Mushy faces, soft clothes, mitten hands | **Not fixable** from these scans: source texture 1k, 14-17k triangles. Needs a scan that meets the source bar (ASSET-SOURCES.md) |
| Hair weighted to the arm (fwild) | Not fixed: needs a hair mask in the rig step, or a scan with tied-back hair |
| Seated clip floats without a seat | Expected in the empty lab; campus seats would carry it |

## Performance

`v9-compare.mjs --perf`: the lab crowd mode, 20 people on screen (the lab person + 19), day rig, shadows on the
first ring, M2 Pro, headless Chrome with the frame-rate limit off (so fps is the uncapped render rate, not a
phone's). The "phone" run emulates 844 × 390 at DPR 2 but runs on the same M2 GPU: treat it as a relative number;
it is not a measurement on a real phone.

| Variant | Viewport | fps (uncapped) | draw calls | triangles | textures |
| --- | --- | --- | --- | --- | --- |
| current people | desktop 1280 × 720 | 453 | 164 | 286k | 81 |
| current people | phone 844 × 390, DPR 2 | 453 | 165 | 286k | 81 |
| v9 people | desktop 1280 × 720 | 699 | 30 | 296k | 47 |
| v9 people | phone 844 × 390, DPR 2 | 711 | 30 | 296k | 47 |

v9 is cheaper to draw (one mesh per person instead of ~20) at about the same triangle count. Performance is not the
problem; the look is.
