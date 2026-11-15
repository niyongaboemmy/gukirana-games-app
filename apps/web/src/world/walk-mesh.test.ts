import { describe, expect, it } from "vitest";
import { inBuilding } from "./footprints";
import { PAVING_R } from "./layout";
import { CAMPUS_WALKS, DISTRICT_WALKS } from "./campus";
import { buildWalkSurface, fillet, WALK_PATHS, WALK_PROPS, walkSdf, WALK_BEND_R } from "./walk-mesh";

const surface = buildWalkSurface();

/** triangles of a position array as [ax, az, bx, bz, cx, cz] */
function triangles(pos: Float32Array) {
  const out: number[][] = [];
  for (let i = 0; i < pos.length; i += 9) out.push([pos[i]!, pos[i + 2]!, pos[i + 3]!, pos[i + 5]!, pos[i + 6]!, pos[i + 8]!]);
  return out;
}
const area = (t: number[]) => ((t[2]! - t[0]!) * (t[5]! - t[1]!) - (t[4]! - t[0]!) * (t[3]! - t[1]!)) / 2;
/** strictly inside the triangle (a small tolerance off its edges, shared edges do not count as overlap) */
function inside(t: number[], x: number, z: number) {
  const s = Math.sign(area(t));
  const e = (ax: number, az: number, bx: number, bz: number) => ((bx - ax) * (z - az) - (bz - az) * (x - ax)) * s;
  return e(t[0]!, t[1]!, t[2]!, t[3]!) > 1e-6 && e(t[2]!, t[3]!, t[4]!, t[5]!) > 1e-6 && e(t[4]!, t[5]!, t[0]!, t[1]!) > 1e-6;
}

describe("the walk network as one paved surface (P2-WLD-16)", () => {
  it("is one up-facing surface without degenerate triangles", () => {
    const tris = triangles(surface.pave);
    expect(tris.length).toBeGreaterThan(1000);
    expect(tris.length).toBeLessThan(60000);
    // every triangle winds counter-clockwise seen from above (normal +y)
    for (let i = 0; i < surface.pave.length; i += 9) {
      const ax = surface.pave[i]!;
      const az = surface.pave[i + 2]!;
      const ny = (surface.pave[i + 5]! - az) * (surface.pave[i + 6]! - ax) - (surface.pave[i + 3]! - ax) * (surface.pave[i + 8]! - az);
      expect(ny).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("has no overlapping triangles anywhere, junctions included", () => {
    const tris = triangles(surface.pave);
    // bucket the triangles on a 2 m grid
    const B = 2;
    const buckets = new Map<string, number[]>();
    tris.forEach((t, i) => {
      const x0 = Math.floor(Math.min(t[0]!, t[2]!, t[4]!) / B);
      const x1 = Math.floor(Math.max(t[0]!, t[2]!, t[4]!) / B);
      const z0 = Math.floor(Math.min(t[1]!, t[3]!, t[5]!) / B);
      const z1 = Math.floor(Math.max(t[1]!, t[3]!, t[5]!) / B);
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) (buckets.get(`${a},${b}`) ?? buckets.set(`${a},${b}`, []).get(`${a},${b}`)!).push(i);
    });
    // probe points around every junction (walk ends meet the promenade, the bends) and along every walk
    const probes: { x: number; z: number }[] = [];
    for (const n of CAMPUS_WALKS.nodes) for (let k = 0; k < 400; k++) probes.push({ x: n.x + ((k % 20) - 10) * 0.37 + 0.011, z: n.z + (Math.floor(k / 20) - 10) * 0.37 + 0.007 });
    let checked = 0;
    for (const p of probes) {
      const list = buckets.get(`${Math.floor(p.x / B)},${Math.floor(p.z / B)}`) ?? [];
      const hits = list.filter((i) => inside(tris[i]!, p.x, p.z)).length;
      expect(hits).toBeLessThanOrEqual(1);
      // and on the paving (well inside the field) exactly one triangle covers the point
      if (walkSdf(p.x, p.z) > 0.1) {
        expect(hits).toBe(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("joins the walks to the promenade as one surface: no edge (kerb) inside a junction", () => {
    for (const w of DISTRICT_WALKS) {
      const end = w.pts[w.pts.length - 1]!;
      // the walk's end is well inside the merged surface
      expect(walkSdf(end.x, end.z)).toBeGreaterThan(1.4);
      // and no contour segment (edging) passes within 1 m of the junction centre
      for (let s = 0; s < surface.contour.length; s += 4) {
        const mx = (surface.contour[s]! + surface.contour[s + 2]!) / 2;
        const mz = (surface.contour[s + 1]! + surface.contour[s + 3]!) / 2;
        expect(Math.hypot(mx - end.x, mz - end.z)).toBeGreaterThan(1.0);
      }
    }
  });

  it("keeps every paved point out of the buildings and starts at the plaza paving's edge", () => {
    for (let s = 0; s < surface.contour.length; s += 4) {
      const x = surface.contour[s]!;
      const z = surface.contour[s + 1]!;
      expect(Math.hypot(x, z)).toBeGreaterThan(PAVING_R - 0.05);
    }
    // the district walks themselves (sampled along their filleted centre lines) stay off the halls
    for (const w of WALK_PATHS.filter((q) => q.id !== "promenade"))
      for (let i = 0; i < w.pts.length - 1; i++)
        for (let t = 0; t <= 1; t += 0.25) {
          const x = w.pts[i]!.x + (w.pts[i + 1]!.x - w.pts[i]!.x) * t;
          const z = w.pts[i]!.z + (w.pts[i + 1]!.z - w.pts[i]!.z) * t;
          if (Math.hypot(x, z) > PAVING_R + 1) expect(inBuilding(x, z, 0)).toBe(false);
        }
  });

  it("rounds the bends of the district walks", () => {
    const p = fillet(
      [
        { x: 0, z: 0 },
        { x: 0, z: 20 },
        { x: 20, z: 20 },
      ],
      WALK_BEND_R,
    );
    expect(p.length).toBeGreaterThan(8);
    // the corner itself is cut: the closest point of the curve to it is ≈ r (√2 − 1) away
    const d = Math.min(...p.map((q) => Math.hypot(q.x, q.z - 20)));
    expect(d).toBeGreaterThan(WALK_BEND_R * 0.35);
    // and every turn between consecutive pieces is small (a curve, not a kink)
    for (let i = 1; i < p.length - 1; i++) {
      const a = Math.atan2(p[i]!.x - p[i - 1]!.x, p[i]!.z - p[i - 1]!.z);
      const b = Math.atan2(p[i + 1]!.x - p[i]!.x, p[i + 1]!.z - p[i]!.z);
      expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(0.2);
    }
  });

  it("puts lamps, benches and bins beside the walks, never on them or in a building", () => {
    expect(WALK_PROPS.filter((p) => p.kind === "lamp").length).toBeGreaterThan(12);
    expect(WALK_PROPS.filter((p) => p.kind === "bench").length).toBeGreaterThan(4);
    for (const p of WALK_PROPS) {
      expect(walkSdf(p.x, p.z)).toBeLessThan(-0.2);
      expect(walkSdf(p.x, p.z)).toBeGreaterThan(-1.6);
      expect(inBuilding(p.x, p.z, 1)).toBe(false);
    }
  });
});
