import { describe, expect, it } from "vitest";
import { BOXING_METHODS, FOUL_LEVELS, FOULS, TIEBREAK_STEPS } from "@gukirana/contracts";
import { FS, FOUL_TUTORIAL, foulText, levelText, methodText, tiebreakText } from "./scoring-strings";

describe("boxing scoring strings (P3-FGT-06)", () => {
  it("every foul, level, method and countback step has a message; every tutorial foul has its rule text", () => {
    for (const k of [...FOULS.map(foulText), ...FOUL_LEVELS.map(levelText), ...BOXING_METHODS.map(methodText), ...TIEBREAK_STEPS.map(tiebreakText)])
      expect(FS[k], k).toBeTruthy();
    for (const r of FOUL_TUTORIAL) {
      expect(FS[r.when]).toBeTruthy();
      expect(FS[r.avoid]).toBeTruthy();
    }
  });
});
