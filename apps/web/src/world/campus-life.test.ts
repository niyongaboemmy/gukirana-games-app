import { describe, expect, it } from "vitest";
import {
  campusNpcs,
  laneZ,
  poseAt,
  schedule,
  TRAFFIC_X,
  vehicles,
  vehicleX,
  type Pose,
  type Stroller,
} from "./campus-life";
import { inCompound, onCampusRoad, PUBLIC_ROAD, campusShrubs, campusTrees, walkDepth } from "./campus";
import { inBuilding } from "./footprints";
import { planRoute, PLAZA_OBSTACLES } from "./obstacles";
import { PLAZA_RADIUS } from "./layout";

const route = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x, a.z) < PLAZA_RADIUS - 0.6 && Math.hypot(b.x, b.z) < PLAZA_RADIUS - 0.6
    ? planRoute(a, b, PLAZA_OBSTACLES)
    : [b];

describe("campus life (P2-WLD-22)", () => {
  it("is deterministic: the same people in the same places on every screen", () => {
    expect(JSON.stringify(campusNpcs())).toBe(JSON.stringify(campusNpcs()));
    expect(JSON.stringify(vehicles())).toBe(JSON.stringify(vehicles()));
  });

  it("people stand inside the compound (or on the bus stop footpath), never inside a building", () => {
    for (const n of campusNpcs()) {
      const pts = n.kind === "stroll" ? n.stops : [n];
      for (const p of pts) {
        expect(inBuilding(p.x, p.z, 0)).toBe(false);
        if (n.id !== "bus-wait") expect(inCompound(p.x, p.z, 0)).toBe(true);
        expect(onCampusRoad(p.x, p.z, 0)).toBe(false);
      }
    }
  });

  it("a stroller moves continuously (no teleports) and walks at a human pace", () => {
    for (const n of campusNpcs().filter((m): m is Stroller => m.kind === "stroll")) {
      expect(n.speed).toBeGreaterThan(1);
      expect(n.speed).toBeLessThan(1.8);
      const s = schedule(n, route);
      const a: Pose = { x: 0, z: 0, yaw: 0, moving: false };
      const b: Pose = { x: 0, z: 0, yaw: 0, moving: false };
      for (let t = 0; t < s.period * 1.2; t += 0.25) {
        poseAt(s, t, a);
        poseAt(s, t + 1 / 60, b);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.1);
      }
    }
  });

  it("traffic keeps to its lane (right-hand traffic) on the drawn stretch of Musanze Road", () => {
    expect(laneZ(1)).toBeGreaterThan(PUBLIC_ROAD.mid);
    expect(laneZ(-1)).toBeLessThan(PUBLIC_ROAD.mid);
    expect(laneZ(1)).toBeLessThan(PUBLIC_ROAD.c1);
    expect(laneZ(-1)).toBeGreaterThan(PUBLIC_ROAD.c0);
    for (const v of vehicles())
      for (let t = 0; t < 600; t += 7) {
        const x = vehicleX(v, t);
        expect(x).toBeGreaterThanOrEqual(TRAFFIC_X.x0 - 1e-6);
        expect(x).toBeLessThanOrEqual(TRAFFIC_X.x1 + 1e-6);
      }
  });

  it("campus trees and shrubs stay off walks, roads and buildings", () => {
    const trees = campusTrees();
    expect(trees.some((t) => t.kind === "jacaranda")).toBe(true);
    expect(trees.some((t) => t.kind === "eucalyptus")).toBe(true);
    for (const b of campusShrubs()) {
      expect(inBuilding(b.x, b.z, 2)).toBe(false);
      expect(walkDepth(b.x, b.z).depth).toBeLessThan(-1);
      expect(inCompound(b.x, b.z, 1)).toBe(true);
    }
  });
});
