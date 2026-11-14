import { describe, expect, it } from "vitest";
import { HALLS } from "./layouts";
import { seatActivity } from "./seat-activity";

describe("hall seat → seated activity (P2-HAL-10)", () => {
  it("Ludo players lean over the board: the table edge is within forearm reach", () => {
    for (const s of HALLS.ludo.seats) {
      const a = seatActivity(HALLS.ludo, s.id)!;
      expect(a.kind).toBe("board");
      expect(a.reach).toBeGreaterThan(0.35);
      expect(a.reach).toBeLessThan(0.65);
      expect(a.deskH).toBeCloseTo(0.74, 5);
    }
  });
  it("Igisoro players sow on the low board in front of them", () => {
    for (const s of HALLS.igisoro.seats) {
      const a = seatActivity(HALLS.igisoro, s.id)!;
      expect(a.kind).toBe("sow");
      expect(a.reach).toBeGreaterThan(0.5);
      expect(a.reach).toBeLessThan(0.95);
      expect(a.deskH).toBeGreaterThan(0.55);
      expect(a.deskH).toBeLessThan(0.65);
    }
  });
  it("Pool lounge chairs and arena seats watch (no hands on a table)", () => {
    expect(seatActivity(HALLS.pool, "t0s0")!.kind).toBe("watch");
    const a = seatActivity(HALLS.arena, HALLS.arena.seats[0]!.id)!;
    expect(a.kind).toBe("watch");
    expect(a.focus).not.toBeNull();
  });
  it("offices: the officer types at a desk in reach, visitors listen and nod, the meeting table has hands on it; the lobby just sits", () => {
    const ids = HALLS.admin.seats.map((s) => s.id);
    for (const id of ids.filter((x) => x.endsWith("-officer"))) {
      const a = seatActivity(HALLS.admin, id)!;
      expect(a.kind).toBe("type");
      expect(a.reach).toBeGreaterThan(0.35);
      expect(a.reach).toBeLessThan(0.65);
    }
    for (const id of ids.filter((x) => x.includes("-visitor-"))) expect(seatActivity(HALLS.admin, id)!.kind).toBe("visit");
    for (const id of ids.filter((x) => x.includes("-meeting-"))) {
      const a = seatActivity(HALLS.admin, id)!;
      expect(a.kind).toBe("meet");
      expect(a.reach).toBeGreaterThan(0.3);
      expect(a.reach).toBeLessThan(0.65);
    }
    for (const id of ids.filter((x) => x.startsWith("lobby-"))) expect(seatActivity(HALLS.admin, id)).toBeNull();
  });
  it("unknown seats have no activity; results are cached (same object)", () => {
    expect(seatActivity(HALLS.ludo, "nope")).toBeNull();
    expect(seatActivity(HALLS.ludo, "t0s0")).toBe(seatActivity(HALLS.ludo, "t0s0"));
  });
});
