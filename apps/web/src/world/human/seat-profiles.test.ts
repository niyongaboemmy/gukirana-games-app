import { describe, expect, it } from "vitest";
import { PLAZA_BENCH_SEAT_Y, PLAZA_SEATS } from "@gukirana/contracts";
import { ADMIN_SEATS } from "@/admin-block/plan";
import { BOWL_SEATS, LOWER, UPPER } from "@/arena/bowl";
import { HALLS } from "@/rooms/layouts";
import {
  CLIP_BODY,
  CLIP_SEAT_H,
  footLift,
  footZ,
  SEAT_BACK,
  SEAT_FURNITURE,
  SEAT_PROFILES,
  seatKindFor,
  seatLift,
  seatProfileFor,
  type SeatKind,
} from "./seat-profiles";

const KINDS = Object.keys(SEAT_PROFILES) as SeatKind[];
/** standing heights above the sole (Rocketbox bind pose) */
const ANKLE_H = 0.08;
const TOE_H = 0.02;

/** 2D two-bone leg (side view, z forward / y up): the knee for hip → ankle, bending forward / up like the leg IK */
function kneeOf(hip: { z: number; y: number }, ankle: { z: number; y: number }, thigh: number, shin: number) {
  const dz = ankle.z - hip.z;
  const dy = ankle.y - hip.y;
  const d = Math.min(Math.hypot(dz, dy), thigh + shin - 1e-6);
  const along = (thigh * thigh - shin * shin + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  const ux = dz / d;
  const uy = dy / d;
  // perpendicular towards forward / up
  return { z: hip.z + ux * along - uy * h, y: hip.y + uy * along + ux * h };
}

describe("seat profiles fit the seats as built", () => {
  it("the plaza bench is the seat the mocap was authored for", () => {
    expect(SEAT_PROFILES.bench.seatH).toBe(PLAZA_BENCH_SEAT_Y);
    expect(seatLift(SEAT_PROFILES.bench)).toBe(0);
    expect(CLIP_SEAT_H).toBe(PLAZA_BENCH_SEAT_Y);
  });

  it.each(KINDS)("%s: the hips rest on the cushion (never sunk into it, never floating)", (k) => {
    const p = SEAT_PROFILES[k];
    const top = SEAT_FURNITURE[k].top;
    // buttocks contact after the shift = seatH: at most 2 cm into a soft cushion, at most 4 cm above it (bucket seat)
    expect(CLIP_SEAT_H + seatLift(p)).toBeCloseTo(p.seatH, 6);
    expect(p.seatH).toBeGreaterThanOrEqual(top - 0.02);
    expect(p.seatH).toBeLessThanOrEqual(top + 0.045);
  });

  it.each(KINDS)("%s: the buttocks stay in front of the back rest", (k) => {
    const p = SEAT_PROFILES[k];
    expect(p.hipFwd - CLIP_BODY.buttBack).toBeGreaterThanOrEqual(-SEAT_FURNITURE[k].back - 0.03);
  });

  it.each(KINDS)("%s: the knees reach past the seat's front edge (the shins never pass through it)", (k) => {
    const p = SEAT_PROFILES[k];
    const f = SEAT_FURNITURE[k];
    if (f.lip === undefined) {
      expect(CLIP_BODY.kneeFront + p.hipFwd).toBeGreaterThanOrEqual(f.front - 0.03);
      return;
    }
    // a bucket seat's front lip: the feet go forward (footFwd) so the leg IK lifts the knees over it
    const hip = { z: p.hipFwd - 0.02, y: p.seatH + 0.09 };
    const ankle = { z: hip.z + p.footFwd, y: ANKLE_H };
    const knee = kneeOf(hip, ankle, 0.42, 0.43);
    expect(knee.y).toBeGreaterThanOrEqual(f.lip);
    expect(knee.z + 0.05).toBeGreaterThanOrEqual(f.front - 0.03);
  });

  it.each(KINDS)("%s: the feet end up on the floor and inside the legroom", (k) => {
    const p = SEAT_PROFILES[k];
    // buried feet (the seated loops put the ball of the foot up to 16 cm under the floor) are lifted onto it
    for (const feet of [
      [{ ankleY: 0.033, toeY: -0.075 }, { ankleY: 0.06, toeY: 0.01 }],
      [{ ankleY: -0.03, toeY: -0.165 }, { ankleY: -0.04, toeY: -0.12 }],
      [{ ankleY: 0.19, toeY: 0.187 }, { ankleY: 0.091, toeY: 0.02 }], // crossed ankles: already on the floor
    ]) {
      const lift = footLift(feet, 0, ANKLE_H, TOE_H);
      expect(lift).toBeGreaterThanOrEqual(0);
      for (const f of feet) {
        expect(f.ankleY + lift).toBeGreaterThanOrEqual(ANKLE_H - 1e-9);
        expect(f.toeY + lift).toBeGreaterThanOrEqual(TOE_H - 1e-9);
      }
      // lifted just enough: one foot ends up touching the floor
      expect(Math.min(...feet.map((f) => Math.min(f.ankleY + lift - ANKLE_H, f.toeY + lift - TOE_H)))).toBeCloseTo(0, 6);
    }
    // stretched legs are pulled back into the legroom; deep seats put the feet forward
    expect(footZ(1.2, 0, p)).toBeLessThanOrEqual(p.legroom);
    expect(footZ(0.3, 0.05, p)).toBeGreaterThanOrEqual(Math.min(p.legroom, p.footFwd > 0 ? 0.05 + p.footFwd : 0.3));
    expect(p.footFwd).toBeLessThanOrEqual(p.legroom);
  });

  it("feet on a raised floor (arena rake, VIP box) are measured from that floor", () => {
    expect(footLift([{ ankleY: 0.9 + 0.02, toeY: 0.9 - 0.05 }], 0.9, ANKLE_H, TOE_H)).toBeCloseTo(0.07, 6);
    expect(footLift([{ ankleY: 1.2, toeY: 1.1 }], 0.9, ANKLE_H, TOE_H)).toBe(0);
  });

  it("stadium toes stay on their own tread: never over the step into the row in front", () => {
    // a bowl seat stands 0.62 of the way back on its tread; the seated origin is SEAT_BACK behind the seat point
    const lowerEdge = LOWER.depth * 0.62 + SEAT_BACK;
    const upperEdge = UPPER.depth * 0.62 + SEAT_BACK;
    expect(SEAT_PROFILES.stadium.legroom + CLIP_BODY.toeLen).toBeLessThanOrEqual(Math.min(lowerEdge, upperEdge));
  });
});

describe("every seat in the playground has a profile", () => {
  it("hall chairs per game", () => {
    expect(HALLS.pool.seats.every((s) => seatKindFor("pool", s.id) === "lounge")).toBe(true);
    expect(HALLS.ludo.seats.every((s) => seatKindFor("ludo", s.id) === "armchairLudo")).toBe(true);
    expect(HALLS.igisoro.seats.every((s) => seatKindFor("igisoro", s.id) === "stool")).toBe(true);
  });

  it("Administrative Block: sofa, armchairs, waiting benches, officer and visitor / meeting chairs", () => {
    const kinds = new Map<string, SeatKind>();
    for (const s of ADMIN_SEATS) kinds.set(s.id, seatKindFor("admin", s.id));
    for (const s of ADMIN_SEATS) {
      const k = kinds.get(s.id)!;
      if (s.kind === "officer") expect(k).toBe("task");
      else if (s.kind === "visitor" || s.kind === "meeting") expect(k).toBe("visitor");
      else expect(["sofa", "armchair", "waitBench"]).toContain(k);
    }
    const lobby = ADMIN_SEATS.filter((s) => s.kind === "lobby");
    // the sofa places face west (yaw −π/2), the armchairs east (π/2), the benches the entrance (0)
    for (const s of lobby) {
      const k = kinds.get(s.id)!;
      if (k === "sofa") expect(s.yaw).toBeCloseTo(-Math.PI / 2);
      if (k === "armchair") expect(s.yaw).toBeCloseTo(Math.PI / 2);
      if (k === "waitBench") expect(s.yaw).toBeCloseTo(0);
    }
    expect(lobby.filter((s) => kinds.get(s.id) === "sofa")).toHaveLength(3);
    expect(lobby.filter((s) => kinds.get(s.id) === "armchair")).toHaveLength(2);
  });

  it("arena: bowl seats and VIP box seats", () => {
    for (const s of BOWL_SEATS) expect(seatKindFor("arena", s.id)).toBe(s.table.startsWith("V") ? "vip" : "stadium");
  });

  it("plaza benches and anything unknown sit on the mocap bench", () => {
    for (const s of PLAZA_SEATS) expect(seatProfileFor(undefined, s.id)).toBe(SEAT_PROFILES.bench);
    expect(seatKindFor("plaza", "b0s1")).toBe("bench");
    expect(seatKindFor("pool", null)).toBe("bench");
  });
});
