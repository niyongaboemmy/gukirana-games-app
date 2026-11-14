import { describe, expect, it } from "vitest";
import { ACTIVITY_OBSTACLES, ACTIVITY_SPOTS, CAFE_FRONT_R, BIRD_AWAY_S, birdHomes, birdState, flockSettled, fogFactor, kigaliHour, mistLevel, someoneNear } from "./activities";
import { DOOR_RING, FOUNTAIN_COURT, FOUNTAIN_RADIUS, PLAZA_RADIUS, ringPoint, SERVICE_ANGLE } from "./layout";
import { BODY_RADIUS, circle, PLAZA_OBSTACLES, rect, resolve } from "./obstacles";

const PROPS = [
  rect(ACTIVITY_OBSTACLES.board.x, ACTIVITY_OBSTACLES.board.z, ACTIVITY_OBSTACLES.board.hw, ACTIVITY_OBSTACLES.board.hd, ACTIVITY_OBSTACLES.board.rot),
  circle(ACTIVITY_OBSTACLES.water.x, ACTIVITY_OBSTACLES.water.z, ACTIVITY_OBSTACLES.water.r),
  circle(ACTIVITY_OBSTACLES.viewpoint.x, ACTIVITY_OBSTACLES.viewpoint.z, ACTIVITY_OBSTACLES.viewpoint.r),
];

describe("plaza activity placement", () => {
  it("the new props stand clear of the existing plaza furniture (a person fits between)", () => {
    for (const p of PROPS) {
      const c = { x: p.x, z: p.z };
      // a body-sized probe at the prop centre must not be pushed by any existing obstacle (with 0.3 m to spare)
      expect(resolve({ ...c }, PLAZA_OBSTACLES, (p.kind === "circle" ? p.r : Math.max(p.hw, p.hd)) + 0.3), JSON.stringify(p)).toBe(false);
    }
  });
  it("every stand spot is walkable: nothing pushes a person standing there", () => {
    for (const [k, s] of Object.entries(ACTIVITY_SPOTS)) {
      const q = { x: s.x, z: s.z };
      expect(resolve(q, [...PLAZA_OBSTACLES, ...PROPS], BODY_RADIUS), k).toBe(false);
    }
  });
  it("the café counter is used at the café front (walkable, a few metres from the glass), not out in the plaza", () => {
    const c = ringPoint(SERVICE_ANGLE, CAFE_FRONT_R);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(PLAZA_RADIUS - 0.1);
    const glass = DOOR_RING + 1.5; // servicePavilion: shopfront 1.5 m behind the door ring
    expect(glass - CAFE_FRONT_R).toBeLessThan(4.5);
    expect(resolve({ x: c.x, z: c.z }, PLAZA_OBSTACLES, BODY_RADIUS)).toBe(false);
  });
  it("you face the prop you use", () => {
    const b = ACTIVITY_SPOTS.board;
    expect(Math.cos(b.yaw)).toBeLessThan(-0.99); // board is north of the spot: face −z
    const w = ACTIVITY_SPOTS.water;
    expect(Math.sin(w.yaw)).toBeGreaterThan(0.99); // tap is east of the spot
    // the photo spot looks out north-north-west, at Bisoke
    const p = ACTIVITY_SPOTS.photo;
    expect(Math.cos(p.yaw)).toBeLessThan(-0.9);
    expect(Math.sin(p.yaw)).toBeLessThan(-0.3);
  });
});

describe("morning mist (Kigali time)", () => {
  it("converts UTC to Kigali hours (UTC+2)", () => {
    expect(kigaliHour(Date.UTC(2026, 10, 14, 4, 30))).toBeCloseTo(6.5);
    expect(kigaliHour(Date.UTC(2026, 10, 14, 23, 0))).toBeCloseTo(1);
  });
  it("is thick at dawn, gone by mid-morning, a light haze in the evening", () => {
    expect(mistLevel(6.5)).toBeCloseTo(1);
    expect(mistLevel(8.75)).toBeGreaterThan(0.2);
    expect(mistLevel(8.75)).toBeLessThan(0.8);
    expect(mistLevel(10.5)).toBe(0);
    expect(mistLevel(14)).toBe(0);
    expect(mistLevel(20)).toBeCloseTo(0.25);
    expect(mistLevel(2)).toBeCloseTo(0.25);
  });
  it("never goes backwards while clearing (no flicker)", () => {
    let last = 2;
    for (let h = 7.5; h <= 10; h += 0.05) {
      const m = mistLevel(h);
      expect(m).toBeLessThanOrEqual(last + 1e-9);
      last = m;
    }
  });
  it("only thickens the fog (×1 … ×3)", () => {
    expect(fogFactor(0)).toBe(1);
    expect(fogFactor(1)).toBe(3);
  });
});

describe("pigeons", () => {
  const homes = birdHomes();
  it("rest on the fountain court, outside the basin, the same for everyone", () => {
    expect(birdHomes()).toEqual(homes);
    for (const h of homes) {
      const r = Math.hypot(h.x, h.z);
      expect(r).toBeGreaterThan(FOUNTAIN_RADIUS + 1);
      expect(r).toBeLessThan(FOUNTAIN_COURT);
    }
  });
  it("lift off one after another, stay away, glide back and settle", () => {
    expect(birdState(Infinity, 0).phase).toBe("ground");
    expect(birdState(0.5, 0).phase).toBe("takeoff");
    expect(birdState(0.05, 3).phase).toBe("ground"); // the fourth bird goes a moment later
    expect(birdState(10, 2).phase).toBe("away");
    expect(birdState(BIRD_AWAY_S + 2, 0).phase).toBe("landing");
    expect(birdState(BIRD_AWAY_S + 10, 0).phase).toBe("ground");
    expect(flockSettled(5, homes.length)).toBe(false);
    expect(flockSettled(BIRD_AWAY_S + 10, homes.length)).toBe(true);
  });
  it("notice people walking close", () => {
    const h = homes[0]!;
    expect(someoneNear(homes, [{ x: h.x + 1, z: h.z }])).toBe(true);
    expect(someoneNear(homes, [{ x: 0, z: 30 }])).toBe(false);
  });
});
