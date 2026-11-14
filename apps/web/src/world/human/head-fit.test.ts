import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BAND,
  bandY,
  clippedLength,
  fadeAmount,
  HAT_CLEARANCE,
  SHELL,
  shellLength,
  skullAzimuth,
} from "./head-fit";
import {
  EAR_LANDMARKS,
  SKULL_FITS,
  skullDir,
  skullNormal,
  skullPoint,
  skullStandoff,
  templateRadius,
} from "./skull";
import { isBrimUV } from "./hair";
import { HAIR_STYLES, OUTFITS, type BodyType, type HeadwearKind } from "../outfits";

const BODIES: BodyType[] = ["masculine", "feminine", "neutral"];
const HATS = Object.keys(BAND) as Exclude<HeadwearKind, "none">[];

describe("skull template (P2-AVA-10)", () => {
  it("has a plausible radius everywhere (8 – 17 cm from the skull centre)", () => {
    for (let el = -0.8; el <= 1.57; el += 0.1)
      for (let az = 0; az < Math.PI * 2; az += 0.2) {
        const r = templateRadius(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
        expect(r).toBeGreaterThan(0.075);
        expect(r).toBeLessThan(0.175);
      }
  });

  it("puts every body's skull top 9 – 15 cm above the eyes and the back of the head behind the ears", () => {
    for (const b of BODIES) {
      const top = skullPoint(b, new THREE.Vector3(0, 1, 0), new THREE.Vector3());
      expect(top.y).toBeGreaterThan(0.09);
      expect(top.y).toBeLessThan(0.15);
      const back = skullPoint(b, new THREE.Vector3(0, 0.2, -1).normalize(), new THREE.Vector3());
      expect(back.z).toBeLessThan(EAR_LANDMARKS[b].earBack);
    }
  });

  it("measures stand-off along the ray: on the surface 0, outside positive, inside negative", () => {
    const d = new THREE.Vector3(0.3, 0.8, -0.4).normalize();
    for (const b of BODIES) {
      const p = skullPoint(b, d, new THREE.Vector3());
      expect(Math.abs(skullStandoff(b, p))).toBeLessThan(1e-4);
      const c = new THREE.Vector3(...SKULL_FITS[b].c);
      const out = p.clone().sub(c).multiplyScalar(1.1).add(c);
      expect(skullStandoff(b, out)).toBeGreaterThan(0.005);
      expect(skullStandoff(b, p.clone().sub(c).multiplyScalar(0.9).add(c))).toBeLessThan(-0.005);
      expect(skullDir(b, p, new THREE.Vector3()).dot(d)).toBeGreaterThan(0.999);
      expect(skullNormal(b, d, new THREE.Vector3()).dot(d)).toBeGreaterThan(0.3);
    }
  });
});

describe("headwear placement (P2-AVA-10)", () => {
  it("keeps the band above the ears on the sides, above the brows at the front, lower at the back", () => {
    for (const b of BODIES)
      for (const k of HATS) {
        const front = bandY(k, b, 0);
        const side = bandY(k, b, Math.PI / 2);
        const back = bandY(k, b, Math.PI);
        // brows sit ~2–3.5 cm above the eyes: the band clears them
        expect(front).toBeGreaterThan(0.038);
        // ears outside the band
        expect(side).toBeGreaterThan(EAR_LANDMARKS[b].earTop + 0.008);
        expect(back).toBeLessThan(front);
        // symmetric left / right
        expect(bandY(k, b, -Math.PI / 2)).toBeCloseTo(side, 6);
      }
  });

  it("gives volume styles more room under a hat than close crops, and a bald head none", () => {
    expect(HAT_CLEARANCE.afro).toBeGreaterThan(HAT_CLEARANCE.short);
    expect(HAT_CLEARANCE.locs).toBeGreaterThan(HAT_CLEARANCE.fade);
    expect(HAT_CLEARANCE.bald).toBeLessThan(0);
    for (const h of HAIR_STYLES) expect(typeof HAT_CLEARANCE[h.id]).toBe("number");
  });

  it("presses close hair down under the band but leaves it below the band", () => {
    const z = -0.06;
    const topY = 0.11;
    const lowY = -0.04;
    for (const b of BODIES) {
      expect(clippedLength("short", "cap", b, 0, topY, z)).toBeLessThanOrEqual(HAT_CLEARANCE.short);
      expect(clippedLength("short", "cap", b, 0.07, lowY, -0.1)).toBeCloseTo(
        shellLength("short", 0.07, lowY, -0.1),
        6,
      );
      expect(clippedLength("short", "none", b, 0, topY, z)).toBe(shellLength("short", 0, topY, z));
    }
    expect(skullAzimuth("masculine", 0.05, SKULL_FITS.masculine.c[2])).toBeCloseTo(Math.PI / 2, 6);
  });

  it("every headwear item has a fitted model kind", () => {
    for (const o of OUTFITS.filter((x) => x.slot === "headwear" && x.kind !== "none"))
      expect(HATS).toContain(o.kind);
  });
});

describe("hair lengths (P2-AVA-10)", () => {
  it("fades from skin-short on the sides / nape to full length on top; the front hairline keeps its length", () => {
    expect(fadeAmount(0.08, 0.0, -0.09)).toBeGreaterThan(0.8);
    expect(fadeAmount(0, 0.12, -0.08)).toBeLessThan(0.05);
    expect(fadeAmount(0, 0.06, 0.0)).toBe(0);
    expect(shellLength("fade", 0.08, 0.0, -0.09)).toBeLessThan(0.0015);
    expect(shellLength("fade", 0, 0.12, -0.08)).toBeGreaterThan(0.006);
    // a low fade keeps more hair over the ears than a mid fade
    expect(shellLength("lowfade", 0.08, 0.015, -0.09)).toBeGreaterThan(
      shellLength("fade", 0.08, 0.015, -0.09),
    );
  });

  it("has a shell (or a reason not to) for every style; close crops stay within a centimetre", () => {
    for (const h of HAIR_STYLES) {
      expect(h.id in SHELL).toBe(true);
      for (const [x, y, z] of [
        [0, 0.12, -0.08],
        [0.08, 0.0, -0.09],
        [0, -0.04, -0.17],
      ] as const) {
        const l = shellLength(h.id, x, y, z);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThan(0.01);
      }
    }
    expect(SHELL.bald).toBeNull();
  });

  it("recognises the neutral head's baked brim islands", () => {
    expect(isBrimUV(0.1, 0.1)).toBe(true);
    expect(isBrimUV(0.9, 0.2)).toBe(true);
    expect(isBrimUV(0.5, 0.1)).toBe(false);
    expect(isBrimUV(0.1, 0.4)).toBe(false);
  });
});
