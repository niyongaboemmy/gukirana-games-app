import { beforeEach, describe, expect, it } from "vitest";
import { PLAZA_BENCH_ANGLES, PLAZA_BENCH_RADIUS, PLAZA_SEATS } from "@gukirana/contracts";
import { BENCHES } from "@/world/layout";
import { selfPose, useWorld, type RemotePlayer } from "@/lib/world-store";
import { pushPose, renderPose, stepMotion, tracks } from "./motion";

const player = (id: string, x = 0, z = 0): RemotePlayer => ({ id, name: id, color: "#3DA9FC", level: 1, x, z, yaw: 0, anim: 0 });

beforeEach(() => {
  tracks.clear();
  selfPose.x = 100;
  selfPose.z = 100;
  useWorld.setState({ players: {}, seats: {} });
});

describe("shared bench places match the plaza layout", () => {
  it("every bench in world/layout.ts has its seats in @gukirana/contracts", () => {
    expect(BENCHES).toHaveLength(PLAZA_BENCH_ANGLES.length);
    BENCHES.forEach((b, i) => {
      const seats = PLAZA_SEATS.filter((s) => s.id.startsWith(`b${i}s`));
      expect(seats.length).toBeGreaterThanOrEqual(2);
      for (const s of seats) {
        expect(Math.hypot(s.x - b.x, s.z - b.z)).toBeLessThan(0.9); // on the 2.1 m bench
        expect(Math.abs(Math.atan2(Math.sin(s.yaw - b.rotY), Math.cos(s.yaw - b.rotY)))).toBeLessThan(1e-6); // facing the fountain
      }
      expect(Math.hypot(b.x, b.z)).toBeCloseTo(PLAZA_BENCH_RADIUS);
    });
  });
});

describe("remote motion", () => {
  it("interpolates between server updates instead of jumping", () => {
    useWorld.setState({ players: { a: player("a") } });
    pushPose("a", 0, 0, 0, 1, 1000);
    pushPose("a", 100, 0, 0, 1, 1100); // 1 m in 100 ms
    pushPose("a", 200, 0, 0, 1, 1200);
    stepMotion(0.016, 1200);
    const x1 = renderPose("a")!.x;
    stepMotion(0.016, 1250);
    const x2 = renderPose("a")!.x;
    expect(x1).toBeGreaterThan(0);
    expect(x1).toBeLessThan(2);
    expect(x2).toBeGreaterThan(x1);
    expect(x2 - x1).toBeLessThan(0.7); // smooth: ~0.5 m in 50 ms at 10 m/s, never a teleport
  });

  it("extrapolates briefly when an update is late, then holds", () => {
    useWorld.setState({ players: { a: player("a") } });
    pushPose("a", 0, 0, 0, 1, 1000);
    pushPose("a", 100, 0, 0, 1, 1100);
    stepMotion(0.016, 1100 + 160 + 150);
    const x = renderPose("a")!.x;
    expect(x).toBeGreaterThan(1);
    stepMotion(0.016, 5000);
    expect(renderPose("a")!.x).toBeLessThan(3.5);
  });

  it("snaps a real jump (door / respawn) instead of sliding across the plaza", () => {
    useWorld.setState({ players: { a: player("a") } });
    pushPose("a", 0, 0, 0, 0, 1000);
    pushPose("a", 2000, 0, 0, 0, 1100);
    stepMotion(0.016, 1400);
    expect(renderPose("a")!.x).toBeCloseTo(20);
  });

  it("renders seated people on the exact bench place with the seated animation", () => {
    const seat = PLAZA_SEATS[4]!;
    useWorld.setState({ players: { a: player("a") }, seats: { [seat.id]: "a" } });
    pushPose("a", Math.round(seat.x * 100) + 80, Math.round(seat.z * 100), 0, 13, 1000);
    for (let t = 0; t < 60; t++) stepMotion(0.05, 1000 + t * 50);
    const p = renderPose("a")!;
    expect(p.seated).toBe(true);
    expect(p.anim).toBe(13);
    expect(p.x).toBeCloseTo(seat.x, 2);
    expect(p.z).toBeCloseTo(seat.z, 2);
    expect(p.yaw).toBeCloseTo(seat.yaw, 2);
    // standing up again: the stale seated pose is not shown while walking
    useWorld.setState({ seats: {} });
    pushPose("a", 0, 0, 0, 1, 4100);
    stepMotion(0.05, 4300);
    expect(renderPose("a")!.anim).toBe(1);
  });

  it("keeps standing people apart (soft separation), never pushing seated ones", () => {
    useWorld.setState({ players: { a: player("a"), b: player("b") } });
    pushPose("a", 0, 0, 0, 0, 1000);
    pushPose("b", 10, 0, 0, 0, 1000);
    for (let t = 0; t < 40; t++) stepMotion(0.05, 1000 + t * 50);
    const a = renderPose("a")!;
    const b = renderPose("b")!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5);
  });
});
