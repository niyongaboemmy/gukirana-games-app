import { describe, expect, it } from "vitest";
import { fixtureBlocks, HALL_DISCS } from "./hall-colliders";
import { BOXING_AISLES, BOXING_SIZE, FEATURE_STAGE, RINGS, ringSteps } from "./plan";
import { boxingWalkable } from "./hooks";

describe("Boxing hall fixture colliders (P3-FGT-08)", () => {
  it("every standard ring's floor kit (2 stools + 2 bucket groups) is solid", () => {
    expect(HALL_DISCS.length).toBe(RINGS.filter((r) => !r.feature).length * 4);
    for (const d of HALL_DISCS) expect(fixtureBlocks(d.x, d.z)).toBe(true);
  });
  it("the foot of every ring's steps and the walking aisles stay open", () => {
    for (const r of RINGS)
      for (const c of ["red", "blue"] as const) {
        const f = ringSteps(r, c);
        if (!r.feature) expect(boxingWalkable(f.x, f.z), `${r.id} ${c}`).toBe(true);
      }
    for (const x of BOXING_AISLES.slice(1, -1)) for (let z = -BOXING_SIZE.d / 2 + 1.5; z < BOXING_SIZE.d / 2 - 2.5; z += 0.25) expect(boxingWalkable(x, z), `aisle ${x.toFixed(2)} @ ${z}`).toBe(true);
    for (let x = -BOXING_SIZE.w / 2 + 1; x < BOXING_SIZE.w / 2 - 1; x += 0.25) expect(boxingWalkable(x, BOXING_SIZE.d / 2 - 1.75)).toBe(true);
  });
  it("the feature stage's spectator rail is solid; the floor in front of it is not", () => {
    expect(fixtureBlocks(0, FEATURE_STAGE.z0 + 0.9)).toBe(true);
    expect(fixtureBlocks(FEATURE_STAGE.hw + 0.9, 0)).toBe(true);
    expect(fixtureBlocks(0, FEATURE_STAGE.z0 + 1.6)).toBe(false);
  });
});
