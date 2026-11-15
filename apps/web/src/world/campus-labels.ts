import { PORTALS, ringPoint } from "./layout";
import { inBuilding, PLOTS, type Plot } from "./footprints";
import { CAMPUS, SITE } from "./campus-strings";
import { DISTRICTS, GATE_LINE_Z, PUBLIC_ROAD } from "./campus";

/**
 * Where the campus aerial view's labels float (P2-WLD-16): every building name over the middle of its own footprint
 * (the bounding box of its plot's rectangles, footprints.ts PLOTS: the Fight Games label over the Boxing hall's long
 * body, the Pool Hall's over the Pool Hall — it used to float 12 m behind the door, which from the aerial view put it
 * over the Tournament Arena), a little above its roof; the district names over open lawn. Pure (unit tested).
 */
export interface CampusLabel {
  key: string;
  text: string;
  sub?: string;
  x: number;
  z: number;
  y: number;
  /** "far": still shown from very high up (the campus name, the big Fight hall); "near": hidden there (decluttered) */
  tier: "near" | "far";
}

/** Label height (m) by building kind: just above the roof (the arena: drum 20 m, dome and oculus lid to ~25.5 m since P2-WLD-17; the halls 7–12 m). */
const HEIGHT: Record<string, number> = { arena: 26, fight: 17, pool: 15, admin: 15, ludo: 14, igisoro: 12, service: 10 };

/** The middle of a plot's footprint in the world. */
export function plotCentre(p: Plot): { x: number; z: number } {
  const xs = p.rects.flatMap((r) => [r.x0, r.x1]);
  const zs = p.rects.flatMap((r) => [r.z0, r.z1]);
  const lx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const lz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const d = ringPoint(p.angleDeg, p.ring);
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return { x: d.x + lx * c + lz * s, z: d.z - lx * s + lz * c };
}

export function campusLabels(): CampusLabel[] {
  const out: CampusLabel[] = [];
  for (const p of PORTALS) {
    if (p.kind === "soon") continue;
    const plot = PLOTS.find((q) => q.id === p.id)!;
    const c = plotCentre(plot);
    out.push({ key: p.id, text: p.label, sub: p.href ? undefined : CAMPUS.closed, x: c.x, z: c.z, y: HEIGHT[p.kind] ?? 14, tier: p.kind === "fight" ? "far" : "near" });
  }
  const svc = plotCentre(PLOTS.find((q) => q.id === "service")!);
  out.push({ key: "help", text: CAMPUS.help, x: svc.x, z: svc.z, y: HEIGHT.service!, tier: "near" });
  out.push({ key: "plaza", text: CAMPUS.plaza, x: 0, z: 0, y: 12, tier: "near" });
  out.push({ key: "gate", text: CAMPUS.gate, x: 0, z: GATE_LINE_Z, y: 12, tier: "near" });
  out.push({ key: "campus", text: CAMPUS.campus, x: 0, z: 0, y: 40, tier: "far" });
  // district names over open lawn in the middle of their bearing range (clear of every building)
  for (const d of DISTRICTS) {
    if (d.id === "view") continue;
    const mid = (d.from + d.to) / 2;
    let best: { x: number; z: number } | null = null;
    search: for (const r of [132, 126, 138, 120, 144, 114, 150])
      for (const dd of [0, -6, 6, -12, 12, -18, 18]) {
        const q = ringPoint(mid + dd, r);
        if (!inBuilding(q.x, q.z, 6)) {
          best = { x: q.x, z: q.z };
          break search;
        }
      }
    const c = best ?? ringPoint(mid, 132);
    out.push({ key: `d-${d.id}`, text: SITE.district[d.id], x: c.x, z: c.z, y: 8, tier: "near" });
  }
  out.push({ key: "road", text: SITE.road, x: -90, z: PUBLIC_ROAD.mid, y: 5, tier: "near" });
  return out;
}
