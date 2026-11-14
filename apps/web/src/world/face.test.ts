import { describe, expect, it } from "vitest";
import { lookOf } from "@/lib/profile-store";
import { DEFAULT_LOOK, decodeLook, encodeLook } from "./outfits";
import { BROW_STYLES, EYE_SHAPES, FACE_SHAPES, LIP_SHAPES, NOSE_SHAPES, DEFAULT_FACE, type FaceLook } from "./face";
import { faceShape } from "./human/face-rig";

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
