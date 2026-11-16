#!/usr/bin/env node
// P3-FGT-19B: the anthropometric audit (measure.mjs) and the per-fighter triangle count, run on a SHIPPED boxer GLB
// (no MakeHuman checkout needed), so the fighter-v8 harness can score any build — v7 today, v8 once it lands.
//
//   node apps/web/scripts/boxer/measure-glb.mjs apps/web/public/assets/characters/boxer-m.glb [more.glb …]
//
// Prints one JSON line per file: { file, proportions: measureBody(…), triangles: { total, byMesh } }.
import { measureBody } from "./measure.mjs";
import { fighterTriangles, readBoxerGlb } from "./glb-read.mjs";

/** measure a read GLB's body mesh in the bind pose (base body type) */
export function measureGlb(glb, { morph = null } = {}) {
  const body0 = glb.meshes.get("body");
  if (!body0) throw new Error("measure-glb: no `body` mesh");
  // a body type at full weight (P3-FGT-19B: the v8 GLB's `heavy` morph is the heavier weight class)
  const d = morph ? body0.morphs?.[morph] : null;
  if (morph && !d) throw new Error(`measure-glb: no morph ${morph}`);
  const body = d ? { ...body0, P: Float32Array.from(body0.P, (v, i) => v + d[i]) } : body0;
  const bm = morph ? glb.extras.boneMorph?.[morph] : null;
  const index = new Map(glb.joints.map((j, k) => [j.name, k]));
  const bp = (name) => {
    const k = index.get(name);
    if (k === undefined) throw new Error(`measure-glb: no joint ${name}`);
    const p = glb.joints[k].pos;
    return bm?.[k] ? [p[0] + bm[k][0], p[1] + bm[k][1], p[2] + bm[k][2]] : p;
  };
  const used = new Set(body.index);
  const wOf = (i, name) => {
    const k = index.get(name);
    if (k === undefined) return 0;
    let w = 0;
    for (let q = 0; q < 4; q++) if (body.J[i * 4 + q] === k) w += body.W[i * 4 + q];
    return w;
  };
  return measureBody({ P: body.P, bodyV: used, bp, wOf });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) {
    const glb = readBoxerGlb(file);
    console.log(JSON.stringify({ file, proportions: measureGlb(glb), triangles: fighterTriangles(glb) }));
  }
}
