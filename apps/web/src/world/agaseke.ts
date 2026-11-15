import * as THREE from "three";

/**
 * Agaseke (igiseke) — the Rwandan coiled sisal basket with its tall pointed lid, used everywhere the campus shows one
 * (the fountain sculpture, the plaza seen from the halls, the Igisoro Court baskets and woven shades).
 *
 * Shape (from real baskets): a narrow foot widening in a gentle curve to the shoulder; the lid's rolled rim sits just
 * proud of the shoulder; the lid rises as a tall concave cone to a slender point (a little knot on top). Proportions:
 * body ≈ 55 % of the height, widest at the rim, foot ≈ half the rim width.
 *
 * Pattern: undyed cream sisal in fine horizontal coils, black stepped "lightning" motifs on the body, thin black rings
 * on the lid and a black knot at the tip. The texture's v runs with the height (0 = foot, 1 = tip), u around.
 */

/** profile (radius, height) for a basket 1 unit tall; widest radius 0.31 (rim) */
export const AGASEKE_PROFILE: [number, number][] = [
  [0.001, 0],
  [0.15, 0],
  [0.168, 0.02],
  [0.19, 0.07],
  [0.22, 0.16],
  [0.25, 0.27],
  [0.272, 0.38],
  [0.288, 0.47],
  [0.295, 0.53],
  // the lid's rolled rim, just proud of the shoulder
  [0.31, 0.535],
  [0.312, 0.555],
  [0.3, 0.57],
  // the tall concave lid
  [0.265, 0.6],
  [0.215, 0.645],
  [0.165, 0.7],
  [0.12, 0.76],
  [0.085, 0.82],
  [0.056, 0.88],
  [0.034, 0.93],
  [0.022, 0.965],
  [0.016, 0.985],
  [0.001, 1],
];

/** Lathe geometry of an agaseke `height` tall (radius scales with it), v remapped to the height for the pattern. */
export function agasekeGeometry(height: number, segments = 32): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    AGASEKE_PROFILE.map(([r, y]) => new THREE.Vector2(r * height, y * height)),
    segments,
  );
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / height);
  uv.needsUpdate = true;
  return g;
}

const W = 512;
const H = 1024;
const yOf = (v: number) => (1 - v) * H; // canvas row of height fraction v

function drawCoils(g: CanvasRenderingContext2D, dark: number) {
  // fine horizontal coil rows: a light crown and a shadowed seam per row
  const row = 7;
  for (let y = 0; y < H; y += row) {
    g.fillStyle = `rgba(255,255,255,${0.1})`;
    g.fillRect(0, y + 1, W, 2);
    g.fillStyle = `rgba(60,45,25,${dark})`;
    g.fillRect(0, y + row - 1.5, W, 1.5);
  }
}

/** a black stepped "lightning" motif: a short bar, a staircase of offset coils, a bar (repeats around) */
function lightning(g: CanvasRenderingContext2D, x0: number, v0: number, dir: 1 | -1) {
  const row = 7;
  const step = 22;
  const y0 = yOf(v0);
  g.fillStyle = "#1c1a18";
  // lower bar
  g.fillRect(x0 - 70 * dir * (dir > 0 ? 1 : 0), y0, 70, row * 2 - 2);
  // staircase going up and across
  for (let s = 0; s < 6; s++) {
    const x = x0 + s * step * dir;
    const y = y0 - (s + 1) * row * 1.5;
    g.fillRect(dir > 0 ? x : x - step * 1.8, y, step * 1.8, row * 1.5 - 1.5);
  }
  // upper bar
  const xe = x0 + 6 * step * dir;
  g.fillRect(dir > 0 ? xe : xe - 70, y0 - 7 * row * 1.5, 70, row * 2 - 2);
}

function paint(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ece5d3";
  g.fillRect(0, 0, W, H);
  drawCoils(g, 0.2);
  // body: two rows of lightning motifs, three around, the upper row offset by half a repeat
  for (let k = 0; k < 3; k++) {
    lightning(g, (k * W) / 3 + 30, 0.13, 1);
    lightning(g, (k * W) / 3 + W / 6 + 30, 0.33, 1);
  }
  // a black band under the shoulder and the lid rim's black edge
  g.fillStyle = "#1c1a18";
  g.fillRect(0, yOf(0.5), W, 8);
  g.fillRect(0, yOf(0.47), W, 4);
  // lid: two thin black rings low on the lid, two near the tip, and the black knot
  for (const v of [0.61, 0.63, 0.86, 0.875]) g.fillRect(0, yOf(v), W, 5);
  g.fillRect(0, 0, W, yOf(0.975));
  // the coils over the black too (the dye is in the sisal, the ridges stay)
  drawCoils(g, 0.25);
  return c;
}

function paintBump(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = H;
  const g = c.getContext("2d")!;
  const row = 7;
  for (let y = 0; y < H; y += row) {
    const gr = g.createLinearGradient(0, y, 0, y + row);
    gr.addColorStop(0, "#606060");
    gr.addColorStop(0.45, "#ffffff");
    gr.addColorStop(1, "#303030");
    g.fillStyle = gr;
    g.fillRect(0, y, 64, row);
  }
  return c;
}

let tex: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null;
/** the woven pattern (sRGB) and its coil bump map, built once */
export function agasekeTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (tex) return tex;
  const map = new THREE.CanvasTexture(paint());
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(paintBump());
  bump.wrapS = THREE.RepeatWrapping;
  bump.anisotropy = 4;
  tex = { map, bump };
  return tex;
}
