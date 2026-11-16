import { describe, expect, it } from "vitest";
import { RESERVED_SEAT_PREFIX } from "@gukirana/contracts";
import { HALLS } from "@/rooms/layouts";
import { freeChair, reservedForMe } from "@/rooms/table-status";
import { hallTitle, nearestFree, placesOf, stakeWords, widerStakes } from "./quick-play";
import { MS, mf } from "./mm-strings";

describe("Quick Play helpers (P2-MM-05)", () => {
  it("every table / ring of the game's hall, numbered like the hall shows them", () => {
    expect(placesOf("ludo")).toHaveLength(HALLS.ludo.tables.length);
    expect(placesOf("ludo")[0]).toMatchObject({ id: "t0", n: "1" });
    expect(placesOf("boxing")).toHaveLength(32);
    expect(placesOf("boxing").find((p) => p.id === "R7")?.n).toBe("7");
    expect(hallTitle("igisoro")).toBe(HALLS.igisoro.title);
  });

  it("nearest free: busy places are skipped; from the door when I am elsewhere, from me when I am in the hall", () => {
    const all = placesOf("pool");
    const fromDoor = nearestFree("pool", {});
    expect(fromDoor).toBeTruthy();
    const busy = Object.fromEntries(all.filter((p) => p.id !== "t3").map((p) => [p.id, "playing" as const]));
    expect(nearestFree("pool", busy)).toBe("t3");
    expect(nearestFree("pool", { ...busy, t3: "reserved" })).toBeNull();
    const t5 = all.find((p) => p.id === "t5")!;
    expect(nearestFree("pool", {}, { x: t5.x, z: t5.z })).toBe("t5");
  });

  it("widening adds the neighbouring stakes and Friendly, never more than 5", () => {
    expect(widerStakes([25], [0, 25, 50, 100, 200])).toEqual([25, 50, 0]);
    expect(widerStakes([100], [0, 25, 50, 100, 200])).toEqual([100, 200, 50, 0]);
    expect(widerStakes([200], [0, 25])).toEqual([200, 0]);
    expect(widerStakes([0], [0, 25])).toEqual([0, 25]);
    expect(widerStakes([25, 50, 0], [0, 25, 50])).toEqual([25, 50, 0]);
    expect(stakeWords([25, 0], "Friendly")).toBe("25 Stars, Friendly");
  });

  it("a chair reserved for me is mine to walk to and sit on; nobody else's", () => {
    const layout = HALLS.ludo;
    const seats = { t2s0: `${RESERVED_SEAT_PREFIX}me`, t2s1: "someone" };
    expect(reservedForMe(seats.t2s0, "me")).toBe(true);
    expect(reservedForMe(seats.t2s0, "other")).toBe(false);
    expect(freeChair(layout, "t2", seats, "mySession", 0, 0, "me")?.id).toBe("t2s0");
    expect(freeChair(layout, "t2", seats, "mySession", 0, 0, "other")).toBeNull();
  });

  it("strings: every key fills its variables; no emoji", () => {
    expect(mf("found.body", { name: "Amani", game: "Ludo", stake: "Friendly" })).toBe("Amani wants to play Ludo · Friendly");
    for (const v of Object.values(MS)) expect(/\p{Extended_Pictographic}/u.test(v)).toBe(false);
  });
});
