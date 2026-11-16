#!/usr/bin/env node
// Boxer body build (P3-FGT-13, docs/FIGHT-REALISM-V3.md §3): a dedicated athletic body for the ring people, built
// from the MakeHuman 1.x CC0 assets (base mesh, macro targets, default skeleton + weights) and garments generated
// from the body itself (vest, trunks, boots, gloves, headgear, hand wraps; referee shirt, bow tie, trousers, shoes;
// staff polo; a short hair cap). Output: apps/web/public/assets/characters/boxer-{m,f}.glb.
//
//   MH_DIR=/path/to/makehuman/makehuman/data node apps/web/scripts/boxer/build.mjs
//
// MH_DIR is a checkout of https://github.com/makehumancommunity/makehuman (data/3dobjs, data/rigs,
// data/targets/macrodetails). Licences: docs/ASSET-LICENSES.md (MakeHuman assets CC0 1.0).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jointPos, macroTargets, morph, readObj, readProxy, readSkeleton, readTarget } from "./mh.mjs";
import { writeGlb } from "./glb.mjs";
import { shoulderShare, weightBytes } from "./skin-math.mjs";
import { buildGlove, headgearSeam, headgearThickness } from "./kit-shapes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../public/assets/characters");
const MH = process.env.MH_DIR;
if (!MH) throw new Error("set MH_DIR to makehuman/makehuman/data");

/* ------------------------------------------------------------ material slots (shader palette, boxer-material.ts) ------------------------------------------------------------ */
export const MAT = {
  skin: 0,
  vest: 1,
  vestTrim: 2,
  trunks: 3,
  trunksTrim: 4,
  boot: 5,
  sole: 6,
  lace: 7,
  glove: 8,
  gloveTarget: 9,
  gloveCuff: 10,
  headgear: 11,
  headgearTrim: 12,
  wrap: 13,
  shirt: 14,
  trousers: 15,
  shoe: 16,
  bowtie: 17,
  polo: 18,
  hair: 19,
  eye: 20,
  lash: 21,
  teeth: 22,
  sock: 23,
  belt: 24,
};
/** body cover bits: a body face whose three corners are covered by the worn outfit is not drawn */
const COVER = { vest: 1, trunks: 2, boots: 4, gloves: 8, headgear: 16, shirt: 32, trousers: 64, shoes: 128, hair: 256 };

/* ------------------------------------------------------------ small vector maths ------------------------------------------------------------ */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------ the skeleton: MakeHuman default → Bip01 names (rig.ts) ------------------------------------------------------------ */
const SIDES = [
  ["L", ".L"],
  ["R", ".R"],
];
/** [final name, parent, MakeHuman bones merged into it (the first one gives the joint position)] */
function finalBones() {
  const b = [
    ["Bip01", null, ["root"]],
    // P3-FGT-14: the spine pivots sit where the rig's reference body (Rocketbox) has them — Spine at the lower back,
    // Spine1 at the bottom of the ribs, Spine2 at the upper chest (≈ 11 cm under the shoulder joints). With MakeHuman's
    // spine02 as the chest pivot (25 cm under the shoulders) every lean / turn of the authored poses swung the shoulders
    // ~15 cm further forward than on the reference body: the guard folded the arms shut and the elbows flared out at
    // shoulder height (docs/FIGHT-REALISM-V4.md §1).
    ["Bip01_Pelvis", "Bip01", ["root", "pelvis.L", "pelvis.R", "spine05"]],
    ["Bip01_Spine", "Bip01_Pelvis", ["spine04", "spine03"]],
    ["Bip01_Spine1", "Bip01_Spine", ["spine02"]],
    ["Bip01_Spine2", "Bip01_Spine1", ["spine01", "breast.L", "breast.R"]],
    ["Bip01_Neck", "Bip01_Spine2", ["neck01", "neck02", "neck03"]],
    ["Bip01_Head", "Bip01_Neck", ["head"]],
    ["Bip01_Jaw", "Bip01_Head", ["jaw", "special04", "tongue00", "tongue01", "tongue02", "tongue03", "tongue04", "tongue05.L", "tongue05.R", "tongue06.L", "tongue06.R", "tongue07.L", "tongue07.R", "oris05", "oris06", "oris06.L", "oris06.R", "oris07.L", "oris07.R"]],
  ];
  for (const [S, s] of SIDES) {
    b.push(
      [`Bip01_${S}_Eye`, "Bip01_Head", [`eye${s}`]],
      [`Bip01_${S}_UpperLid`, "Bip01_Head", [`orbicularis03${s}`]],
      [`Bip01_${S}_LowerLid`, "Bip01_Head", [`orbicularis04${s}`]],
      [`Bip01_${S}_Brow`, "Bip01_Head", [`oculi01${s}`, `oculi02${s}`]],
      [`Bip01_${S}_MouthCorner`, "Bip01_Head", [`risorius03${s}`, `risorius02${s}`]],
      // P3-FGT-14: the clavicles hang from the NECK, as in the reference (3ds Max biped / Rocketbox) rig the boxing
      // poses were authored on: the rig turns the neck part-way back towards the opponent (between the chest and the
      // head aim), and the shoulders follow it. Under Spine2 they took the full chest turn: the lead shoulder sat
      // ~14 cm further forward than authored, inside the guard.
      [`Bip01_${S}_Clavicle`, "Bip01_Neck", [`clavicle${s}`, `shoulder01${s}`]],
      [`Bip01_${S}_UpperArm`, `Bip01_${S}_Clavicle`, [`upperarm01${s}`, `upperarm02${s}`]],
      [`Bip01_${S}_Forearm`, `Bip01_${S}_UpperArm`, [`lowerarm01${s}`, `lowerarm02${s}`]],
      [`Bip01_${S}_Hand`, `Bip01_${S}_Forearm`, [`wrist${s}`, `metacarpal1${s}`, `metacarpal2${s}`, `metacarpal3${s}`, `metacarpal4${s}`]],
    );
    for (let f = 0; f < 5; f++) {
      const mh = (k) => `finger${f + 1}-${k}${s}`;
      b.push([`Bip01_${S}_Finger${f}`, `Bip01_${S}_Hand`, [mh(1)]], [`Bip01_${S}_Finger${f}1`, `Bip01_${S}_Finger${f}`, [mh(2)]], [`Bip01_${S}_Finger${f}2`, `Bip01_${S}_Finger${f}1`, [mh(3)]]);
    }
    b.push(
      [`Bip01_${S}_Thigh`, "Bip01_Pelvis", [`upperleg01${s}`, `upperleg02${s}`]],
      [`Bip01_${S}_Calf`, `Bip01_${S}_Thigh`, [`lowerleg01${s}`, `lowerleg02${s}`]],
      [`Bip01_${S}_Foot`, `Bip01_${S}_Calf`, [`foot${s}`]],
      [`Bip01_${S}_Toe0`, `Bip01_${S}_Foot`, [1, 2, 3, 4, 5].flatMap((t) => [1, 2, 3].map((k) => `toe${t}-${k}${s}`))],
    );
  }
  // P3-FGT-14 helper bones (appended: the other indices stay put), driven by boxer/helpers.ts after the rig:
  //  - ShoulderHelper: at the shoulder joint under the clavicle, turning HALF as far as the upper arm. The deltoid /
  //    armpit skin that MakeHuman weights to the clavicle and the chest (≈ 30 % next to the joint) rides on it, so the
  //    shoulder rounds over a raised arm instead of staying behind as a lump with a crease;
  //  - ForearmTwist: on the forearm axis, rolling HALF the hand's twist (MakeHuman's lowerarm02 weights): no candy
  //    wrapper at the wrist when the fist turns over.
  for (const [S, s] of SIDES) b.push([`Bip01_${S}_ShoulderHelper`, `Bip01_${S}_Clavicle`, [`upperarm01${s}`]], [`Bip01_${S}_ForearmTwist`, `Bip01_${S}_Forearm`, [`lowerarm02${s}`]]);
  return b;
}

/* ------------------------------------------------------------ one body variant ------------------------------------------------------------ */
const DM = 0.1; // MakeHuman decimetres → metres
const { pos: BASE, groups: GROUPS, uv: UVS, uvGroups: UVG } = readObj(join(MH, "3dobjs/base.obj"));
/**
 * P3-FGT-15: MakeHuman's own UV layout (the skin textures are painted on it). glTF's v runs top-down: v' = 1 − v.
 * A body vertex on a UV seam has several uv corners (the body mesh splits it); garments cut from the body take the
 * first uv each vertex has (their fabric detail is tiled, a seam there is invisible).
 */
const uvAt = (k) => (k >= 0 ? [UVS[k * 2], 1 - UVS[k * 2 + 1]] : [0, 0]);
const VUV = new Int32Array(BASE.length / 3).fill(-1);
for (const [g, faces] of GROUPS) {
  const uvf = UVG.get(g);
  faces.forEach((f, n) => f.forEach((v, c) => {
    if (VUV[v] < 0) VUV[v] = uvf[n][c];
  }));
}
/** triangles with their uv corners: [[v, uv], [v, uv], [v, uv]] */
const triUV = (group) => {
  const faces = GROUPS.get(group);
  const uvf = UVG.get(group);
  return faces.flatMap((f, n) => {
    const u = uvf[n];
    const c = f.map((v, k) => [v, u[k]]);
    return c.length === 4 ? [[c[0], c[1], c[2]], [c[0], c[2], c[3]]] : [c.slice(0, 3)];
  });
};
const { skel, weights: MHW } = readSkeleton(MH);
const FB = finalBones();
const FINAL_INDEX = new Map(FB.map((b, i) => [b[0], i]));
/** MakeHuman bone → final bone index (bones not listed go to their nearest listed ancestor) */
const MH_TO_FINAL = new Map();
for (const [i, b] of FB.entries()) for (const m of b[2]) if (!MH_TO_FINAL.has(m)) MH_TO_FINAL.set(m, i);
const finalOf = (mh) => {
  let k = mh;
  while (k) {
    if (MH_TO_FINAL.has(k)) return MH_TO_FINAL.get(k);
    k = skel.bones[k]?.parent;
  }
  return FINAL_INDEX.get("Bip01_Pelvis");
};
/** per vertex: up to 4 [final bone, weight] */
const NV = BASE.length / 3;
const top4 = (m) => {
  const top = [...m.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = top.reduce((n, [, w]) => n + w, 0) || 1;
  return top.length ? top.map(([b, w]) => [b, w / s]) : [[FINAL_INDEX.get("Bip01_Head"), 1]];
};
const mergedWeights = (map) => {
  const acc = Array.from({ length: NV }, () => new Map());
  for (const [bone, list] of Object.entries(MHW)) {
    const f = map(bone);
    for (const [vi, w] of list) acc[vi].set(f, (acc[vi].get(f) ?? 0) + w);
  }
  return acc;
};
/** the merged MakeHuman weights: the garment / region tests are designed on these */
const VW0 = mergedWeights(finalOf).map(top4);
/** the skin weights: lowerarm02 on the forearm twist helper, the shoulder corrective (see shoulderCorrective) */
const VW = shoulderCorrective(mergedWeights((mh) => (/^lowerarm02\./.test(mh) ? FINAL_INDEX.get(`Bip01_${mh.endsWith(".L") ? "L" : "R"}_ForearmTwist`) : finalOf(mh)))).map(top4);
const wOf = (vi, name) => {
  const k = FINAL_INDEX.get(name);
  for (const [b, w] of VW0[vi]) if (b === k) return w;
  return 0;
};

/**
 * The shoulder corrective (P3-FGT-14): round each shoulder joint, the share of a vertex's weight on the bones that do
 * NOT follow the arm (clavicle, chest, neck) moves onto the ShoulderHelper (half the arm's turn), fully on the deltoid
 * cap / armpit next to the joint, fading out 9 → 15 cm from it and medially towards the collarbone / pec. Exported
 * maths in skin-math.mjs (tested).
 */
function shoulderCorrective(acc) {
  for (const [S, s] of SIDES) {
    const j = jointPos(skel, BASE, `upperarm01${s}____head`).map((v) => v * DM);
    const helper = FINAL_INDEX.get(`Bip01_${S}_ShoulderHelper`);
    const statics = ["Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", `Bip01_${S}_Clavicle`].map((n) => FINAL_INDEX.get(n));
    const arm = [`Bip01_${S}_UpperArm`].map((n) => FINAL_INDEX.get(n));
    for (let i = 0; i < NV; i++) {
      const p = [BASE[i * 3] * DM, BASE[i * 3 + 1] * DM, BASE[i * 3 + 2] * DM];
      if (Math.sign(p[0]) !== Math.sign(j[0])) continue;
      const m = acc[i];
      const f = shoulderShare(p, j, arm.reduce((n, b) => n + (m.get(b) ?? 0), 0) / ([...m.values()].reduce((n, w) => n + w, 0) || 1));
      if (f <= 0) continue;
      let moved = 0;
      for (const b of statics) {
        const w = m.get(b) ?? 0;
        if (!w) continue;
        m.set(b, w * (1 - f));
        moved += w * f;
      }
      if (moved > 0) m.set(helper, (m.get(helper) ?? 0) + moved);
    }
  }
  return acc;
}
const wSum = (vi, names) => names.reduce((n, x) => n + wOf(vi, x), 0);

function variantPositions(params) {
  const p = morph(BASE, macroTargets(MH, params));
  return p;
}

/** everything the garments need, from one morphed position set (metres, feet on y = 0) */
function geometry(pdm) {
  // ground: the lowest body vertex
  const body = GROUPS.get("body");
  let minY = Infinity;
  for (const f of body) for (const i of f) minY = Math.min(minY, pdm[i * 3 + 1]);
  const P = new Float64Array(pdm.length);
  for (let i = 0; i < NV; i++) {
    P[i * 3] = pdm[i * 3] * DM;
    P[i * 3 + 1] = (pdm[i * 3 + 1] - minY) * DM;
    P[i * 3 + 2] = pdm[i * 3 + 2] * DM;
  }
  const J = (name) => {
    const j = jointPos(skel, pdm, name);
    return [j[0] * DM, (j[1] - minY) * DM, j[2] * DM];
  };
  const bones = FB.map(([name, parent, mh]) => ({ name, parent: parent ? FINAL_INDEX.get(parent) : -1, pos: J(`${mh[0]}____head`) }));
  // the toe bone sits at the ball of the foot (the foot's tail)
  for (const [S, s] of SIDES) bones[FINAL_INDEX.get(`Bip01_${S}_Toe0`)].pos = J(`foot${s}____tail`);
  return { P, bones, J, minY, torso: torsoSlices(P, bones) };
}

/**
 * The torso's volume for the rig's arm keep-out (P3-FGT-14): horizontal slices from the lower back to the neck base,
 * each [y, half width, front z, back z] relative to the Spine2 joint (bind pose), from the body vertices that belong to
 * the trunk (arm / head weight under 10 %). The boxing poses were authored on a slimmer reference body: without it the
 * rear forearm of the guard sat inside this chest.
 */
function torsoSlices(P, bones) {
  const at = (n) => bones[FINAL_INDEX.get(n)].pos;
  const s2 = at("Bip01_Spine2");
  const y0 = at("Bip01_Spine")[1];
  const y1 = at("Bip01_Neck")[1];
  const STEP = (y1 - y0) / 12;
  const n = 13;
  const rows = Array.from({ length: n }, (_, k) => ({ y: y0 + ((y1 - y0) * k) / (n - 1), hw: 0, zf: -1, zb: 1 }));
  const body = new Set();
  for (const f of GROUPS.get("body")) for (const i of f) body.add(i);
  const trunk = (i) => {
    let off = 0;
    for (const [b, w] of VW0[i]) {
      const name = FB[b][0];
      if (/(Arm|Forearm|Hand|Finger|Head|Jaw|Eye|Lid|Brow|Mouth)/.test(name)) off += w;
    }
    return off < 0.1;
  };
  for (const i of body) {
    if (!trunk(i)) continue;
    const y = P[i * 3 + 1];
    const k = Math.round(((y - y0) / (y1 - y0)) * (n - 1));
    if (k < 0 || k >= n || Math.abs(rows[k].y - y) > STEP * 0.6) continue;
    const r = rows[k];
    r.hw = Math.max(r.hw, Math.abs(P[i * 3]));
    r.zf = Math.max(r.zf, P[i * 3 + 2]);
    r.zb = Math.min(r.zb, P[i * 3 + 2]);
  }
  // (a row the trunk vertices miss, up in the neck, takes the row under it)
  for (let k = 1; k < n; k++) if (rows[k].hw === 0) Object.assign(rows[k], { hw: rows[k - 1].hw, zf: rows[k - 1].zf, zb: rows[k - 1].zb });
  return rows.map((r) => [r.y - s2[1], r.hw, r.zf - s2[2], r.zb - s2[2]].map((v) => +v.toFixed(4)));
}

/** smooth vertex normals over a face list (area-weighted) */
function normalsOf(P, faces) {
  const N = new Float64Array(P.length);
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k],
        b = f[(k + 1) % f.length],
        c = f[(k + f.length - 1) % f.length];
      const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
      const n = cross(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pa), sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], pa));
      N[a * 3] += n[0];
      N[a * 3 + 1] += n[1];
      N[a * 3 + 2] += n[2];
    }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l;
    N[i + 1] /= l;
    N[i + 2] /= l;
  }
  return N;
}
const tri = (faces) => faces.flatMap((f) => (f.length === 4 ? [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] : [f.slice(0, 3)]));

/**
 * A mesh under construction: positions (metres), normals, skin (4 joints / weights), material slot, extra attributes.
 */
class MeshBuilder {
  constructor(name) {
    this.name = name;
    this.p = [];
    this.n = [];
    this.j = [];
    this.w = [];
    this.mat = [];
    this.ao = [];
    this.zone = [];
    this.cover = [];
    this.paint = [];
    this.src = [];
    this.uv = [];
    this.idx = [];
  }
  vert(p, n, skin, mat, extra = {}) {
    this.p.push(...p);
    this.n.push(...n);
    const s = skin.slice(0, 4);
    while (s.length < 4) s.push([0, 0]);
    this.j.push(...s.map((x) => x[0]));
    this.w.push(...s.map((x) => x[1]));
    this.mat.push(mat);
    this.ao.push(extra.ao ?? 0.5);
    this.zone.push(extra.zone ?? 0);
    this.cover.push(extra.cover ?? 0);
    this.paint.push(...(extra.paint ?? [0, 0, 0, 0]));
    this.src.push(extra.src ?? -1);
    this.uv.push(...(extra.uv ?? [0, 0]));
    return this.p.length / 3 - 1;
  }
  face(a, b, c) {
    this.idx.push(a, b, c);
  }
  get count() {
    return this.p.length / 3;
  }
  build(withBody) {
    const u8n = (arr) => Uint8Array.from(arr, (x) => Math.round(clamp(x, 0, 1) * 255));
    // weights as normalised bytes: each vertex's four re-summed to exactly 255
    const w8 = new Uint8Array(this.w.length);
    for (let v = 0; v < this.w.length; v += 4) w8.set(weightBytes([0, 1, 2, 3].map((k) => this.w[v + k])), v);
    const attrs = {
      POSITION: { data: Float32Array.from(this.p), size: 3 },
      NORMAL: { data: Float32Array.from(this.n), size: 3 },
      JOINTS_0: { data: Uint8Array.from(this.j), size: 4 },
      WEIGHTS_0: { data: w8, size: 4, norm: true },
      _MAT: { data: Uint8Array.from(this.mat), size: 1 },
      _AO: { data: u8n(this.ao), size: 1, norm: true },
      // P3-FGT-15: uv as normalised uint16 (KHR_mesh_quantization)
      TEXCOORD_0: { data: Uint16Array.from(this.uv, (x) => Math.round(clamp(x, 0, 1) * 65535)), size: 2, norm: true },
    };
    if (withBody) {
      attrs._ZONE = { data: Uint8Array.from(this.zone), size: 1 };
      attrs._COVER = { data: Uint16Array.from(this.cover), size: 1 };
      attrs._PAINT = { data: u8n(this.paint), size: 4, norm: true };
    }
    return { name: this.name, attrs, index: Uint32Array.from(this.idx) };
  }
}

/* ------------------------------------------------------------ the build of one gender ------------------------------------------------------------ */
function buildVariant(key, base, morphParams) {
  const pdm = variantPositions(base);
  const G = geometry(pdm);
  const { P, bones, J } = G;
  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const bodyFaces = GROUPS.get("body");
  const bodyV = new Set(bodyFaces.flat());
  const bodyTris = tri(bodyFaces);
  const NB = normalsOf(P, bodyFaces);
  const Nv = (i) => [NB[i * 3], NB[i * 3 + 1], NB[i * 3 + 2]];
  const bp = (name) => bones[FINAL_INDEX.get(name)].pos;

  // landmarks
  const pelvis = bp("Bip01_Pelvis");
  // (garment landmarks keep the MakeHuman spine joints they were designed on, whatever the rig pivots are)
  const spine = J("spine05____head");
  const spine2 = J("spine02____head");
  const neck = bp("Bip01_Neck");
  const head = bp("Bip01_Head");
  const shoulderL = bp("Bip01_L_UpperArm");
  const elbowL = bp("Bip01_L_Forearm");
  const kneeL = bp("Bip01_L_Calf");
  const ankleL = bp("Bip01_L_Foot");
  const thighL = bp("Bip01_L_Thigh");
  const eyeL = bp("Bip01_L_Eye");
  const eyeR = bp("Bip01_R_Eye");
  const jaw = bp("Bip01_Jaw");
  const mouthL = bp("Bip01_L_MouthCorner");
  const mouthR = bp("Bip01_R_MouthCorner");
  const waistY = lerp(pelvis[1], spine[1], 0.85);
  const bootTopY = ankleL[1] + 0.13;
  const neckBaseY = neck[1];
  const shoulderX = Math.abs(shoulderL[0]);
  const headC = [head[0], (head[1] + eyeL[1]) / 2 + 0.01, head[2] - 0.01];

  // neighbours (cavity)
  const neigh = Array.from({ length: NV }, () => new Set());
  for (const f of bodyFaces)
    for (let k = 0; k < f.length; k++) {
      neigh[f[k]].add(f[(k + 1) % f.length]);
      neigh[f[k]].add(f[(k + f.length - 1) % f.length]);
    }
  /** Laplacian-smoothed positions over a face set (cloth bridging, the shoe last) */
  const smoothed = (faces, iters, region = () => true, taubin = true) => {
    const nb = new Map();
    for (const f of faces)
      for (let k = 0; k < f.length; k++) {
        const a = f[k];
        if (!nb.has(a)) nb.set(a, new Set());
        nb.get(a).add(f[(k + 1) % f.length]);
        nb.get(a).add(f[(k + f.length - 1) % f.length]);
      }
    let cur = Float64Array.from(P);
    for (let it = 0; it < iters * 2; it++) {
      const lam = it % 2 === 0 || !taubin ? 0.5 : -0.53;
      const nx = Float64Array.from(cur);
      for (const [a, ns] of nb) {
        if (!region(a)) continue;
        let x = 0, y = 0, z = 0;
        for (const q of ns) {
          x += cur[q * 3];
          y += cur[q * 3 + 1];
          z += cur[q * 3 + 2];
        }
        const n = ns.size;
        nx[a * 3] = cur[a * 3] + lam * (x / n - cur[a * 3]);
        nx[a * 3 + 1] = cur[a * 3 + 1] + lam * (y / n - cur[a * 3 + 1]);
        nx[a * 3 + 2] = cur[a * 3 + 2] + lam * (z / n - cur[a * 3 + 2]);
      }
      cur = nx;
    }
    return cur;
  };
  const SMOOTH_BODY = smoothed(bodyFaces, 40);
  // P3-FGT-15: what cloth rests on — a plain (shrinking) Laplacian smoothing: nipples, the navel and muscle edges gone
  // (Taubin smoothing above keeps features of that size)
  const CLOTH_BODY = smoothed(bodyFaces, 10, () => true, false);
  {
    // the nipples are broad cones on the MakeHuman base (≈ 2 cm proud of the chest, several cm wide: smoothing keeps
    // them); what cloth rests on has them pressed flat, so no garment ever shows them (the body under the cloth is not
    // drawn). Per side: the most forward chest vertex, its base from the ring 4.5–6 cm round it, a smooth cone removed.
    for (const s of [1, -1]) {
      const cand = [...bodyV].filter((i) => P[i * 3] * s > 0.05 && P[i * 3] * s < 0.15 && P[i * 3 + 1] > spine2[1] - 0.08 && P[i * 3 + 1] < spine2[1] + 0.14);
      if (!cand.length) continue;
      const tip = cand.reduce((a, b) => (P[b * 3 + 2] > P[a * 3 + 2] ? b : a));
      const T = [P[tip * 3], P[tip * 3 + 1], P[tip * 3 + 2]];
      const dist = (i) => Math.hypot(P[i * 3] - T[0], P[i * 3 + 1] - T[1]);
      const ring = cand.filter((i) => dist(i) > 0.045 && dist(i) < 0.06 && P[i * 3 + 2] > T[2] - 0.08).map((i) => CLOTH_BODY[i * 3 + 2]).sort((a, b) => a - b);
      const base = ring.length ? ring[Math.floor(ring.length * 0.75)] : T[2] - 0.015;
      for (const i of bodyV) {
        const d = dist(i);
        if (d >= 0.045 || P[i * 3 + 2] < T[2] - 0.08) continue;
        const k = (1 - d / 0.045) ** 2;
        const z = CLOTH_BODY[i * 3 + 2];
        const flatZ = base + (z - base) * 0.25;
        if (z > flatZ) CLOTH_BODY[i * 3 + 2] = lerp(z, flatZ, Math.min(1, k * 1.6));
      }
    }
  }
  const SMOOTH_TIGHTS = smoothed(GROUPS.get("helper-tights"), 16);
  let SM_SRC = SMOOTH_BODY;
  const SM = (i) => [SM_SRC[i * 3], SM_SRC[i * 3 + 1], SM_SRC[i * 3 + 2]];
  const cavity = new Float64Array(NV);
  for (const f of bodyFaces)
    for (const i of f) {
      if (cavity[i]) continue;
      const ns = [...neigh[i]];
      let c = [0, 0, 0];
      let e = 0;
      for (const n of ns) {
        c = add(c, V(n));
        e += len(sub(V(n), V(i)));
      }
      c = scl(c, 1 / ns.length);
      e /= ns.length;
      // > 0 concave (a groove between muscles), < 0 convex
      cavity[i] = clamp(0.5 + (dot(Nv(i), sub(c, V(i))) / (e || 1)) * 2.2, 0, 1) || 0.5;
    }

  // region tests on body vertices
  const isHand = (i) => wSum(i, ["Bip01_L_Hand", "Bip01_R_Hand"]) + FB.reduce((n, b, k) => n + (b[0].includes("Finger") ? wOf(i, b[0]) : 0), 0) > 0.5;
  const isArm = (i) => wSum(i, ["Bip01_L_UpperArm", "Bip01_R_UpperArm", "Bip01_L_Forearm", "Bip01_R_Forearm"]) > 0.3 || isHand(i);
  const isHeadV = (i) => wSum(i, ["Bip01_Head", "Bip01_Jaw", "Bip01_L_Eye", "Bip01_R_Eye", "Bip01_L_UpperLid", "Bip01_R_UpperLid", "Bip01_L_LowerLid", "Bip01_R_LowerLid", "Bip01_L_Brow", "Bip01_R_Brow", "Bip01_L_MouthCorner", "Bip01_R_MouthCorner"]) > 0.5;
  const footW = (i) => wSum(i, ["Bip01_L_Foot", "Bip01_R_Foot", "Bip01_L_Toe0", "Bip01_R_Toe0"]);

  /* ---------------- garment fields (metres; > 0 inside the garment) ---------------- */
  const armW = (i) => wSum(i, ["Bip01_L_UpperArm", "Bip01_R_UpperArm", "Bip01_L_Forearm", "Bip01_R_Forearm", "Bip01_L_Hand", "Bip01_R_Hand"]) + FB.reduce((n, b) => n + (b[0].includes("Finger") ? wOf(i, b[0]) : 0), 0);
  const headW = (i) => (isHeadV(i) ? 1 : 0) + wOf(i, "Bip01_Neck") * 0.5;
  // the neck's front at its base (vest neckline / collar)
  const backZ = (p) => smooth(spine2[2] - 0.02, spine2[2] + 0.04, p[2]);
  const vestField = (i) => {
    const p = V(i);
    const side = p[0] >= 0 ? 1 : -1;
    const fBottom = p[1] - (waistY - 0.075);
    // P3-FGT-14: a singlet's arm hole, cut geometrically: an ellipse seen from the side round the shoulder joint (top
    // over the shoulder, bottom ~8 cm under the armpit fold) on the part of the body lateral of the strap line. It
    // used to be "arm weight > 22 %", which on MakeHuman's weights opened the vest down the ribs and across the pec,
    // jagged at the shoulder: the arm read as coming out of a hole in the person, not out of the shoulder.
    void side;
    // (sized by the shoulder width: the feminine body is ~20 % narrower and the strap must survive between the
    // neckline and the hole)
    const sc = shoulderX / 0.207;
    // P3-FGT-16: a smaller hole (bottom ~4 cm under the armpit fold, was ~9: the vest opened down the ribs) and a
    // wider strap
    const ey = (p[1] - (shoulderL[1] - 0.035 * sc)) / (0.12 * sc);
    const ez = (p[2] - (shoulderL[2] - 0.012)) / (0.08 * sc);
    // (a rounded intersection: the strap's corner at the top of the hole is a curve, not a point)
    const a = (1 - Math.hypot(ey, ez)) * 0.08 * sc,
      b = Math.abs(p[0]) - (shoulderX - 0.078 * sc);
    const k = 0.025,
      hk = Math.max(k - Math.abs(a - b), 0) / k;
    const inHole = Math.min(a, b) - hk * hk * k * 0.25;
    const fArm = -inHole;
    const fArmW = (0.6 - armW(i)) * 0.3;
    // neckline: a round scoop at the front, higher at the back
    const ax = Math.abs(p[0]) / sc;
    const front = backZ(p);
    const lineY = lerp(neckBaseY - 0.012 + 0.016 * smooth(0.03, 0.09, ax), neckBaseY - 0.06 * sc + 0.045 * sc * smooth(0.02, 0.1, ax), front);
    const fNeck = lineY - p[1];
    return Math.min(fBottom, fArm, fArmW, fNeck, 0.3 - headW(i));
  };
  const shirtField = (i) => {
    const p = V(i);
    const side = p[0] >= 0 ? 1 : -1;
    // (tucked in: it ends just under the trousers' waistband)
    const fBottom = p[1] - (waistY - 0.035);
    const sh = [shoulderL[0] * side, shoulderL[1], shoulderL[2]];
    const el = [elbowL[0] * side, elbowL[1], elbowL[2]];
    const axis = norm(sub(el, sh));
    const along = dot(sub(p, sh), axis);
    const upper = wSum(i, ["Bip01_L_UpperArm", "Bip01_R_UpperArm"]);
    const fSleeve = upper > 0.25 ? len(sub(el, sh)) * 0.5 - along : 1;
    const fFore = (0.15 - (armW(i) - upper)) * 0.3;
    const front = backZ(p);
    const fNeck = lerp(neckBaseY + 0.03, neckBaseY - 0.012, front) + 0.03 * smooth(0.035, 0.085, Math.abs(p[0])) - p[1];
    return Math.min(fBottom, fSleeve, fFore, fNeck, 0.3 - headW(i));
  };
  const hemY = kneeL[1] + 0.105;
  const trunksTop = waistY + 0.012;
  const bootTop = (i) => (wSum(i, ["Bip01_L_Calf", "Bip01_R_Calf", "Bip01_L_Foot", "Bip01_R_Foot", "Bip01_L_Toe0", "Bip01_R_Toe0"]) > 0.3 ? bootTopY - V(i)[1] : -1);
  const shoeTop = (i) => (footW(i) > 0.3 || wOf(i, "Bip01_L_Calf") + wOf(i, "Bip01_R_Calf") > 0.5 ? ankleL[1] + 0.035 - V(i)[1] : -1);
  const wrapBand = (i) => (wSum(i, ["Bip01_L_Forearm", "Bip01_R_Forearm"]) > 0.5 ? Math.min(distToWrist(i) - 0.04, 0.085 - distToWrist(i)) : -1);

  /* ---------------- per body vertex: covers, zones, face paint ---------------- */
  const vestCover = (i) => {
    const p = V(i);
    if (isArm(i) || isHeadV(i)) return false;
    if (p[1] < waistY - 0.07 || p[1] > neckBaseY + 0.005) return false;
    // arm holes: a scoop round the shoulder joint
    const ax = Math.abs(p[0]);
    if (ax > shoulderX * 0.62 && p[1] > shoulderL[1] - 0.16) return false;
    // neckline: a round scoop at the front, higher at the back
    const front = p[2] > spine2[2];
    if (front && p[1] > neckBaseY - 0.085 + 0.05 * smooth(0.02, 0.09, ax)) return false;
    if (!front && p[1] > neckBaseY - 0.025 + 0.02 * smooth(0.03, 0.09, ax)) return false;
    return true;
  };
  const shirtCover = (i) => {
    const p = V(i);
    if (isHand(i) || isHeadV(i)) return false;
    if (p[1] < waistY - 0.09 || p[1] > neckBaseY + 0.02) return false;
    // short sleeves: the upper arm down to a third of the way to the elbow
    const side = p[0] > 0 ? 1 : -1;
    const sh = [shoulderL[0] * side, shoulderL[1], shoulderL[2]];
    const el = [elbowL[0] * side, elbowL[1], elbowL[2]];
    const armAxis = norm(sub(el, sh));
    const along = dot(sub(p, sh), armAxis);
    if (wSum(i, ["Bip01_L_Forearm", "Bip01_R_Forearm"]) > 0.2) return false;
    if (wSum(i, ["Bip01_L_UpperArm", "Bip01_R_UpperArm"]) > 0.25 && along > len(sub(el, sh)) * 0.45) return false;
    const front = p[2] > spine2[2];
    if (front && p[1] > neckBaseY - 0.03) return false;
    return true;
  };
  const glovesCover = (i) => isHand(i) || (wSum(i, ["Bip01_L_Forearm", "Bip01_R_Forearm"]) > 0.4 && distToWrist(i) < 0.06);
  const distToWrist = (i) => {
    const p = V(i);
    const wl = bp("Bip01_L_Hand");
    const wr = bp("Bip01_R_Hand");
    return Math.min(len(sub(p, wl)), len(sub(p, wr)));
  };
  const bootsCover = (i) => footW(i) > 0.4 || (V(i)[1] < bootTopY && wSum(i, ["Bip01_L_Calf", "Bip01_R_Calf"]) > 0.3);
  const shoesCover = (i) => footW(i) > 0.5 && V(i)[1] < ankleL[1] + 0.02;
  const headLocal = (i) => sub(V(i), headC);
  const faceOval = (p) => {
    // the open face of the headgear (and the face, for paint): an oval round the eyes, nose, mouth and chin, front
    const q = sub(p, headC);
    if (q[2] < 0.035) return false;
    const yTop = eyeL[1] - headC[1] + 0.035;
    const yBot = jaw[1] - headC[1] - 0.075;
    const halfW = 0.058 + 0.012 * smooth(yBot, yTop, q[1]);
    return q[1] < yTop && q[1] > yBot && Math.abs(q[0]) < halfW;
  };
  const headgearCover = (i) => isHeadV(i) && !faceOval(V(i)) && V(i)[1] > jaw[1] - 0.02;
  /**
   * P3-FGT-15: the scalp as a smooth field (m, > 0 on the hair): above a hairline that runs from the forehead (a soft
   * M, temples a little higher) over the tops of the ears (sideburns down to the ear's middle) to the nape. The hair
   * is a thin shell on the scalp itself (a close crop: the skull's own shape, never a helmet); its edge fades out
   * strand by strand in the shader (the _ao channel carries the distance from the hairline).
   */
  const hairField = (i) => {
    if (!isHeadV(i) && wOf(i, "Bip01_Neck") < 0.3) return -0.05;
    const q = headLocal(i);
    const eyeY = eyeL[1] - headC[1];
    const ax = Math.abs(q[0]);
    // front hairline (forehead), temples, sides over the ears, nape
    const front = smooth(-0.045, 0.035, q[2]);
    const temple = 0.012 * smooth(0.015, 0.045, ax) * front;
    const lineFront = eyeY + 0.056 + temple + 0.004 * Math.cos(q[0] * 60);
    const lineSide = eyeY + 0.035 - 0.02 * smooth(0.0, -0.06, q[2]) * smooth(0.04, 0.07, ax);
    const lineBack = eyeY - 0.075;
    const back = smooth(-0.02, -0.08, q[2]);
    const line = lerp(lerp(lineSide, lineFront, front), lineBack, back);
    // the ears stay bare: the hair goes round them
    const earGap = ax > 0.062 && q[2] < 0.02 && q[2] > -0.05 && q[1] < eyeY + 0.03 ? -0.01 : 0;
    return q[1] - line + earGap;
  };
  // (the scalp stays drawn under the hair: the skin texture carries a close-cropped natural hairline, the shell adds
  // the strands over it, partly open)
  const hairCover = () => false;
  const trunksCoverBody = (i) => {
    const p = V(i);
    return p[1] < waistY + 0.005 && p[1] > kneeL[1] + 0.09 && !isArm(i);
  };
  const trousersCoverBody = (i) => {
    const p = V(i);
    return p[1] < waistY + 0.01 && p[1] > ankleL[1] + 0.03 && !isArm(i) && footW(i) < 0.3;
  };
  const coverBits = (i) =>
    (vestField(i) > 0.022 ? COVER.vest : 0) |
    (trunksCoverBody(i) ? COVER.trunks : 0) |
    (bootTop(i) > 0.012 ? COVER.boots : 0) |
    (glovesCover(i) ? COVER.gloves : 0) |
    (headgearCover(i) ? COVER.headgear : 0) |
    (shirtField(i) > 0.022 ? COVER.shirt : 0) |
    (trousersCoverBody(i) ? COVER.trousers : 0) |
    (shoeTop(i) > 0.012 ? COVER.shoes : 0) |
    (hairCover(i) ? COVER.hair : 0);
  const zoneOf = (i) => {
    if (isHeadV(i)) return 1;
    const p = V(i);
    if (!isArm(i) && p[1] > pelvis[1] + 0.03 && p[1] < spine2[1] + 0.06) return 2;
    return 0;
  };
  const paintOf = (i) => {
    if (!isHeadV(i)) return [0, 0, 0, 0];
    const p = V(i);
    const n = Nv(i);
    // lips: an ellipse between the mouth corners, a little below the corner line
    const mc = scl(add(mouthL, mouthR), 0.5);
    const hw = Math.abs(mouthL[0] - mouthR[0]) / 2 + 0.004;
    const q = sub(p, mc);
    const lipE = (q[0] / hw) ** 2 + ((q[1] + 0.001) / 0.0115) ** 2;
    const lips = n[2] > 0.2 && q[2] > -0.02 ? 1 - smooth(0.55, 1.05, lipE) : 0;
    // brows: an arch above each eye
    let brow = 0;
    let socket = 0;
    for (const e of [eyeL, eyeR]) {
      const d = sub(p, e);
      const ax = d[0] * Math.sign(e[0] || 1);
      const arch = 0.021 + 0.006 * Math.cos((ax / 0.03) * 1.3);
      const by = d[1] - arch;
      if (n[2] > 0.1 && d[2] > -0.005 && ax > -0.018 && ax < 0.034) brow = Math.max(brow, (1 - smooth(0.0035, 0.0075, Math.abs(by))) * (1 - smooth(0.024, 0.036, ax)) * smooth(-0.02, -0.01, ax));
      const r = Math.hypot(d[0], d[1]);
      if (d[2] > -0.012) socket = Math.max(socket, smooth(0.01, 0.016, r) * (1 - smooth(0.016, 0.026, r)));
    }
    // beard / stubble region (jaw, chin, upper lip) for a masculine face
    const jl = sub(p, jaw);
    const beard = n[2] > -0.6 && p[1] < mc[1] + 0.012 && p[1] > jaw[1] - 0.09 && jl[2] > -0.03 && lips < 0.3 ? smooth(0.0, 0.02, p[1] - (jaw[1] - 0.085)) : 0;
    return [lips, brow, socket, beard];
  };

  /* ---------------- the body mesh: skin + eyes + lashes + teeth ---------------- */
  const bodyMesh = new MeshBuilder("body");
  const map = new Map();
  const addBodyVert = (i, mat, N, uvk = VUV[i]) => {
    const key = `${mat}:${i}:${uvk}`;
    if (map.has(key)) return map.get(key);
    const k = bodyMesh.vert(V(i), N ? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] : Nv(i), VW[i], mat, mat === MAT.skin ? { ao: cavity[i], zone: zoneOf(i), cover: coverBits(i), paint: paintOf(i), src: i, uv: uvAt(uvk) } : { src: i, uv: uvAt(uvk) });
    map.set(key, k);
    return k;
  };
  // P3-FGT-15: each skin corner keeps its own uv (seams split the vertex): the skin texture maps exactly
  for (const [a, b, c] of triUV("body")) bodyMesh.face(addBodyVert(a[0], MAT.skin, null, a[1]), addBodyVert(b[0], MAT.skin, null, b[1]), addBodyVert(c[0], MAT.skin, null, c[1]));
  // P3-FGT-15: the eyes are MakeHuman's high-poly eye proxy (CC0: a cornea-shaped ball with its own uv onto the eye
  // texture: sclera with veins, a photographic iris, the pupil), fitted to this body like MakeHuman fits it (.mhclo);
  // skinned through the base vertices it hangs from (the eye bones: gaze and blinks keep working)
  {
    const px = readProxy(join(MH, "eyes/high-poly/high-poly.mhclo"));
    const obj = readObj(join(MH, "eyes/high-poly", px.objFile));
    const fitted = px.fit(pdm);
    const EP = new Float64Array(fitted.length);
    for (let i = 0; i < px.refs.length; i++) {
      EP[i * 3] = fitted[i * 3] * DM;
      EP[i * 3 + 1] = (fitted[i * 3 + 1] - G.minY) * DM;
      EP[i * 3 + 2] = fitted[i * 3 + 2] * DM;
    }
    const faces = [...obj.groups.values()].flat();
    const uvf = [...obj.uvGroups.values()].flat();
    const EN = normalsOf(EP, faces);
    const skinOf = (r) => {
      const wm = new Map();
      r.v.forEach((v, k) => {
        for (const [b, w] of VW[v]) wm.set(b, (wm.get(b) ?? 0) + w * r.w[k]);
      });
      const top = [...wm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const s = top.reduce((q, [, w]) => q + w, 0) || 1;
      return top.map(([b, w]) => [b, w / s]);
    };
    const ids = new Map();
    const ev = (v, t) => {
      const key = `${v}:${t}`;
      if (!ids.has(key)) ids.set(key, bodyMesh.vert([EP[v * 3], EP[v * 3 + 1], EP[v * 3 + 2]], [EN[v * 3], EN[v * 3 + 1], EN[v * 3 + 2]], skinOf(px.refs[v]), MAT.eye, { uv: t >= 0 ? [obj.uv[t * 2], 1 - obj.uv[t * 2 + 1]] : [0, 0] }));
      return ids.get(key);
    };
    faces.forEach((f, n) => {
      // (the proxy's clear cornea layer maps onto the texture's corner disc: left out, the wet cornea is the shader's
      // clearcoat on the eyeball)
      if (uvf[n].every((t) => obj.uv[t * 2] > 0.84 && obj.uv[t * 2 + 1] < 0.16)) return;
      const c = f.map((v, k) => ev(v, uvf[n][k]));
      bodyMesh.face(c[0], c[1], c[2]);
      if (c.length === 4) bodyMesh.face(c[0], c[2], c[3]);
    });
  }
  for (const [g, mat] of [
    ["helper-l-eyelashes-1", MAT.lash],
    ["helper-r-eyelashes-1", MAT.lash],
    ["helper-l-eyelashes-2", MAT.lash],
    ["helper-r-eyelashes-2", MAT.lash],
    ["helper-upper-teeth", MAT.teeth],
    ["helper-lower-teeth", MAT.teeth],
  ]) {
    const faces = GROUPS.get(g);
    const N = normalsOf(P, faces);
    for (const [a, b, c] of tri(faces)) bodyMesh.face(addBodyVert(a, mat, N), addBodyVert(b, mat, N), addBodyVert(c, mat, N));
  }

  /* ---------------- shells: a garment cut from the body by a smooth field (> 0 inside), offset along the normals ---------------- */
  /**
   * The garment's edge follows the field's zero line exactly: triangles across it are clipped (new vertices on the
   * edges, their position / normal / skin / morph interpolated), so arm holes, necklines and hems are smooth curves,
   * not the body's quad steps. Boundary edges get a hem strip (cloth thickness) in the rim slot.
   */
  function shell(name, faces, normals, { field, offset, mat, hem = 0.006, rimMat, surface = null, bridge = 0, flatAo = false, edgeAo = 0, remap = null }) {
    const SV = (i) => (surface ? [surface[i * 3], surface[i * 3 + 1], surface[i * 3 + 2]] : V(i));
    const m = new MeshBuilder(name);
    const f = new Map();
    const F = (i) => {
      if (!f.has(i)) f.set(i, field(i));
      return f.get(i);
    };
    // generalised vertex: [a, b, t] (a point on the edge a→b at t; a === b for a body vertex)
    const gv = new Map();
    const at = (a, b, t, inside) => {
      const key = `${a < b ? a : b}_${a < b ? b : a}_${inside ? 1 : 0}`;
      if (gv.has(key)) return gv.get(key);
      const lerp3 = (A, B) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
      const na = [normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2]];
      const nb = [normals[b * 3], normals[b * 3 + 1], normals[b * 3 + 2]];
      const n = norm(lerp3(na, nb));
      const br = (q) => (bridge > 0 ? Math.max(0, dot(sub(SM(q), V(q)), [normals[q * 3], normals[q * 3 + 1], normals[q * 3 + 2]])) * bridge : 0);
      const o = offset(a) + br(a) + (offset(b) + br(b) - offset(a) - br(a)) * t - (inside ? hem : 0);
      const pos = add(lerp3(SV(a), SV(b)), scl(n, o));
      // skin: blend the two vertices' weights
      const wm = new Map();
      const put = (bone, w) => {
        if (!remap) return void wm.set(bone, (wm.get(bone) ?? 0) + w);
        for (const [b2, k] of remap(bone)) wm.set(b2, (wm.get(b2) ?? 0) + w * k);
      };
      for (const [bone, w] of VW[a]) put(bone, w * (1 - t));
      for (const [bone, w] of VW[b]) put(bone, w * t);
      const top = [...wm.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const sum = top.reduce((q, [, w]) => q + w, 0) || 1;
      const slot = typeof mat === "function" ? mat(t < 0.5 ? a : b) : mat;
      // (P3-FGT-15: draped cloth does not take the body's muscle cavities: flatAo)
      const ua = uvAt(VUV[a]),
        ub = uvAt(VUV[b]);
      const ao = edgeAo > 0 ? clamp((F(a) * (1 - t) + F(b) * t) / edgeAo, 0, 1) : flatAo ? 0.5 : 0.5 + 0.35 * (((cavity[a] || 0.5) * (1 - t) + (cavity[b] || 0.5) * t) - 0.5);
      const k = m.vert(pos, n, top.map(([bone, w]) => [bone, w / sum]), slot, { ao, src: [a, b, t], uv: [ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t] });
      gv.set(key, k);
      return k;
    };
    const V0 = (i, inside = false) => at(i, i, 0, inside);
    const E = (a, b, inside = false) => {
      const fa = F(a),
        fb = F(b);
      const t = fa / (fa - fb);
      return at(a, b, t, inside);
    };
    const out = [];
    for (const [a, b, c] of tri(faces)) {
      const ins = [F(a) > 0, F(b) > 0, F(c) > 0];
      const n = ins.filter(Boolean).length;
      if (n === 0) continue;
      if (n === 3) {
        out.push([
          [a, a],
          [b, b],
          [c, c],
        ]);
        continue;
      }
      // rotate so the odd one out is first
      let r = [a, b, c];
      let k = ins;
      for (let s2 = 0; s2 < 3; s2++) {
        const odd = n === 1 ? k[0] && !k[1] && !k[2] : !k[0] && k[1] && k[2];
        if (odd) break;
        r = [r[1], r[2], r[0]];
        k = [k[1], k[2], k[0]];
      }
      const [x, y, z] = r;
      if (n === 1)
        out.push([
          [x, x],
          [x, y],
          [x, z],
        ]);
      else {
        out.push([
          [y, y],
          [z, z],
          [z, x],
        ]);
        out.push([
          [y, y],
          [z, x],
          [y, x],
        ]);
      }
    }
    const id = (e, inside = false) => (e[0] === e[1] ? V0(e[0], inside) : E(e[0], e[1], inside));
    const edges = new Map();
    const ekey = (e) => (e[0] === e[1] ? `v${e[0]}` : `e${Math.min(e[0], e[1])}_${Math.max(e[0], e[1])}`);
    for (const t3 of out) {
      m.face(id(t3[0]), id(t3[1]), id(t3[2]));
      for (const [u, v] of [
        [t3[0], t3[1]],
        [t3[1], t3[2]],
        [t3[2], t3[0]],
      ]) {
        const ku = ekey(u),
          kv = ekey(v);
        const k2 = ku < kv ? `${ku}|${kv}` : `${kv}|${ku}`;
        const e = edges.get(k2);
        if (e) e.n++;
        else edges.set(k2, { u, v, n: 1 });
      }
    }
    // the hem: a strip from the outer surface down towards the body along every boundary edge
    for (const { u, v, n } of edges.values()) {
      if (n !== 1) continue;
      const ou = id(u),
        ov = id(v);
      const iu = id(u, true),
        iv = id(v, true);
      const pu = [m.p[ou * 3], m.p[ou * 3 + 1], m.p[ou * 3 + 2]];
      const pv = [m.p[ov * 3], m.p[ov * 3 + 1], m.p[ov * 3 + 2]];
      const nu = [m.n[ou * 3], m.n[ou * 3 + 1], m.n[ou * 3 + 2]];
      const dir = norm(cross(sub(pv, pu), nu));
      const skinOf = (k) => [0, 1, 2, 3].map((q) => [m.j[k * 4 + q], m.w[k * 4 + q]]);
      const slot = rimMat ?? m.mat[ou];
      const uvOf = (k) => [m.uv[k * 2], m.uv[k * 2 + 1]];
      const r1 = m.vert(pu, dir, skinOf(ou), slot, { src: m.src[ou], uv: uvOf(ou) });
      const r2 = m.vert(pv, dir, skinOf(ov), slot, { src: m.src[ov], uv: uvOf(ov) });
      const i1 = m.vert([m.p[iu * 3], m.p[iu * 3 + 1], m.p[iu * 3 + 2]], dir, skinOf(iu), slot, { src: m.src[iu], uv: uvOf(iu) });
      const i2 = m.vert([m.p[iv * 3], m.p[iv * 3 + 1], m.p[iv * 3 + 2]], dir, skinOf(iv), slot, { src: m.src[iv], uv: uvOf(iv) });
      m.face(r1, i1, r2);
      m.face(r2, i1, i2);
    }
    return m;
  }

  // vest: corner colour, white binding at the neckline and arm holes (the hem strips).
  // P3-FGT-15: a real garment, not paint on the body: the vest hangs as cloth from the chest / bust / shoulder blades
  // (the same drape as the referee's shirt: the cleavage and the spine groove bridged, small bumps never printed, at
  // most 0.22 m/m of inward slope below the chest) and is tucked under the trunks' waistband; 5 mm of fabric over the
  // drape, a 6 mm binding at the neckline and arm holes (the hem strips give the cloth its edge thickness).
  const DRAPE_SURF = drapeShirt();
  const NDr = normalsOf(DRAPE_SURF, bodyFaces);
  // (the base mesh is very dense round the nipples and the navel: after the drape those little faces can fold over,
  // and their face normals would print a dot on the cloth; cloth normals are smoothed over the neighbourhood)
  for (let it = 0; it < 8; it++) {
    const prev = Float64Array.from(NDr);
    for (const i of bodyV) {
      let x = prev[i * 3],
        y = prev[i * 3 + 1],
        z = prev[i * 3 + 2];
      for (const q of neigh[i]) {
        x += prev[q * 3];
        y += prev[q * 3 + 1];
        z += prev[q * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      NDr[i * 3] = x / l;
      NDr[i * 3 + 1] = y / l;
      NDr[i * 3 + 2] = z / l;
    }
  }
  // P3-FGT-16: a vest rides on the arm only through the shoulder: the upper arm's share of the skin under it goes to the
  // shoulder helper (half the arm's turn) and the clavicle — in a raised guard the strap and the arm hole's edge used to
  // stretch with the whole arm into a torn-looking zig-zag; with no follow at all the deltoid came up through the strap
  const ARMISH = new Map();
  for (const S of ["L", "R"]) {
    const clav = FINAL_INDEX.get(`Bip01_${S}_Clavicle`);
    const helper = FINAL_INDEX.get(`Bip01_${S}_ShoulderHelper`);
    for (const n of ["UpperArm", "Forearm", "ForearmTwist", "Hand"])
      ARMISH.set(FINAL_INDEX.get(`Bip01_${S}_${n}`), [
        [helper, 0.65],
        [clav, 0.35],
      ]);
  }
  const vestRemap = (bone) => ARMISH.get(bone) ?? [[bone, 1]];
  const vest = shell("kit_vest", bodyFaces, NDr, {
    remap: vestRemap,
    field: vestField,
    // (a little more over the arm holes and straps, where the shoulder works under the cloth)
    offset: (i) => 0.005 + 0.004 * smooth(0.2, 0.5, armW(i) + wSum(i, ["Bip01_L_Clavicle", "Bip01_R_Clavicle"])),
    surface: DRAPE_SURF,
    flatAo: true,
    mat: MAT.vest,
    hem: 0.006,
    rimMat: MAT.vestTrim,
  });

  // trunks: the tights helper above the knee, loose and flared towards the hem (waistband / stripe: the shader)
  const tightsFaces = GROUPS.get("helper-tights");
  const NT = normalsOf(P, tightsFaces);
  SM_SRC = SMOOTH_TIGHTS;
  const trunks = shell("kit_trunks", tightsFaces, NT, {
    bridge: 1,
    field: (i) => Math.min(V(i)[1] - hemY, trunksTop - V(i)[1]),
    flatAo: true,
    offset: (i) => 0.013 + 0.03 * smooth(thighL[1] - 0.05, hemY, V(i)[1]) + 0.004 * smooth(trunksTop - 0.07, trunksTop - 0.05, V(i)[1]),
    mat: MAT.trunks,
    hem: 0.006,
    rimMat: MAT.trunks,
  });

  // boots: high (mid-calf), black, white laces down the front, a light sole
  /**
   * The foot of a boot / shoe: a loft of rounded sections along the foot (heel → toe), fitted to the foot's own
   * length, width and instep height, with a flat sole, a toe spring and closed ends; skinned to the foot / toe bones.
   */
  function loftFoot(m, S, { top, slot, soleSlot, laceSlot, pad }) {
    const A = bp(`Bip01_${S}_Foot`);
    const T = bp(`Bip01_${S}_Toe0`);
    const fwd = norm([T[0] - A[0], 0, T[2] - A[2]]);
    const side = norm(cross([0, 1, 0], fwd));
    const sideOf = (q) => (S === "L" ? q[0] > 0 : q[0] < 0);
    const footB = FINAL_INDEX.get(`Bip01_${S}_Foot`);
    const toeB = FINAL_INDEX.get(`Bip01_${S}_Toe0`);
    const loc = (k) => {
      const d = sub(V(k), A);
      return [dot(d, fwd), dot(d, side), V(k)[1]];
    };
    // the foot's extent per slice along its length
    const NS = 14;
    let u0 = Infinity,
      u1 = -Infinity;
    const fv = [];
    for (let k = 0; k < NV; k++) if (footW(k) > 0.3 && sideOf(V(k)) && V(k)[1] < A[1] + 0.02) fv.push(k);
    for (const k of fv) {
      const [u] = loc(k);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
    }
    const ext = Array.from({ length: NS }, () => ({ vmin: Infinity, vmax: -Infinity, h: 0 }));
    const bin = (u) => clamp(Math.floor(((u - u0) / (u1 - u0)) * NS), 0, NS - 1);
    for (const k of fv) {
      const [u, v, h] = loc(k);
      const e = ext[bin(u)];
      e.vmin = Math.min(e.vmin, v);
      e.vmax = Math.max(e.vmax, v);
      e.h = Math.max(e.h, h);
    }
    for (let b = 0; b < NS; b++) if (!Number.isFinite(ext[b].vmin)) Object.assign(ext[b], ext[Math.max(0, b - 1)]);
    const prof = (u) => {
      const x = clamp(((u - u0) / (u1 - u0)) * NS - 0.5, 0, NS - 1);
      const a = Math.floor(x),
        b = Math.min(NS - 1, a + 1),
        t = x - a;
      const ea = ext[a],
        eb = ext[b];
      return { vc: lerp((ea.vmin + ea.vmax) / 2, (eb.vmin + eb.vmax) / 2, t), w: lerp(ea.vmax - ea.vmin, eb.vmax - eb.vmin, t) / 2, h: lerp(ea.h, eb.h, t) };
    };
    const ballU = dot(sub(T, A), fwd);
    const R = 20;
    const rings = [];
    const US = 18;
    for (let q = 0; q <= US; q++) {
      const uu = (u0 - pad) + ((u1 - u0 + 2 * pad) * q) / US;
      const end = Math.min(q, US - q) / US;
      const cap = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, end * 5)) ** 2));
      const pr = prof(clamp(uu, u0, u1));
      const tip = smooth(u1 - 0.06, u1 + pad, uu);
      const hw = (pr.w * (1 - 0.25 * tip) + pad) * (0.25 + 0.75 * cap);
      const ht = Math.min(top, Math.max(0.03, pr.h + pad)) * (1 - 0.35 * tip);
      const spring = 0.012 * tip;
      const row = [];
      for (let r = 0; r < R; r++) {
        const th = (2 * Math.PI * r) / R;
        const cx = Math.cos(th),
          cy = Math.sin(th);
        // a flattened, slightly boxy section on a flat sole
        const sp = (x, e) => Math.sign(x) * Math.abs(x) ** e;
        const v = pr.vc + hw * sp(cx, 0.8);
        const yy = cy < 0 ? spring * (0.5 + 0.5 * cx * 0) : (ht - 0.004) * sp(cy, 0.85) * (0.3 + 0.7 * cap);
        const h = Math.max(0, cy < 0 ? spring : yy) + (cy < 0 ? 0 : 0.004);
        const pos = add(add(A, add(scl(fwd, uu), scl(side, v))), [0, 0, 0]);
        pos[1] = h + 0.003; // (3 mm off the floor: a sole flush with the canvas z-fights)
        const n = norm(add(scl(side, cx), [0, cy < -0.2 ? -1 : cy, 0]));
        const kToe = smooth(ballU - 0.02, ballU + 0.03, uu);
        const sl = cy < -0.15 ? soleSlot : laceSlot !== null && cy > 0.75 && uu > 0.0 && uu < ballU - 0.01 ? laceSlot : slot;
        row.push(m.vert(pos, n, [[footB, 1 - kToe], [toeB, kToe]], sl, { ao: 0.5 }));
      }
      rings.push(row);
    }
    for (let q = 0; q < US; q++)
      for (let r = 0; r < R; r++) {
        const a0 = rings[q][r],
          a1 = rings[q][(r + 1) % R],
          b0 = rings[q + 1][r],
          b1 = rings[q + 1][(r + 1) % R];
        m.face(a0, a1, b0);
        m.face(a1, b1, b0);
      }
  }
  const bootShaft = (i) => Math.min(bootTop(i), V(i)[1] - (ankleL[1] + 0.012));
  const boots = shell("kit_boots", bodyFaces, NB, {
    field: bootShaft,
    offset: () => 0.007,
    mat: (i) => {
      const p = V(i);
      const n = Nv(i);
      const side = p[0] > 0 ? 1 : -1;
      const ax = bp(side > 0 ? "Bip01_L_Foot" : "Bip01_R_Foot");
      if (n[2] > 0.6 && Math.abs(p[0] - ax[0]) < 0.024) return MAT.lace;
      return MAT.boot;
    },
    hem: 0.005,
    rimMat: MAT.boot,
  });
  for (const S of ["L", "R"]) loftFoot(boots, S, { top: ankleL[1] + 0.04, slot: MAT.boot, soleSlot: MAT.sole, laceSlot: MAT.lace, pad: 0.009 });
  // socks: a short white band folded over the boot top
  const socks = shell("kit_socks", bodyFaces, NB, {
    field: (i) => (wSum(i, ["Bip01_L_Calf", "Bip01_R_Calf"]) > 0.3 ? Math.min(V(i)[1] - (bootTopY - 0.012), bootTopY + 0.026 - V(i)[1]) : -1),
    offset: () => 0.0045,
    mat: MAT.sock,
    hem: 0.003,
  });

  // hand wraps: a white band round the forearm just above the glove cuff
  SM_SRC = SMOOTH_BODY;
  const wraps = shell("kit_wraps", bodyFaces, NB, { field: wrapBand, offset: () => 0.0035, mat: MAT.wrap, hem: 0.0025 });

  // referee / staff: short-sleeved shirt (tucked in), trousers, shoes
  // P3-FGT-14: real cloth volume instead of a 1–3 cm shell that showed every muscle (and the bust) like a bodysuit:
  // the shirt hangs from the chest / bust / shoulder blades straight down to a bloused tuck at the belt, with soft
  // vertical folds; loose short sleeves flaring to the hem; the trousers hang straight from the seat / thighs.
  const SHIRT_SURF = DRAPE_SURF;
  const NS = NDr;
  const shirt = shell("ref_shirt", bodyFaces, NS, {
    field: shirtField,
    offset: (i) => 0.004 + sleeveFlare(i),
    mat: MAT.shirt,
    surface: SHIRT_SURF,
    flatAo: true,
    hem: 0.004,
  });
  const TROUSER_SURF = drapeTrousers(tightsFaces);
  const NTr = normalsOf(TROUSER_SURF, tightsFaces);
  const trousers = shell(
    "ref_trousers",
    tightsFaces,
    NTr,
    {
      field: (i) => Math.min(V(i)[1] - (ankleL[1] + 0.03), waistY + 0.02 - V(i)[1]),
      offset: () => 0.004,
      surface: TROUSER_SURF,
      flatAo: true,
      mat: (i) => (V(i)[1] > waistY - 0.018 ? MAT.belt : MAT.trousers),
      hem: 0.005,
    },
  );

  /** the short sleeve: looser towards its hem (a sleeve stands off the arm, it does not wrap it) */
  function sleeveFlare(i) {
    const upper = wSum(i, ["Bip01_L_UpperArm", "Bip01_R_UpperArm"]);
    if (upper < 0.2) return 0;
    const p = V(i);
    const side = p[0] >= 0 ? 1 : -1;
    const sh = [shoulderL[0] * side, shoulderL[1], shoulderL[2]];
    const el = [elbowL[0] * side, elbowL[1], elbowL[2]];
    const along = dot(sub(p, sh), norm(sub(el, sh))) / len(sub(el, sh));
    return smooth(0.2, 0.5, upper) * (0.008 + 0.022 * smooth(0.05, 0.5, along));
  }

  /**
   * Radial drape round a vertical axis: per height slice and angle round the trunk, the body's outer radius (angular
   * max filter: the cloth bridges the cleavage, the spine groove, the sides of the chest), then from the top down the
   * cloth may only come in towards the body slowly (it hangs from the bust / chest / shoulder blades), and it tucks
   * back in to the belt. Returns the draped positions for every vertex index (others = the body).
   */
  function drapeShirt() {
    const out = Float64Array.from(P);
    const yTop = neckBaseY + 0.02,
      yBot = waistY - 0.12;
    const DY = 0.012,
      NA = 72;
    const rows = Math.ceil((yTop - yBot) / DY) + 1;
    const ri = (y) => clamp(Math.round((yTop - y) / DY), 0, rows - 1);
    const ai = (a) => ((Math.round((a / (2 * Math.PI)) * NA) % NA) + NA) % NA;
    // the trunk vertices (no arm / head), their slice centre (mid depth) and outer radius per angle
    const trunkV = [];
    for (let i = 0; i < NV; i++) {
      if (!bodyV.has(i)) continue;
      const p = V(i);
      if (p[1] < yBot - 0.02 || p[1] > yTop + 0.02) continue;
      if (armW(i) > 0.35 || headW(i) > 0.4) continue;
      trunkV.push(i);
    }
    const zc = new Float64Array(rows);
    {
      const lo = new Float64Array(rows).fill(9),
        hi = new Float64Array(rows).fill(-9);
      for (const i of trunkV) {
        const k = ri(V(i)[1]);
        lo[k] = Math.min(lo[k], V(i)[2]);
        hi[k] = Math.max(hi[k], V(i)[2]);
      }
      for (let k = 0; k < rows; k++) zc[k] = lo[k] < hi[k] ? (lo[k] + hi[k]) / 2 : k ? zc[k - 1] : spine2[2];
      // a smooth axis
      for (let pass = 0; pass < 4; pass++) for (let k = 1; k < rows - 1; k++) zc[k] = (zc[k - 1] + zc[k] * 2 + zc[k + 1]) / 4;
    }
    const R = Array.from({ length: rows }, () => new Float64Array(NA));
    for (const i of trunkV) {
      // (P3-FGT-15: the envelope of the SMOOTHED body + 6 mm: a nipple's tip no longer makes a bump in the cloth)
      const p = V(i);
      const k = ri(p[1]);
      const sx = CLOTH_BODY[i * 3],
        sz = CLOTH_BODY[i * 3 + 2] - zc[k];
      const dz = p[2] - zc[k];
      const a = ai(Math.atan2(p[0], dz));
      R[k][a] = Math.max(R[k][a], Math.hypot(sx, sz) + 0.006);
    }
    // fill empty bins, angular max filter (±4 bins = ±20°) then a blur: a convex-ish envelope
    for (let k = 0; k < rows; k++) {
      const r = R[k];
      for (let pass = 0; pass < NA; pass++) for (let a = 0; a < NA; a++) if (!r[a]) r[a] = Math.max(r[(a + 1) % NA], r[(a + NA - 1) % NA]) * 0.999;
      const mx = r.map((_, a) => Math.max(...[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => r[(a + d + NA) % NA])));
      for (let a = 0; a < NA; a++) r[a] = Math.max(r[a], (mx[(a + NA - 1) % NA] + mx[a] * 2 + mx[(a + 1) % NA]) / 4);
    }
    // the hang: from the top down the radius may shrink by at most 0.22 per unit of height; tucked at the belt
    const H = R.map((r) => Float64Array.from(r));
    for (let k = 1; k < rows; k++) for (let a = 0; a < NA; a++) H[k][a] = Math.max(R[k][a], H[k - 1][a] - 0.22 * DY);
    const tuckY = waistY + 0.01;
    const ease = 0.012;
    const region = [];
    const floor = new Map();
    const folds = new Map();
    for (let i = 0; i < NV; i++) {
      if (!bodyV.has(i)) continue;
      const p = V(i);
      if (p[1] < yBot || p[1] > yTop) continue;
      const k = ri(p[1]);
      const dz = p[2] - zc[k];
      const ang = Math.atan2(p[0], dz);
      const a = ai(ang);
      const own = Math.hypot(p[0], dz);
      // the bloused tuck: back in towards the body over the 9 cm above the belt (2.5 cm of overhang stays above it)
      const t = smooth(tuckY + 0.09, tuckY - 0.005, p[1]);
      const blouse = 0.012 * Math.exp(-(((p[1] - (tuckY + 0.035)) / 0.025) ** 2));
      // soft vertical folds below the chest (stronger towards the tuck), none up on the shoulders
      const fold = (0.006 * Math.sin(ang * 9 + Math.sin(ang * 3) * 1.3) + 0.003 * Math.sin(ang * 17 + p[1] * 30)) * smooth(spine2[1] + 0.08, tuckY + 0.02, p[1]) * (1 - smooth(0.12, 0.4, armW(i)));
      let r = lerp(H[k][a] + ease, own + 0.006, t) + blouse * (1 - t);
      folds.set(i, fold);
      // (never inside the body, but bumps over the smoothed body are bridged: see the floor below)
      const sOwn0 = Math.hypot(CLOTH_BODY[i * 3], CLOTH_BODY[i * 3 + 2] - zc[k]);
      r = Math.max(r, lerp(sOwn0 + 0.012, own + 0.004, t));
      // the arm side of the trunk (armpit, shoulder) and the collar line: back to the body shell
      const w = (1 - smooth(0.12, 0.4, armW(i))) * (1 - smooth(neckBaseY - 0.09, neckBaseY - 0.025, p[1]));
      const rr = lerp(own + 0.008, r, w);
      const f = rr / (own || 1);
      out[i * 3] = p[0] * f;
      out[i * 3 + 1] = p[1];
      out[i * 3 + 2] = zc[k] + dz * f;
      region.push(i);
      // (the floor: over the body by a few mm, and 1.4 cm over its smoothed shape away from the tuck: the cloth bridges
      // small bumps like the nipples instead of printing them)
      const sOwn = Math.hypot(CLOTH_BODY[i * 3], CLOTH_BODY[i * 3 + 2] - zc[k]);
      // (P3-FGT-15: a bump more than 6 mm over that envelope, a nipple, is bridged too: the body under the cloth is not
      // drawn, so nothing pokes through)
      floor.set(i, lerp(sOwn + 0.014, own + 0.004, t));
    }
    // cloth is smooth: relax the draped region (the bins are coarse), never inside the body
    for (let it = 0; it < 8; it++) {
      const prev = Float64Array.from(out);
      for (const i of region) {
        let x = 0,
          z = 0,
          n = 0;
        for (const q of neigh[i]) {
          x += prev[q * 3];
          z += prev[q * 3 + 2];
          n++;
        }
        if (!n) continue;
        out[i * 3] = lerp(prev[i * 3], x / n, 0.6);
        out[i * 3 + 2] = lerp(prev[i * 3 + 2], z / n, 0.6);
        const k = ri(V(i)[1]);
        const dx = out[i * 3],
          dz = out[i * 3 + 2] - zc[k];
        const r = Math.hypot(dx, dz);
        const lo = floor.get(i);
        if (r < lo) {
          out[i * 3] = (dx / (r || 1)) * lo;
          out[i * 3 + 2] = zc[k] + (dz / (r || 1)) * lo;
        }
      }
    }
    // P3-FGT-15: stretched cloth over the chest is smooth: the radius of the front of the trunk is replaced by a blurred
    // (row × angle) field of itself, never lower than it was by more than 4 mm (the body under it is not drawn) — no
    // small bump of the body (a nipple, a muscle edge) shows in the cloth
    {
      const NB2 = 72;
      const sum = Array.from({ length: rows }, () => new Float64Array(NB2));
      const cnt = Array.from({ length: rows }, () => new Float64Array(NB2));
      const polar = new Map();
      for (const i of region) {
        const k = ri(V(i)[1]);
        const dx = out[i * 3],
          dz = out[i * 3 + 2] - zc[k];
        const ang = Math.atan2(dx, dz);
        const b = ((Math.round((ang / (2 * Math.PI)) * NB2) % NB2) + NB2) % NB2;
        const r = Math.hypot(dx, dz);
        polar.set(i, [k, b, r, ang]);
        // (the trunk only: the hanging arms and the head are not cloth on the chest)
        if (armW(i) > 0.1 || headW(i) > 0.2) continue;
        sum[k][b] += r;
        cnt[k][b] += 1;
      }
      const avg = sum.map((row, k) => row.map((s, b) => (cnt[k][b] ? s / cnt[k][b] : 0)));
      for (let pass = 0; pass < 2; pass++)
        for (let k = 0; k < rows; k++)
          for (let b = 0; b < NB2; b++) if (!avg[k][b]) avg[k][b] = avg[k][(b + 1) % NB2] || avg[k][(b + NB2 - 1) % NB2] || (k ? avg[k - 1][b] : 0);
      const blur = (src) => {
        const o = src.map((row) => Float64Array.from(row));
        for (let k = 0; k < rows; k++)
          for (let b = 0; b < NB2; b++) {
            let s = 0,
              w = 0;
            for (let dk = -2; dk <= 2; dk++)
              for (let db = -3; db <= 3; db++) {
                const kk = clamp(k + dk, 0, rows - 1);
                const v = src[kk][(b + db + NB2) % NB2];
                if (!v) continue;
                const ww = Math.exp(-(dk * dk) / 2.5 - (db * db) / 5);
                s += v * ww;
                w += ww;
              }
            if (w) o[k][b] = s / w;
          }
        return o;
      };
      const sm = blur(blur(avg));
      const front = [];
      for (const i of region) {
        const [k, b, r, ang] = polar.get(i);
        const p = V(i);
        // front and sides of the chest / belly only (not the shoulders, armpits or collar: they follow the body)
        const wFront = smooth(-0.2, 0.25, Math.cos(ang)) * (1 - smooth(0.1, 0.35, armW(i))) * (1 - smooth(neckBaseY - 0.1, neckBaseY - 0.04, p[1]));
        if (wFront <= 0) continue;
        // (never more than 1.5 cm out from where it was: only bumps are evened out)
        const target = clamp(sm[k][b], r - 0.004, r + 0.015);
        const nr = lerp(r, target, wFront);
        const f = nr / (r || 1);
        out[i * 3] *= f;
        out[i * 3 + 2] = zc[k] + (out[i * 3 + 2] - zc[k]) * f;
        front.push([i, wFront]);
      }
      // then the cloth over the chest relaxes in all directions (the base mesh is dense round the nipples: a radial
      // move alone leaves those little triangles crumpled)
      for (let it = 0; it < 24; it++) {
        const prev = Float64Array.from(out);
        for (const [i, wf] of front) {
          let x = 0,
            y = 0,
            z = 0,
            n = 0;
          for (const q of neigh[i]) {
            x += prev[q * 3];
            y += prev[q * 3 + 1];
            z += prev[q * 3 + 2];
            n++;
          }
          if (!n) continue;
          const kk = 0.5 * wf;
          out[i * 3] = lerp(prev[i * 3], x / n, kk);
          out[i * 3 + 1] = lerp(prev[i * 3 + 1], y / n, kk);
          out[i * 3 + 2] = lerp(prev[i * 3 + 2], z / n, kk);
        }
      }
    }
    // the folds go on after the relax (they are the cloth's shape, not noise)
    for (const i of region) {
      const k = ri(V(i)[1]);
      const dx = out[i * 3],
        dz = out[i * 3 + 2] - zc[k];
      const r = Math.hypot(dx, dz) || 1;
      const f = folds.get(i) ?? 0;
      out[i * 3] += (dx / r) * f;
      out[i * 3 + 2] += (dz / r) * f;
    }
    return out;
  }

  /** the trousers: each leg hangs straight from the seat / the thigh's widest point (the tights helper as the body) */
  function drapeTrousers(faces) {
    const verts = new Set();
    for (const f of faces) for (const i of f) verts.add(i);
    const out = Float64Array.from(P);
    const yTop = waistY + 0.03,
      yBot = ankleL[1];
    const DY = 0.015,
      NA = 48;
    const rows = Math.ceil((yTop - yBot) / DY) + 1;
    const ri = (y) => clamp(Math.round((yTop - y) / DY), 0, rows - 1);
    const ai = (a) => ((Math.round((a / (2 * Math.PI)) * NA) % NA) + NA) % NA;
    // a leg's axis at height y: hip joint → knee → ankle (per side)
    const axisAt = (side, y) => {
      const hip = bp(side > 0 ? "Bip01_L_Thigh" : "Bip01_R_Thigh");
      const knee = bp(side > 0 ? "Bip01_L_Calf" : "Bip01_R_Calf");
      const ank = bp(side > 0 ? "Bip01_L_Foot" : "Bip01_R_Foot");
      const seg = y > knee[1] ? [knee, hip] : [ank, knee];
      const t = clamp((y - seg[0][1]) / (seg[1][1] - seg[0][1] || 1), 0, 1);
      return [lerp(seg[0][0], seg[1][0], t), lerp(seg[0][2], seg[1][2], t)];
    };
    const crotchY = pelvis[1] - 0.09;
    for (const side of [1, -1]) {
      const R = Array.from({ length: rows }, () => new Float64Array(NA));
      const mine = [...verts].filter((i) => V(i)[0] * side > 0 && V(i)[1] <= yTop && V(i)[1] >= yBot);
      for (const i of mine) {
        const p = V(i);
        const k = ri(p[1]);
        const [cx, cz] = axisAt(side, p[1]);
        const a = ai(Math.atan2(p[0] - cx, p[2] - cz));
        R[k][a] = Math.max(R[k][a], Math.hypot(p[0] - cx, p[2] - cz));
      }
      for (let k = 0; k < rows; k++) {
        const r = R[k];
        for (let pass = 0; pass < NA; pass++) for (let a = 0; a < NA; a++) if (!r[a]) r[a] = Math.max(r[(a + 1) % NA], r[(a + NA - 1) % NA]) * 0.999;
        const mx = r.map((_, a) => Math.max(r[(a + NA - 1) % NA], r[a], r[(a + 1) % NA]));
        for (let a = 0; a < NA; a++) r[a] = (mx[(a + NA - 1) % NA] + mx[a] * 2 + mx[(a + 1) % NA]) / 4;
      }
      // straight legs: below the crotch the radius shrinks slowly (0.16 per unit height), a little looser at the hem
      const H = R.map((r) => Float64Array.from(r));
      for (let k = 1; k < rows; k++) {
        const y = yTop - k * DY;
        const slope = y < crotchY ? 0.16 : 0.6;
        for (let a = 0; a < NA; a++) H[k][a] = Math.max(R[k][a], H[k - 1][a] - slope * DY);
      }
      for (const i of mine) {
        const p = V(i);
        const k = ri(p[1]);
        const [cx, cz] = axisAt(side, p[1]);
        const dx = p[0] - cx,
          dz = p[2] - cz;
        const own = Math.hypot(dx, dz);
        const ang = Math.atan2(dx, dz);
        // the inner thigh / crotch keeps close (the legs must not merge), the waist sits on the body (the belt)
        const inner = smooth(0.3, 0.9, -Math.sin(ang) * side) * smooth(crotchY - 0.12, crotchY + 0.04, p[1]);
        const waist = smooth(waistY - 0.06, waistY - 0.0, p[1]);
        const band = 0.006 * waist;
        const fold = 0.003 * Math.sin(ang * 5 + p[1] * 40) * smooth(kneeL[1] + 0.15, ankleL[1] + 0.1, p[1]);
        let r = H[k][ai(ang)] + 0.008 + fold;
        r = lerp(r, own + 0.006, Math.max(inner, waist)) + band;
        r = Math.max(r, own + 0.004);
        const f = r / (own || 1);
        out[i * 3] = cx + dx * f;
        out[i * 3 + 2] = cz + dz * f;
        out[i * 3 + 1] = p[1];
      }
    }
    return out;
  }
  SM_SRC = SMOOTH_BODY;
  const shoes = new MeshBuilder("ref_shoes");
  for (const S of ["L", "R"]) loftFoot(shoes, S, { top: ankleL[1] + 0.012, slot: MAT.shoe, soleSlot: MAT.sole, laceSlot: null, pad: 0.008 });

  /* ---------------- rigid kit: gloves, headgear, bow tie, hair cap, shirt collar ---------------- */
  const handFrame = (S) => {
    const wrist = bp(`Bip01_${S}_Hand`);
    const mid = bp(`Bip01_${S}_Finger2`);
    const idx = bp(`Bip01_${S}_Finger1`);
    const pinky = bp(`Bip01_${S}_Finger4`);
    const f = norm(sub(mid, wrist));
    // palm normal: across the knuckles × along the fingers, signed so it faces the palm side (away from the thumb's back)
    const across = norm(sub(idx, pinky));
    let nrm = norm(cross(f, across));
    const thumb = bp(`Bip01_${S}_Finger01`);
    if (dot(sub(thumb, wrist), nrm) < 0) nrm = scl(nrm, -1);
    const s = norm(cross(nrm, f));
    return { wrist, f, n: nrm, s: s, across };
  };
  // P3-FGT-16: real glove shapes (kit-shapes.mjs): a lofted leather body with a knuckle roll, a flat palm with the grip
  // line, the thumb along the side tied at its tip, a cuff with a raised strap, stitched seams as grooves
  const gloves = new MeshBuilder("kit_gloves");
  for (const S of ["L", "R"]) {
    buildGlove(gloves, handFrame(S), { hand: FINAL_INDEX.get(`Bip01_${S}_Hand`), fore: FINAL_INDEX.get(`Bip01_${S}_ForearmTwist`) }, MAT);
  }

  /** a smooth shell round the head: per direction from the head centre, the head's own extent + thickness */
  function headShell(name, { thick, region, mat, skinBones, rimMat, seam = null }) {
    const m = new MeshBuilder(name);
    const AZ = 44,
      EL = 26;
    const el0 = -1.25,
      el1 = Math.PI / 2;
    const headVerts = [];
    for (const f of bodyFaces) for (const i of f) if (isHeadV(i) || wOf(i, "Bip01_Neck") > 0.5) headVerts.push(i);
    const uniq = [...new Set(headVerts)];
    const radius = Array.from({ length: EL + 1 }, () => new Float64Array(AZ));
    for (let e = 0; e <= EL; e++) {
      const el = el0 + ((el1 - el0) * e) / EL;
      for (let a = 0; a < AZ; a++) {
        const az = (2 * Math.PI * a) / AZ;
        const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
        let r = 0.07;
        for (const i of uniq) {
          const q = sub(V(i), headC);
          const d = len(q);
          if (d < 1e-6) continue;
          const c = dot(q, dir) / d;
          if (c > 0.985) r = Math.max(r, dot(q, dir));
        }
        radius[e][a] = r;
      }
    }
    // P3-FGT-16: the head's own extent before smoothing — the shell never dips under it (at the face opening the
    // smoothed envelope ran a few mm inside the cheeks: the pads' edge z-fought with the skin, a dotted fringe)
    const rawR = radius.map((r) => Float64Array.from(r));
    // smooth (the ears and nose would make bumps): a few passes of neighbour averaging, keeping the max-ish envelope
    for (let pass = 0; pass < 3; pass++) {
      const copy = radius.map((r) => Float64Array.from(r));
      for (let e = 0; e <= EL; e++)
        for (let a = 0; a < AZ; a++) {
          let s = 0,
            n = 0,
            mx = 0;
          for (let de = -1; de <= 1; de++)
            for (let da = -1; da <= 1; da++) {
              const ee = clamp(e + de, 0, EL);
              const v = copy[ee][(a + da + AZ) % AZ];
              s += v;
              n++;
              mx = Math.max(mx, v);
            }
          radius[e][a] = lerp(s / n, mx, 0.3);
        }
    }
    const grid = [];
    for (let e = 0; e <= EL; e++) {
      const el = el0 + ((el1 - el0) * e) / EL;
      const row = [];
      for (let a = 0; a < AZ; a++) {
        const az = (2 * Math.PI * a) / AZ;
        const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
        const inside = region(el, az, dir);
        if (!inside) {
          row.push(-1);
          continue;
        }
        const th = thick(el, az, dir);
        const r = Math.max(radius[e][a], rawR[e][a] + 0.004) + th;
        const p = add(headC, scl(dir, r));
        const sg = seam ? seam(el, az) : 0;
        row.push(m.vert(p, dir, skinBones(p), typeof mat === "function" ? mat(el, az, dir) : mat, { ao: sg > 0 ? 0.2 : 0.5, src: -1 - th * 1000 }));
      }
      grid.push(row);
    }
    const edges = new Map();
    for (let e = 0; e < EL; e++)
      for (let a = 0; a < AZ; a++) {
        const a0 = grid[e][a],
          a1 = grid[e][(a + 1) % AZ],
          b0 = grid[e + 1][a],
          b1 = grid[e + 1][(a + 1) % AZ];
        if (a0 < 0 || a1 < 0 || b0 < 0 || b1 < 0) continue;
        // outward winding
        m.face(a0, a1, b0);
        m.face(a1, b1, b0);
        for (const [x, y] of [
          [a0, a1],
          [a1, b1],
          [b1, b0],
          [b0, a0],
        ]) {
          const k = x < y ? `${x}_${y}` : `${y}_${x}`;
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
    // the rim at every opening: a rolled edge inwards
    if (rimMat !== undefined)
      for (const [k, cnt] of edges) {
        if (cnt !== 1) continue;
        const [x, y] = k.split("_").map(Number);
        const px = [m.p[x * 3], m.p[x * 3 + 1], m.p[x * 3 + 2]];
        const py = [m.p[y * 3], m.p[y * 3 + 1], m.p[y * 3 + 2]];
        // (rolled in by the padding's own thickness less 3 mm: never into the head)
        const dx = Math.max(0.004, -m.src[x] / 1000 - 0.003),
          dy = Math.max(0.004, -m.src[y] / 1000 - 0.003);
        const inX = add(px, scl(norm(sub(headC, px)), dx));
        const inY = add(py, scl(norm(sub(headC, py)), dy));
        // (the strip's own normal: the radial one lay in its plane and broke the bump shading into sparkles)
        const out = norm(cross(sub(py, px), sub(inX, px)));
        const r1 = m.vert(px, out, skinBones(px), rimMat);
        const r2 = m.vert(py, out, skinBones(py), rimMat);
        const i1 = m.vert(inX, out, skinBones(inX), rimMat);
        const i2 = m.vert(inY, out, skinBones(inY), rimMat);
        m.face(r1, i1, r2);
        m.face(r2, i1, i2);
      }
    return m;
  }
  const headBone = FINAL_INDEX.get("Bip01_Head");
  const eyeEl = Math.atan2(eyeL[1] - headC[1], Math.max(0.05, eyeL[2] - headC[2]));
  const chinEl = Math.atan2(jaw[1] - 0.06 - headC[1], 0.07);
  const headgear = headShell("kit_headgear", {
    // P3-FGT-16: an amateur open-face headgear (kit-shapes.mjs): forehead bolster, cheek pads, ear pieces, a quilted crown
    thick: (el, az, d) => headgearThickness(el, az, d, eyeEl, chinEl) - headgearSeam(el, az, eyeEl),
    seam: (el, az) => headgearSeam(el, az, eyeEl),
    region: (el, az, d) => {
      const front = Math.cos(az);
      // the open face: in front, between the brow pad and the chin
      if (front > 0.68 && el < eyeEl + 0.2 && el > chinEl - 0.05) return false;
      // a chin strap: a narrow band under the chin
      if (el < chinEl - 0.05) return front > 0.25 && el > chinEl - 0.38 && Math.abs(Math.sin(az)) < 0.75 ? Math.abs(el - (chinEl - 0.24)) < 0.11 || front < 0.55 : false;
      // the back of the neck stays open below the skull
      if (front < -0.3 && el < -0.62) return false;
      return el > -1.0 || front > 0;
    },
    mat: MAT.headgear,
    skinBones: () => [[headBone, 1]],
    rimMat: MAT.headgearTrim,
  });
  // P3-FGT-15: a close crop on the scalp (3–7 mm of hair, fuller on the crown), not a bowl
  SM_SRC = SMOOTH_BODY;
  const hairCap = shell("hair_cap", bodyFaces, NB, {
    field: hairField,
    offset: (i) => 0.0018 + 0.0035 * smooth(eyeL[1] + 0.05, headC[1] + 0.1, V(i)[1]),
    mat: MAT.hair,
    hem: 0.0005,
    edgeAo: 0.03,
  });

  // the referee's bow tie and the shirt / polo collar: small rigid pieces at the throat on the neck / upper spine
  const bowtie = new MeshBuilder("ref_bowtie");
  {
    const neckB = FINAL_INDEX.get("Bip01_Neck");
    // the front of the neck at its base: the frontmost body vertex near the neck joint height
    let front = null;
    for (const f of bodyFaces)
      for (const i of f) {
        const p = V(i);
        if (Math.abs(p[0]) < 0.012 && Math.abs(p[1] - (neckBaseY + 0.01)) < 0.012 && (!front || p[2] > front[2])) front = p;
      }
    const c = add(front ?? [0, neckBaseY, 0.06], [0, 0.0, 0.012]);
    const skin = [[neckB, 0.6], [FINAL_INDEX.get("Bip01_Spine2"), 0.4]];
    const quad = (pts, nn) => {
      const ids = pts.map((p) => bowtie.vert(add(c, p), nn, skin, MAT.bowtie));
      bowtie.face(ids[0], ids[1], ids[2]);
      bowtie.face(ids[0], ids[2], ids[3]);
    };
    for (const sgn of [-1, 1]) {
      quad([[0, 0.006, 0.004], [0.05 * sgn * 0.9, 0.022, 0], [0.05 * sgn * 0.9, -0.022, 0], [0, -0.006, 0.004]].map((p) => (sgn < 0 ? p : p)), [0, 0, 1]);
      quad([[0, -0.006, -0.002], [0.045 * sgn, -0.02, -0.006], [0.045 * sgn, 0.02, -0.006], [0, 0.006, -0.002]], [0, 0, -1]);
    }
    quad([[-0.008, 0.008, 0.007], [0.008, 0.008, 0.007], [0.008, -0.008, 0.007], [-0.008, -0.008, 0.007]], [0, 0, 1]);
  }
  // the collar: the shirt's neck opening edge raised into a stand-up band (shirt / polo)
  const collar = (name, mat) => {
    const m = new MeshBuilder(name);
    const ring = [];
    const R = 28;
    const neckB = FINAL_INDEX.get("Bip01_Neck");
    const skin = [[neckB, 0.5], [FINAL_INDEX.get("Bip01_Spine2"), 0.5]];
    // neck radius at its base from the body
    let rx = 0,
      rz = 0,
      cz = 0,
      n = 0;
    for (const f of bodyFaces)
      for (const i of f) {
        const p = V(i);
        if (Math.abs(p[1] - neckBaseY) < 0.01 && wOf(i, "Bip01_Neck") + wOf(i, "Bip01_Spine2") > 0.6 && !isArm(i)) {
          rx = Math.max(rx, Math.abs(p[0]));
          cz += p[2];
          n++;
        }
      }
    cz /= n || 1;
    for (const f of bodyFaces)
      for (const i of f) {
        const p = V(i);
        if (Math.abs(p[1] - neckBaseY) < 0.01 && Math.abs(p[0]) < 0.02) rz = Math.max(rz, Math.abs(p[2] - cz));
      }
    rx = Math.min(rx, 0.06) + 0.004;
    rz = Math.min(rz || 0.055, 0.06) + 0.004;
    // P3-FGT-14: a stand collar that grows out of the shirt's neckline (the lowest ring flares onto the shirt, no
    // skin gap), and two pointed fall-down wings at the front either side of the tie
    const H = [
      [-0.03, 1.45],
      [-0.012, 1.2],
      [0.004, 1.0],
      [0.02, 1.03],
      [0.03, 1.07],
    ];
    for (const [dy, grow] of H) {
      const y = neckBaseY + dy;
      const row = [];
      for (let u = 0; u < R; u++) {
        const th = (2 * Math.PI * u) / R;
        // the collar opens at the front
        if (Math.abs(th) < 0.3 || Math.abs(th - 2 * Math.PI) < 0.3) {
          row.push(-1);
          continue;
        }
        const nn = [Math.sin(th), 0, Math.cos(th)];
        row.push(m.vert([Math.sin(th) * rx * grow, y, cz + Math.cos(th) * rz * grow], nn, skin, mat));
      }
      ring.push(row);
    }
    for (let k = 0; k < H.length - 1; k++)
      for (let u = 0; u < R; u++) {
        const a0 = ring[k][u],
          a1 = ring[k][(u + 1) % R],
          b0 = ring[k + 1][u],
          b1 = ring[k + 1][(u + 1) % R];
        if (a0 < 0 || a1 < 0 || b0 < 0 || b1 < 0) continue;
        m.face(a0, a1, b0);
        m.face(a1, b1, b0);
        m.face(a0, b0, a1);
        m.face(a1, b0, b1);
      }
    // the wings: from the top of the stand at the opening, folded down and out to a point on the chest
    for (const sgn of [-1, 1]) {
      const th0 = sgn * 0.32,
        th1 = sgn * 1.05;
      const top = (th, g) => [Math.sin(th) * rx * g, neckBaseY + 0.03, cz + Math.cos(th) * rz * g + 0.004];
      const a = top(th0, 1.12),
        b = top(th1, 1.14);
      const tip = [Math.sin(sgn * 0.42) * rx * 1.9, neckBaseY - 0.045, cz + rz * 1.28];
      const n = norm(cross(sub(b, a), sub(tip, a)));
      const nf = n[2] < 0 ? scl(n, -1) : n;
      const ids = [a, b, tip].map((q) => m.vert(q, nf, skin, mat));
      m.face(ids[0], ids[1], ids[2]);
      m.face(ids[0], ids[2], ids[1]);
    }
    return m;
  };
  const refCollar = collar("ref_collar", MAT.shirt);
  // the staff polo: the shirt shape in the polo colour, with its collar
  const polo = shell("staff_polo", bodyFaces, NS, {
    field: shirtField,
    offset: (i) => 0.005 + sleeveFlare(i),
    surface: SHIRT_SURF,
    flatAo: true,
    mat: MAT.polo,
    hem: 0.004,
  });
  const poloCollar = collar("staff_collar", MAT.polo);

  const meshes = [bodyMesh, vest, trunks, boots, socks, gloves, headgear, wraps, shirt, refCollar, bowtie, trousers, shoes, polo, poloCollar, hairCap];
  return { key, G, meshes, landmarks: { headC, eyeL, eyeR, kit: [Math.abs(thighL[0]), pelvis[1] - 0.07, trunksTop, hemY], torso: G.torso }, morphParams };
}

/* ------------------------------------------------------------ the player's face on the boxer head (P3-FGT-14) ------------------------------------------------------------ */
/**
 * The avatar's face choices (world/face.ts: shape, eyes, nose, lips) as MakeHuman face targets (data/targets/head,
 * eyes, nose, mouth; CC0). The first option of each list in face.ts that reads as the base mesh has no target (oval,
 * almond, rounded, medium). Each option is one sparse morph target of the body mesh; the runtime bakes the chosen
 * ones (boxer-body.ts). Weights are kept moderate: a boxer's face, recognisably the player's choice, never a caricature.
 */
const FACE_MORPHS = {
  "shape:round": [["head/head-round", 0.75], ["head/head-fat-incr", 0.3]],
  "shape:square": [["head/head-square", 0.85]],
  "shape:heart": [["head/head-invertedtriangular", 0.8]],
  "shape:long": [["head/head-scale-vert-incr", 0.55], ["head/head-scale-horiz-decr", 0.25]],
  "eyes:round": [["eyes/l-eye-height2-incr", 0.6], ["eyes/r-eye-height2-incr", 0.6]],
  "eyes:hooded": [["eyes/l-eye-eyefold-down", 0.7], ["eyes/r-eye-eyefold-down", 0.7]],
  "eyes:narrow": [["eyes/l-eye-height2-decr", 0.55], ["eyes/r-eye-height2-decr", 0.55]],
  "eyes:deep": [["eyes/l-eye-eyefold-concave", 0.7], ["eyes/r-eye-eyefold-concave", 0.7]],
  "nose:broad": [["nose/nose-scale-horiz-incr", 0.55], ["nose/nose-flaring-incr", 0.45]],
  "nose:straight": [["nose/nose-greek-incr", 0.5], ["nose/nose-hump-decr", 0.4]],
  "nose:narrow": [["nose/nose-scale-horiz-decr", 0.55], ["nose/nose-point-width-decr", 0.4]],
  "nose:wide": [["nose/nose-nostrils-width-incr", 0.7], ["nose/nose-flaring-incr", 0.4]],
  "lips:full": [["mouth/mouth-upperlip-volume-incr", 0.6], ["mouth/mouth-lowerlip-volume-incr", 0.6]],
  "lips:thin": [["mouth/mouth-upperlip-volume-decr", 0.6], ["mouth/mouth-lowerlip-volume-decr", 0.6]],
  "lips:wide": [["mouth/mouth-scale-horiz-incr", 0.6]],
  "lips:bow": [["mouth/mouth-cupidsbow-incr", 0.8]],
};
/** per face option: MakeHuman vertex → delta (m) */
const FACE_DELTAS = Object.fromEntries(
  Object.entries(FACE_MORPHS).map(([name, list]) => {
    const d = new Map();
    for (const [file, w] of list) {
      const t = readTarget(join(MH, "targets", `${file}.target`));
      for (let i = 0; i < t.length; i += 4) {
        const k = t[i];
        const cur = d.get(k) ?? [0, 0, 0];
        cur[0] += t[i + 1] * w * DM;
        cur[1] += t[i + 2] * w * DM;
        cur[2] += t[i + 3] * w * DM;
        d.set(k, cur);
      }
    }
    return [name, d];
  }),
);
/** the body mesh's face targets: its vertices that come from a moved MakeHuman vertex */
function faceMorphs(mb) {
  return Object.entries(FACE_DELTAS).map(([name, d]) => {
    const indices = [];
    const values = [];
    for (let k = 0; k < mb.count; k++) {
      const src = mb.src[k];
      if (typeof src !== "number" || src < 0) continue;
      const v = d.get(src);
      if (!v || Math.hypot(v[0], v[1], v[2]) < 2e-5) continue;
      indices.push(k);
      values.push(v[0], v[1], v[2]);
    }
    return { name, indices, values: Float32Array.from(values) };
  });
}

/* ------------------------------------------------------------ variants: body types as morph targets ------------------------------------------------------------ */
const ETH = { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 };
const GENDERS = {
  m: {
    base: { gender: 1, age: 0.55, muscle: 0.92, weight: 0.42, height: 0.52, proportions: 0.85, ...ETH },
    morphs: {
      heavy: { muscle: 0.9, weight: 0.78, height: 0.6 },
      slim: { muscle: 0.74, weight: 0.3, height: 0.46 },
      mature: { age: 0.66, muscle: 0.62, weight: 0.6 },
    },
  },
  f: {
    base: { gender: 0, age: 0.55, muscle: 0.84, weight: 0.44, height: 0.56, proportions: 0.85, ...ETH },
    morphs: {
      heavy: { muscle: 0.82, weight: 0.74, height: 0.6 },
      slim: { muscle: 0.68, weight: 0.32, height: 0.52 },
      mature: { age: 0.66, muscle: 0.55, weight: 0.6 },
    },
  },
};

mkdirSync(OUT, { recursive: true });
for (const [key, spec] of Object.entries(GENDERS)) {
  const base = buildVariant(key, spec.base);
  const morphNames = Object.keys(spec.morphs);
  // each morph: the same build with other macro values; garment vertices follow their source body vertex
  const morphGeo = morphNames.map((m) => geometry(variantPositions({ ...spec.base, ...spec.morphs[m] })));
  const out = base.meshes.map((mb) => {
    const built = mb.build(mb.name === "body");
    // morph deltas: body / shell vertices follow their source vertex; rigid pieces follow their bone
    built.morphs = morphGeo.map((g) => {
      const d = new Float32Array(mb.p.length);
      for (let k = 0; k < mb.count; k++) {
        const src = mb.src[k];
        let dx, dy, dz;
        if (Array.isArray(src) || src >= 0) {
          const [a, b, t] = Array.isArray(src) ? src : [src, src, 0];
          const d = (q, ax) => g.P[q * 3 + ax] - base.G.P[q * 3 + ax];
          dx = d(a, 0) * (1 - t) + d(b, 0) * t;
          dy = d(a, 1) * (1 - t) + d(b, 1) * t;
          dz = d(a, 2) * (1 - t) + d(b, 2) * t;
        } else {
          // the bone this vertex is weighted to most
          const j = mb.j[k * 4];
          dx = g.bones[j].pos[0] - base.G.bones[j].pos[0];
          dy = g.bones[j].pos[1] - base.G.bones[j].pos[1];
          dz = g.bones[j].pos[2] - base.G.bones[j].pos[2];
        }
        d[k * 3] = dx;
        d[k * 3 + 1] = dy;
        d[k * 3 + 2] = dz;
      }
      return d;
    });
    // the player's face shape (P3-FGT-14): sparse targets on the body's head vertices (MakeHuman CC0 face targets)
    if (mb.name === "body") built.sparseMorphs = faceMorphs(mb);
    return built;
  });
  // shell vertices that were not tracked (hem strips) inherit nothing: fine (they are tiny); rigid pieces use the bone
  const boneMorph = Object.fromEntries(morphNames.map((m, k) => [m, morphGeo[k].bones.map((b, i) => b.pos.map((v, a) => +(v - base.G.bones[i].pos[a]).toFixed(5)))]));
  // the torso slices per body-type morph, as deltas (the runtime blends them like the joints)
  const torsoMorph = Object.fromEntries(morphNames.map((m, k) => [m, morphGeo[k].torso.map((r, i) => r.map((v, a) => +(v - base.G.torso[i][a]).toFixed(4)))]));
  const extras = {
    boxerBody: 1,
    source: "MakeHuman 1.x (CC0 1.0): base.obj, macrodetails targets, default.mhskel, default_weights.mhw",
    morphs: morphNames,
    faceMorphs: Object.keys(FACE_MORPHS),
    boneMorph,
    torsoMorph,
    landmarks: base.landmarks,
    mat: MAT,
    cover: COVER,
  };
  const bytes = writeGlb(join(OUT, `boxer-${key}.glb`), { bones: base.G.bones, meshes: out, morphNames, extras });
  const tris = out.reduce((n, m) => n + m.index.length / 3, 0);
  console.log(`boxer-${key}.glb: ${(bytes / 1024).toFixed(0)} KB, ${out.length} meshes, ${tris} triangles, ${base.G.bones.length} bones, height ${Math.max(...base.G.P.filter((_, i) => i % 3 === 1)).toFixed(3)} m`);
  for (const m of out) { const P = m.attrs.POSITION.data; let lo = 9, hi = -9; for (let i = 1; i < P.length; i += 3) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); } console.log(`  ${m.name}: ${P.length / 3} verts, ${m.index.length / 3} tris, y ${lo.toFixed(2)}..${hi.toFixed(2)}`); }
}
