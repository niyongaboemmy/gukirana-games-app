# P2-AVA-16 — campus human close-up pass 2

Follows P2-AVA-15 (`docs/QA/human-defects/audit.md`, its open items #13, #14 and #15). Scope: the current campus people
(`apps/web/src/world/Avatar.tsx`, `world/human/*`) with the realistic campus people flag on (`NEXT_PUBLIC_FF_CAMPUS_HUMANS`,
default on). Every change is gated on that existing flag (`campusHumansOn()`); `?people=v1` still shows the older people.
No new flag, no new assets, no item ids changed.

**Shipped: the forehead fill. Held back after review (keep the old look): the modelled collars and the feminine tops.**

## How it was checked

- Dev human lab (`/play/human-lab`), day light rig, 560×560 close-ups, Chrome driven over raw CDP (no packages). The page's
  clock (`performance.now`, `Date.now`, rAF timestamps) is replaced by a virtual frame clock frozen 240 frames after load,
  so before and after show the same idle pose.
- Head turn / nod (collars): the head and neck bones rotated on top of the frozen pose (0.9 rad turn / 0.6 rad nod).
- Geometry also inspected offline: base meshes dumped from the lab and rendered with a small software rasteriser
  (wireframe, mask regions, open borders, turned-over triangles).

## Shipped

| # | Defect (P2-AVA-15 #) | Fix | Code |
|---|----------------------|-----|------|
| 1 | Pale arc across the forehead of the neutral body without a hat (#13): the removed baked cap brim left a thin open crescent (42 border edges, ≤ 9 mm wide) between the forehead skin and the old crown; the sky showed through from every angle | New holes a clean-up opens are found (open borders that were not borders before) and thin ones (≤ 16 mm) are bridged with real triangles: the loop is split into two rims and zipped (shorter diagonal first). The strip has its own vertices: the crown-side rim keeps its hair UVs, the forehead rim's UVs continue the crown island's own 3D → UV mapping a short way (no smear across texture islands), so the hairline sits where the brim met the forehead. Skin weights copied, triangles face the way of the surface round them, the head's normal smoothing and tessellation run after it (no seam in the light). Near and far heads. | `world/human/seam-fill.ts`, `Avatar.tsx prepareBase` |

Evidence (`*.jpg`, before | after, same look, camera, light and frozen pose): `01-forehead-short_{front,profile,q34,below}`,
`01-forehead-{afro,locs,bald}_*` (the arc is gone with every style, no hat), `01-forehead-{cap,kufi}_q34` (unchanged under
headwear: the fill sits under the hats).

## Held back (review gate: not clearly better than the old look at full size)

The code stays in the tree, tested, behind two constants in `world/human/garment-fit.ts` (`FEMININE_CUTS`,
`MODELLED_COLLARS`, both `false`); with them off every look renders exactly as before this task (checked in the lab).

- **Feminine tops (#15).** Every top has a feminine cut (neckline, sleeve length, weave), the blazer front is replaced by a
  clean panel over a smoothed depth map, the collar band folds into the neck, short sleeves are taken in. At full size it
  read as a flat, fold-less sack next to the baked blazer, with leftovers: notches at the shoulder tips, dark marks at the
  side hem, the blazer's cuff ring as a band at the wrist, small folds on the shoulders from the collar roll. Needs real
  fabric (folds under the bust, at the waist and armpit, hem and sleeve-hem thickness) and the shoulders / cuffs rebuilt
  before it can ship.
- **Modelled collars (#14).** A swept stand + fall with thickness and points, fitted to the neck and chest, skinned to chest
  and neck. Reworked after review (stand 27 → 20 mm, fall rolled over and lying on the shoulders, points on the chest): on
  the masculine kitenge shirt it now reads as a normal shirt collar lying down, but next to the base jacket's own baked
  collar the gain is modest, not clearly better. On the neutral body it sits inside the base fleece's hood (shards in the
  hood), and under the masculine blazer it shows as white shards over the jacket collar: both worse.

## Performance (human lab crowd mode, 20 people, median of 3, headless Chrome / Metal, frame rate uncapped)

| viewport | before fps | after fps | draw calls | triangles |
|----------|-----------:|----------:|-----------:|----------:|
| desktop 1280×720 DPR 1 | 402.7 (393.0 / 407.9 / 402.7) | 437.5 (422.8 / 437.5 / 451.8) | 165 → 165 | 341 785 → 342 509 |
| phone 844×390 DPR 2 | 439.5 (392.5 / 439.5 / 441.8) | 441.3 (441.3 / 418.0 / 450.4) | 168 → 168 | 341 791 → 342 515 |

The machine is shared, single samples swing ±7 %: no measurable change. The fill adds ~40 triangles per neutral head
(~160 on the tessellated near head); no new draw calls, textures or programs.

## Not fixed / left

- Held back above: feminine tops, modelled collars.
- The neutral body's bald scalp still carries the old cap crown's folds (P2-AVA-10 scalp, outside this pass); a thin dark
  shell edge at the right temple predates this task.
