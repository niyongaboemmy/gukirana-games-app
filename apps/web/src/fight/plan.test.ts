import { describe, expect, it } from "vitest";
import { BOXING_RING_COUNT, FEATURE_RINGS, RING_IDS } from "@gukirana/contracts";
import { HALLS } from "@/rooms/layouts";
import { inBuilding, PLOTS } from "@/world/footprints";
import { EXPANSION_PLOTS, FIGHT_WALK, PLAZA_RADIUS, PORTALS, portalTransform, RING_ROAD } from "@/world/layout";
import { campusWalkLength, campusWalkRoute, walkDepth } from "@/world/campus";
import { BOXING_AISLES, BOXING_SIZE, FEATURE_STAGE, FIGHT_BUILDING, hallLz, LOBBY_TO_HALL_DZ, LOBBY_BACK_Z, ringAt, ringPromptDist, RINGS, ringSteps, SUBHALL_DOOR_X } from "./plan";
import { boxingRoute, boxingWalkable } from "./hooks";

/** world point of a door-frame local point of the Fight hall */
const fightPortal = PORTALS.find((p) => p.id === "fight")!;
function world(lx: number, lz: number) {
  const t = portalTransform(fightPortal);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c };
}

describe("Fight Games site (P3-FGT-01 §4.1)", () => {
  it("merges plots 07 + 08 into the Fight hall at 80° on the expansion ring (east district, P2-WLD-12)", () => {
    for (const id of ["plot-07", "plot-08", "plot-09", "plot-10"]) expect(EXPANSION_PLOTS.map((e) => e.id)).not.toContain(id);
    const plot = PLOTS.find((p) => p.id === "fight")!;
    expect(plot.angleDeg).toBe(80);
    expect(plot.ring).toBe(108);
  });

  it("keeps the whole (chamfered) building inside r ≤ 156, clear of the ring road", () => {
    const f = FIGHT_BUILDING;
    const outline: [number, number][] = [
      [-f.hw, f.front],
      [-f.hw, f.back + f.chamfer],
      [-f.hw + f.chamfer, f.back],
      [f.hw - f.chamfer, f.back],
      [f.hw, f.back + f.chamfer],
      [f.hw, f.front],
    ];
    for (const [lx, lz] of outline) {
      const p = world(lx, lz);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(156);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(RING_ROAD.r0);
    }
  });

  it("the hall interior (rings) sits inside the chamfered shell", () => {
    const f = FIGHT_BUILDING;
    for (const r of RINGS) {
      for (const [sx, sz] of <[number, number][]>[
        [-1, -1],
        [1, -1],
      ]) {
        const lx = Math.abs(r.x + sx * r.half);
        const lz = hallLz(r.z + sz * r.half);
        expect(lx).toBeLessThan(f.hw - 0.4);
        // inside the chamfer line x + |z| ≤ hw + |back| − chamfer (less the wall)
        expect(lx + Math.abs(lz)).toBeLessThan(f.hw + Math.abs(f.back) - f.chamfer - 0.4);
      }
    }
  });

  it("the Fight walk runs over open ground (no building within 0.4 m of it), from the plaza to the door", () => {
    for (const l of FIGHT_WALK)
      for (let t = 0; t <= 1; t += 0.02) {
        const x = l.a.x + (l.b.x - l.a.x) * t;
        const z = l.a.z + (l.b.z - l.a.z) * t;
        const nx = -(l.b.z - l.a.z);
        const nz = l.b.x - l.a.x;
        const n = Math.hypot(nx, nz);
        for (const k of [-1, 0, 1]) {
          const px = x + (nx / n) * k * l.hw;
          const pz = z + (nz / n) * k * l.hw;
          // the last metres reach into the Fight hall's own forecourt / door
          if (Math.hypot(px, pz) > 104) continue;
          expect(inBuilding(px, pz, 0.4), `walk at ${px.toFixed(1)},${pz.toFixed(1)}`).toBe(false);
        }
      }
    // every leg is walkable ground of the campus walks, the door at the end of it
    for (const l of FIGHT_WALK) for (const t of [0, 0.5, 1]) expect(walkDepth(l.a.x + (l.b.x - l.a.x) * t, l.a.z + (l.b.z - l.a.z) * t).depth).toBeGreaterThan(l.hw - 0.05);
    const door = portalTransform(fightPortal);
    expect(walkDepth(door.entryX, door.entryZ).depth).toBeGreaterThan(1);
    // the routed walk from the plaza edge to the door: well within a minute at the normal pace (2.2 m/s)
    const start = FIGHT_WALK[0]!.a;
    expect(Math.hypot(start.x, start.z)).toBeLessThan(PLAZA_RADIUS);
    const route = campusWalkRoute(start, { x: door.entryX, z: door.entryZ });
    expect(route[route.length - 1]).toEqual({ x: door.entryX, z: door.entryZ });
    expect(campusWalkLength(start, { x: door.entryX, z: door.entryZ }) / 2.2).toBeLessThan(60);
  });
});

describe("Boxing hall plan (§4.3)", () => {
  it("has exactly 50 rings with the contract ids, R1 / R2 the feature rings", () => {
    expect(RINGS.length).toBe(BOXING_RING_COUNT);
    expect(RINGS.map((r) => r.id)).toEqual([...RING_IDS]);
    expect(RINGS.filter((r) => r.feature).map((r) => r.id)).toEqual([...FEATURE_RINGS]);
  });

  it("numbers rows A → D from the front, west block first, west → east", () => {
    const row = (from: number) => RINGS.slice(from - 1, from + 11);
    for (const [first, letter] of [
      [3, "A"],
      [15, "B"],
      [27, "C"],
      [39, "D"],
    ] as const) {
      const r = row(first);
      expect(r.every((x) => x.row === letter)).toBe(true);
      for (let i = 1; i < 12; i++) expect(r[i]!.x).toBeGreaterThan(r[i - 1]!.x);
      expect(r[5]!.x).toBeLessThan(0);
      expect(r[6]!.x).toBeGreaterThan(0);
    }
    // row A is the front (towards the door, +z)
    expect(RINGS[2]!.z).toBeGreaterThan(RINGS[14]!.z);
  });

  it("rings never overlap, keep ≥ 1.2 m aisles and stay inside the walls", () => {
    for (let i = 0; i < RINGS.length; i++) {
      const a = RINGS[i]!;
      expect(Math.abs(a.x) + a.half).toBeLessThan(BOXING_SIZE.w / 2 - 0.5);
      expect(Math.abs(a.z) + a.half).toBeLessThan(BOXING_SIZE.d / 2 - 0.5);
      for (let j = i + 1; j < RINGS.length; j++) {
        const b = RINGS[j]!;
        const gap = Math.max(Math.abs(a.x - b.x) - a.half - b.half, Math.abs(a.z - b.z) - a.half - b.half);
        expect(gap, `${a.id} ↔ ${b.id}`).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it("aisles and the front cross aisle are walkable (no platform on them), the door opens onto an aisle", () => {
    for (const x of BOXING_AISLES)
      for (let z = -BOXING_SIZE.d / 2 + 1.5; z < BOXING_SIZE.d / 2 - 0.5; z += 0.25) {
        expect(ringAt(x, z, 0.3), `aisle ${x} at ${z}`).toBeNull();
        if (Math.abs(x) < FEATURE_STAGE.hw + 0.3) expect(z > FEATURE_STAGE.z0 || z < FEATURE_STAGE.z1).toBe(true);
      }
    for (let x = -BOXING_SIZE.w / 2 + 0.5; x < BOXING_SIZE.w / 2 - 0.5; x += 0.25) expect(ringAt(x, BOXING_SIZE.d / 2 - 1.3, 0.3)).toBeNull();
    expect(BOXING_AISLES.some((x) => Math.abs(x - HALLS.boxing.door.x) < 0.8)).toBe(true);
    // every ring's steps stand on open floor
    for (const r of RINGS) {
      const s = ringSteps(r);
      expect(ringAt(s.x, s.z), r.id).toBeNull();
    }
  });

  it("you can stand at the foot of every ring's corner steps, and that ring takes the prompt there (P3-FGT-04)", () => {
    const best = (x: number, z: number) => {
      let bi = -1;
      let bd = Infinity;
      RINGS.forEach((_, j) => {
        const d = ringPromptDist(j, x, z);
        if (d < bd) [bi, bd] = [j, d];
      });
      return { id: RINGS[bi]!.id, d: bd };
    };
    // the feature rings: at the front of the stage (R1) and at its back (R2)
    expect(best(0, FEATURE_STAGE.z0 + 0.4)).toMatchObject({ id: "R1" });
    expect(best(0, FEATURE_STAGE.z1 - 0.4)).toMatchObject({ id: "R2" });
    expect(best(0, FEATURE_STAGE.z0 + 0.4).d).toBeLessThan(1.3);
    RINGS.forEach((r) => {
      if (r.feature) return;
      for (const c of ["red", "blue"] as const) {
        const f = ringSteps(r, c);
        // clear of the side and back walls (the outer columns' red steps used to end 3 cm from the west wall)
        expect(BOXING_SIZE.w / 2 - Math.abs(f.x), `${r.id} ${c} side wall`).toBeGreaterThan(0.9);
        expect(f.z + BOXING_SIZE.d / 2, `${r.id} ${c} back wall`).toBeGreaterThan(0.9);
        expect(BOXING_SIZE.d / 2 - f.z, `${r.id} ${c} front wall`).toBeGreaterThan(0.9);
        // open floor for someone who does not hold the ring (no platform, rail or stage of any ring)
        expect(boxingWalkable(f.x, f.z), `${r.id} ${c} walkable`).toBe(true);
        // that ring wins the prompt over the platform across the aisle
        expect(best(f.x, f.z).id, `${r.id} ${c} prompt`).toBe(r.id);
      }
    });
  });

  it("routes from the door to every standard ring's steps over open floor (P3-FGT-04)", () => {
    const door = { x: HALLS.boxing.door.x, z: BOXING_SIZE.d / 2 - 1.2 };
    for (const r of RINGS) {
      if (r.feature) continue;
      const to = ringSteps(r, "red");
      const legs = [door, ...boxingRoute(door, to)];
      expect(legs[legs.length - 1]).toEqual(to);
      for (let i = 1; i < legs.length; i++) {
        const a = legs[i - 1]!;
        const b = legs[i]!;
        for (let k = 0; k <= 20; k++) expect(boxingWalkable(a.x + ((b.x - a.x) * k) / 20, a.z + ((b.z - a.z) * k) / 20), `${r.id} leg ${i}`).toBe(true);
      }
    }
  });

  it("the lobby's Boxing door lines up with the hall's door through one wall", () => {
    expect(HALLS.boxing.door.x).toBe(SUBHALL_DOOR_X.boxing);
    expect(LOBBY_BACK_Z + LOBBY_TO_HALL_DZ).toBe(BOXING_SIZE.d / 2);
    expect(HALLS.fight.size.w).toBe(30);
  });
});
