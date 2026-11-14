import { describe, expect, it } from "vitest";
import { CORNER_COLORS, kitFor, type RingState } from "@gukirana/contracts";
import { encodeLook, seededLook } from "@/world/outfits";
import { boxingKitOverride } from "@/world/human/boxing/kit";
import { CLIP_MAP, kitStatus } from "./assets-shim";
import { BOXING_CLIPS as CONTRACT_CLIPS, RING_STATUSES } from "@gukirana/contracts";
import { BOXING_CLIPS } from "@/world/human/boxing/clips";

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
  it("the override is a new look in the corner's kit; the saved look (and its code) is untouched", () => {
    const look = seededLook("someone", "#7a7a7a");
    const before = encodeLook(look);
    const snapshot = JSON.stringify(look);
    const kit = boxingKitOverride(look, "red", { headgear: true });
    expect(kit.look).not.toBe(look);
    expect(kit.look.outfit).not.toBe(look.outfit);
    expect(kit.corner).toBe("red");
    expect(kit.look.skinTone).toBe(look.skinTone);
    expect(kit.look.face).toEqual(look.face);
    expect(JSON.stringify(look)).toBe(snapshot);
    expect(encodeLook(look)).toBe(before);
    expect(boxingKitOverride(look, "blue").corner).toBe("blue");
    void CORNER_COLORS;
  });
  it("every contract clip maps onto a motion-library clip; every ring status onto a kit lamp", () => {
    for (const c of CONTRACT_CLIPS) expect(BOXING_CLIPS[CLIP_MAP[c]], c).toBeTruthy();
    for (const s of RING_STATUSES) expect(["free", "waiting", "fighting", "closed"]).toContain(kitStatus(s));
  });
});
