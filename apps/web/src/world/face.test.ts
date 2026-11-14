import { describe, expect, it } from "vitest";
import { lookOf } from "@/lib/profile-store";
import { DEFAULT_LOOK, decodeLook, encodeLook } from "./outfits";
import { BROW_STYLES, EYE_SHAPES, FACE_SHAPES, LIP_SHAPES, NOSE_SHAPES, DEFAULT_FACE, seededFace, type FaceLook } from "./face";
import { faceShape } from "./human/face-rig";
import { FACIAL_HAIR_PARAMS, LIP_TINTS, lookUniforms } from "./human/materials";
import { HUMAN_MODELS } from "./human/meta";

const MM = 0.001;

describe("face proportions (P2-AVA-07)", () => {
  const all: FaceLook[] = [];
  for (const shape of FACE_SHAPES) all.push({ ...DEFAULT_FACE, shape });
  for (const eyes of EYE_SHAPES) all.push({ ...DEFAULT_FACE, eyes });
  for (const brows of BROW_STYLES) all.push({ ...DEFAULT_FACE, brows });
  for (const nose of NOSE_SHAPES) all.push({ ...DEFAULT_FACE, nose });
  for (const lips of LIP_SHAPES) all.push({ ...DEFAULT_FACE, lips });

  it("stays subtle (≤ 3 mm moves, ≤ 25 % scale) and mirror-symmetric", () => {
    for (const model of ["feminine", "masculine", "neutral"])
      for (const f of all) {
        const o = faceShape(f, model);
        for (const [name, sh] of Object.entries(o)) {
          for (const v of sh?.p ?? []) expect(Math.abs(v)).toBeLessThanOrEqual(3 * MM + 1e-9);
          for (const v of sh?.s ?? []) expect(Math.abs(v - 1)).toBeLessThanOrEqual(0.25);
          if (name.includes("_L")) {
            const r = o[name.replace("_L", "_R")];
            expect(r?.p?.[0]).toBeCloseTo(-(sh?.p?.[0] ?? 0));
            expect(r?.p?.[1]).toBeCloseTo(sh?.p?.[1] ?? 0);
          }
        }
      }
  });

  it("every choice changes the face (no dead options)", () => {
    const base = JSON.stringify(faceShape(DEFAULT_FACE, "neutral"));
    const dead = all.filter((f) => JSON.stringify(f) !== JSON.stringify(DEFAULT_FACE) && JSON.stringify(faceShape(f, "neutral")) === base);
    // brows "full" / "thin" and the shader-only choices are painted, not moved
    expect(dead.map((f) => f.brows).every((b) => b === "full" || b === "thin")).toBe(true);
  });
});

describe("local profile and wire agree on the face", () => {
  it("a profile without a face shows the same seeded face as its code without a face token", () => {
    const s = { ...DEFAULT_LOOK, face: undefined, color: "#2F80ED", hairStyle: "locs" as const, skinTone: "#4A2C21" };
    const local = lookOf(s);
    const code = encodeLook(local).replace(/\|F=[^|]*$/, "");
    expect(decodeLook(code, "#2F80ED").face).toEqual(local.face);
    // and once saved, the face travels in the code
    expect(decodeLook(encodeLook(local), "#2F80ED").face).toEqual(local.face);
  });
});

describe("natural defaults (P2-AVA-08)", () => {
  const ids = Array.from({ length: 600 }, (_, i) => `user-${i}-${(i * 2654435761) >>> 0}`);

  it("no make-up default on masculine / neutral bodies, and no gloss default on anyone", () => {
    for (const id of ids) {
      expect(seededFace(id, "masculine").makeup).toBe("none");
      expect(seededFace(id, "neutral").makeup).toBe("none");
      expect(seededFace(id, "feminine").makeup).not.toBe("gloss");
    }
    // feminine defaults still vary (subtle matte tints / liner on some)
    expect(new Set(ids.map((id) => seededFace(id, "feminine").makeup)).size).toBeGreaterThan(2);
  });

  it("clean-shaven is really clean: nothing painted, no lip tint, no gloss", () => {
    expect(FACIAL_HAIR_PARAMS.none).toEqual([0, 0, 0, 0, 0, 0]);
    expect(LIP_TINTS.none[1]).toBe(0); // lip tint amount
    expect(LIP_TINTS.none[2]).toBe(0); // liner
    expect(LIP_TINTS.none[3]).toBe(0); // gloss
    const u = lookUniforms({ ...DEFAULT_LOOK, bodyType: "neutral", face: { ...DEFAULT_FACE, facialHair: "none", makeup: "none" } }, HUMAN_MODELS.neutral, true, null);
    expect(u.uFH.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(u.uFH2.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(u.uMakeup.value.toArray()).toEqual([0, 0, 0, 0]);
    // the base heads carry no baked beard any more (the neutral head was shaved in the texture)
    for (const m of Object.values(HUMAN_MODELS)) expect("beard" in m).toBe(false);
  });

  it("only the gloss make-up is glossy; tints stay subtle", () => {
    for (const [k, [, amount, , gloss]] of Object.entries(LIP_TINTS)) {
      expect(gloss).toBe(k === "gloss" ? 1 : 0);
      expect(amount).toBeLessThanOrEqual(0.4);
    }
  });

  it("every facial hair style except none paints something", () => {
    for (const [k, p] of Object.entries(FACIAL_HAIR_PARAMS)) {
      const covers = p[0] + p[1] + p[2] + p[4];
      if (k === "none") expect(covers).toBe(0);
      else {
        expect(covers).toBeGreaterThan(0);
        expect(p[3]).toBeGreaterThan(0);
      }
    }
  });
});
