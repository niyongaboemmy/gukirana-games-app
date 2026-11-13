import { describe, expect, it } from "vitest";
import { defaultLookCode as apiDefaultLookCode } from "../../../api/src/modules/identity/default-look";
import {
  decodeLook,
  defaultLookCode,
  encodeLook,
  HAIR_STYLES,
  itemById,
  SKIN_TONES,
  seededLook,
} from "./outfits";

const ids = Array.from({ length: 400 }, (_, i) => `01J${(i * 7919).toString(36).padStart(8, "0")}user${i}`);

describe("seeded default looks (P1-WLD-03)", () => {
  it("is deterministic and identical to the API's sign-up look", () => {
    for (const id of ids) {
      expect(defaultLookCode(id, "#2F80ED")).toBe(defaultLookCode(id, "#2F80ED"));
      expect(defaultLookCode(id, "#2F80ED")).toBe(apiDefaultLookCode(id, "#2F80ED"));
      expect(defaultLookCode(id, "#9B51E0", "feminine")).toBe(apiDefaultLookCode(id, "#9B51E0", "feminine"));
    }
  });

  it("only uses catalogue items and round-trips through the wire encoding", () => {
    for (const id of ids) {
      const l = seededLook(id, "#2F80ED");
      for (const slot of ["top", "bottom", "shoes", "accessory", "headwear"] as const)
        expect(itemById(l.outfit[slot])?.slot).toBe(slot);
      expect(HAIR_STYLES.some((h) => h.id === l.hairStyle)).toBe(true);
      expect(SKIN_TONES.slice(0, 8)).toContain(l.skinTone.toUpperCase());
      expect(l.topColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(decodeLook(encodeLook(l), "#000000")).toEqual(l);
      expect(encodeLook(l).length).toBeLessThanOrEqual(90);
    }
  });

  it("varies people: many distinct skins, hair, tops and colours; ~25% wear headwear", () => {
    const looks = ids.map((id) => seededLook(id, "#2F80ED"));
    expect(new Set(looks.map((l) => l.skinTone)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBe(HAIR_STYLES.length);
    expect(new Set(looks.map((l) => l.outfit.top)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(looks.map((l) => l.topColor)).size).toBe(12);
    const hats = looks.filter((l) => l.outfit.headwear !== "no-hat").length / looks.length;
    expect(hats).toBeGreaterThan(0.15);
    expect(hats).toBeLessThan(0.33);
    // no two of the first 20 people are the same clone
    expect(new Set(looks.slice(0, 20).map(encodeLook)).size).toBe(20);
  });

  it("keeps the player's own body-type choice", () => {
    for (const id of ids.slice(0, 50))
      expect(seededLook(id, "#2F80ED", "masculine").bodyType).toBe("masculine");
  });

  it("falls back to the seeded look for missing or invalid look strings", () => {
    expect(decodeLook(undefined, "#2F80ED", "abc")).toEqual(seededLook("abc", "#2F80ED"));
    expect(decodeLook("garbage", "#2F80ED", "abc")).toEqual(seededLook("abc", "#2F80ED"));
  });
});
