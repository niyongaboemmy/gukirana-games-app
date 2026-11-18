import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { borderLoops, borderVertexFlags, fillNewHoles, fillStripHole, stripWidth } from "./seam-fill";
import {
  buildCollar,
  collarSection,
  FEMININE_CUTS,
  feminineCut,
  MODELLED_COLLARS,
  frontPanel,
  necklineDrop,
  neckProfile,
  SLEEVE_END,
  topCut,
  type CollarSpec,
} from "./garment-fit";
import { OUTFITS } from "../outfits";

/** P2-AVA-16 close-up pass: forehead gap fill, modelled collars, feminine tops that follow the chosen item. */

/** A grid (z up) with rows `gapRow` .. gapRow+1 removed: a thin open strip, like the neutral head's old brim seam. */
function stripHoleGrid(w = 10, h = 6, gapRow = 2) {
  const P: number[] = [];
  const UV: number[] = [];
  const N: number[] = [];
  for (let j = 0; j <= h; j++)
    for (let i = 0; i <= w; i++) {
      P.push(i * 0.01, 0, j * 0.004);
      N.push(0, -1, 0);
      // lower rows: "skin" island (u < 0.5); upper rows: another island (u > 0.5)
      UV.push(j <= gapRow ? i * 0.04 : 0.6 + i * 0.03, j * 0.05);
    }
  const id = (i: number, j: number) => j * (w + 1) + i;
  const I: number[] = [];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      // the strip: the middle of one row is missing (an interior hole, closed at both ends by the grid)
      if (j === gapRow && i >= 2 && i < w - 2) continue;
      I.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  return g;
}

describe("forehead gap fill (P2-AVA-16)", () => {
  it("finds the thin strip as an open loop and closes it with real triangles", () => {
    const g = stripHoleGrid();
    const loops = borderLoops(g);
    // outer border + the strip
    expect(loops.length).toBe(2);
    const strip = loops.reduce((a, b) => (stripWidth(g, a) < stripWidth(g, b) ? a : b));
    expect(stripWidth(g, strip)).toBeLessThan(0.006);
    const before = (g.index!.count / 3) | 0;
    const added = fillStripHole(g, strip, (u) => u < 0.5);
    expect(added).toBeGreaterThan(10);
    expect(g.index!.count / 3).toBe(before + added);
    // only the outer border is left open
    expect(borderLoops(g).length).toBe(1);
  });

  it("continues the chosen side's texture mapping (no smear across two UV islands) and faces outward", () => {
    const g = stripHoleGrid();
    const strip = borderLoops(g).reduce((a, b) => (stripWidth(g, a) < stripWidth(g, b) ? a : b));
    const base = g.attributes.position!.count;
    fillStripHole(g, strip, (u) => u < 0.5);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = base; i < uv.count; i++) expect(uv.getX(i)).toBeLessThan(0.5);
    // every new triangle faces the same way as the grid (−y)
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index!.array;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    for (let t = idx.length - 3; t >= 0; t -= 3) {
      if (idx[t]! < base) break;
      a.fromBufferAttribute(pos, idx[t]!);
      b.fromBufferAttribute(pos, idx[t + 1]!).sub(a);
      c.fromBufferAttribute(pos, idx[t + 2]!).sub(a);
      expect(b.cross(c).y).toBeLessThanOrEqual(0);
    }
  });

  it("fills only holes the clean-up opened, never the mesh's own openings", () => {
    const g = stripHoleGrid();
    // pretend every vertex was already on a border before (an existing opening): nothing is filled
    const all = new Uint8Array(g.attributes.position!.count).fill(1);
    expect(fillNewHoles(g, all, (u) => u < 0.5)).toBe(0);
    // with the real flags of an intact grid, the strip is new and gets filled
    const intact = new Uint8Array(g.attributes.position!.count);
    expect(fillNewHoles(g, intact, (u) => u < 0.5)).toBeGreaterThan(0);
    expect(borderVertexFlags(g).some((f) => f === 1)).toBe(true);
  });
});

describe("tops follow the chosen item on the feminine body (P2-AVA-16)", () => {
  it("gives every catalogue top a feminine cut (held back for now), and only the masculine shirts a collar", () => {
    for (const item of OUTFITS.filter((o) => o.slot === "top")) {
      const f = feminineCut(item);
      // the base blazer's tailoring stays only for the blazer itself
      expect(f.flatten).toBe(item.kind !== "blazer");
      expect(topCut(item, "feminine")).toBe(FEMININE_CUTS ? f : null);
      expect(!!topCut(item, "masculine")).toBe(MODELLED_COLLARS && item.kind === "shirt");
      expect(topCut(item, "neutral")).toBeNull();
    }
    expect(feminineCut(OUTFITS.find((o) => o.id === "tee")!).sleeve).toBe("short");
    expect(feminineCut(OUTFITS.find((o) => o.id === "kitenge-sun")!).collar).toBe("shirt");
    if (MODELLED_COLLARS)
      expect(
        topCut(
          OUTFITS.find((o) => o.id === "kitenge-sun"),
          "masculine",
        )!.collar,
      ).toBe("shirt");
    expect(topCut(undefined, "masculine")).toBeNull();
  });

  it("cuts necklines lower in front than at the back, a V deepest on the centre line", () => {
    for (const shape of ["crew", "scoop", "vee", "open"] as const) {
      expect(necklineDrop(shape, 0.06, 0, 1)).toBeGreaterThan(necklineDrop(shape, 0.06, 0, 0));
    }
    expect(necklineDrop("vee", 0.08, 0, 1)).toBeGreaterThan(necklineDrop("vee", 0.08, 0.04, 1));
    expect(necklineDrop("vee", 0.08, 0.2, 1)).toBeCloseTo(necklineDrop("vee", 0.08, 0, 0), 6);
    // a mock (stand-collar) neck sits above the neck base
    expect(necklineDrop("mock", 0, 0, 1)).toBeLessThan(0);
    expect(SLEEVE_END.long).toBe(0);
    expect(SLEEVE_END.short).toBeLessThan(SLEEVE_END.elbow);
  });
});

describe("clean front panel (P2-AVA-16)", () => {
  it("replaces a front with a raised lapel by one smooth panel that faces forward", () => {
    // a 30 × 40 cm front (facing −y), a 1 cm raised lapel strip down its middle-left
    const P: number[] = [],
      I: number[] = [],
      SI: number[] = [],
      SW: number[] = [];
    const nx = 15,
      nz = 20;
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const x = -0.15 + i * 0.02,
          z = 1.0 + j * 0.02;
        const lapel = x > -0.06 && x < -0.02 ? 0.01 : 0;
        P.push(x, -0.1 - lapel, z);
        SI.push(1, 0, 0, 0);
        SW.push(1, 0, 0, 0);
      }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        // wound to face −y
        I.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(P.length).fill(0), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((P.length / 3) * 2).fill(0.5), 2));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(SI, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(SW, 4));
    g.setIndex(I);
    const before = g.index!.count / 3;
    const added = frontPanel(g, {
      centre: new THREE.Vector3(0, 0, 1.4),
      forward: new THREE.Vector3(0, -1, 0),
      xMax: 0.17,
      zMin: 1.02,
      zMax: 1.36,
      include: () => true,
      neckZ: () => 1.34,
    });
    expect(added).toBeGreaterThan(100);
    // the lapel strip's triangles inside the panel are gone: nothing original stands proud of the panel there
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index!.array;
    let proud = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      if (v.some((k) => k >= P.length / 3)) continue;
      const cz = (pos.getZ(v[0]!) + pos.getZ(v[1]!) + pos.getZ(v[2]!)) / 3;
      const cy = (pos.getY(v[0]!) + pos.getY(v[1]!) + pos.getY(v[2]!)) / 3;
      const cx = (pos.getX(v[0]!) + pos.getX(v[1]!) + pos.getX(v[2]!)) / 3;
      if (cz > 1.06 && cz < 1.3 && Math.abs(cx) < 0.1 && cy < -0.105) proud++;
    }
    expect(proud).toBe(0);
    expect(g.index!.count / 3).toBeLessThan(before + added);
    // skin weights carried over from the surface it replaced
    const sw = g.attributes.skinWeight as THREE.BufferAttribute;
    expect(sw.getX(pos.count - 1)).toBeCloseTo(1, 5);
    // the panel faces forward (−y)
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    const t = idx.length - added * 3;
    a.fromBufferAttribute(pos, idx[t]!);
    b.fromBufferAttribute(pos, idx[t + 1]!).sub(a);
    c.fromBufferAttribute(pos, idx[t + 2]!).sub(a);
    expect(b.cross(c).y).toBeLessThan(0);
  });
});

describe("modelled collar (P2-AVA-16)", () => {
  const spec = (kind: CollarSpec["kind"]): CollarSpec => ({
    kind,
    centre: new THREE.Vector3(0, 0.05, 1.45),
    forward: new THREE.Vector3(0, -1, 0),
    opening: 0.4,
    radius: () => 0.06,
    baseZ: (th) => -0.02 * (1 - Math.cos(th)) * 0.5,
  });

  it("is a closed, thick sweep with a stand under a fall and points at the front, modest in triangles", () => {
    const m = buildCollar(spec("shirt"));
    const tris = m.index.length / 3;
    expect(tris).toBeGreaterThan(200);
    expect(tris).toBeLessThan(800);
    // every edge is shared by two triangles: finished edges, no open cloth edge
    const edges = new Map<string, number>();
    const key = (a: number, b: number) => {
      const pa = m.position
        .slice(a * 3, a * 3 + 3)
        .map((x) => x.toFixed(6))
        .join(",");
      const pb = m.position
        .slice(b * 3, b * 3 + 3)
        .map((x) => x.toFixed(6))
        .join(",");
      return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
    };
    for (let t = 0; t < m.index.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const k = key(m.index[t + e]!, m.index[t + ((e + 1) % 3)]!);
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    // the fall reaches lower at the front (the points) than at the back
    const back = collarSection("shirt", 0, 0.4);
    const front = collarSection("shirt", Math.PI - 0.4, 0.4);
    const low = (s: [number, number][]) => Math.min(...s.map((p) => p[1]));
    expect(low(front)).toBeLessThan(low(back) - 0.02);
    // the cloth has thickness everywhere (no zero-width section)
    for (const th of [0, 1, 2, Math.PI - 0.4]) {
      const s = collarSection("shirt", th, 0.4);
      const rs = s.map((p) => p[0]);
      expect(Math.max(...rs) - Math.min(...rs)).toBeGreaterThan(0.004);
    }
  });

  it("stays clear of the neck (never inside the neck radius) and faces outward", () => {
    for (const kind of ["shirt", "stand", "hood"] as const) {
      const m = buildCollar(spec(kind));
      for (let i = 0; i < m.position.length; i += 3) {
        const r = Math.hypot(m.position[i]! - 0, m.position[i + 1]! - 0.05);
        expect(r).toBeGreaterThan(0.06 - 0.004);
      }
      // closed and wound outwards: positive signed volume
      let vol = 0;
      const P = (k: number) =>
        new THREE.Vector3(m.position[k * 3]!, m.position[k * 3 + 1]! - 0.05, m.position[k * 3 + 2]! - 1.45);
      for (let t = 0; t < m.index.length; t += 3)
        vol += P(m.index[t]!).dot(P(m.index[t + 1]!).cross(P(m.index[t + 2]!)));
      expect(vol).toBeGreaterThan(0);
      // skin weights: from the base (0) up to the stand's top (1)
      expect(Math.min(...m.height)).toBe(0);
      expect(Math.max(...m.height)).toBeGreaterThan(0.8);
    }
  });

  it("measures the neck from a mesh cross-section", () => {
    const cyl = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 32, 4, true)
      .rotateX(Math.PI / 2)
      .translate(0, 0.05, 1.45);
    const r = neckProfile(cyl, new THREE.Vector3(0, 0.05, 1.45), new THREE.Vector3(0, -1, 0), 1.45)!;
    expect(r).not.toBeNull();
    for (const th of [0, 1, -2, 3]) expect(r(th)).toBeCloseTo(0.06, 2);
  });
});
