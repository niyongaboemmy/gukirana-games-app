// P3-FGT-19B: the v8 fighter bodies for build.mjs (V8=1), from the design's reusable source
// (source-v8/shape-targets.json, docs/design/fighter-v8/SPEC.md §2): MakeHuman macro values, MakeHuman regional and
// athlete-face targets, the design's sculpt layer (anisotropic volumes pushed along the normal, limited by skin
// weight), then a uniform scale to the class stature. The four classes map onto the game's body types: the base body
// of each gender is the lighter class (male welterweight / female lightweight) and the `heavy` morph is the heavier
// one (male heavyweight / female middleweight), so the ring's weight class (buildOf) blends between them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { macroTargets, morph } from "./mh.mjs";
import { vertexNormals } from "./anatomy-bake.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHAPES = JSON.parse(readFileSync(join(HERE, "source-v8/shape-targets.json"), "utf8"));
export const V8_FIGHTERS = SHAPES.fighters;

/**
 * Corrections on top of the design's lists (its own audit, SPEC §2): the heavyweight's head is 3 % small (8.05 heads;
 * the checklist asks 7.3–7.9 for every class) and the welterweight sits on the edge (7.91).
 */
export const V8_EXTRA = {
  mW: [["head/head-scale-vert-incr", 0.06], ["head/head-scale-horiz-incr", 0.02], ["head/head-scale-depth-incr", 0.02]],
  mH: [["head/head-scale-vert-incr", 0.22], ["head/head-scale-horiz-incr", 0.08], ["head/head-scale-depth-incr", 0.08], ["measure/measure-neck-height-incr", 0.25], ["measure/measure-waist-circ-decr", 0.35]],
  fL: [],
  fM: [],
};

/** the game's body types per gender: base + morphs, as v8 class keys and overrides (build.mjs GENDERS_V8) */
export const V8_GENDERS = {
  m: { base: { v8: "mW" }, morphs: { heavy: { v8: "mH" }, slim: { v8: "mW", macro: { weight: 0.3, muscle: 0.9 } } } },
  f: { base: { v8: "fL" }, morphs: { heavy: { v8: "fM" }, slim: { v8: "fL", macro: { weight: 0.34, muscle: 0.84 } } } },
};

/** every target file and weight of a class (macro values overridable) */
export function v8Targets(MH, key, macroOver = {}) {
  const f = V8_FIGHTERS[key];
  if (!f) throw new Error(`v8-body: no fighter ${key}`);
  const list = [...macroTargets(MH, { ...f.macro, ...macroOver })];
  for (const [name, w] of [...f.regional, ...f.face, ...(V8_EXTRA[key] ?? [])]) {
    if (name.startsWith("sym:")) {
      const t = name.slice(4);
      list.push([join(MH, "targets/armslegs", `l-${t}.target`), w], [join(MH, "targets/armslegs", `r-${t}.target`), w]);
    } else list.push([join(MH, "targets", `${name}.target`), w]);
  }
  return list;
}

/**
 * The sculpt layer (SPEC §2): each volume an anisotropic Gaussian (centre / radii in decimetres) whose amplitude moves
 * the vertex along its normal, limited to vertices weighted to the named MakeHuman bones (weight × 1.6, capped at 1).
 * In place on `pdm` (decimetres). `vw[v]` is a Map of MakeHuman bone name → weight.
 */
export function applySculpt(pdm, faces, verts, vw, volumes) {
  const N = vertexNormals(pdm, faces, pdm.length / 3);
  const disp = new Float64Array(pdm.length / 3);
  for (const v of verts) {
    let d = 0;
    for (const m of volumes) {
      const q0 = pdm[v * 3] - m.centreDm[0],
        q1 = pdm[v * 3 + 1] - m.centreDm[1],
        q2 = pdm[v * 3 + 2] - m.centreDm[2];
      const e = (q0 / m.radiiDm[0]) ** 2 + (q1 / m.radiiDm[1]) ** 2 + (q2 / m.radiiDm[2]) ** 2;
      if (e > 9) continue;
      let bw = 0;
      for (const b of m.bones) bw += vw[v]?.get(b) ?? 0;
      d += m.amplitudeDm * Math.exp(-0.5 * e) * Math.min(1, bw * 1.6);
    }
    disp[v] = d;
  }
  for (const v of verts) for (let a = 0; a < 3; a++) pdm[v * 3 + a] += N[v * 3 + a] * disp[v];
}

/** scale (about the origin) so the body's height is the stature: decimetres in and out (build.mjs grounds it) */
export function scaleToStature(pdm, verts, stature, DM = 0.1) {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of verts) {
    lo = Math.min(lo, pdm[v * 3 + 1]);
    hi = Math.max(hi, pdm[v * 3 + 1]);
  }
  const s = stature / ((hi - lo) * DM);
  for (let i = 0; i < pdm.length; i++) pdm[i] *= s;
  return s;
}

/** the full v8 body positions (decimetres) of a class: targets → sculpt → stature */
export function v8Positions({ MH, base, bodyFaces, bodyVerts, vw }, params) {
  const f = V8_FIGHTERS[params.v8];
  const pdm = morph(base, v8Targets(MH, params.v8, params.macro ?? {}));
  applySculpt(pdm, bodyFaces, bodyVerts, vw, f.sculptVolumes);
  scaleToStature(pdm, bodyVerts, f.stature);
  return pdm;
}
