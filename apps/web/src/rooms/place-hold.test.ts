import { describe, expect, it } from "vitest";
import { HELD_SEAT } from "@gukirana/contracts";
import { HALLS } from "./layouts";
import { freeChair, tableStatuses } from "./table-status";
import { clock } from "@/lib/place-strings";
import { shownStatus } from "@/fight/rings";

/** P2-NET-06: a held chair / ring reads "held" (not free, not waiting) and can't be picked */
describe("held places", () => {
  const ludo = HALLS.ludo;
  it("a table whose only taken chair is held is held, and that chair is never offered", () => {
    const st = tableStatuses(ludo, { t0s0: HELD_SEAT, t1s0: "someone" });
    expect(st.t0).toBe("held");
    expect(st.t1).toBe("waiting");
    expect(st.t2).toBe("free");
    const c = freeChair(ludo, "t0", { t0s0: HELD_SEAT }, "me", 0, 0);
    expect(c?.id).toBe("t0s1");
  });
  it("a ring with a hold shows held", () => {
    expect(shownStatus({ id: "R3", status: "waiting", watchers: 0, since: 0, held: { ms: 4000 } })).toBe("held");
    expect(shownStatus({ id: "R3", status: "waiting", watchers: 0, since: 0 })).toBe("waiting");
    expect(shownStatus(undefined)).toBe("free");
  });
  it("countdown text", () => {
    expect(clock(42_000)).toBe("0:42");
    expect(clock(60_000)).toBe("1:00");
    expect(clock(-5)).toBe("0:00");
  });
});
