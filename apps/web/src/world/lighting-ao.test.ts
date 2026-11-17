import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P3-FGT-24: the hall's ring AO (world/Lighting `Effects`) froze the canvas in every fight. n8ao's `halfRes` renders
 * into its WebGLMultipleRenderTargets shim, whose `texture` getter returns the textures array; three r187's
 * WebGLTextures.setupRenderTarget reads `renderTarget.texture.mipmaps.length` and throws on every frame (n8ao 2.0.1
 * ships the shim in dist/N8AO.js; it is a dependency of @react-three/postprocessing, not importable from here).
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("ring AO (N8AO) with three r187", () => {
  it("no N8AO in the app turns halfRes on", () => {
    for (const f of ["./Lighting.tsx", "../fight/game/RingLab.tsx", "./human/boxing/BoxingLab.tsx"]) {
      const tags = src(f).match(/<N8AO\b[^>]*>/g) ?? [];
      expect(tags.length, f).toBeGreaterThan(0);
      for (const t of tags) expect(t, f).not.toMatch(/\bhalfRes\b/);
    }
  });
});
