import * as THREE from "three";
import type { GeoBatch } from "./geo";
import { rng } from "./textures";

/**
 * Roofs seen from above (P2-WLD-11): a light-grey single-ply membrane with welded seams, walkway pads and weathering
 * on the flat roofs, plus rooftop kit — HVAC units with fan grilles, a duct run and skylight strips — placed from a
 * seeded hash, so the campus aerial view reads as real buildings instead of untextured slabs. Everything is added to
 * existing merged materials (alu, steel, screenFrame, glass) except the membrane itself: one extra draw call for every
 * roof on the campus. Works in any building's local frame: give it the roof rectangle and the roof height.
 */

/** Membrane texture: 8 m tile, seams every 2 m, faint ponding stains and foot-traffic darkening. */
export function roofMembraneTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = rng(4242);
  g.fillStyle = "#c9cbc8";
  g.fillRect(0, 0, S, S);
  // weathering: soft darker blotches (dust, ponding stains)
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 8 + r() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(90,88,80,${0.05 + r() * 0.08})`);
    grd.addColorStop(1, "rgba(90,88,80,0)");
    g.fillStyle = grd;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) g.fillRect(x - rad + ox, y - rad + oy, rad * 2, rad * 2);
  }
  // welded seams (sheet edges) every 2 m and their slight shadow
  for (let k = 0; k < 4; k++) {
    const y = k * (S / 4);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(0, y, S, 2);
    g.fillStyle = "rgba(60,60,58,0.18)";
    g.fillRect(0, y + 2, S, 1);
  }
  // fine speckle
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 10;
    img.data[i] = img.data[i]! + n;
    img.data[i + 1] = img.data[i + 1]! + n;
    img.data[i + 2] = img.data[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export interface RoofRect {
  x0: number;
  x1: number;
  /** front edge (larger z) */
  z0: number;
  /** back edge (smaller z) */
  z1: number;
  /** top of the roof slab */
  y: number;
}

/** The membrane over a flat roof, inset from the parapet. */
export function roofMembrane(b: GeoBatch, f: RoofRect, inset = 0.25) {
  const w = f.x1 - f.x0 - inset * 2;
  const d = f.z0 - f.z1 - inset * 2;
  if (w <= 0 || d <= 0) return;
  b.box("roofMembrane", w, 0.02, d, { p: [(f.x0 + f.x1) / 2, f.y + 0.01, (f.z0 + f.z1) / 2], tile: 8 });
}

/**
 * Rooftop kit on a flat roof: a row of skylights down the middle, HVAC units on curbs with dark fan grilles, a duct
 * run and a walkway of pads from the roof hatch. `keep` lists rectangles to leave clear (terraces, existing plant).
 */
export function roofKit(b: GeoBatch, f: RoofRect, seed: number, opts: { skylights?: boolean; hvac?: number; keep?: { x0: number; x1: number; z0: number; z1: number }[] } = {}) {
  const r = rng(seed);
  const y = f.y + 0.02;
  const cx = (f.x0 + f.x1) / 2;
  const W = f.x1 - f.x0;
  const D = f.z0 - f.z1;
  const clear = (x: number, z: number, hw: number, hd: number) =>
    x - hw > f.x0 + 1 &&
    x + hw < f.x1 - 1 &&
    z + hd < f.z0 - 1 &&
    z - hd > f.z1 + 1 &&
    !(opts.keep ?? []).some((k) => x + hw > k.x0 && x - hw < k.x1 && z + hd > k.z1 && z - hd < k.z0);
  // skylights: glazed strips with aluminium upstands, along the long axis of the roof
  if (opts.skylights !== false && W > 12 && D > 12) {
    const n = Math.max(2, Math.floor(D / 7));
    for (let i = 0; i < n; i++) {
      const z = f.z1 + ((i + 0.5) / n) * D;
      for (const sx of [-1, 1]) {
        const x = cx + sx * W * 0.18;
        const lw = Math.min(8, W * 0.22);
        if (!clear(x, z, lw / 2 + 0.3, 1.1)) continue;
        b.box("alu", lw + 0.3, 0.35, 1.9, { p: [x, y + 0.17, z] });
        b.box("glass", lw, 0.04, 1.6, { p: [x, y + 0.36, z], tile: 6 });
      }
    }
  }
  // HVAC units on curbs: aluminium casing, two fan grilles on top
  const units = opts.hvac ?? Math.max(1, Math.round((W * D) / 260));
  for (let i = 0, tries = 0; i < units && tries < units * 12; tries++) {
    const w = 2.2 + r() * 1.4;
    const d = 1.4 + r() * 0.6;
    const x = f.x0 + 2 + r() * (W - 4);
    const z = f.z1 + 2 + r() * (D - 4);
    if (!clear(x, z, w / 2 + 0.6, d / 2 + 0.6)) continue;
    i++;
    b.box("steel", w + 0.3, 0.25, d + 0.3, { p: [x, y + 0.12, z] });
    b.box("alu", w, 1.0, d, { p: [x, y + 0.75, z] });
    for (const s of [-1, 1]) b.add("screenFrame", new THREE.CircleGeometry(Math.min(d, w / 2) * 0.38, 16).rotateX(-Math.PI / 2), { p: [x + s * w * 0.24, y + 1.26, z] });
    // duct from the unit into the roof
    b.box("aluBrushed", 0.5, 0.5, 2.2, { p: [x, y + 0.45, z - d / 2 - 1.1] });
  }
  // roof hatch and a walkway of grey pads to the plant
  const hx = f.x0 + 1.6;
  const hz = f.z0 - 1.6;
  if (clear(hx, hz, 0.6, 0.6)) {
    b.box("steel", 1.0, 0.45, 1.0, { p: [hx, y + 0.22, hz] });
    for (let k = 1; k < Math.min(10, D / 1.2 - 2); k++) if (clear(hx, hz - k * 1.2, 0.4, 0.4)) b.box("concreteDark", 0.8, 0.04, 0.8, { p: [hx, y + 0.02, hz - k * 1.2], tile: 2 });
  }
}
