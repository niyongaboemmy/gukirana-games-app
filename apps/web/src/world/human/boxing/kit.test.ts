import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, encodeLook, type AvatarLook } from "../../outfits";
import { boxingKitOverride, CORNER_COLORS, KitSwap, refereeLook } from "./kit";

const saved = (): AvatarLook => ({
  ...DEFAULT_LOOK,
  bodyType: "feminine",
  hairStyle: "headwrap",
  outfit: { top: "kitenge-sun", bottom: "skirt", shoes: "sandals", accessory: "earrings", headwear: "cap" },
  face: { ...DEFAULT_LOOK.face },
});

describe("boxingKitOverride", () => {
  it("never mutates the saved look (deep: outfit and face too)", () => {
    const look = saved();
    const before = JSON.stringify(look);
    const code = encodeLook(look);
    const kit = boxingKitOverride(look, "red", { headgear: true });
    kit.look.outfit.top = "hoodie";
    kit.look.face.expression = "smile";
    expect(JSON.stringify(look)).toBe(before);
    expect(encodeLook(look)).toBe(code);
    expect(kit.look.outfit).not.toBe(look.outfit);
    expect(kit.look.face).not.toBe(look.face);
  });

  it("dresses in the corner colour, keeps the person (body, skin, face, age)", () => {
    const look = saved();
    for (const corner of ["red", "blue"] as const) {
      const kit = boxingKitOverride(look, corner);
      expect(kit.look.topColor).toBe(CORNER_COLORS[corner].main);
      expect(kit.colors.gloves).toBe(CORNER_COLORS[corner].main);
      expect(kit.colors.trunks).toBe(CORNER_COLORS[corner].main);
      expect(kit.look.outfit).toEqual({ top: "tee", bottom: "shorts", shoes: "sneakers", accessory: "none", headwear: "no-hat" });
      expect(kit.look.bodyType).toBe(look.bodyType);
      expect(kit.look.skinTone).toBe(look.skinTone);
      expect(kit.look.face).toEqual(look.face);
    }
    expect(boxingKitOverride(look, "red").colors.gloves).not.toBe(boxingKitOverride(look, "blue").colors.gloves);
  });

  it("headgear compresses the hair under the fitted shell; a headwrap becomes a bun in the ring", () => {
    const kit = boxingKitOverride(saved(), "blue", { headgear: true, mouthguard: false });
    expect(kit.headgear).toBe(true);
    expect(kit.mouthguard).toBe(false);
    expect(kit.look.outfit.headwear).toBe("beanie");
    expect(kit.look.hairStyle).toBe("bun");
    expect(boxingKitOverride({ ...saved(), hairStyle: "afro" }, "red").look.hairStyle).toBe("afro");
  });

  it("is deterministic and encodable on the wire", () => {
    const a = boxingKitOverride(saved(), "red", { boots: "white" });
    const b = boxingKitOverride(saved(), "red", { boots: "white" });
    expect(a).toEqual(b);
    expect(encodeLook(a.look).length).toBeLessThanOrEqual(160);
  });

  it("referee look: white shirt, no accessories, saved look untouched", () => {
    const look = saved();
    const r = refereeLook(look);
    expect(r.outfit.top).toBe("tee-white");
    expect(r.outfit.accessory).toBe("none");
    expect(look.outfit.top).toBe("kitenge-sun");
  });
});

describe("KitSwap", () => {
  it("fades out, swaps at the darkest point, fades back in dressed", () => {
    const s = new KitSwap(0.2, 0.3);
    expect(s.sample(0)).toEqual({ fade: 1, wearing: false, busy: false });
    s.enter(10);
    expect(s.sample(10.1).wearing).toBe(false);
    expect(s.sample(10.1).fade).toBeLessThan(1);
    expect(s.sample(10.2).fade).toBeLessThan(0.02);
    expect(s.sample(10.21).wearing).toBe(true);
    expect(s.sample(10.6)).toEqual({ fade: 1, wearing: true, busy: false });
    // fade is continuous (no visible pop)
    let prev = 1;
    for (let t = 10; t < 10.6; t += 0.005) {
      const f = s.sample(t).fade;
      expect(Math.abs(f - prev)).toBeLessThan(0.06);
      prev = f;
    }
    s.exit(20);
    expect(s.sample(20.4).wearing).toBe(false);
  });

  it("re-entering while already dressed does nothing", () => {
    const s = new KitSwap();
    s.enter(0);
    s.enter(5);
    expect(s.sample(5.1)).toEqual({ fade: 1, wearing: true, busy: false });
  });
});
