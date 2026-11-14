import { describe, expect, it } from "vitest";
import { BOXING_RING_COUNT, FEATURE_RINGS, RING_IDS } from "@gukirana/contracts";
import { HALLS } from "@/rooms/layouts";
import { inBuilding, PLOTS } from "@/world/footprints";
import { EXPANSION_PLOTS, FIGHT_WALK, fightWalkDepth, fightWalkRoute, PORTALS, portalTransform, RING_ROAD, ringPoint } from "@/world/layout";
import { BOXING_AISLES, BOXING_SIZE, FEATURE_STAGE, FIGHT_BUILDING, hallLz, LOBBY_TO_HALL_DZ, LOBBY_BACK_Z, ringAt, RINGS, ringSteps, SUBHALL_DOOR_X } from "./plan";

/** world point of a door-frame local point of the Fight hall */
const fightPortal = PORTALS.find((p) => p.id === "fight")!;
function world(lx: number, lz: number) {
  const t = portalTransform(fightPortal);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c };
}

describe("Fight Games site (P3-FGT-01 §4.1)", () => {
  it("merges plots 09 + 10 into the Fight hall at 140° on the expansion ring", () => {
    expect(EXPANSION_PLOTS.map((e) => e.id)).not.toContain("plot-09");
    expect(EXPANSION_PLOTS.map((e) => e.id)).not.toContain("plot-10");
    const plot = PLOTS.find((p) => p.id === "fight")!;
    expect(plot.angleDeg).toBe(140);
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
      for (const [sx, sz] of [
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
    const door = portalTransform(fightPortal);
    expect(fightWalkDepth(door.entryX, door.entryZ).depth).toBeGreaterThan(1);
    const route = fightWalkRoute(FIGHT_WALK[0]!.a, { x: door.entryX, z: door.entryZ });
    expect(route.length).toBe(FIGHT_WALK.length);
    const start = ringPoint(133, 36);
    expect(fightWalkDepth(start.x, start.z).depth).toBeGreaterThan(0);
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

  it("the lobby's Boxing door lines up with the hall's door through one wall", () => {
    expect(HALLS.boxing.door.x).toBe(SUBHALL_DOOR_X.boxing);
    expect(LOBBY_BACK_Z + LOBBY_TO_HALL_DZ).toBe(BOXING_SIZE.d / 2);
    expect(HALLS.fight.size.w).toBe(30);
  });
});
