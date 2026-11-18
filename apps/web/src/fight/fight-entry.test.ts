import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "@gukirana/i18n/messages/en.json";
import fr from "@gukirana/i18n/messages/fr.json";
import rw from "@gukirana/i18n/messages/rw.json";
import sw from "@gukirana/i18n/messages/sw.json";

/**
 * P3-FGT-25: entering the fight game froze and swapped the world for a loading screen. The causes found (measured with
 * qa/e2e/fight-entry.mjs, docs/QA/fight-entry/) and what keeps them from coming back.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("fight game entry stays live", () => {
  it("Quick Play / a meeting travel with the world live (stage travelTo), not a bare route change", () => {
    const mm = src("../match/MatchmakingV2.tsx");
    expect(mm.match(/travelTo\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src("../world/SceneHost.tsx")).toMatch(/travelTo\(g, null\)/);
  });

  it("the hall's focus fog is installed before the warm-up (no whole-hall recompile on its first frame)", () => {
    const f = src("./FocusMode.tsx");
    expect(f).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?scene\.fog = fog/);
    // off screen the fog stays (far away), only the background is restored
    expect(f).toMatch(/if \(!onScreen\) \{\s*restoreBackground\(\);\s*if \(scene\.fog !== fog\) scene\.fog = fog;/);
  });

  it("the fighter body is requested and warm-compiled with the hall, not at the ring", () => {
    const s = src("./BoxingHallScene.tsx");
    expect(s).toMatch(/<FighterWarmup lite=\{lite\} \/>/);
    expect(s).toMatch(/gkWarmOnly: true/);
    expect(s).toMatch(/preloadBoxers\(\)/);
  });

  it("people that stream in never suspend a whole room or the other ring pairs", () => {
    expect(src("./gym-life.tsx")).toMatch(/<Suspense key=\{s\.id\} fallback=\{null\}>\s*<StaffNpc/);
    expect(src("./fighters.tsx")).toMatch(/<Suspense key=\{`\$\{s\.ring\}:\$\{s\.src\}`\} fallback=\{null\}>\s*<RingPair/);
  });

  it("my own person stays on screen until my fighter is really drawn", () => {
    expect(src("./fighters.tsx")).toMatch(/b\.mine && mineDrawn\.ring === b\.mine\.ring/);
  });

  it("the entry hint text is an i18n key in every locale", () => {
    for (const m of [en, fr, rw, sw] as { world?: { entry?: { ring?: string; hall?: string } } }[]) {
      expect(m.world?.entry?.ring).toBeTruthy();
      expect(m.world?.entry?.hall).toContain("{hall}");
    }
  });
});
