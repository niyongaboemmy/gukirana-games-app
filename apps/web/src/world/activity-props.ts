import type { GeoBatch } from "./geo";
import { NOTICE_BOARD, VIEWPOINT, WATER_POINT } from "./activities";

/**
 * Static props of the plaza activities (P2-WLD-09), merged into the district batch with the existing materials, so
 * they add no draw call of their own. The notice board's printed face is its own small quad (world/PlazaActivities:
 * frustum-culled, no shadow), so it is only drawn while it is in view.
 * Local frames: +z faces the person who uses the prop.
 */
export function activityProps(b: GeoBatch): void {
  // notice board: two timber posts, a framed pin board under a small timber canopy, on a lava-stone kerb
  const nb = NOTICE_BOARD;
  b.frame([nb.x, 0, nb.z], nb.rotY, () => {
    const top = 1.05 + nb.h;
    for (const s of [-1, 1]) b.box("woodDark", 0.1, top + 0.25, 0.1, { p: [s * (nb.w / 2 + 0.02), (top + 0.25) / 2, 0], tile: 1 });
    b.box("woodDark", nb.w + 0.16, nb.h + 0.12, 0.05, { p: [0, 1.05 + nb.h / 2, -0.03], tile: 1 });
    b.box("wood", nb.w + 0.5, 0.05, 0.42, { p: [0, top + 0.27, 0.06], r: [0.18, 0, 0], tile: 1 });
    b.box("lava", nb.w + 0.4, 0.12, 0.34, { p: [0, 0.06, 0], tile: 1.2 });
  });
  // drinking water point: a lava-stone pillar with a steel push tap and a small grated drain at its foot
  const wp = WATER_POINT;
  b.frame([wp.x, 0, wp.z], wp.rotY, () => {
    b.box("lava", 0.34, 0.98, 0.34, { p: [0, 0.49, 0], tile: 1.2 });
    b.box("granite", 0.4, 0.05, 0.4, { p: [0, 1.0, 0], tile: 1.2 });
    b.cyl("steel", 0.026, 0.026, 0.16, 10, { p: [0, 0.94, 0.2], r: [Math.PI / 2, 0, 0] });
    b.cyl("steel", 0.02, 0.016, 0.08, 10, { p: [0, 0.9, 0.27] });
    b.cyl("brass", 0.03, 0.03, 0.03, 12, { p: [0, 1.04, 0.1] });
    b.box("basalt", 0.5, 0.03, 0.36, { p: [0, 0.015, 0.36], tile: 1.2 });
    for (let i = -2; i <= 2; i++) b.box("steel", 0.42, 0.012, 0.02, { p: [0, 0.035, 0.36 + i * 0.06] });
  });
  // volcano viewpoint: a slim steel post with a sloping brass plate (the peaks' outline is etched into it)
  const v = VIEWPOINT;
  b.frame([v.x, 0, v.z], v.rotY, () => {
    b.box("lava", 0.42, 0.1, 0.42, { p: [0, 0.05, 0], tile: 1.2 });
    b.cyl("steel", 0.045, 0.06, 1.02, 10, { p: [0, 0.6, 0] });
    b.box("brass", 0.62, 0.025, 0.4, { p: [0, 1.13, 0], r: [0.42, 0, 0] });
  });
}
