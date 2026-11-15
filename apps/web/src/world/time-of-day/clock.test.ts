import { describe, expect, it } from "vitest";
import { clockLabel, ease, loadChoice, nearestDay, presetMinutes, PRESET_MIN, saveChoice, shownTime, STORAGE_KEY, targetTime, transitionDone, transitionMs } from "./clock";
import { computeLook, lightsOn, phaseOf, sunColour, twilightOf } from "./look";
import { kigaliMinutes, kigaliTime, sunPosition } from "./solar";

const NOV15 = Date.parse("2026-11-15T10:00:00Z"); // 12:00 in Kigali
const H = 3_600_000;

describe("presets", () => {
  it("Morning 08:00, Midday 12:30, Night 21:00", () => {
    expect(PRESET_MIN).toEqual({ morning: 480, midday: 750, night: 1260 });
    expect(clockLabel(targetTime("morning", NOV15, NOV15))).toBe("08:00");
    expect(clockLabel(targetTime("midday", NOV15, NOV15))).toBe("12:30");
    expect(clockLabel(targetTime("night", NOV15, NOV15))).toBe("21:00");
  });
  it("Sunset is today's sunset (the disc on the horizon): ≈ 17:45–18:20 all year, ~18:05 on average", () => {
    for (const iso of ["2026-02-11", "2026-06-21", "2026-11-03", "2026-12-21"]) {
      const m = presetMinutes("sunset", Date.parse(`${iso}T10:00:00Z`));
      expect(m).toBeGreaterThan(17 * 60 + 40);
      expect(m).toBeLessThan(18 * 60 + 25);
      const el = sunPosition(kigaliTime(Date.parse(`${iso}T10:00:00Z`), m)).el;
      expect(el).toBeGreaterThan(-0.5);
      expect(el).toBeLessThan(1.5);
    }
  });
  it("a preset lands on the nearest day (the short way round the clock)", () => {
    const late = Date.parse("2026-11-15T21:00:00Z"); // 23:00 in Kigali
    const t = targetTime("morning", late, late);
    expect(t - late).toBe(9 * H); // tomorrow 08:00, not this morning
    expect(targetTime("now", late, late)).toBe(late);
  });
  it("nearestDay stays within ±12 h", () => {
    expect(nearestDay(NOV15 + 30 * H, NOV15)).toBe(NOV15 + 6 * H);
    expect(nearestDay(NOV15 - 20 * H, NOV15)).toBe(NOV15 + 4 * H);
  });
});

describe("transition", () => {
  it("quintic ease: 0 → 1, symmetric, flat at both ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.02)).toBeLessThan(0.001);
    expect(1 - ease(0.98)).toBeLessThan(0.001);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    for (let k = 0; k < 1; k += 0.05) expect(ease(k + 0.05)).toBeGreaterThanOrEqual(ease(k));
  });
  it("runs from the shown time to the preset over the transition, never a cut", () => {
    const from = targetTime("midday", NOV15, NOV15);
    const to = targetTime("night", NOV15, from);
    const tr = { from, to, start: 1000, dur: transitionMs(false) };
    expect(shownTime(tr, NOV15, 1000, 0)).toBe(from);
    const mid = shownTime(tr, NOV15, 1000 + 1750, 0);
    expect(clockLabel(mid)).toBe("16:45"); // halfway through 12:30 → 21:00
    expect(shownTime(tr, NOV15, 1000 + 3500, 0)).toBe(to);
    expect(transitionDone(tr, 1000 + 3499)).toBe(false);
    expect(transitionDone(tr, 1000 + 3500)).toBe(true);
    // per 100 ms the clock never jumps more than ~1 h 10 min (8.5 h over 3.5 s, quintic peak velocity 1.875×)
    let prev = from;
    for (let p = 1000; p <= 4500; p += 100) {
      const t = shownTime(tr, NOV15, p, 0);
      expect(Math.abs(t - prev)).toBeLessThan(1.2 * H);
      prev = t;
    }
  });
  it("back to Now follows the moving real clock", () => {
    const from = targetTime("night", NOV15, NOV15);
    const tr = { from, to: null, start: 0, dur: 3500 };
    expect(shownTime(tr, NOV15 + 10_000, 3500, 0)).toBe(NOV15 + 10_000);
  });
  it("is slower in VR", () => {
    expect(transitionMs(true)).toBeGreaterThan(transitionMs(false));
  });
});

describe("storage", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("round-trips the choice", () => {
    const s = mem();
    expect(saveChoice(s, { mode: "night" })).toBe(true);
    expect(loadChoice(s)).toEqual({ mode: "night" });
    saveChoice(s, { mode: "custom", minutes: 1500 });
    expect(loadChoice(s)).toEqual({ mode: "custom", minutes: 60 });
  });
  it("falls back to Now when storage is missing, throws or holds junk", () => {
    expect(loadChoice(null)).toEqual({ mode: "now" });
    expect(loadChoice({ getItem: () => { throw new Error("SecurityError"); } })).toEqual({ mode: "now" });
    const s = mem();
    s.m.set(STORAGE_KEY, "{not json");
    expect(loadChoice(s)).toEqual({ mode: "now" });
    s.m.set(STORAGE_KEY, JSON.stringify({ mode: "eclipse" }));
    expect(loadChoice(s)).toEqual({ mode: "now" });
    expect(saveChoice({ setItem: () => { throw new Error("QuotaExceeded"); } }, { mode: "night" })).toBe(false);
  });
});

describe("phases and look", () => {
  it("maps the sun's altitude and direction to phases", () => {
    expect(phaseOf(-30, false)).toBe("night");
    expect(phaseOf(-8, true)).toBe("dawn");
    expect(phaseOf(-8, false)).toBe("dusk");
    expect(phaseOf(1, true)).toBe("sunrise");
    expect(phaseOf(1, false)).toBe("sunset");
    expect(phaseOf(7, false)).toBe("golden");
    expect(phaseOf(30, true)).toBe("morning");
    expect(phaseOf(30, false)).toBe("afternoon");
    expect(phaseOf(70, true)).toBe("midday");
    expect(twilightOf(-3)).toBe("civil");
    expect(twilightOf(-9)).toBe("nautical");
    expect(twilightOf(-15)).toBe("astronomical");
  });
  it("the presets show their phases on 15 Nov 2026", () => {
    const at = (p: "morning" | "midday" | "sunset" | "night") => {
      const t = targetTime(p, NOV15, NOV15);
      const s = sunPosition(t);
      return phaseOf(s.el, sunPosition(t + 60_000).el > s.el);
    };
    expect(at("morning")).toBe("morning");
    expect(at("midday")).toBe("midday");
    expect(at("sunset")).toBe("sunset");
    expect(at("night")).toBe("night");
  });
  it("sun colour: white at noon, warm low down, deep orange at the horizon", () => {
    const noon = sunColour(70);
    expect(noon[2]).toBeGreaterThan(0.8);
    const low = sunColour(2);
    expect(low[0]).toBe(1);
    expect(low[2]).toBeLessThan(0.15);
  });
  it("street lights: off by day, on at night, switching around sunset", () => {
    expect(lightsOn(10)).toBe(0);
    expect(lightsOn(-10)).toBe(1);
    expect(lightsOn(0)).toBeGreaterThan(0.1);
    expect(lightsOn(0)).toBeLessThan(0.9);
  });
  it("the 17° morning reproduces the hand-tuned P1-WLD-03 light", () => {
    const l = computeLook(17, true, { el: -30, fraction: 0.5 });
    expect(l.sunI).toBeCloseTo(2.6, 1);
    expect(l.hemiI).toBeCloseTo(0.45, 2);
    expect(l.shadow).toBe(1);
    expect(l.lights).toBe(0);
  });
  it("midday is not blown out; night is dim but readable, moonlit and starry", () => {
    const noon = computeLook(75, true, { el: -40, fraction: 1 });
    expect(noon.sunI).toBeLessThanOrEqual(2.75);
    const night = computeLook(-40, false, { el: 50, fraction: 1 });
    expect(night.keyIsSun).toBe(false);
    expect(night.keyI).toBeGreaterThan(0.2);
    expect(night.hemiI).toBeGreaterThan(0.8);
    expect(night.lights).toBe(1);
    expect(night.stars).toBeGreaterThan(0.3);
    const moonless = computeLook(-40, false, { el: -20, fraction: 0 });
    expect(moonless.keyI).toBe(0);
    expect(moonless.stars).toBe(1);
  });
  it("the key light fades to zero before it switches from the sun to the moon (no shadow pop)", () => {
    for (let h = -2.5; h <= -1.5; h += 0.1) {
      const l = computeLook(h, false, { el: 40, fraction: 1 });
      expect(l.keyI).toBeLessThan(0.01);
    }
  });
  it("the look changes continuously with the clock (no step larger than a few % per minute)", () => {
    let prev = computeLook(sunPosition(kigaliTime(NOV15, 0)).el, false, { el: 0, fraction: 0.5 });
    for (let m = 1; m < 1440; m++) {
      const t = kigaliTime(NOV15, m);
      const s = sunPosition(t);
      const l = computeLook(s.el, sunPosition(t + 60_000).el > s.el, { el: 0, fraction: 0.5 });
      expect(Math.abs(l.keyI - prev.keyI)).toBeLessThan(0.15);
      expect(Math.abs(l.hemiI - prev.hemiI)).toBeLessThan(0.05);
      expect(Math.abs(l.lights - prev.lights)).toBeLessThan(0.1);
      expect(Math.abs(l.horizon[0] - prev.horizon[0])).toBeLessThan(0.06);
      prev = l;
    }
    expect(kigaliMinutes(kigaliTime(NOV15, 90))).toBe(90);
  });
});
