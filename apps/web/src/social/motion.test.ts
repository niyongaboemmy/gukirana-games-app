import { beforeEach, describe, expect, it } from "vitest";
import { PLAZA_BENCH_ANGLES, PLAZA_BENCH_RADIUS, PLAZA_SEATS } from "@gukirana/contracts";
import { BENCHES } from "@/world/layout";
import { selfPose, useWorld, type RemotePlayer } from "@/lib/world-store";
import { ghostOf, ghosts, pushPose, renderPose, stepGhosts, stepMotion, tracks } from "./motion";

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

  it("bench: the origin goes straight onto the seat (the sit-down clip carries the body), no fast glide", () => {
    const seat = PLAZA_SEATS[2]!;
    useWorld.setState({ players: { a: player("a") } });
    // they stepped back to the bench themselves: 0.4 m in front of the seat
    const fx = seat.x + Math.sin(seat.yaw) * 0.4;
    const fz = seat.z + Math.cos(seat.yaw) * 0.4;
    pushPose("a", Math.round(fx * 100), Math.round(fz * 100), 0, 0, 1000);
    stepMotion(0.016, 1300);
    useWorld.setState({ seats: { [seat.id]: "a" } });
    stepMotion(0.016, 1316);
    const p = renderPose("a")!;
    expect(p.anim).toBe(13);
    expect(p.x).toBeCloseTo(seat.x, 3);
    expect(p.z).toBeCloseTo(seat.z, 3);
  });

  it("standing up from a bench follows the newest pose directly (no interpolation glide)", () => {
    const seat = PLAZA_SEATS[2]!;
    useWorld.setState({ players: { a: player("a") }, seats: { [seat.id]: "a" } });
    pushPose("a", Math.round(seat.x * 100), Math.round(seat.z * 100), 0, 13, 1000);
    stepMotion(0.016, 1300);
    useWorld.setState({ seats: {} });
    const sx = seat.x + Math.sin(seat.yaw) * 0.41;
    const sz = seat.z + Math.cos(seat.yaw) * 0.41;
    pushPose("a", Math.round(sx * 100), Math.round(sz * 100), 0, 0, 1316);
    stepMotion(0.016, 1316);
    const p = renderPose("a")!;
    expect(Math.hypot(p.x - sx, p.z - sz)).toBeLessThan(0.02);
  });

  it("fades people in on arrival and lets leavers walk on through the door while fading", () => {
    useWorld.setState({ players: { a: player("a") } });
    pushPose("a", 0, 0, 0, 1, 1000);
    pushPose("a", 13, 0, 0, 1, 1100);
    stepMotion(0.1, 1150);
    expect(tracks.get("a")!.fade).toBeGreaterThan(0);
    expect(tracks.get("a")!.fade).toBeLessThan(0.5);
    for (let t = 0; t < 10; t++) stepMotion(0.1, 1200 + t * 100);
    expect(tracks.get("a")!.fade).toBe(1);
    selfPose.x = 0;
    selfPose.z = 0;
    stepMotion(0.016, 2300);
    ghostOf("a", 2300);
    useWorld.setState({ players: {} });
    const g = ghosts.get("a")!;
    expect(g.vx).toBeCloseTo(1.35, 1);
    const x0 = g.x;
    stepGhosts(0.2, 2500);
    stepGhosts(0.2, 2700);
    expect(g.x).toBeGreaterThan(x0 + 0.4);
    for (let t = 0; t < 20; t++) stepGhosts(0.1, 2800 + t * 100);
    expect(ghosts.has("a")).toBe(false);
  });

  it("people in a contact action (handshake, hug) are not pushed apart", () => {
    useWorld.setState({ players: { a: player("a"), b: player("b") } });
    pushPose("a", 0, 0, 0, 23, 1000);
    pushPose("b", 42, 0, 0, 23, 1000);
    for (let t = 0; t < 40; t++) stepMotion(0.05, 1000 + t * 50);
    const a = renderPose("a")!;
    const b = renderPose("b")!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.42, 2);
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
