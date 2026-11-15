import { describe, expect, it } from "vitest";
import { bodyDetour } from "./soft-bodies";

describe("walking round people", () => {
  it("steps round someone standing on the line, on the side away from them", () => {
    const d = bodyDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 1.5, z: 0.2, r: 0.3 }], 0.32);
    expect(d).not.toBeNull();
    expect(d!.x).toBeCloseTo(1.5, 1);
    expect(d!.z).toBeLessThan(-0.9); // the body is a little to the left (+z), so pass on the right
  });
  it("ignores people off the line, behind you or past the target", () => {
    expect(bodyDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 1.5, z: 1.5, r: 0.3 }], 0.32)).toBeNull();
    expect(bodyDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: -1, z: 0, r: 0.3 }], 0.32)).toBeNull();
    expect(bodyDetour({ x: 0, z: 0 }, { x: 1, z: 0 }, [{ x: 1.8, z: 0, r: 0.3 }], 0.32)).toBeNull();
  });
  it("takes the other side when the first one is not walkable", () => {
    const d = bodyDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 1.5, z: 0.2, r: 0.3 }], 0.32, (_x, z) => z > 0);
    expect(d!.z).toBeGreaterThan(0.9);
  });
});
