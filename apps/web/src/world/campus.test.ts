import { describe, expect, it } from "vitest";
import { hallRects, inBuilding, PLOTS, sitePlan, type Plot, type Rect } from "./footprints";
import { DOOR_RING, EXPANSION_PLOTS, EXPANSION_RING, PERIMETER_R, PLAZA_RADIUS, PORTALS, portalTransform, ringPoint, SPAWN } from "./layout";
import { GATE_Z } from "./gate/Gate";
import { LAWN_BEDS } from "./beds";
import {
  CAMPUS_LOOP,
  CAMPUS_WALKS,
  campusOutside,
  campusTrees,
  campusWalkLength,
  campusWalkRoute,
  compoundR,
  COMPOUND,
  DISTRICT_WALKS,
  ADMIN_SITE_DEG,
  FIGHT_SITE_DEG,
  WALK_TOTEMS,
  FORECOURT,
  FRONTAGE_Z,
  GATE_LINE_Z,
  GROWTH_BAND,
  GROWTH_PLOTS,
  inCompound,
  LOOP,
  loopDistance,
  onCampusRoad,
  PARKING_BAYS,
  PUBLIC_ROAD,
  VIEW_CORRIDOR_DEG,
  walkDepth,
  WALK_DOORS,
  type P,
} from "./campus";

const bearing = (p: P) => (Math.atan2(p.x, -p.z) * 180) / Math.PI;

/** dense outline of a plot (or any door-frame rectangles) in the world */
function outline(angleDeg: number, ring: number, rects: Rect[]): P[] {
  const r = ringPoint(angleDeg, ring);
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const w = (lx: number, lz: number) => ({ x: r.x + lx * c + lz * s, z: r.z - lx * s + lz * c });
  const pts: P[] = [];
  for (const f of rects)
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(w(f.x0 + (f.x1 - f.x0) * t, f.z0), w(f.x0 + (f.x1 - f.x0) * t, f.z1), w(f.x0, f.z0 + (f.z1 - f.z0) * t), w(f.x1, f.z0 + (f.z1 - f.z0) * t));
    }
  return pts;
}
const plotOutline = (p: Plot) => outline(p.angleDeg, p.ring, p.rects);
const growthOutline = (g: (typeof GROWTH_PLOTS)[number]) => outline(g.angleDeg, g.ring, hallRects(sitePlan(0), 0.5));

const outer = PLOTS.filter((p) => p.ring !== DOOR_RING);

/** points along the walk legs (centre and both edges) */
function walkSamples(step = 0.5) {
  const out: { p: P; leg: number }[] = [];
  CAMPUS_WALKS.legs.forEach((l, i) => {
    const a = CAMPUS_WALKS.nodes[l.a]!;
    const b = CAMPUS_WALKS.nodes[l.b]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / L;
    const nz = (b.x - a.x) / L;
    for (let t = 0; t <= L; t += step)
      for (const k of [-1, 0, 1]) out.push({ p: { x: a.x + ((b.x - a.x) * t) / L + nx * k * l.hw, z: a.z + ((b.z - a.z) * t) / L + nz * k * l.hw }, leg: i });
  });
  return out;
}

describe("campus master plan (P2-WLD-12)", () => {
  it("keeps the heart: the arrival gate line is the gate, the boundary just behind its forecourt", () => {
    expect(GATE_LINE_Z).toBe(GATE_Z);
    expect(FRONTAGE_Z).toBeGreaterThan(GATE_Z + 19); // the gate's forecourt disc (r 19) stays inside the wall
    expect(PUBLIC_ROAD.z0).toBeGreaterThan(FORECOURT.layby.z1);
    expect(SPAWN.z).toBeLessThan(PLAZA_RADIUS);
  });

  it("Fight Games has the +88° plaza plot, the Administrative Block the north-east district on the walks (P2-WLD-14)", () => {
    const fight = PLOTS.find((p) => p.id === "fight")!;
    expect(fight.angleDeg).toBe(FIGHT_SITE_DEG);
    expect(fight.ring).toBe(DOOR_RING);
    const admin = PLOTS.find((p) => p.id === "admin")!;
    expect(admin.angleDeg).toBe(ADMIN_SITE_DEG);
    expect(admin.ring).toBe(EXPANSION_RING);
    expect(CAMPUS_WALKS.doors.admin).toBeDefined();
  });

  it("builds nothing but the frontage south of the gate line", () => {
    for (const p of outer) for (const q of plotOutline(p)) expect(q.z, p.id).toBeLessThan(GATE_LINE_Z);
    for (const g of GROWTH_PLOTS) for (const q of growthOutline(g)) expect(q.z, g.id).toBeLessThan(GATE_LINE_Z);
    for (const { p } of walkSamples(2)) expect(p.z).toBeLessThan(GATE_LINE_Z);
    for (const b of LAWN_BEDS) expect(b.z).toBeLessThan(GATE_LINE_Z);
    // the loop road only comes south of the gate line on its frontage straights, inside the wall
    for (const q of CAMPUS_LOOP) if (q.z > GATE_LINE_Z) expect(q.z).toBeLessThanOrEqual(FORECOURT.layby.z0 + 0.01);
  });

  it("every plot lies inside the compound and outside the heart; growth plots in band B, inside the grown arc", () => {
    const heart = (q: P) => Math.hypot(q.x, q.z) < PERIMETER_R + 2 || (Math.abs(q.x) < 27 && q.z > 30 && q.z < FRONTAGE_Z);
    const inner = PLOTS.filter((p) => p.ring === DOOR_RING).map(plotOutline);
    for (const p of outer)
      for (const q of plotOutline(p)) {
        expect(inCompound(q.x, q.z, 2), `${p.id} at ${q.x.toFixed(1)},${q.z.toFixed(1)}`).toBe(true);
        expect(heart(q), p.id).toBe(false);
        if (Math.hypot(q.x, q.z) < 95) for (const o of inner) for (const h of o) expect(Math.hypot(h.x - q.x, h.z - q.z)).toBeGreaterThan(1.5);
      }
    for (const g of GROWTH_PLOTS)
      for (const q of growthOutline(g)) {
        const r = Math.hypot(q.x, q.z);
        expect(r).toBeGreaterThan(GROWTH_BAND.r0 - 1);
        expect(r).toBeLessThan(GROWTH_BAND.r1 + 1);
        expect(Math.abs(bearing(q))).toBeLessThan(GROWTH_BAND.deg);
        expect(inCompound(q.x, q.z, 2), g.id).toBe(true);
      }
    expect(compoundR(0)).toBe(COMPOUND.growR);
    expect(compoundR(170)).toBe(COMPOUND.r);
  });

  it("offers at least 6 reserved hall plots (expansion + growth band B) and no two plots touch", () => {
    expect(EXPANSION_PLOTS.length + GROWTH_PLOTS.length).toBeGreaterThanOrEqual(7);
    const shapes = [...outer.map((p) => ({ id: p.id, o: plotOutline(p) })), ...GROWTH_PLOTS.map((g) => ({ id: g.id, o: growthOutline(g) }))];
    for (let i = 0; i < shapes.length; i++)
      for (let j = i + 1; j < shapes.length; j++) {
        let m = Infinity;
        for (const a of shapes[i]!.o) for (const b of shapes[j]!.o) m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z));
        expect(m, `${shapes[i]!.id} ↔ ${shapes[j]!.id}`).toBeGreaterThan(3);
      }
  });

  it("keeps the volcano view corridor empty (no hall plots behind the arena)", () => {
    for (const p of outer) for (const q of plotOutline(p)) expect(Math.abs(bearing(q)), p.id).toBeGreaterThan(VIEW_CORRIDOR_DEG);
    for (const g of GROWTH_PLOTS) for (const q of growthOutline(g)) expect(Math.abs(bearing(q)), g.id).toBeGreaterThan(VIEW_CORRIDOR_DEG);
    for (const w of DISTRICT_WALKS) for (const q of w.pts) expect(Math.abs(bearing(q))).toBeGreaterThan(VIEW_CORRIDOR_DEG);
  });

  it("roads, walks and plots never overlap", () => {
    // walks over open ground: ≥ 0.4 m from every building, except the spur's last metres into a hall's forecourt
    for (const { p } of walkSamples()) {
      if (Math.hypot(p.x, p.z) < PLAZA_RADIUS) continue;
      if (Math.hypot(p.x, p.z) > 104 && WALK_DOORS.some((d) => Math.abs(bearing(p) - d.angleDeg) < 4)) continue;
      expect(inBuilding(p.x, p.z, 0.4), `walk at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
      expect(onCampusRoad(p.x, p.z, 1), `walk on a road at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
    }
    // the loop road (carriageway + footpaths) clear of every plot, and inside the compound
    for (const p of [...outer.map(plotOutline), ...GROWTH_PLOTS.map(growthOutline)]) for (const q of p) expect(loopDistance(q.x, q.z)).toBeGreaterThan(LOOP.hw + LOOP.foot + 0.5);
    for (const q of CAMPUS_LOOP) if (q.z < LOOP.southZ + 1) expect(inCompound(q.x, q.z, LOOP.hw + LOOP.foot)).toBe(true);
    // car parks and roads clear of every building
    const built = PLOTS.map(plotOutline);
    for (const b of PARKING_BAYS) for (const o of built) for (const q of o) expect(Math.hypot(q.x - b.x, q.z - b.z)).toBeGreaterThan(4);
    for (const p of built) for (const q of p) expect(onCampusRoad(q.x, q.z, 0.5)).toBe(false);
  });

  it("campus trees stand on lawn or in planters: never on a walk or a road, never in a building", () => {
    const trees = campusTrees();
    expect(trees.length).toBeGreaterThan(20);
    for (const t of trees) {
      expect(inBuilding(t.x, t.z, 2)).toBe(false);
      expect(walkDepth(t.x, t.z).depth).toBeLessThan(-1);
      expect(inCompound(t.x, t.z, 1)).toBe(true);
    }
  });

  it("the loop is one continuous road", () => {
    for (let i = 1; i < CAMPUS_LOOP.length; i++) {
      const a = CAMPUS_LOOP[i - 1]!;
      const b = CAMPUS_LOOP[i]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(3.2);
    }
  });

  it("every hall door is ≤ 60 s on foot (132 m of walk) from the plaza edge, and the route is walkable", () => {
    for (const d of WALK_DOORS) {
      const portal = PORTALS.find((p) => p.id === d.id);
      const door = portal ? { x: portalTransform(portal).entryX, z: portalTransform(portal).entryZ } : ringPoint(d.angleDeg, EXPANSION_RING - 2.4);
      expect(walkDepth(door.x, door.z).depth, d.id).toBeGreaterThan(1);
      const len = Math.min(...CAMPUS_WALKS.exits.map((e) => campusWalkLength(CAMPUS_WALKS.nodes[e]!, door))) - 1.5;
      expect(len, d.id).toBeLessThanOrEqual(132);
      // from the spawn: across the plaza to a walk exit, then on walkable ground all the way
      const route = campusWalkRoute(SPAWN, door);
      const last = route[route.length - 1]!;
      expect(Math.hypot(last.x - door.x, last.z - door.z)).toBeLessThan(0.01);
      let at: P = SPAWN;
      for (const w of route) {
        if (!w.plaza)
          for (let t = 0; t <= 1; t += 0.05) {
            const q = { x: at.x + (w.x - at.x) * t, z: at.z + (w.z - at.z) * t };
            if (Math.hypot(q.x, q.z) > PLAZA_RADIUS - 1) expect(walkDepth(q.x, q.z).depth, `${d.id} route`).toBeGreaterThan(0);
          }
        at = w;
      }
    }
  });

  it("routes back into the plaza and between walks", () => {
    const ne = DISTRICT_WALKS.find((w) => w.id === "northEast")!.pts[2]!;
    const w = DISTRICT_WALKS.find((q) => q.id === "west")!.pts[2]!;
    const back = campusWalkRoute(ne, { x: 0, z: 10 });
    expect(back[back.length - 1]!.plaza).toBe(true);
    const across = campusWalkRoute(ne, w);
    expect(across[across.length - 1]).toEqual({ x: w.x, z: w.z });
  });

  it("the landscape boundary is the compound plus the frontage up to the public road", () => {
    expect(campusOutside(0, 0)).toBeLessThan(0);
    expect(campusOutside(0, PUBLIC_ROAD.z1 - 1)).toBeLessThan(0);
    expect(campusOutside(0, PUBLIC_ROAD.z1 + 5)).toBeGreaterThan(0);
    expect(campusOutside(0, -COMPOUND.growR + 1)).toBeLessThan(0);
    expect(campusOutside(0, -COMPOUND.growR - 5)).toBeGreaterThan(0);
    expect(campusOutside(ringPoint(135, COMPOUND.r + 5).x, ringPoint(135, COMPOUND.r + 5).z)).toBeGreaterThan(0);
  });
});

describe("easy access to every hall (P2-WLD-13 access review, P2-WLD-14 Fight Games on the plaza)", () => {
  const doorOf = (id: string): P => {
    const t = portalTransform(PORTALS.find((p) => p.id === id)!);
    return { x: t.entryX, z: t.entryZ };
  };

  it("the Fight Games door is on the plaza, ≤ 25 s at the normal pace (2.2 m/s) from the spawn", () => {
    const door = doorOf("fight");
    expect(Math.hypot(door.x, door.z)).toBeLessThan(PLAZA_RADIUS);
    // straight across the plaza (no walk network needed): the routed plaza walk is checked in footprints.test.ts
    expect(Math.hypot(door.x - SPAWN.x, door.z - SPAWN.z) / 2.2).toBeLessThanOrEqual(25);
    // among the nearest playable doors to the spawn: only the small pavilions by the gate are closer
    const near = PORTALS.filter((p) => p.href && p.kind !== "soon" && p.id !== "fight").map((p) => Math.hypot(doorOf(p.id).x - SPAWN.x, doorOf(p.id).z - SPAWN.z));
    for (const d of near) expect(Math.hypot(door.x - SPAWN.x, door.z - SPAWN.z)).toBeLessThanOrEqual(d + 0.5);
  });

  it("the Fight Games facade faces the arrival: in view of the spawn's camera, nothing tall in between", () => {
    const t = portalTransform(PORTALS.find((p) => p.id === "fight")!);
    const cam = { x: SPAWN.x, z: SPAWN.z + 9 };
    // the facade's north half is within the 16:9 follow camera's ±45° (facing north at the spawn)
    const north = { x: t.x + Math.cos(t.rotY) * -12, z: t.z - Math.sin(t.rotY) * -12 };
    expect(Math.abs(bearing({ x: north.x - cam.x, z: north.z - cam.z }))).toBeLessThan(45);
    // the sight line from the camera to the door crosses no building (the plaza is open between)
    for (let k = 0.05; k < 0.97; k += 0.02) expect(inBuilding(cam.x + (t.x - cam.x) * k, cam.z + (t.z - cam.z) * k)).toBe(false);
  });

  it("every inner hall door is ≤ 75 m from the spawn (≤ 35 s at the normal pace)", () => {
    for (const p of PORTALS.filter((q) => !q.ring)) expect(Math.hypot(doorOf(p.id).x - SPAWN.x, doorOf(p.id).z - SPAWN.z), p.id).toBeLessThanOrEqual(75);
  });

  it("the Administrative Block (staff offices, outer ring) is ≤ 75 s from the spawn over the walks", () => {
    expect(campusWalkLength(SPAWN, doorOf("admin")) / 2.2).toBeLessThanOrEqual(75);
  });

  it("the totem at the north-east walk's plaza exit lists the Administrative Block", () => {
    const ne = CAMPUS_WALKS.nodes[CAMPUS_WALKS.exits[DISTRICT_WALKS.filter((w) => w.exit).findIndex((w) => w.id === "northEast")]!]!;
    const near = WALK_TOTEMS.filter((t) => Math.hypot(t.x - ne.x, t.z - ne.z) < 12);
    expect(near.length).toBeGreaterThanOrEqual(1);
    for (const t of near) expect(t.rows.map((r) => r.id)).toContain("admin");
  });
});
