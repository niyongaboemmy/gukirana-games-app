import { describe, expect, it } from "vitest";
import { CORNER_COLORS, kitFor, type RingState } from "@gukirana/contracts";
import { encodeLook, seededLook } from "@/world/outfits";
import { boxingKitOverride } from "./assets-shim";

/** Kit wiring (P3-FGT-01 §5): the kit is a temporary look derived from the registry; the saved look never changes. */
describe("boxing kit wiring", () => {
  const rings: RingState[] = [
    { id: "R7", status: "fighting", red: { sid: "a", name: "A", corner: "red" }, blue: { sid: "b", name: "B", corner: "blue" }, watchers: 0, since: 0 },
    { id: "R9", status: "free", watchers: 0, since: 0 },
  ];
  it("only fighters holding a ring wear a kit, in their corner's colour", () => {
    expect(kitFor("a", rings)?.corner).toBe("red");
    expect(kitFor("b", rings)?.corner).toBe("blue");
    expect(kitFor("c", rings)).toBeNull();
  });
  it("the override is a new look in the corner colour; the saved look (and its code) is untouched", () => {
    const look = seededLook("someone", "#7a7a7a");
    const before = encodeLook(look);
    const snapshot = JSON.stringify(look);
    const kit = boxingKitOverride(look, "red");
    expect(kit).not.toBe(look);
    expect(kit.topColor).toBe(CORNER_COLORS.red);
    expect(kit.skinTone).toBe(look.skinTone);
    expect(kit.hairStyle).toBe(look.hairStyle);
    expect(kit.face).toEqual(look.face);
    expect(JSON.stringify(look)).toBe(snapshot);
    expect(encodeLook(look)).toBe(before);
    expect(boxingKitOverride(look, "blue").topColor).toBe(CORNER_COLORS.blue);
    // cached per (look, corner): one rebuild per swap
    expect(boxingKitOverride(look, "red")).toBe(kit);
  });
});
