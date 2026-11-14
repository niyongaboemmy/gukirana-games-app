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
import { DEFAULT_FACE, EYE_COLORS, FACE_FIELDS, FACIAL_HAIR, decodeFace, encodeFace, seededFace } from "./face";

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
      expect(encodeLook(l).length).toBeLessThanOrEqual(110);
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

describe("face choices in the look code (P2-AVA-07)", () => {
  const legacy = "1|m|5C3A26|fade|141010|tee|jeans|sneakers|none|cap|2F80ED|2E3A46";

  it("round-trips every option of every face field", () => {
    const base = seededLook("someone", "#2F80ED");
    for (const [k, list] of FACE_FIELDS)
      for (const v of list) {
        const l = { ...base, face: { ...base.face, [k]: v } };
        expect(decodeLook(encodeLook(l), "#2F80ED").face).toEqual(l.face);
      }
  });

  it("decodes codes saved before faces with the person's seeded face (old codes stay valid)", () => {
    const l = decodeLook(legacy, "#000000", "user-1");
    expect(l.bodyType).toBe("masculine");
    expect(l.hairStyle).toBe("fade");
    expect(l.topColor).toBe("#2E3A46");
    expect(l.face).toEqual(seededFace("user-1", "masculine"));
    // without an id: a stable key of body / skin / hair, the same on every screen and unchanged by clothes
    const a = decodeLook(legacy, "#000000").face;
    expect(decodeLook(legacy.replace("|tee|", "|hoodie|"), "#000000").face).toEqual(a);
    expect(decodeLook(legacy, "#000000").face).toEqual(a);
  });

  it("old clients still read new codes: the face token is never taken for a top colour", () => {
    const l = { ...decodeLook(legacy, "#000000"), topColor: undefined };
    const code = encodeLook(l);
    const p = code.split("|");
    expect(p[0]).toBe("1");
    expect(p).toHaveLength(12);
    expect(/^[0-9a-fA-F]{6}$/.test(p[11]!)).toBe(false);
    expect(code).toMatch(/^[\w.:;,|#=-]{0,160}$/);
  });

  it("falls back field by field for unknown digits / versions and never throws", () => {
    const f = decodeFace("F=1zzzzzzzzz", DEFAULT_FACE);
    expect(f).toEqual(DEFAULT_FACE);
    expect(decodeFace("F=9000000000", DEFAULT_FACE)).toEqual(DEFAULT_FACE);
    expect(decodeFace("F=10", DEFAULT_FACE)).toEqual(DEFAULT_FACE);
    expect(decodeFace("garbage", DEFAULT_FACE)).toEqual(DEFAULT_FACE);
    expect(decodeFace(encodeFace({ ...DEFAULT_FACE, facialHair: "full" }), DEFAULT_FACE).facialHair).toBe("full");
  });

  it("seeded faces are deterministic and varied; beards only on masculine / neutral defaults", () => {
    const faces = ids.map((id) => seededLook(id, "#2F80ED"));
    for (const id of ids.slice(0, 40)) expect(seededLook(id, "#2F80ED").face).toEqual(seededLook(id, "#2F80ED").face);
    expect(new Set(faces.map((l) => encodeFace(l.face))).size).toBeGreaterThan(300);
    expect(new Set(faces.map((l) => l.face.eyeColor)).size).toBeGreaterThanOrEqual(5);
    for (const l of faces) {
      expect(EYE_COLORS).toContain(l.face.eyeColor);
      if (l.bodyType === "feminine") expect(l.face.facialHair).toBe("none");
      if (l.bodyType === "masculine") expect(l.face.makeup).toBe("none");
    }
    const masc = faces.filter((l) => l.bodyType === "masculine");
    expect(new Set(masc.map((l) => l.face.facialHair)).size).toBe(FACIAL_HAIR.length);
    // most men are clean-shaven or lightly bearded, not everyone has a beard
    expect(masc.filter((l) => l.face.facialHair === "none").length / masc.length).toBeGreaterThan(0.2);
  });
});
