import { describe, expect, it } from "vitest";
import { HALLS } from "@/rooms/layouts";
import { ARENA, igisoroHall, inBuilding, PLOT_HALL_SIZE, PLOTS, wingedHall, wingedPlan, type Plot } from "./footprints";
import { BENCHES, ENTRY_Z, FOUNTAIN_RADIUS,  PLAZA_RADIUS, PORTALS, portalTransform, RING_ROAD, ringPoint, SPAWN } from "./layout";
import { LAWN_BEDS, PLAZA_ARCS, RING_PLANTERS } from "./beds";
import { GATE_Z } from "./gate/Gate";
import { LAMPS, planRoute, PLAZA_OBSTACLES, resolve } from "./obstacles";

type P = { x: number; z: number };

/** World outline of a plot's footprints (dense boundary samples); the arena as its drum ellipse + lobby. */
function outline(plot: Plot, rectsOverride?: Plot["rects"]): P[][] {
  const r = ringPoint(plot.angleDeg, plot.ring);
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const w = (lx: number, lz: number) => ({ x: r.x + lx * c + lz * s, z: r.z - lx * s + lz * c });
  if (plot.type === "arena") {
    const drum = Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      return w(Math.sin(a) * (ARENA.rx + 0.7), ARENA.cz + Math.cos(a) * (ARENA.rz + 0.7));
    });
    const lobby: P[] = [];
    for (let i = 0; i <= 24; i++) lobby.push(w(-9 + (18 * i) / 24, 3.2), w(-9 + (18 * i) / 24, -6));
    return [drum, lobby];
  }
  return (rectsOverride ?? plot.rects).map((f) => {
    const pts: P[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(w(f.x0 + (f.x1 - f.x0) * t, f.z0), w(f.x0 + (f.x1 - f.x0) * t, f.z1), w(f.x0, f.z0 + (f.z1 - f.z0) * t), w(f.x1, f.z0 + (f.z1 - f.z0) * t));
    }
    return pts;
  });
}
const gap = (a: P[][], b: P[][]) => {
  let m = Infinity;
  for (const pa of a.flat()) for (const pb of b.flat()) m = Math.min(m, Math.hypot(pa.x - pb.x, pa.z - pb.z));
  return m;
};

describe("campus layout (P1-WLD-03)", () => {
  it("is 1.6–2× the first 28 m courtyard", () => {
    const k = (PLAZA_RADIUS * PLAZA_RADIUS) / (28 * 28);
    expect(k).toBeGreaterThanOrEqual(1.6);
    expect(k).toBeLessThanOrEqual(2);
  });

  it("every hall's exterior is at least as large as its interior", () => {
    for (const g of ["pool", "ludo"] as const) {
      const h = wingedHall(g);
      expect(h.x1 - h.x0).toBeGreaterThanOrEqual(HALLS[g].size.w);
      expect(h.z0 - h.z1).toBeGreaterThanOrEqual(HALLS[g].size.d);
      expect(h.H).toBeGreaterThan(HALLS[g].size.h);
    }
    const i = igisoroHall();
    expect(i.x1 - i.x0).toBeGreaterThanOrEqual(HALLS.igisoro.size.w);
    expect(i.z0 - i.z1).toBeGreaterThanOrEqual(HALLS.igisoro.size.d);
  });

  it("no two buildings touch (≥ 1.5 m apart), and none stands on the entry gate, now and with every hall at 36 × 28 m", () => {
    const grown = (p: Plot) => {
      if (p.type !== "pool" && p.type !== "ludo" && p.type !== "igisoro" && p.type !== "admin") return undefined;
      const h = wingedPlan(PLOT_HALL_SIZE, Math.sign(p.angleDeg));
      return [
        { x0: -9, x1: 9, z0: 1.6, z1: -h.wing },
        { x0: h.x0 - 0.2, x1: h.x1 + 0.2, z0: -h.wing, z1: h.z1 - 0.2 },
      ];
    };
    for (const variant of ["now", "grown"] as const) {
      const shapes = PLOTS.map((p) => ({ ...p, o: outline(p, variant === "grown" ? grown(p) : undefined) }));
      for (let i = 0; i < shapes.length; i++)
        for (let j = i + 1; j < shapes.length; j++) {
          const d = gap(shapes[i]!.o, shapes[j]!.o);
          expect(d, `${variant}: ${shapes[i]!.id} ↔ ${shapes[j]!.id}`).toBeGreaterThan(1.5);
        }
      const gate: P[] = [];
      for (let x = -16.5; x <= 16.5; x += 0.5) gate.push({ x, z: ENTRY_Z - 4.3 }, { x, z: ENTRY_Z + 4.3 });
      for (const s of shapes) expect(gap(s.o, [gate])).toBeGreaterThan(2);
    }
  }, 30000);

  it("offers at least 6 reserved hall plots beyond the current halls, all inside the ring road", () => {
    const sites = PLOTS.filter((p) => p.type === "site");
    expect(sites.length).toBeGreaterThanOrEqual(6 + 1);
    for (const p of sites) for (const o of outline(p).flat()) expect(Math.hypot(o.x, o.z)).toBeLessThan(RING_ROAD.r0 - 2);
  });

  it("keeps the sign-in walk short: the arrival gate is a fixed distance outside the plaza edge", () => {
    expect(GATE_Z - PLAZA_RADIUS).toBeCloseTo(48 - 28, 5);
  });

  it("keeps plaza furniture inside the plaza and off the doorsteps and promenades", () => {
    for (const b of BENCHES) expect(Math.hypot(b.x, b.z)).toBeLessThan(PLAZA_RADIUS - 2);
    for (const p of [...RING_PLANTERS, ...LAMPS]) expect(Math.hypot(p.x, p.z) + ("r" in p ? p.r : 0)).toBeLessThan(PLAZA_RADIUS - 0.5);
    for (const p of PORTALS) {
      // the 3.6 m promenade from the fountain court to the door is free of benches, planters and lamps
      const a = (p.angleDeg * Math.PI) / 180;
      for (let r = FOUNTAIN_RADIUS + 6; r < PLAZA_RADIUS - 0.5; r += 0.5)
        for (const lat of [-1.4, 0, 1.4]) {
          const q = { x: Math.sin(a) * r + Math.cos(a) * lat, z: -Math.cos(a) * r + Math.sin(a) * lat };
          expect(resolve({ ...q }, PLAZA_OBSTACLES, 0.3), `${p.id} promenade at r=${r} lat=${lat}`).toBe(false);
        }
    }
    for (const b of PLAZA_ARCS) expect(b.r1).toBeLessThanOrEqual(PLAZA_RADIUS);
  });

  it("lawn beds never touch a building", () => {
    for (const b of LAWN_BEDS) expect(inBuilding(b.x, b.z, 1)).toBe(false);
  });

  it("every playable door is a sensible walk from the spawn (≤ 35 s at the normal 2.2 m/s pace)", () => {
    for (const p of PORTALS.filter((q) => q.href)) {
      const t = portalTransform(p);
      const route = planRoute(SPAWN, { x: t.entryX, z: t.entryZ });
      let len = 0;
      let at: P = SPAWN;
      for (const w of route) {
        len += Math.hypot(w.x - at.x, w.z - at.z);
        at = w;
      }
      expect(Math.hypot(at.x - t.entryX, at.z - t.entryZ)).toBeLessThan(0.8);
      expect(len / 2.2, p.id).toBeLessThan(35);
    }
  }, 30000);
});
