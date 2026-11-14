import { describe, expect, it } from "vitest";
import { defaultLookCode as apiDefaultLookCode } from "../../../api/src/modules/identity/default-look";
import { AGE_GROUPS, ageParams, decodeAge, encodeAge } from "./age";
import { decodeLook, defaultLookCode, encodeLook, seededLook } from "./outfits";
import { DEFAULT_FACE, decodeFace, encodeFace, EXPRESSIONS, seededFace } from "./face";
import { faceShape } from "./human/face-rig";

const ids = Array.from({ length: 500 }, (_, i) => `01K${(i * 104729).toString(36).padStart(8, "0")}age${i}`);
const MM = 0.001;

describe("age ranges in the look code (P2-AVA-11, adults only)", () => {
  const legacy = "1|m|5C3A26|fade|141010|tee|jeans|sneakers|none|cap|2F80ED|2E3A46|F=1001011300";

  it("has adult ranges only: no child or teen option exists", () => {
    expect([...AGE_GROUPS]).toEqual(["young", "adult", "senior"]);
  });

  it("decodes every older code as a young adult", () => {
    expect(decodeLook(legacy, "#2F80ED").age).toBe("young");
    expect(decodeLook("1|n|6E4530|fade|141010|hoodie|joggers|sneakers|none|cap|2F80ED", "#2F80ED", "u1").age).toBe("young");
    expect(decodeAge(legacy.split("|"))).toBe("young");
  });

  it("round-trips adult and senior; a young look writes no token (older codes stay byte-identical)", () => {
    const l = decodeLook(legacy, "#2F80ED");
    expect(encodeLook({ ...l, age: "young" })).toBe(encodeLook({ ...l, age: undefined }));
    expect(encodeLook({ ...l, age: "young" })).not.toContain("A=");
    for (const age of ["adult", "senior"] as const) {
      const code = encodeLook({ ...l, age });
      expect(code).toContain(`|${encodeAge(age)}|`);
      expect(decodeLook(code, "#2F80ED")).toEqual({ ...l, age });
      // older clients: the top colour slot never takes the token, the face token is still found
      const p = code.split("|");
      expect(/^[0-9a-fA-F]{6}$/.test(p[12] ?? "")).toBe(false);
      expect(p[p.length - 1]!.startsWith("F=")).toBe(true);
    }
  });

  it("falls back to young for unknown versions / digits and never throws", () => {
    expect(decodeAge(["1", "m", "x", "x", "x", "x", "x", "x", "x", "x", "x", "A=91"])).toBe("young");
    expect(decodeAge(["1", "m", "x", "x", "x", "x", "x", "x", "x", "x", "x", "A=19"])).toBe("young");
    expect(decodeAge(["1", "m", "x", "x", "x", "x", "x", "x", "x", "x", "x", "A=12"])).toBe("senior");
    expect(decodeAge([])).toBe("young");
  });
});

describe("expression in the face token (P2-AVA-11)", () => {
  it("a face token saved before expressions decodes as relaxed (not the seeded value)", () => {
    const old = "F=1001011300"; // nine digits: the token as P2-AVA-07…10 wrote it
    for (const base of [{ ...DEFAULT_FACE, expression: "smile" as const }, { ...DEFAULT_FACE, expression: "serious" as const }])
      expect(decodeFace(old, base).expression).toBe("relaxed");
  });

  it("round-trips every expression", () => {
    for (const expression of EXPRESSIONS) expect(decodeFace(encodeFace({ ...DEFAULT_FACE, expression }), DEFAULT_FACE).expression).toBe(expression);
  });

  it("seeded faces: mostly relaxed or smiling; older seeded fields unchanged by the new roll", () => {
    const faces = ids.map((id) => seededFace(id, "feminine"));
    const n = (e: string) => faces.filter((f) => f.expression === e).length / faces.length;
    expect(n("relaxed") + n("smile")).toBeGreaterThan(0.8);
    expect(n("serious")).toBeGreaterThan(0);
    // young faces are identical to adult ones except where age picks facial hair
    for (const id of ids.slice(0, 50)) expect({ ...seededFace(id, "feminine", "senior") }).toEqual(seededFace(id, "feminine"));
  });
});

describe("seeded ages (deterministic, mirrored by the API)", () => {
  it("web and API produce the same code, ages included", () => {
    for (const id of ids) {
      expect(defaultLookCode(id, "#2F80ED")).toBe(apiDefaultLookCode(id, "#2F80ED"));
      expect(defaultLookCode(id, "#2F80ED", "masculine")).toBe(apiDefaultLookCode(id, "#2F80ED", "masculine"));
    }
  });

  it("most people are young adults; adults and seniors appear with age-appropriate looks", () => {
    const looks = ids.map((id) => seededLook(id, "#2F80ED"));
    const share = (a: string) => looks.filter((l) => l.age === a).length / looks.length;
    expect(share("young")).toBeGreaterThan(0.5);
    expect(share("adult")).toBeGreaterThan(0.12);
    expect(share("senior")).toBeGreaterThan(0.04);
    for (const l of looks) {
      if (l.age === "senior") expect(["#b4b0aa", "#e6e4e0", "#8a8a8a"]).toContain(l.hairColor);
      if (l.age === "senior" && l.bodyType === "masculine") expect(["short", "buzz", "bald"]).toContain(l.hairStyle);
      if (l.age !== "young" && l.bodyType === "masculine") expect(["short", "lowfade", "buzz", "bald", "fade"]).toContain(l.hairStyle);
      if (l.age !== "young" && l.bodyType === "feminine") expect(l.face.facialHair).toBe("none");
    }
    const seniorMen = looks.filter((l) => l.age === "senior" && l.bodyType === "masculine");
    expect(seniorMen.some((l) => l.face.facialHair === "moustache")).toBe(true);
  });

  it("young seeds keep their earlier code (no age token, twelve fields)", () => {
    for (const id of ids) {
      const code = defaultLookCode(id, "#2F80ED");
      const young = seededLook(id, "#2F80ED").age === "young";
      expect(code.includes("A=")).toBe(!young);
      if (young) expect(code.split("|")).toHaveLength(12);
    }
  });
});

describe("age parameters", () => {
  it("young is untouched; lines and grey grow with age", () => {
    const y = ageParams("young", "masculine");
    expect(y.lines + y.templeGrey + y.scalpGrey + y.beardGrey + y.recede + y.fuller + y.stoop).toBe(0);
    expect(y.smooth).toBe(1);
    const a = ageParams("adult", "masculine");
    const s = ageParams("senior", "masculine");
    for (const k of ["lines", "templeGrey", "scalpGrey", "beardGrey", "recede", "texture"] as const) {
      expect(a[k]).toBeGreaterThan(y[k]);
      expect(s[k]).toBeGreaterThan(a[k]);
    }
    expect(s.smooth).toBeLessThan(a.smooth);
    expect(s.stoop).toBeGreaterThan(0);
    expect(s.stoop).toBeLessThan(0.12); // subtle (rad)
    expect(ageParams(undefined, "feminine")).toEqual(ageParams("young", "feminine"));
  });

  it("receding temples are a masculine trait (half on neutral, none on feminine)", () => {
    expect(ageParams("senior", "feminine").recede).toBe(0);
    expect(ageParams("senior", "neutral").recede).toBeCloseTo(ageParams("senior", "masculine").recede / 2);
  });

  it("face bones: expressions differ, the default stays subtle (≤ 3 mm) and symmetric, adults fill out", () => {
    for (const model of ["masculine", "feminine", "neutral"]) {
      const relaxed = faceShape(DEFAULT_FACE, model);
      for (const sh of Object.values(relaxed)) for (const v of sh?.p ?? []) expect(Math.abs(v)).toBeLessThanOrEqual(3 * MM + 1e-9);
      expect(JSON.stringify(faceShape({ ...DEFAULT_FACE, expression: "smile" }, model))).not.toBe(JSON.stringify(relaxed));
      expect(JSON.stringify(faceShape({ ...DEFAULT_FACE, expression: "serious" }, model))).not.toBe(JSON.stringify(relaxed));
      const smile = faceShape({ ...DEFAULT_FACE, expression: "smile" }, model);
      // smiling: the mouth corners go up, mirrored on both sides
      expect(smile.Bip01_LMouthCorner!.p![1]).toBeGreaterThan(relaxed.Bip01_LMouthCorner!.p![1]);
      expect(smile.Bip01_RMouthCorner!.p![0]).toBeCloseTo(-smile.Bip01_LMouthCorner!.p![0]);
      const adult = faceShape(DEFAULT_FACE, model, "adult");
      expect(adult.Bip01_LCheek!.p![0]).toBeGreaterThan(relaxed.Bip01_LCheek!.p![0]);
    }
  });
});
