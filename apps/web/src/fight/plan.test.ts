import { describe, expect, it } from "vitest";
import { BOXING_RING_COUNT, FEATURE_RINGS, RING_IDS } from "@gukirana/contracts";
import { HALLS } from "@/rooms/layouts";
import { inBuilding, PLOTS } from "@/world/footprints";
import { DOOR_RING, EXPANSION_PLOTS, PLAZA_RADIUS, PORTALS, portalTransform, RING_ROAD, SPAWN } from "@/world/layout";
import { GATE_LINE_Z } from "@/world/campus";
import { BOXING_AISLES, BOXING_SIZE, FEATURE_STAGE, FIGHT_BUILDING, hallLocal, LOBBY_TO_HALL_DZ, LOBBY_BACK_Z, ringAt, ringPromptDist, RINGS, ringSteps, SUBHALL_DOOR_X } from "./plan";
import { boxingRoute, boxingWalkable } from "./hooks";
import { fixtureBlocks } from "./hall-colliders";
import { RING_SPOTS } from "../../../realtime/src/rooms/boxing-rings";

/** world point of a door-frame local point of the Fight hall */
const fightPortal = PORTALS.find((p) => p.id === "fight")!;
function world(lx: number, lz: number) {
  const t = portalTransform(fightPortal);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c };
}

describe("Fight Games site (P3-FGT-01 §4.1, on the plaza since P2-WLD-14)", () => {
  it("stands on the +88° plaza plot: its door on the plaza's door ring, the expansion plots 07–10 stay merged away", () => {
    for (const id of ["plot-07", "plot-08", "plot-09", "plot-10"]) expect(EXPANSION_PLOTS.map((e) => e.id)).not.toContain(id);
    const plot = PLOTS.find((p) => p.id === "fight")!;
    expect(plot.angleDeg).toBe(88);
    expect(plot.ring).toBe(DOOR_RING);
  });

  it("keeps the whole (chamfered) building clear of the loop road and north of the gate line", () => {
    const f = FIGHT_BUILDING;
    const outline: [number, number][] = [
      [-f.hw, f.front],
      [-f.hw, f.back + f.chamfer],
      [-f.hw + f.chamfer, f.back],
      [f.hw - f.chamfer, f.back],
      [f.hw, f.back + f.chamfer],
      [f.hw, f.front],
    ];
    for (const [x, lz] of outline) {
      const lx = x + f.cx;
      const p = world(lx, lz);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(RING_ROAD.r0 - 8);
      expect(p.z).toBeLessThan(GATE_LINE_Z - 30);
    }
  });

  it("the hall interior (rings) sits inside the chamfered shell, turned a quarter (its length running out from the plaza)", () => {
    const f = FIGHT_BUILDING;
    expect(f.hw).toBeGreaterThanOrEqual(BOXING_SIZE.d / 2 + 0.4);
    expect(f.front - f.back).toBeGreaterThanOrEqual(BOXING_SIZE.w + 0.8);
    for (const r of RINGS)
      for (const [sx, sz] of <[number, number][]>[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const { lx, lz } = hallLocal(r.x + sx * r.half, r.z + sz * r.half);
        expect(Math.abs(lx - f.cx)).toBeLessThan(f.hw - 0.4);
        expect(lz).toBeLessThan(f.front - 0.4);
        // inside the chamfer line |x| + |z − back| ≥ chamfer (less the wall)
        expect(f.hw - Math.abs(lx - f.cx) + (lz - f.back)).toBeGreaterThan(f.chamfer + 0.4);
      }
  });

  it("the door is on the plaza: the doorstep is plaza ground, ≤ 25 s from the spawn at the normal pace (2.2 m/s)", () => {
    const door = portalTransform(fightPortal);
    expect(Math.hypot(door.entryX, door.entryZ)).toBeLessThan(PLAZA_RADIUS);
    expect(Math.hypot(door.entryX - SPAWN.x, door.entryZ - SPAWN.z) / 2.2).toBeLessThanOrEqual(25);
    // the building front is clear of the plaza's walkable disc except its doorway
    for (let lx = -FIGHT_BUILDING.lobbyHw; lx <= FIGHT_BUILDING.lobbyHw; lx += 0.5) {
      const q = world(lx, 0.4);
      expect(Math.hypot(q.x, q.z)).toBeGreaterThan(PLAZA_RADIUS - 0.6);
      expect(inBuilding(world(lx, -1).x, world(lx, -1).z)).toBe(true);
    }
  });
});

describe("Boxing hall plan (§4.3)", () => {
  it("has exactly BOXING_RING_COUNT (32) rings with the contract ids, R1 / R2 the feature rings", () => {
    expect(RINGS.length).toBe(BOXING_RING_COUNT);
    expect(RINGS.map((r) => r.id)).toEqual([...RING_IDS]);
    expect(RINGS.filter((r) => r.feature).map((r) => r.id)).toEqual([...FEATURE_RINGS]);
  });

  it("numbers rows A → C from the front, west block first, west → east", () => {
    const row = (from: number) => RINGS.slice(from - 1, from + 9);
    for (const [first, letter] of [
      [3, "A"],
      [13, "B"],
      [23, "C"],
    ] as const) {
      const r = row(first);
      expect(r.every((x) => x.row === letter)).toBe(true);
      for (let i = 1; i < 10; i++) expect(r[i]!.x).toBeGreaterThan(r[i - 1]!.x);
      expect(r[4]!.x).toBeLessThan(0);
      expect(r[5]!.x).toBeGreaterThan(0);
    }
    expect(RINGS[RINGS.length - 1]!.id).toBe("R32");
    // row A is the front (towards the door, +z)
    expect(RINGS[2]!.z).toBeGreaterThan(RINGS[12]!.z);
  });

  it("the realtime server's ring spots (apps/realtime boxing-rings.ts) match the plan ring by ring", () => {
    expect(Object.keys(RING_SPOTS)).toEqual(RINGS.map((r) => r.id));
    for (const r of RINGS) {
      const s = RING_SPOTS[r.id]!;
      expect(s.x, r.id).toBeCloseTo(r.x, 6);
      expect(s.z, r.id).toBeCloseTo(r.z, 6);
      expect(s.half, r.id).toBeCloseTo(r.half, 6);
    }
  });

  it("rings never overlap, keep ≥ 2.4 m between platforms and stay inside the walls", () => {
    for (let i = 0; i < RINGS.length; i++) {
      const a = RINGS[i]!;
      expect(Math.abs(a.x) + a.half).toBeLessThan(BOXING_SIZE.w / 2 - 0.5);
      expect(Math.abs(a.z) + a.half).toBeLessThan(BOXING_SIZE.d / 2 - 0.5);
      for (let j = i + 1; j < RINGS.length; j++) {
        const b = RINGS[j]!;
        const gap = Math.max(Math.abs(a.x - b.x) - a.half - b.half, Math.abs(a.z - b.z) - a.half - b.half);
        expect(gap, `${a.id} ↔ ${b.id}`).toBeGreaterThanOrEqual(2.4);
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

  it("routes from the door to every standard ring's red steps over open floor: no platform, rail, steps or corner kit (P3-FGT-04, P3-FGT-11)", () => {
    const door = { x: HALLS.boxing.door.x, z: BOXING_SIZE.d / 2 - 1.2 };
    for (const r of RINGS) {
      if (r.feature) continue;
      const to = ringSteps(r, "red");
      const legs = [door, ...boxingRoute(door, to)];
      expect(legs[legs.length - 1]).toEqual(to);
      for (let i = 1; i < legs.length; i++) {
        const a = legs[i - 1]!;
        const b = legs[i]!;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const z = a.z + ((b.z - a.z) * k) / n;
          expect(boxingWalkable(x, z), `${r.id} leg ${i} walkable @ ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
          expect(fixtureBlocks(x, z), `${r.id} leg ${i} fixture @ ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false);
        }
      }
    }
  });

  it("the lobby's Boxing door lines up with the hall's door through one wall", () => {
    expect(HALLS.boxing.door.x).toBe(SUBHALL_DOOR_X.boxing);
    expect(LOBBY_BACK_Z + LOBBY_TO_HALL_DZ).toBe(BOXING_SIZE.d / 2);
    expect(HALLS.fight.size.w).toBe(30);
  });
});
