#!/usr/bin/env node
// P3-FGT-19A fighter v8 design prototype (DEV ONLY — never shipped, not imported by the app).
// Builds four athlete bodies (male welterweight / heavyweight, female lightweight / middleweight) from the MakeHuman
// 1.x CC0 base with our sculpt layer, one Catmull-Clark level, the full kit (vest, trunks with a contrasting band,
// 10 oz gloves, open-face headgear, boots, hand wraps), MakeHuman CC0 eyes, and the skin maps (four Monk-scale tones,
// detail normal, roughness, sweat mask). Output: qa/fighter-v8/out/ (git-ignored) — GLB per fighter + textures,
// read by page/proto.js and rendered by shoot.mjs.
//
//   MH_DIR=<makehuman checkout>/makehuman/data node qa/fighter-v8/build.mjs [mW,fL,…]
//
// MakeHuman commit a8bc2d54ff0ac92e78ff71431b1023eda42bf482 (CC0 1.0), same as the game's boxer build.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readObj, readProxy } from "../../apps/web/scripts/boxer/mh.mjs";
import { writeGlb } from "../../apps/web/scripts/boxer/glb.mjs";
import { bandHeight, bakeDetail } from "../../apps/web/scripts/boxer/anatomy-bake.mjs";
import { buildBody, FIGHTERS, loadMH } from "./lib/body.mjs";
import { catmullClark, clamp, smoothstep, vertexNormals } from "./lib/geo.mjs";
import { buildBoot, buildGlove, buildHeadgear, buildTrunks, buildVest, buildWraps, KIT } from "./lib/kit.mjs";
import { composeAlbedo, composeNormal, loadImage, rasterUV, TONES, writeGrey, writeRGB } from "./lib/bake.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const REPO = join(HERE, "../..");
const MH = process.env.MH_DIR;
if (!MH) throw new Error("set MH_DIR to makehuman/makehuman/data");
mkdirSync(OUT, { recursive: true });
const only = process.argv[2]?.split(",");
const TEX = Number(process.env.TEX ?? 2048);

const mh = loadMH(MH);
const DM = 0.1;

/** subdivided body with landmarks */
function prepare(key, spec) {
  const b = buildBody(mh, spec);
  const uvAll = mh.obj.uv;
  const uvs = b.bodyUV.map((f) => f.map((k) => [uvAll[k * 2], 1 - uvAll[k * 2 + 1]]));
  const skin = b.vw.map((m) => m);
  const cc = catmullClark({ P: b.P, faces: b.bodyFaces, uvs, skin });
  // only vertices that belong to faces
  const tris = cc.faces.flatMap((f) => [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]);
  const N = vertexNormals(cc.P, cc.faces);
  const body = { P: cc.P, N, faces: cc.faces, uvs: cc.uvs, tris, skin: cc.skin, bones: b.bones, boneIndex: mh.boneIndex, measure: b.measure };
  const bone = (n) => b.bones[mh.boneIndex.get(n)];
  const H = spec.stature;
  const sh = bone("upperarm01.L").head;
  // landmarks
  const headJ = bone("head").head;
  const eyeY = bone("eye.L").head[1];
  let mouthY = 0; // set after the chin is found (stomion ≈ 58 % of the way from the eyes to the chin)
  let chinY = Infinity, chinZ = 0, crotchY = 0, earX = 0, earZ = 0;
  const nv = body.P.length / 3;
  const headW = (i) => {
    let s = 0;
    for (const [bi, w] of body.skin[i]) if (/^(head|jaw|special|oris|tongue|risorius|levator|orbic|oculi|temporalis|eye)/.test(b.bones[bi].name)) s += w;
    return s;
  };
  for (let i = 0; i < nv; i++) {
    const p = [body.P[i * 3], body.P[i * 3 + 1], body.P[i * 3 + 2]];
    if (headW(i) > 0.6 && p[2] > headJ[2] + 0.03 && p[1] < chinY) {
      chinY = p[1];
      chinZ = p[2];
    }
    if (Math.abs(p[0]) < 0.006 && p[1] > 0.5 && p[1] < 0.6 * H && p[2] < 0.12 && p[2] > -0.12) {
      // lowest point of the trunk surface between the legs (crotch): maximum of the lower surface
    }
    if (headW(i) > 0.6 && Math.abs(p[1] - (eyeY - 0.015)) < 0.02 && Math.abs(p[0]) > earX) {
      earX = Math.abs(p[0]);
      earZ = p[2];
    }
  }
  // crotch: the highest point of the gap between the thighs (scan the midline downwards)
  {
    let best = 0;
    for (const [a, bb, c] of tris) {
      for (const v of [a, bb, c]) {
        const x = body.P[v * 3], y = body.P[v * 3 + 1];
        if (Math.abs(x) < 0.01 && y < 0.56 * H && y > 0.35 * H && body.N[v * 3 + 1] < -0.5) best = Math.max(best, y);
      }
    }
    crotchY = best || 0.47 * H;
  }
  mouthY = eyeY - 0.58 * (eyeY - chinY);
  const L = {
    stature: H,
    shoulderL: bone("upperarm01.L").head,
    shoulderR: bone("upperarm01.R").head,
    hipL: bone("upperleg01.L").head,
    hipR: bone("upperleg01.R").head,
    kneeL: bone("lowerleg01.L").head,
    kneeR: bone("lowerleg01.R").head,
    notchY: bone("clavicle.L").head[1],
    neckZ: bone("neck01").head[2],
    chestY: sh[1] - (spec.macro.gender > 0.5 ? 0.17 : 0.14) * (H / 1.76),
    bandTop: 0.6 * H - 0.008,
    crotchY,
    eyeY,
    mouthY,
    chinY,
    chinZ,
    crownY: H,
    earX,
    earZ,
    headC: [0, eyeY + 0.01, headJ[2] - 0.005],
  };
  return { b, body, L };
}

/** per-vertex skin Map → top-4 arrays */
function top4(m) {
  const t = [...m.entries()].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = t.reduce((n, [, w]) => n + w, 0) || 1;
  const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  t.forEach(([b, x], k) => {
    j[k] = b;
    w[k] = x / s;
  });
  return [j, w];
}

/** a GLB mesh from positions / normals / uv / skin / triangles */
function glbMesh(name, P, N, uv, skin, tris, extra = {}) {
  const nv = P.length / 3;
  const J = new Uint8Array(nv * 4), W = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    const [j, w] = Array.isArray(skin) ? top4(skin[i]) : [[skin, 0, 0, 0], [1, 0, 0, 0]];
    J.set(j, i * 4);
    W.set(w, i * 4);
  }
  const attrs = {
    POSITION: { data: Float32Array.from(P), size: 3 },
    NORMAL: { data: Float32Array.from(N), size: 3 },
    TEXCOORD_0: { data: Float32Array.from(uv), size: 2 },
    JOINTS_0: { data: J, size: 4 },
    WEIGHTS_0: { data: W, size: 4 },
  };
  for (const [k, v] of Object.entries(extra)) attrs[k] = v;
  return { name, attrs, index: Uint32Array.from(tris.flat()) };
}

/** split a mesh into sub-meshes by a per-vertex class (triangle = majority of its corners) */
function splitByClass(name, m, classes, skinOf) {
  const out = [];
  for (const [cls, label] of Object.entries(classes)) {
    const tris = m.tris.filter((t) => {
      const c = t.map((v) => m.mat[v]);
      const maj = c[0] === c[1] || c[0] === c[2] ? c[0] : c[1];
      return maj === +cls;
    });
    if (!tris.length) continue;
    const remap = new Map();
    const P = [], N = [], uv = [], sk = [];
    const t2 = tris.map((t) =>
      t.map((v) => {
        if (!remap.has(v)) {
          remap.set(v, P.length / 3);
          P.push(m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]);
          N.push(m.N[v * 3], m.N[v * 3 + 1], m.N[v * 3 + 2]);
          uv.push(m.uv[v * 2], m.uv[v * 2 + 1]);
          sk.push(skinOf(v));
        }
        return remap.get(v);
      }),
    );
    out.push(glbMesh(`${name}_${label}`, P, N, uv, sk, t2));
  }
  return out;
}

/** nearest body vertex skin (for boots): brute force over the candidates */
function nearestSkin(body, pts, filter) {
  const cand = [];
  for (let i = 0; i < body.P.length / 3; i++) if (filter(i)) cand.push(i);
  return (v) => {
    const x = pts[v * 3], y = pts[v * 3 + 1], z = pts[v * 3 + 2];
    let best = -1, bd = Infinity;
    for (const i of cand) {
      const d = (body.P[i * 3] - x) ** 2 + (body.P[i * 3 + 1] - y) ** 2 + (body.P[i * 3 + 2] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return body.skin[best];
  };
}

/** body render mesh: split vertices on uv seams; cover bits for culling under gloves / boots */
function bodyMesh(body, L, fields = {}) {
  const key = new Map();
  const P = [], N = [], uv = [], sk = [], cover = [], src = [];
  const tris = [];
  const handRe = /^(wrist|metacarpal|finger)/;
  const footRe = /^(foot|toe)/;
  const coverOf = (v) => {
    let hand = 0, foot = 0;
    for (const [b, w] of body.skin[v]) {
      const n = body.bones[b].name;
      if (handRe.test(n)) hand += w;
      if (footRe.test(n)) foot += w;
    }
    const y = body.P[v * 3 + 1];
    let c = 0;
    if (hand > 0.55) c |= 1;
    if (y < KIT.boot.shaft - 0.025 && (foot > 0.2 || y < 0.12)) c |= 2;
    // deep under the vest / trunks (not near an edge): hidden, culled (the garment cannot be poked through)
    if (fields.vest && fields.vest(v) > 0.03) c |= 4;
    if (fields.trunks && fields.trunks(v) > 0.035) c |= 8;
    return c;
  };
  body.faces.forEach((f, fi) => {
    const ids = f.map((v, k) => {
      const u = body.uvs[fi][k];
      const kk = `${v}_${Math.round(u[0] * 1e5)}_${Math.round(u[1] * 1e5)}`;
      if (!key.has(kk)) {
        key.set(kk, P.length / 3);
        P.push(body.P[v * 3], body.P[v * 3 + 1], body.P[v * 3 + 2]);
        N.push(body.N[v * 3], body.N[v * 3 + 1], body.N[v * 3 + 2]);
        uv.push(u[0], u[1]);
        sk.push(body.skin[v]);
        cover.push(coverOf(v));
        src.push(v);
      }
      return key.get(kk);
    });
    tris.push([ids[0], ids[1], ids[2]], [ids[0], ids[2], ids[3]]);
  });
  const m = glbMesh("body", P, N, uv, sk, tris, { _COVER: { data: Uint8Array.from(cover), size: 1 } });
  return { m, P, uv, tris, src };
}

/** per-vertex region fields on the subdivided body (for the UV bakes) */
function regionFields(body, L, sex) {
  const nv = body.P.length / 3;
  const R = { braid: new Float32Array(nv), vein: new Float32Array(nv), pore: new Float32Array(nv), lips: new Float32Array(nv), palms: new Float32Array(nv), hair: new Float32Array(nv), brows: new Float32Array(nv), joints: new Float32Array(nv), rough: new Float32Array(nv), sweat: new Float32Array(nv), skinRef: new Float32Array(nv) };
  const bw = (i, re) => {
    let s = 0;
    for (const [b, w] of body.skin[i]) if (re.test(body.bones[b].name)) s += w;
    return s;
  };
  const C = L.headC;
  for (let i = 0; i < nv; i++) {
    const p = [body.P[i * 3], body.P[i * 3 + 1], body.P[i * 3 + 2]];
    const n = [body.N[i * 3], body.N[i * 3 + 1], body.N[i * 3 + 2]];
    const head = bw(i, /^(head|jaw|special|oris|tongue|risorius|levator|orbic|oculi|temporalis|eye)/);
    const dx = p[0] - C[0], dy = p[1] - C[1], dz = p[2] - C[2];
    const az = Math.atan2(dx, dz);
    // lips: thin band at the mouth line, front of the face
    const lipD = Math.hypot(dx / 0.027, (p[1] - L.mouthY) / 0.011);
    R.lips[i] = head > 0.5 && dz > 0.05 && body.N[i * 3 + 2] > 0.2 ? clamp(1.3 - lipD, 0, 1) : 0;
    // scalp hair: above the hairline (forehead ~ 6.5 cm above the eyes at the front, lower at the sides / nape)
    const hairline = lerp3(L.eyeY + 0.068, L.eyeY + 0.02, L.eyeY - 0.06, Math.abs(az) / Math.PI);
    const behindEar = Math.abs(az) > 1.25;
    R.hair[i] = head > 0.4 ? smoothstep(hairline - 0.006, hairline + 0.006, p[1]) * (behindEar || p[1] > L.eyeY + 0.03 ? 1 : 0) : 0;
    // brows: an arc above each eye
    for (const s of [1, -1]) {
      const bx = s * 0.033;
      const by = L.eyeY + 0.021 + 0.004 * Math.cos(((p[0] - bx) / 0.025) * 1.2);
      const d = Math.hypot((p[0] - bx) / 0.024, (p[1] - by) / 0.0045);
      if (head > 0.5 && dz > 0.06) R.brows[i] = Math.max(R.brows[i], clamp(1.4 - d, 0, 1) * (sex === "f" ? 0.85 : 1));
    }
    // palms and soles (lighter on deep skin): the palm faces −dorsal; use the hand weight + palm-facing normal
    const hand = bw(i, /^(wrist|metacarpal|finger)/);
    const foot = bw(i, /^(foot|toe)/);
    if (hand > 0.5) {
      const s = p[0] > 0 ? ".L" : ".R";
      const W = body.bones[body.boneIndex.get(`wrist${s}`)].head;
      const K = body.bones[body.boneIndex.get(`finger3-1${s}`)].head;
      const T1 = body.bones[body.boneIndex.get(`finger1-2${s}`)].head;
      const I = body.bones[body.boneIndex.get(`finger2-1${s}`)].head;
      const fwd = norm3([K[0] - W[0], K[1] - W[1], K[2] - W[2]]);
      const palmDir = norm3([T1[0] - I[0], T1[1] - I[1], T1[2] - I[2]]);
      const pp = palmDir[0] * n[0] + palmDir[1] * n[1] + palmDir[2] * n[2] - (fwd[0] * n[0] + fwd[1] * n[1] + fwd[2] * n[2]) * 0;
      R.palms[i] = smoothstep(0.1, 0.55, pp) * 0.9;
    }
    if (foot > 0.5 && n[1] < -0.4) R.palms[i] = 0.8;
    // joints: knuckles, elbows, knees
    const near = (bn, r) => {
      const j = body.bones[body.boneIndex.get(bn)].head;
      return Math.exp(-(((p[0] - j[0]) ** 2 + (p[1] - j[1]) ** 2 + (p[2] - j[2]) ** 2) / (r * r)));
    };
    let jt = 0;
    for (const s of [".L", ".R"]) {
      jt = Math.max(jt, near(`lowerarm01${s}`, 0.04) * 0.9, near(`lowerleg01${s}`, 0.05) * 0.7);
      for (let f = 2; f <= 5; f++) jt = Math.max(jt, near(`finger${f}-1${s}`, 0.012));
    }
    R.joints[i] = jt;
    // roughness: base 0.5; T-zone (forehead, nose) and lips shinier; palms and scalp matte
    let rough = 0.52;
    const tzone = head > 0.5 && dz > 0.05 ? Math.max(Math.exp(-((dx / 0.018) ** 2)) * smoothstep(L.mouthY + 0.02, L.eyeY - 0.01, p[1]), smoothstep(L.eyeY + 0.025, L.eyeY + 0.04, p[1]) * (1 - R.hair[i])) : 0;
    rough = lerp(rough, 0.4, tzone);
    rough = lerp(rough, 0.34, R.lips[i]);
    rough = lerp(rough, 0.62, R.palms[i]);
    rough = lerp(rough, 0.7, R.hair[i]);
    // natural break-up: oilier and drier patches at a few cm, finer at a few mm
    rough += (fbm3(p[0] * 30, p[1] * 30, p[2] * 30) - 0.5) * 0.12 + (fbm3(p[0] * 160, p[1] * 160, p[2] * 160) - 0.5) * 0.06;
    R.rough[i] = rough;
    // sweat mask (where sweat shows first): forehead, temples, nose, upper lip, chest centre, shoulders / traps,
    // upper back, forearms; a large-scale break-up so it pools in patches
    const chest = Math.exp(-((p[0] / 0.07) ** 2)) * Math.exp(-(((p[1] - (L.chestY + 0.05)) / 0.12) ** 2)) * (p[2] > 0 ? 1 : 0);
    const traps = Math.exp(-(((p[1] - L.shoulderL[1] - 0.02) / 0.07) ** 2)) * smoothstep(0.05, 0.12, Math.abs(p[0]));
    const back = Math.exp(-((p[0] / 0.1) ** 2)) * Math.exp(-(((p[1] - (L.chestY + 0.02)) / 0.15) ** 2)) * (p[2] < 0 ? 1 : 0);
    const face = head > 0.5 && dz > 0.03 ? smoothstep(L.mouthY - 0.01, L.mouthY + 0.02, p[1]) * (1 - R.hair[i]) * (1 - R.brows[i]) : 0;
    const arms = bw(i, /^(upperarm|lowerarm)/) * 0.55;
    const brk = 0.55 + 0.9 * (fbm3(p[0] * 14, p[1] * 14, p[2] * 14) - 0.5);
    R.sweat[i] = clamp(Math.max(face, chest * 0.9, traps * 0.8, back * 0.7, arms) * brk, 0, 1);
    R.skinRef[i] = head < 0.1 && hand < 0.1 && foot < 0.1 ? 1 : 0;
    R.pore[i] = head > 0.5 ? 1 : 0.3;
    // colour zones: blood-rich areas a little warmer / redder (cheeks, nose, ears, lips' edge, knuckles, elbows)
    {
      const cheek = head > 0.5 && dz > 0.04 ? Math.max(...[1, -1].map((sg) => Math.exp(-(((p[0] - sg * 0.04) / 0.022) ** 2 + ((p[1] - (L.eyeY - 0.03)) / 0.02) ** 2)))) : 0;
      const nose = head > 0.5 && dz > 0.08 ? Math.exp(-((p[0] / 0.012) ** 2 + ((p[1] - (L.eyeY - 0.035)) / 0.02) ** 2)) : 0;
      const ear = head > 0.5 && Math.abs(p[0]) > Math.abs(L.earX) - 0.015 && Math.abs(p[1] - (L.eyeY - 0.015)) < 0.035 ? 1 : 0;
      R.flush = R.flush ?? new Float32Array(nv);
      R.flush[i] = Math.max(cheek * 0.8, nose, ear * 0.7, jt * 0.6);
    }
    // natural hair for the women: cornrows, front to back (rows by azimuth, a braid ripple along each row)
    if (sex === "f" && R.hair[i] > 0) {
      const rowAng = az * 7;
      const row = 0.5 + 0.5 * Math.cos(rowAng * 2);
      const along = 0.5 + 0.5 * Math.sin(Math.atan2(p[1] - C[1], dz) * 60 + rowAng);
      R.braid[i] = R.hair[i] * row ** 0.6 * (0.6 + 0.4 * along);
    }
    // superficial veins: forearm (cephalic / basilic / median), back of the hand, over the biceps; sinuous lines
    {
      const s2 = p[0] > 0 ? ".L" : ".R";
      const E = body.bones[body.boneIndex.get(`lowerarm01${s2}`)].head;
      const W = body.bones[body.boneIndex.get(`wrist${s2}`)].head;
      const S = body.bones[body.boneIndex.get(`upperarm01${s2}`)].head;
      const segDist = (a, b, q) => {
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
        return [Math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t, q[2] - a[2] - ab[2] * t), t];
      };
      const fore = bw(i, /^lowerarm/) + bw(i, /^wrist/) * 0.5;
      const upper = bw(i, /^upperarm/);
      let vh = 0;
      if (fore > 0.4) {
        // the veins run on the surface: use the angle round the forearm axis
        const ax = norm3([W[0] - E[0], W[1] - E[1], W[2] - E[2]]);
        const [, t] = segDist(E, W, p);
        const c = [E[0] + (W[0] - E[0]) * t, E[1] + (W[1] - E[1]) * t, E[2] + (W[2] - E[2]) * t];
        const r = norm3([p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
        const ref = norm3([0, 0, 1]);
        const u0 = norm3([ref[0] - ax[0] * (ref[0] * ax[0] + ref[1] * ax[1] + ref[2] * ax[2]), ref[1] - ax[1] * (ref[0] * ax[0] + ref[1] * ax[1] + ref[2] * ax[2]), ref[2] - ax[2] * (ref[0] * ax[0] + ref[1] * ax[1] + ref[2] * ax[2])]);
        const v0 = [ax[1] * u0[2] - ax[2] * u0[1], ax[2] * u0[0] - ax[0] * u0[2], ax[0] * u0[1] - ax[1] * u0[0]];
        const ang = Math.atan2(r[0] * v0[0] + r[1] * v0[1] + r[2] * v0[2], r[0] * u0[0] + r[1] * u0[1] + r[2] * u0[2]);
        for (const [a0, amp, ph] of [[0.4, 0.18, 1.3], [-0.6, 0.22, 2.1], [1.4, 0.12, 0.4]]) {
          const target = a0 + amp * Math.sin(t * 7 + ph) + 0.08 * Math.sin(t * 17 + ph * 2);
          let da = Math.abs(((ang - target + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          vh = Math.max(vh, Math.exp(-((da / 0.07) ** 2)) * Math.min(1, t * 3) * (0.6 + 0.4 * Math.sin(t * 5 + ph)));
        }
      }
      if (upper > 0.5) {
        const [d, t] = segDist(S, E, p);
        const front = p[2] > (S[2] + E[2]) / 2 + 0.02 ? 1 : 0;
        vh = Math.max(vh, front * Math.exp(-(((p[0] - (S[0] + (E[0] - S[0]) * t) - Math.sign(p[0]) * 0.012 * Math.sin(t * 9)) / 0.004) ** 2)) * smoothstep(0.3, 0.6, t) * 0.7);
      }
      R.vein[i] = vh;
    }
  }
  return R;
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, c, t) => (t < 0.5 ? lerp(a, b, t * 2) : lerp(b, c, (t - 0.5) * 2));
const norm3 = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((x) => x / l);
};
import { fbm } from "./lib/geo.mjs";
const fbm3 = (x, y, z) => fbm(x, y, z, 3);

/** bake one sex's skin maps (shared by its weight classes; MakeHuman UV) */
async function bakeSkin(sex, body, L) {
  const dir = join(OUT, `skin-${sex}`);
  mkdirSync(dir, { recursive: true });
  const R = regionFields(body, L, sex);
  // corner arrays for the rasteriser
  const tris = [];
  const uv = [];
  const vals = [];
  if (!R.flush) R.flush = new Float32Array(R.lips.length);
  const keys = ["lips", "palms", "hair", "brows", "joints", "rough", "sweat", "skinRef", "vein", "pore", "braid", "flush"];
  let c = 0;
  body.faces.forEach((f, fi) => {
    const corner = (k) => {
      const v = f[k];
      uv.push(body.uvs[fi][k][0], body.uvs[fi][k][1]);
      for (const kk of keys) vals.push(R[kk][v]);
      return c++;
    };
    const a = corner(0), b = corner(1), cc = corner(2), d = corner(3);
    tris.push([a, b, cc], [a, cc, d]);
  });
  const size = TEX;
  const { data } = rasterUV(tris, uv, vals, keys.length, size);
  const plane = (k) => {
    const o = new Float32Array(size * size);
    const ki = keys.indexOf(k);
    for (let i = 0; i < o.length; i++) o[i] = data[i * keys.length + ki];
    return o;
  };
  const regions = Object.fromEntries(keys.map((k) => [k, plane(k)]));
  const src = await loadImage(join(REPO, `apps/web/public/assets/characters/skin-${sex}.webp`), size);
  for (const tone of TONES) {
    const alb = composeAlbedo(src, size, tone, regions);
    await writeRGB(join(dir, `albedo-${tone.id}.jpg`), alb, size, { quality: 93 });
  }
  const anatomy = await loadImage(join(REPO, `apps/web/public/assets/characters/body-detail-${sex}.webp`));
  const { normal } = composeNormal(src, size, anatomy, { fineGain: 2.4, anatomyGain: 1.25, vein: regions.vein, poreMask: regions.pore, braid: sex === "f" ? regions.braid : null });
  await writeRGB(join(dir, "normal.png"), normal, size);
  await writeGrey(join(dir, "roughness.png"), regions.rough, size);
  await writeGrey(join(dir, "sweat.png"), regions.sweat, size);
  if (process.env.DEBUG_MASKS) for (const k of ["lips", "brows", "hair", "palms", "joints", "vein", "braid"]) await writeGrey(join(dir, `mask-${k}.png`), regions[k], size);
  return dir;
}

/** MakeHuman high-poly eyes fitted to the body, cornea texels dropped */
async function eyesMesh(b, spec) {
  const prox = readProxy(join(MH, "eyes/high-poly/high-poly.mhclo"));
  const pts = prox.fit(b.pdm);
  const obj = readObj(join(MH, "eyes/high-poly", prox.objFile));
  const s = b.scale;
  const P = new Float64Array(pts.length);
  for (let i = 0; i < pts.length / 3; i++) {
    P[i * 3] = pts[i * 3] * DM * s;
    P[i * 3 + 1] = (pts[i * 3 + 1] - b.minY) * DM * s;
    P[i * 3 + 2] = pts[i * 3 + 2] * DM * s;
  }
  const img = await loadImageRGBA(join(MH, "eyes/materials/brown_eye.png"));
  const faces = [...obj.groups.values()].flat();
  const fuv = [...obj.uvGroups.values()].flat();
  const outP = [], outUV = [], sk = [], tris = [];
  const eyeL = mh.boneIndex.get("eye.L"), eyeR = mh.boneIndex.get("eye.R");
  faces.forEach((f, fi) => {
    const uvs = fuv[fi].map((k) => [obj.uv[k * 2], 1 - obj.uv[k * 2 + 1]]);
    const cu = uvs.reduce((a, u) => [a[0] + u[0] / uvs.length, a[1] + u[1] / uvs.length], [0, 0]);
    const ax = Math.min(img.w - 1, Math.floor(cu[0] * img.w)), ay = Math.min(img.h - 1, Math.floor(cu[1] * img.h));
    if (img.data[(ay * img.w + ax) * 4 + 3] < 128) return; // cornea shell
    const ids = f.map((v, k) => {
      outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      outUV.push(uvs[k][0], uvs[k][1]);
      sk.push(P[v * 3] > 0 ? eyeL : eyeR);
      return outP.length / 3 - 1;
    });
    for (let k = 1; k + 1 < ids.length; k++) tris.push([ids[0], ids[k], ids[k + 1]]);
  });
  const N = vertexNormals(Float64Array.from(outP), tris);
  const eyes = glbMesh("eyes", outP, N, outUV, sk.map((j) => new Map([[j, 1]])), tris);
  // eye centres / radii for the lashes
  const ext = { L: [[9, 9, 9], [-9, -9, -9]], R: [[9, 9, 9], [-9, -9, -9]] };
  for (let i = 0; i < outP.length / 3; i++) {
    const S = outP[i * 3] > 0 ? "L" : "R";
    for (let a = 0; a < 3; a++) {
      ext[S][0][a] = Math.min(ext[S][0][a], outP[i * 3 + a]);
      ext[S][1][a] = Math.max(ext[S][1][a], outP[i * 3 + a]);
    }
  }
  eyes.centres = Object.fromEntries(Object.entries(ext).map(([S, [lo, hi]]) => [S, { c: lo.map((v, a) => (v + hi[a]) / 2), r: (hi[0] - lo[0]) / 2 }]));
  return eyes;
}

/** lashes (upper / lower) and brow hairs as thin strips: the face reads as human only with them */
function faceHair(body, eyes, R, headBone) {
  const P = [], N = [], UV = [], tris = [];
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const strip = (pts, w0, w1, nrm) => {
    // a flat tapered strip through pts, facing nrm
    const base = P.length / 3;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      const t = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const side = norm3([t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]]);
      const w = lerp(w0, w1, k / (pts.length - 1)) / 2;
      for (const sg of [-1, 1]) {
        P.push(pts[k][0] + side[0] * w * sg, pts[k][1] + side[1] * w * sg, pts[k][2] + side[2] * w * sg);
        N.push(...nrm);
        UV.push(sg > 0 ? 1 : 0, k / (pts.length - 1));
      }
    }
    for (let k = 0; k < pts.length - 1; k++) {
      const a = base + k * 2;
      tris.push([a, a + 1, a + 3], [a, a + 3, a + 2]);
    }
  };
  for (const S of ["L", "R"]) {
    const { c, r } = eyes.centres[S];
    const sg = S === "L" ? 1 : -1;
    const Rb = r * 1.0;
    const lid = (s, up) => {
      const x = c[0] + s * 0.0145 * sg;
      const y = c[1] + (up ? 0.0048 * (1 - s * s) + 0.0008 : -0.0035 * (1 - s * s) - 0.0004);
      const dz = Math.sqrt(Math.max(0, Rb * Rb - (x - c[0]) ** 2 - (y - c[1]) ** 2));
      return [x, y, c[2] + dz + 0.0013];
    };
    for (const up of [true, false]) {
      const n = up ? 70 : 34;
      for (let k = 0; k < n; k++) {
        const s = -0.95 + (1.9 * (k + rnd() * 0.6)) / n;
        const m = lid(s, up);
        const len = (up ? 0.0075 : 0.0038) * (0.55 + 0.45 * (1 - Math.abs(s - 0.25 * sg * 0) ** 2)) * (0.8 + 0.4 * rnd());
        const dir = up ? [s * 0.25 * sg, 0.35, 1] : [s * 0.2 * sg, -0.5, 1];
        const d = norm3(dir);
        const curl = up ? [0, 1, -0.3] : [0, -1, -0.2];
        const pts = [];
        for (let q = 0; q <= 3; q++) {
          const t = q / 3;
          pts.push([m[0] + d[0] * len * t + curl[0] * len * t * t * 0.5, m[1] + d[1] * len * t + curl[1] * len * t * t * 0.5, m[2] + d[2] * len * t + curl[2] * len * t * t * 0.5]);
        }
        strip(pts, 0.00022, 0.00005, norm3([0, up ? -1 : 1, 0.6]));
      }
    }
  }
  // brows: short hairs lying along the skin, pointing outwards and a little up
  const nv = body.P.length / 3;
  for (let i = 0; i < nv; i++) {
    if (R.brows[i] < 0.45) continue;
    const p = [body.P[i * 3], body.P[i * 3 + 1], body.P[i * 3 + 2]];
    const n = [body.N[i * 3], body.N[i * 3 + 1], body.N[i * 3 + 2]];
    for (let h = 0; h < 3; h++) {
      const sg = Math.sign(p[0]);
      const inner = Math.max(0, 1 - Math.abs(p[0]) / 0.02);
      let d = [sg * (1 - inner * 0.7), 0.35 + inner * 0.8, 0];
      const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      d = norm3([d[0] - n[0] * dn, d[1] - n[1] * dn, d[2] - n[2] * dn]);
      const len = 0.006 + rnd() * 0.004;
      const o = [p[0] + (rnd() - 0.5) * 0.003 + n[0] * 0.0004, p[1] + (rnd() - 0.5) * 0.002 + n[1] * 0.0004, p[2] + n[2] * 0.0004];
      const pts = [0, 1, 2].map((q) => {
        const t = q / 2;
        return [o[0] + d[0] * len * t + n[0] * 0.0008 * t * (1 - t), o[1] + d[1] * len * t + n[1] * 0.0008 * t * (1 - t), o[2] + d[2] * len * t + n[2] * 0.0008 * t * (1 - t)];
      });
      strip(pts, 0.0003, 0.00008, n);
    }
  }
  return glbMesh("facehair", P, N, UV, P.map(() => 0).filter((_, k) => k % 3 === 0).map(() => new Map([[headBone, 1]])), tris);
}
async function loadImageRGBA(path) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const skinDone = new Set();
for (const [key, spec] of Object.entries(FIGHTERS)) {
  if (only && !only.includes(key)) continue;
  const t0 = Date.now();
  const sex = spec.macro.gender > 0.5 ? "m" : "f";
  const { b, body, L } = prepare(key, spec);
  console.log(`${key}: body ${body.P.length / 3} verts, ${body.tris.length} tris (${Date.now() - t0} ms)`);
  const meshes = [];
  const vest = buildVest(body, L, sex);
  const trunks = buildTrunks(body, L);
  const bm = bodyMesh(body, L, { vest: vest.field, trunks: trunks.satin.field });
  meshes.push(bm.m);
  const eyes = await eyesMesh(b, spec);
  meshes.push(eyes);
  meshes.push(faceHair(body, eyes, regionFields(body, L, sex), mh.boneIndex.get("head")));
  // vest: outer + inner in one mesh, the rolled binding as its own mesh (chocolate accent)
  {
    const m = { P: vest.P, N: vest.N, uv: vest.uv, tris: vest.tris, mat: Uint8Array.from(vest.side, (s) => (s === 2 ? 1 : 0)) };
    meshes.push(...splitByClass("vest", m, { 0: "jersey", 1: "binding" }, (v) => vest.skin[v]));
  }
  meshes.push(glbMesh("trunks_satin", trunks.satin.P, trunks.satin.N, trunks.satin.uv, trunks.satin.skin, trunks.satin.tris));
  meshes.push(glbMesh("trunks_band", trunks.band.P, trunks.band.N, trunks.band.uv, trunks.band.skin, trunks.band.tris));
  console.log(`  garments (${Date.now() - t0} ms)`);
  for (const S of ["L", "R"]) {
    const g = buildGlove(body, S);
    const j = mh.boneIndex.get(g.bone);
    const fa = mh.boneIndex.get(`lowerarm02.${S}`);
    // rigid to the hand; the cuff end blends 35 % into the forearm twist bone (no gap, no candy wrapper)
    const gskin = (v) => {
      const k = 0.35 * smoothstep(-0.045, -0.105, g.local[v * 3]);
      return new Map(k > 0 ? [[j, 1 - k], [fa, k]] : [[j, 1]]);
    };
    meshes.push(...splitByClass(`glove${S}`, g, { 0: "leather", 1: "target", 2: "tape" }, gskin));
  }
  console.log(`  gloves (${Date.now() - t0} ms)`);
  const hg = buildHeadgear(body, L);
  {
    const j = mh.boneIndex.get("head");
    meshes.push(...splitByClass("headgear", hg, { 0: "shell", 2: "chinstrap", 3: "velcro" }, () => new Map([[j, 1]])));
  }
  console.log(`  headgear (${Date.now() - t0} ms)`);
  for (const S of ["L", "R"]) {
    const bt = buildBoot(body, L, S);
    console.log(`  boot${S} coverage`, JSON.stringify(bt.coverage));
    meshes.push(...splitByClass(`boot${S}`, bt, { 0: "upper", 1: "sole", 2: "lace" }, (v) => bt.skin[v]));
  }
  console.log(`  boots (${Date.now() - t0} ms)`);
  for (const S of ["L", "R"]) {
    const w = buildWraps(body, S);
    meshes.push(glbMesh(`wraps${S}`, w.P, w.N, w.uv, w.skin, w.tris));
  }
  const bones = b.bones.map((bb) => ({ name: bb.name, parent: bb.parent, pos: bb.head }));
  const extras = {
    fighter: key,
    label: spec.label,
    sex,
    stature: spec.stature,
    tails: b.bones.map((bb) => bb.tail),
    landmarks: L,
    measure: b.measure,
    kit: KIT,
    source: "MakeHuman 1.x CC0 (base.obj, macro + regional targets, default skeleton + weights, high-poly eyes); sculpt, kit and bakes: Gukirana (P3-FGT-19A)",
  };
  writeGlb(join(OUT, `${key}.glb`), { bones, meshes, extras });
  const tris = meshes.reduce((n, m) => n + m.index.length / 3, 0);
  console.log(`${key}.glb written: ${meshes.length} meshes, ${tris} triangles (${Date.now() - t0} ms)`);
  writeFileSync(join(OUT, `${key}.json`), JSON.stringify({ measure: b.measure, landmarks: L, meshes: meshes.map((m) => [m.name, m.attrs.POSITION.data.length / 3, m.index.length / 3]) }, null, 1));
  if (!skinDone.has(sex) && process.env.BAKE !== "0") {
    await bakeSkin(sex, body, L);
    skinDone.add(sex);
    console.log(`  skin-${sex} maps (${Date.now() - t0} ms)`);
  }
}
{
  // eye: MakeHuman CC0 brown eye, iris deepened to a dark brown, sclera a warm off-white
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(join(MH, "eyes/materials/brown_eye.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    if (sat > 0.35) {
      // iris
      const l = (r + g + b) / 3;
      data[i] = Math.min(255, l * 0.62 + 6);
      data[i + 1] = Math.min(255, l * 0.38 + 3);
      data[i + 2] = Math.min(255, l * 0.24 + 2);
    } else {
      data[i] = Math.min(255, r * 1.04 + 6);
      data[i + 1] = Math.min(255, g * 1.0 + 3);
      data[i + 2] = Math.min(255, b * 0.95);
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(join(OUT, "eye.png"));
}
