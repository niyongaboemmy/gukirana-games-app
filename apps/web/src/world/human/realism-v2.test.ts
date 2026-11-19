import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { V2_SHIPPED, v2On, type V2Item } from "./realism-v2";
import { isHairMaterial, softAlphaEdges } from "./alpha-edges";

/** P2-AVA-18: campus people realism v2 switches and the hair edge helper. */

const setQuery = (q: string) => {
  vi.stubGlobal("window", { location: { search: q } });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("v2 item switches", () => {
  it("follows the shipped table without a dev override", () => {
    setQuery("");
    for (const k of Object.keys(V2_SHIPPED) as V2Item[]) expect(v2On(k)).toBe(V2_SHIPPED[k]);
  });

  it("dev override: all, none, a list", () => {
    setQuery("?hv2=all");
    expect((Object.keys(V2_SHIPPED) as V2Item[]).every((k) => v2On(k))).toBe(true);
    setQuery("?hv2=none");
    expect((Object.keys(V2_SHIPPED) as V2Item[]).some((k) => v2On(k))).toBe(false);
    setQuery("?hv2=marks,bogus");
    expect(v2On("marks")).toBe(true);
    expect(v2On("brows")).toBe(false);
  });

  it("nothing applies with the realistic campus people off", () => {
    setQuery("?people=v1&hv2=all");
    expect(v2On("marks")).toBe(false);
  });
});

describe("hair edges", () => {
  it("recognises hair-like avatar materials only", () => {
    const m = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });
    expect(isHairMaterial(m("gk-hair"))).toBe(true);
    expect(isHairMaterial(m("lashes"))).toBe(true);
    expect(isHairMaterial(m("haircards"))).toBe(true);
    expect(isHairMaterial(m("head"))).toBe(false);
  });

  it("switches to coverage, keeps the canvas alpha and the hashed fade, once", () => {
    const m = new THREE.MeshStandardMaterial();
    m.customProgramCacheKey = () => "base";
    softAlphaEdges(m);
    softAlphaEdges(m);
    expect(m.alphaToCoverage).toBe(true);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendDstAlpha).toBe(THREE.OneFactor);
    expect(m.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(m.customProgramCacheKey()).toBe("base|gk-soft-edge");
    const shader = { fragmentShader: "void main() {\n#include <alphahash_fragment>\n}", vertexShader: "", uniforms: {} };
    const renderer = { getContext: () => ({ getContextAttributes: () => ({ antialias: true }) }) };
    m.onBeforeCompile(shader as never, renderer as never);
    expect(shader.fragmentShader).toContain("getAlphaHashThreshold");
    expect(shader.fragmentShader).toContain("opacity < 0.999");
    expect(shader.fragmentShader).toContain("gkEdgeNoise");
  });
});
