import { describe, expect, it } from "vitest";
import { boxerAssets, generationOf, v8Requested, type GenerationInput } from "./generation";

/** P3-FGT-19B: the v8 flag (on by default since the v8 build met its checklist), its dev override and the v7 fallback */
const base: GenerationInput = { v6: true, v7: true, v8Env: undefined, search: null, dev: false, v8Ready: true };

describe("boxer generation", () => {
  it("is v8 by default; NEXT_PUBLIC_FF_BOXER_V8=0 falls back to v7", () => {
    expect(generationOf(base)).toBe("v8");
    expect(generationOf({ ...base, v8Env: "1" })).toBe("v8");
    expect(generationOf({ ...base, v8Env: "0" })).toBe("v7");
  });
  it("falls back to v7 while the v8 assets are not shipped", () => {
    expect(generationOf({ ...base, v8Env: "1", v8Ready: false })).toBe("v7");
    expect(v8Requested({ v8Env: "1", search: null, dev: false })).toBe(true);
  });
  it("needs v7: with v7 or v6 off the older fallbacks hold", () => {
    expect(generationOf({ ...base, v7: false, v8Env: "1" })).toBe("v6");
    expect(generationOf({ ...base, v6: false, v7: false, v8Env: "1" })).toBe("v5");
  });
  it("honours ?boxer= only in development builds", () => {
    expect(generationOf({ ...base, dev: true, search: "?boxer=v8", v8Env: "0" })).toBe("v8");
    expect(generationOf({ ...base, dev: true, search: "?a=1&boxer=v7" })).toBe("v7");
    expect(generationOf({ ...base, dev: false, search: "?boxer=v7" })).toBe("v8");
    expect(generationOf({ ...base, dev: true, search: "?boxer=nonsense", v8Env: "0" })).toBe("v7");
  });
  it("keeps every generation's assets apart (v7 stays byte-for-byte the fallback)", () => {
    const v7 = boxerAssets("v7"),
      v8 = boxerAssets("v8");
    expect(v7.glb.m).toBe("/assets/characters/boxer-m.glb");
    expect(v8.glb.m).toMatch(/\/v8\//);
    expect(v8.v8maps!.albedo("f", 1)).toMatch(/\/v8\/skin-f-t1\.ktx2$/);
    expect(v8.v8maps!.normal("m")).toMatch(/\/v8\/skin-m-normal\.ktx2$/);
    expect(v8.ktx2).toBe(true);
    expect(boxerAssets("v6").glb.f).toBe("/assets/characters/boxer-f-v6.glb");
  });
});
