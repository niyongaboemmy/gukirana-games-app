// P3-FGT-19A fighter v8 prototype (dev only): the athlete bodies.
// MakeHuman 1.x CC0 base (hm08) + macro targets + MakeHuman regional targets + our own sculpt layer (anatomical
// volume deltas anchored to the joints: deltoid caps, upper trapezius, lats, serratus, forearm flexors, VMO,
// gastrocnemius, glutes), scaled to a stature per weight class, measured with the repo's measure.mjs.
import { join } from "node:path";
import { jointPos, macroTargets, morph, readObj, readSkeleton } from "../../../apps/web/scripts/boxer/mh.mjs";
import { measureBody } from "../../../apps/web/scripts/boxer/measure.mjs";
import { add, cross, dot, len, lerp3, norm, scl, sub, vertexNormals } from "./geo.mjs";

const DM = 0.1;

/**
 * Weight-class specs (docs/design/fighter-v8/SPEC.md §1). Statures from the class means in the research
 * (Olympic boxers ♂ 1.76 m, ♀ 1.68 m; Korean national women 1.63 m light / 1.70 m middle; heavyweights 1.87 m).
 */
export const FIGHTERS = {
  mW: {
    label: "Male welterweight (63.5–67 kg)",
    stature: 1.76,
    macro: { gender: 1, age: 0.5, muscle: 0.96, weight: 0.38, height: 0.55, proportions: 1, african: 0.8, asian: 0.1, caucasian: 0.1 },
    regional: [
      ["torso/torso-vshape-incr", 0.5],
      ["torso/torso-muscle-dorsi-incr", 0.55],
      ["torso/torso-muscle-pectoral-incr", 0.35],
      ["stomach/stomach-tone-incr", 0.8],
      ["neck/neck-scale-horiz-incr", 0.3],
      ["neck/neck-back-scale-depth-incr", 0.35],
      ["measure/measure-neck-circ-incr", 0.35],
      ["measure/measure-shoulder-dist-decr", 0.2],
      ["measure/measure-waist-circ-incr", 0.95],
      ["buttocks/buttocks-volume-incr", 0.1],
      ["sym:upperarm-shoulder-muscle-incr", 0.6],
      ["sym:upperarm-muscle-incr", 0.35],
      ["sym:lowerarm-muscle-incr", 0.6],
      ["sym:upperleg-muscle-incr", 0.3],
      ["sym:lowerleg-muscle-incr", 0.55],
      ["head/head-scale-horiz-incr", 0.06],
      ["head/head-scale-depth-incr", 0.06],
    ],
    sculpt: 1,
  },
  mH: {
    label: "Male heavyweight (86–92 kg)",
    stature: 1.87,
    macro: { gender: 1, age: 0.52, muscle: 1, weight: 0.6, height: 0.75, proportions: 1, african: 0.8, asian: 0.1, caucasian: 0.1 },
    regional: [
      ["torso/torso-vshape-incr", 0.35],
      ["torso/torso-muscle-dorsi-incr", 0.6],
      ["torso/torso-muscle-pectoral-incr", 0.5],
      ["stomach/stomach-tone-incr", 0.4],
      ["neck/neck-scale-horiz-incr", 0.5],
      ["neck/neck-back-scale-depth-incr", 0.5],
      ["measure/measure-neck-circ-incr", 0.6],
      ["measure/measure-waist-circ-incr", 1.7],
      ["measure/measure-shoulder-dist-incr", 0.45],
      ["head/head-scale-vert-incr", 0.12],
      ["head/head-scale-depth-incr", 0.1],
      ["sym:upperarm-shoulder-muscle-incr", 0.7],
      ["sym:upperarm-muscle-incr", 0.5],
      ["sym:lowerarm-muscle-incr", 0.7],
      ["sym:upperleg-muscle-incr", 0.45],
      ["sym:lowerleg-muscle-incr", 0.5],
      ["head/head-scale-horiz-incr", 0.04],
    ],
    sculpt: 1.25,
  },
  fL: {
    label: "Female lightweight (57–60 kg)",
    stature: 1.65,
    macro: { gender: 0, age: 0.5, muscle: 0.9, weight: 0.4, height: 0.55, proportions: 1, african: 0.8, asian: 0.1, caucasian: 0.1 },
    regional: [
      ["torso/torso-vshape-incr", 0.3],
      ["torso/torso-muscle-dorsi-incr", 0.45],
      ["torso/torso-muscle-pectoral-incr", 0.15],
      ["stomach/stomach-tone-incr", 0.7],
      ["neck/neck-back-scale-depth-incr", 0.25],
      ["measure/measure-neck-height-decr", 1.0],
      ["measure/measure-neck-circ-incr", 0.25],
      ["measure/measure-waist-circ-incr", 0.95],
      ["breast/female-young-maxmuscle-averageweight-mincup-maxfirmness", 0.6],
      ["breast/breast-point-decr", 0.8],
      ["sym:upperarm-shoulder-muscle-incr", 0.55],
      ["sym:upperarm-muscle-incr", 0.3],
      ["sym:lowerarm-muscle-incr", 0.5],
      ["sym:upperleg-muscle-incr", 0.3],
      ["sym:lowerleg-muscle-incr", 0.5],
      ["head/head-scale-vert-incr", 0.15],
      ["head/head-scale-horiz-incr", 0.12],
      ["head/head-scale-depth-incr", 0.12],
    ],
    sculpt: 0.7,
  },
  fM: {
    label: "Female middleweight (70–75 kg)",
    stature: 1.7,
    macro: { gender: 0, age: 0.52, muscle: 0.95, weight: 0.55, height: 0.62, proportions: 1, african: 0.8, asian: 0.1, caucasian: 0.1 },
    regional: [
      ["torso/torso-vshape-incr", 0.3],
      ["torso/torso-muscle-dorsi-incr", 0.5],
      ["torso/torso-muscle-pectoral-incr", 0.2],
      ["stomach/stomach-tone-incr", 0.5],
      ["neck/neck-back-scale-depth-incr", 0.35],
      ["measure/measure-neck-height-decr", 1.0],
      ["measure/measure-neck-circ-incr", 0.4],
      ["measure/measure-waist-circ-incr", 1.05],
      ["breast/female-young-maxmuscle-averageweight-mincup-maxfirmness", 0.55],
      ["breast/breast-point-decr", 0.8],
      ["sym:upperarm-shoulder-muscle-incr", 0.6],
      ["sym:upperarm-muscle-incr", 0.4],
      ["sym:lowerarm-muscle-incr", 0.6],
      ["sym:upperleg-muscle-incr", 0.4],
      ["sym:lowerleg-muscle-incr", 0.5],
      ["head/head-scale-vert-incr", 0.12],
      ["head/head-scale-horiz-incr", 0.12],
      ["head/head-scale-depth-incr", 0.12],
    ],
    sculpt: 0.85,
  },
};

/** the MakeHuman bones the measure module's Bip01 names stand for */
const BIP = {
  Bip01_Head: "head",
  Bip01_Jaw: "jaw",
  Bip01_Neck: "neck01",
  Bip01_Pelvis: "root",
  Bip01_L_Clavicle: "clavicle.L",
  Bip01_L_UpperArm: "upperarm01.L",
  Bip01_L_ShoulderHelper: "upperarm01.L",
  Bip01_L_Forearm: "lowerarm01.L",
  Bip01_L_ForearmTwist: "lowerarm02.L",
  Bip01_L_Hand: "wrist.L",
  Bip01_R_UpperArm: "upperarm01.R",
  Bip01_R_Forearm: "lowerarm01.R",
  Bip01_R_Hand: "wrist.R",
  Bip01_L_Thigh: "upperleg01.L",
  Bip01_R_Thigh: "upperleg01.R",
  Bip01_L_Calf: "lowerleg01.L",
  Bip01_L_Foot: "foot.L",
};
/** measure-module bone groups (each Bip01 name → the MakeHuman bones it merges) */
const BIP_GROUP = {
  Bip01_Head: (b) => /^(head|eye|orbicularis|oculi|levator|temporalis|special0[1-3]|nose)/.test(b) || b === "head",
  Bip01_Jaw: (b) => /^(jaw|tongue|oris|special04|risorius)/.test(b),
  Bip01_Neck: (b) => /^neck0/.test(b),
  Bip01_Pelvis: (b) => /^(root|pelvis|spine05)/.test(b),
  Bip01_L_UpperArm: (b) => /^upperarm0[12]\.L$/.test(b),
  Bip01_R_UpperArm: (b) => /^upperarm0[12]\.R$/.test(b),
  Bip01_L_ShoulderHelper: () => false,
  Bip01_L_Forearm: (b) => b === "lowerarm01.L",
  Bip01_L_ForearmTwist: (b) => b === "lowerarm02.L",
  Bip01_R_Forearm: (b) => /^lowerarm0[12]\.R$/.test(b),
  Bip01_L_Hand: (b) => /\.L$/.test(b) && /^(wrist|metacarpal|finger)/.test(b),
  Bip01_R_Hand: (b) => /\.R$/.test(b) && /^(wrist|metacarpal|finger)/.test(b),
  Bip01_L_Thigh: (b) => /^upperleg0[12]\.L$/.test(b),
  Bip01_R_Thigh: (b) => /^upperleg0[12]\.R$/.test(b),
  Bip01_L_Calf: (b) => /^lowerleg0[12]\.L$/.test(b),
};

/** athlete faces: lean cheeks, defined cheekbones, a firm jaw (MakeHuman CC0 face targets) */
const FACE = {
  m: [
    ["cheek/l-cheek-bones-incr", 0.5], ["cheek/r-cheek-bones-incr", 0.5],
    ["cheek/l-cheek-volume-decr", 0.45], ["cheek/r-cheek-volume-decr", 0.45],
    ["head/head-fat-decr", 0.55], ["head/head-square", 0.25],
    ["chin/chin-width-incr", 0.3], ["chin/chin-prominent-incr", 0.25],
    ["mouth/mouth-lowerlip-volume-decr", 0.2], ["nose/nose-flaring-decr", 0.15],
  ],
  f: [
    ["cheek/l-cheek-bones-incr", 0.45], ["cheek/r-cheek-bones-incr", 0.45],
    ["cheek/l-cheek-volume-decr", 0.4], ["cheek/r-cheek-volume-decr", 0.4],
    ["head/head-fat-decr", 0.5], ["head/head-oval", 0.3],
    ["chin/chin-prominent-incr", 0.15],
    ["mouth/mouth-upperlip-volume-decr", 0.35], ["mouth/mouth-lowerlip-volume-decr", 0.4], ["mouth/mouth-scale-horiz-decr", 0.15],
    ["nose/nose-flaring-decr", 0.25], ["nose/nose-scale-horiz-decr", 0.1],
  ],
};

/** the sculpt volumes of the last body built (MakeHuman decimetres, before the stature scale), for the source export */
export const SCULPT_LOG = [];
export { FACE };

export function loadMH(MH) {
  const obj = readObj(join(MH, "3dobjs/base.obj"));
  const { skel, weights } = readSkeleton(MH);
  const boneNames = Object.keys(skel.bones);
  const boneIndex = new Map(boneNames.map((n, i) => [n, i]));
  const nvAll = obj.pos.length / 3;
  const vw = Array.from({ length: nvAll }, () => new Map());
  for (const [bone, list] of Object.entries(weights)) {
    const bi = boneIndex.get(bone);
    for (const [v, w] of list) vw[v].set(bi, (vw[v].get(bi) ?? 0) + w);
  }
  return { MH, obj, skel, boneNames, boneIndex, vw };
}

/** a fighter body at bind pose: metres, feet on y = 0, facing +z, +x = the athlete's left */
export function buildBody(mh, spec) {
  const { MH, obj, skel, boneNames, boneIndex, vw } = mh;
  const targets = [...macroTargets(MH, spec.macro)];
  for (const [name, w] of [...spec.regional, ...FACE[spec.macro.gender > 0.5 ? "m" : "f"]]) {
    if (name.startsWith("sym:")) {
      const t = name.slice(4);
      targets.push([join(MH, "targets/armslegs", `l-${t}.target`), w], [join(MH, "targets/armslegs", `r-${t}.target`), w]);
    } else targets.push([join(MH, "targets", `${name}.target`), w]);
  }
  const pdm = morph(obj.pos, targets);
  const bodyFaces = obj.groups.get("body");
  const bodyUV = obj.uvGroups.get("body");
  const bodyVerts = [...new Set(bodyFaces.flat())].sort((a, b) => a - b);
  // sculpt in dm on the full array (joints read from it)
  const J = (name) => jointPos(skel, pdm, name);
  sculpt(pdm, bodyFaces, bodyVerts, J, vw, boneIndex, spec.sculpt);
  // ground and scale to stature
  let minY = Infinity, maxY = -Infinity;
  for (const v of bodyVerts) {
    minY = Math.min(minY, pdm[v * 3 + 1]);
    maxY = Math.max(maxY, pdm[v * 3 + 1]);
  }
  const s = spec.stature / ((maxY - minY) * DM);
  const P = new Float64Array(pdm.length);
  for (let i = 0; i < pdm.length / 3; i++) {
    P[i * 3] = pdm[i * 3] * DM * s;
    P[i * 3 + 1] = (pdm[i * 3 + 1] - minY) * DM * s;
    P[i * 3 + 2] = pdm[i * 3 + 2] * DM * s;
  }
  const Jm = (name) => {
    const j = jointPos(skel, pdm, name);
    return [j[0] * DM * s, (j[1] - minY) * DM * s, j[2] * DM * s];
  };
  const bones = boneNames.map((n) => {
    const b = skel.bones[n];
    return { name: n, parent: b.parent ? boneIndex.get(b.parent) : -1, head: Jm(b.head), tail: Jm(b.tail) };
  });
  // measurement with the repo's audit (Bip01 names → MakeHuman bones)
  const groupW = (vi, bip) => {
    const f = BIP_GROUP[bip];
    if (!f) return 0;
    let w = 0;
    for (const [b, x] of vw[vi]) if (f(boneNames[b])) w += x;
    return w;
  };
  const bp = (bip) => bones[boneIndex.get(BIP[bip])].head;
  const measure = measureBody({ P, bodyV: new Set(bodyVerts), bp, wOf: groupW });
  return { P, pdm, scale: s, minY, bodyFaces, bodyUV, bodyVerts, bones, Jm, measure, vw };
}

/**
 * Our sculpt layer. Each landmark is an anisotropic Gaussian volume in a frame built from two joints (t along the
 * segment, offsets lateral / up / forward in metres at the base scale), pushed along the vertex normal and limited to
 * vertices weighted to the named bones. Amplitudes are for a male welterweight; `k` scales the set per fighter.
 */
function sculpt(pdm, faces, verts, J, vw, boneIndex, k) {
  const N = vertexNormals(pdm, faces, pdm.length / 3);
  const disp = new Float64Array(pdm.length / 3);
  const side = (s) => (s === "L" ? 1 : -1);
  const bonesW = (v, names) => {
    let w = 0;
    for (const n of names) w += vw[v].get(boneIndex.get(n)) ?? 0;
    return w;
  };
  // [from joint, to joint, t, offset [lateral, up, forward] dm, radii [x, y, z] dm, amplitude dm, bones, sides?]
  const L = [];
  for (const S of ["L", "R"]) {
    const s = `.${S}`;
    const lat = side(S);
    const sh = J(`upperarm01${s}____head`);
    const el = J(`lowerarm01${s}____head`);
    const wr = J(`wrist${s}____head`);
    const kn = J(`lowerleg01${s}____head`);
    const an = J(`foot${s}____head`);
    const hip = J(`upperleg01${s}____head`);
    const nk = J("neck01____head");
    const armBones = [`upperarm01${s}`, `upperarm02${s}`, `shoulder01${s}`, `clavicle${s}`];
    // deltoid cap: lateral + slightly forward/back heads, rounding the shoulder past the acromion
    L.push({ c: add(lerp3(sh, el, 0.18), [lat * 0.18, 0.05, 0.0]), r: [0.42, 0.62, 0.5], a: 0.075, bones: armBones });
    L.push({ c: add(lerp3(sh, el, 0.12), [lat * 0.05, 0.05, 0.3]), r: [0.35, 0.5, 0.3], a: 0.04, bones: armBones });
    L.push({ c: add(lerp3(sh, el, 0.14), [lat * 0.05, 0.05, -0.32]), r: [0.35, 0.5, 0.3], a: 0.035, bones: armBones });
    // upper trapezius: neck-to-acromion slope, raised and thickened
    L.push({ c: add(lerp3(nk, sh, 0.45), [0, 0.12, -0.12]), r: [0.55, 0.28, 0.35], a: 0.07, bones: ["neck01", "neck02", "spine01", `clavicle${s}`, `shoulder01${s}`] });
    // lats: the flare under the armpit, back of the ribcage
    L.push({ c: add(sh, [-lat * 0.05, -1.25, -0.35]), r: [0.35, 0.95, 0.45], a: 0.055, bones: ["spine01", "spine02", "spine03", `clavicle${s}`, `shoulder01${s}`, `breast${s}`] });
    // serratus: three small slips below the armpit, front-side of the ribs
    for (let i = 0; i < 3; i++) L.push({ c: add(sh, [-lat * 0.08, -1.05 - i * 0.28, 0.42 + i * 0.05]), r: [0.18, 0.12, 0.2], a: 0.018, bones: ["spine01", "spine02", "spine03", `breast${s}`] });
    // triceps (long head back of the upper arm) and biceps belly
    L.push({ c: add(lerp3(sh, el, 0.48), [0, 0, -0.28]), r: [0.3, 0.6, 0.25], a: 0.03, bones: [`upperarm01${s}`, `upperarm02${s}`] });
    L.push({ c: add(lerp3(sh, el, 0.58), [0, 0, 0.22]), r: [0.25, 0.45, 0.22], a: 0.025, bones: [`upperarm01${s}`, `upperarm02${s}`] });
    // forearm: flexor / brachioradialis mass in the proximal third, tapering to the wrist
    L.push({ c: add(lerp3(el, wr, 0.25), [lat * 0.08, 0, 0.05]), r: [0.3, 0.45, 0.28], a: 0.04, bones: [`lowerarm01${s}`, `lowerarm02${s}`] });
    // vastus medialis (teardrop above the inner knee) and the lateral quad sweep
    L.push({ c: add(lerp3(kn, hip, 0.14), [-lat * 0.28, 0, 0.22]), r: [0.26, 0.38, 0.22], a: 0.03, bones: [`upperleg01${s}`, `upperleg02${s}`] });
    L.push({ c: add(lerp3(kn, hip, 0.5), [lat * 0.3, 0, 0.1]), r: [0.25, 0.8, 0.3], a: 0.025, bones: [`upperleg01${s}`, `upperleg02${s}`] });
    // gastrocnemius: medial head lower and fuller than the lateral head
    L.push({ c: add(lerp3(kn, an, 0.3), [-lat * 0.12, 0, -0.3]), r: [0.25, 0.55, 0.25], a: 0.04, bones: [`lowerleg01${s}`, `lowerleg02${s}`] });
    L.push({ c: add(lerp3(kn, an, 0.24), [lat * 0.14, 0, -0.28]), r: [0.22, 0.45, 0.22], a: 0.028, bones: [`lowerleg01${s}`, `lowerleg02${s}`] });
    // glutes: a firm, high seat
    L.push({ c: add(hip, [lat * 0.05, 0.05, -0.75]), r: [0.55, 0.55, 0.4], a: 0.03, bones: ["root", `pelvis${s}`, `upperleg01${s}`, "spine05"] });
  }
  SCULPT_LOG.length = 0;
  for (const m of L) SCULPT_LOG.push({ centreDm: m.c.map((x) => +x.toFixed(4)), radiiDm: m.r, amplitudeDm: +(m.a * k).toFixed(4), bones: m.bones });
  for (const v of verts) {
    const p = [pdm[v * 3], pdm[v * 3 + 1], pdm[v * 3 + 2]];
    let d = 0;
    for (const m of L) {
      const q = sub(p, m.c);
      const e = (q[0] / m.r[0]) ** 2 + (q[1] / m.r[1]) ** 2 + (q[2] / m.r[2]) ** 2;
      if (e > 9) continue;
      const w = Math.min(1, bonesW(v, m.bones) * 1.6);
      d += m.a * k * Math.exp(-0.5 * e) * w;
    }
    disp[v] = d;
  }
  for (const v of verts) for (let a = 0; a < 3; a++) pdm[v * 3 + a] += N[v * 3 + a] * disp[v];
}

/** a quick perpendicular basis */
export function basis(dir) {
  const d = norm(dir);
  const u = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  return [d, u, cross(d, u)];
}
export { dot, len, scl };
