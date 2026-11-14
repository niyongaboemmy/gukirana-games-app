import { describe, expect, it } from "vitest";
import { animScale, DEFAULT_PREFS, migratePrefs } from "./feedback";

describe("game prefs", () => {
  it("migrates v0 prefs: fullGuide → aim guide length, old AI levels 1/3/5 → Easy/Medium/Hard", () => {
    expect(migratePrefs({ fullGuide: false, aiLevel: 1, sound: false }, 0)).toMatchObject({ aimGuide: "short", aiLevel: 1, sound: false, speed: "normal", hints: true });
    expect(migratePrefs({ fullGuide: true, aiLevel: 3 }, 0)).toMatchObject({ aimGuide: "long", aiLevel: 2 });
    expect(migratePrefs({ aiLevel: 5 }, 0).aiLevel).toBe(3);
    expect("fullGuide" in migratePrefs({ fullGuide: true }, 0)).toBe(false);
    expect(migratePrefs({ aiLevel: 4 }, 1).aiLevel).toBe(2); // not a category: back to Medium
    expect(migratePrefs(null, 0)).toMatchObject({ ...DEFAULT_PREFS, aimGuide: "long", aiLevel: 2 });
  });

  it("animation scale: Relaxed slower, Fast quicker, Skip = instant", () => {
    expect(animScale({ speed: "normal", skipAnim: false })).toBe(1);
    expect(animScale({ speed: "relaxed", skipAnim: false })).toBeGreaterThan(1);
    expect(animScale({ speed: "fast", skipAnim: false })).toBeLessThan(1);
    expect(animScale({ speed: "fast", skipAnim: true })).toBe(0);
  });
});
