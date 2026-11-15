import { describe, expect, it } from "vitest";
import { kigaliMinutes, kigaliTime, moonPosition, skyDir, sunCrossing, sunPosition, worldToEquatorial } from "./solar";

const day = (iso: string) => Date.parse(`${iso}T10:00:00Z`);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/**
 * Musanze (1.5° S, 29.6° E, CAT = UTC+2) sunrise / sunset, Kigali clock. Reference: the NOAA spreadsheet values for
 * the site (the equation of time moves solar noon between 11:46 and 12:16; day length stays 12 h 05–08 min near the
 * equator), cross-checked with published Musanze / Kigali almanacs (Kigali is 0.46° east: ≈ 2 min earlier).
 */
const ALMANAC: [string, string, string][] = [
  // date, sunrise, sunset
  ["2026-02-11", "06:15", "18:23"],
  ["2026-03-20", "06:05", "18:12"],
  ["2026-06-21", "06:01", "18:06"],
  ["2026-09-23", "05:51", "17:58"],
  ["2026-11-03", "05:40", "17:51"],
  ["2026-12-21", "05:54", "18:03"],
];
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

describe("solar position for Musanze", () => {
  for (const [date, rise, set] of ALMANAC) {
    it(`${date}: sunrise ${rise}, sunset ${set} (±10 min)`, () => {
      const r = sunCrossing(day(date), true)!;
      const s = sunCrossing(day(date), false)!;
      expect(Math.abs(r - toMin(rise)), `sunrise ${hm(r)}`).toBeLessThanOrEqual(10);
      expect(Math.abs(s - toMin(set)), `sunset ${hm(s)}`).toBeLessThanOrEqual(10);
    });
  }

  it("the sun rises in the east and sets in the west, nearly vertically (equatorial site)", () => {
    const d = day("2026-11-15");
    const r = sunPosition(kigaliTime(d, sunCrossing(d, true)! + 30));
    const s = sunPosition(kigaliTime(d, sunCrossing(d, false)! - 30));
    expect(r.az).toBeGreaterThan(90);
    expect(r.az).toBeLessThan(125); // November: declination −18°, rising south of east
    expect(s.az).toBeGreaterThan(235);
    expect(s.az).toBeLessThan(270);
    // 30 min after sunrise ≈ 7° up (≈ 0.25° per minute near the equator)
    expect(r.el).toBeGreaterThan(5);
    expect(r.el).toBeLessThan(9);
  });

  it("midday: high sun, to the south in November and to the north in June", () => {
    const nov = sunPosition(kigaliTime(day("2026-11-15"), 11 * 60 + 47));
    expect(nov.el).toBeGreaterThan(70);
    expect(nov.az > 90 && nov.az < 270).toBe(true);
    const jun = sunPosition(kigaliTime(day("2026-06-21"), 12 * 60 + 4));
    expect(jun.el).toBeGreaterThan(62);
    expect(jun.az < 90 || jun.az > 270).toBe(true);
  });

  it("civil twilight lasts ≈ 21–23 min (short at the equator)", () => {
    const d = day("2026-11-15");
    const set = sunCrossing(d, false)!;
    const civil = sunCrossing(d, false, -6)!;
    expect(civil - set).toBeGreaterThan(19);
    expect(civil - set).toBeLessThan(25);
  });

  it("night: the sun is far below the horizon at 21:00 and 03:00", () => {
    const d = day("2026-11-15");
    expect(sunPosition(kigaliTime(d, 21 * 60)).el).toBeLessThan(-40);
    expect(sunPosition(kigaliTime(d, 3 * 60)).el).toBeLessThan(-30);
  });
});

describe("Kigali clock", () => {
  it("is UTC+2 without daylight saving", () => {
    expect(kigaliMinutes(Date.parse("2026-11-15T19:00:00Z"))).toBe(21 * 60);
    expect(kigaliMinutes(Date.parse("2026-06-15T22:30:00Z"))).toBe(30);
  });
  it("kigaliTime builds a time on the Kigali day", () => {
    const t = kigaliTime(Date.parse("2026-11-15T23:30:00Z"), 8 * 60); // 01:30 on the 16th in Kigali
    expect(new Date(t).toISOString()).toBe("2026-11-16T06:00:00.000Z");
  });
});

describe("moon", () => {
  it("full moon 24 Nov 2026, new moon 9 Nov 2026", () => {
    expect(moonPosition(Date.parse("2026-11-24T15:00:00Z")).fraction).toBeGreaterThan(0.97);
    expect(moonPosition(Date.parse("2026-11-09T15:00:00Z")).fraction).toBeLessThan(0.03);
  });
  it("first quarter is waxing and about half lit", () => {
    const m = moonPosition(Date.parse("2026-11-17T12:00:00Z"));
    expect(m.waxing).toBe(true);
    expect(m.fraction).toBeGreaterThan(0.35);
    expect(m.fraction).toBeLessThan(0.65);
  });
  it("a full moon rises around sunset and is high around midnight", () => {
    const d = Date.parse("2026-11-24T12:00:00Z");
    expect(moonPosition(kigaliTime(d, 23 * 60 + 50)).el).toBeGreaterThan(55);
    expect(moonPosition(kigaliTime(d, 12 * 60)).el).toBeLessThan(-50);
  });
});

describe("directions", () => {
  it("sky direction: north = −z, east = +x, up = +y", () => {
    const n = skyDir({ el: 0, az: 0 });
    expect(n[2]).toBeCloseTo(-1);
    const e = skyDir({ el: 0, az: 90 });
    expect(e[0]).toBeCloseTo(1);
    expect(skyDir({ el: 90, az: 0 })[1]).toBeCloseTo(1);
  });
  it("the celestial poles sit 1.5° below the north and above the south horizon", () => {
    const m = worldToEquatorial(Date.now());
    // world direction of the north celestial pole (equatorial z): row 3 of A (column-major: m[2], m[5], m[8])
    const ncp = [m[2]!, m[5]!, m[8]!];
    expect(ncp[1]).toBeCloseTo(Math.sin((-1.5 * Math.PI) / 180), 4);
    expect(ncp[2]).toBeLessThan(-0.99);
  });
});
