import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P3-FGT-24: live fights were voided (LEFT_BEFORE_START) because the live boxing client lived inside the 3D scene: a
 * person's model streaming in re-suspended the hall, React disconnected the scene's effects, the client stopped and
 * left the fight room "on purpose". The client now runs in the DOM (app/room/[game] → LiveBoxingNet) and every
 * BoxerAvatar layer of the hall has its own Suspense boundary.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("Boxing hall: the live client and the scene's Suspense", () => {
  it("the scene does not run the live client", () => {
    expect(src("./BoxingHallScene.tsx")).not.toMatch(/useBoxingNetClient\(/);
  });

  it("the Boxing hall page runs it outside the HUD's boot gate", () => {
    const page = src("../../app/room/[game]/page.tsx");
    expect(page).toMatch(/<LiveBoxingNet \/>/);
    // rendered before (outside) the `hud &&` block, so a HUD toggle never remounts it
    expect(page.indexOf("{net}")).toBeGreaterThan(-1);
    expect(page.indexOf("{net}")).toBeLessThan(page.indexOf("{hud && ("));
  });

  it("every lazily loaded person layer has its own Suspense boundary", () => {
    const scene = src("./BoxingHallScene.tsx");
    for (const layer of ["GymLife", "FightersLayer", "Judges", "BagWorker"])
      expect(scene, layer).toMatch(new RegExp(`<Suspense fallback=\\{null\\}>\\s*<${layer}\\b`));
  });
});
