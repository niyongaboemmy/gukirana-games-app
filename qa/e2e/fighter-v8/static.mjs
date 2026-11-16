// P3-FGT-19B fighter-v8 harness: the STATIC acceptance checks (docs/design/fighter-v8/SPEC.md §15) — everything that
// can be measured on the shipped GLBs, the KTX2 skin set and the design's sources without a browser: proportions of the
// four weight classes, the band / trunks / gathers numbers, the glove and headgear dimensions, the tone albedos, the
// triangle and texture budgets, the adults-only rule. The per-pose checks run in the page (inpage.js).
//
//   node qa/e2e/fighter-v8/static.mjs [--json]      → prints the metrics (run.mjs merges them under `static`)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fighterTriangles, readBoxerGlb } from "../../../apps/web/scripts/boxer/glb-read.mjs";
import { measureGlb } from "../../../apps/web/scripts/boxer/measure-glb.mjs";
import { hullPerimeter } from "../../../apps/web/scripts/boxer/measure.mjs";
import { closestSurface, triGrid } from "../../../apps/web/scripts/boxer/garment-skin.mjs";
import { budget } from "../../../apps/web/scripts/boxer/texture-budget.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const CHAR = join(ROOT, "apps/web/public/assets/characters");
const SRC = join(ROOT, "apps/web/scripts/boxer/source-v8");
const MAT = { skin: 0, vest: 1, vestTrim: 2, trunks: 3, glove: 8, gloveTarget: 9, gloveCuff: 10, headgear: 11, headgearTrim: 12, belt: 24 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r3 = (x) => (x == null ? null : +x.toFixed(4));
const pct = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))] : null;
};

/** sRGB hex / [0..255] → CIE Lab (D65) */
export function lab(c) {
  const rgb = typeof c === "string" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c;
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    Y = 0.2126 * r + 0.7152 * g + 0.0722 * b,
    Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export const deltaE = (a, b) => Math.hypot(...sub(lab(a), lab(b)));
export const chroma = (c) => Math.hypot(lab(c)[1], lab(c)[2]);

/** one mesh's vertices of some material slots as [x,y,z] with their dominant joint */
function slotVerts(glb, mesh, slots) {
  const m = glb.meshes.get(mesh);
  if (!m) return [];
  const out = [];
  for (let i = 0; i < m.P.length / 3; i++) {
    if (!slots.includes(m.attrs._mat[i])) continue;
    let bj = 0,
      bw = -1;
    for (let q = 0; q < 4; q++) if (m.W[i * 4 + q] > bw) ((bw = m.W[i * 4 + q]), (bj = m.J[i * 4 + q]));
    out.push({ p: [m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]], j: glb.joints[bj]?.name ?? "", i });
  }
  return out;
}

function jointAt(glb, name) {
  return glb.joints.find((j) => j.name === name)?.pos ?? null;
}

/** the body's skin surface (body mesh, skin slot) as a triangle grid */
function skinSurface(glb, filter = () => true) {
  const b = glb.meshes.get("body");
  const tris = [];
  for (let t = 0; t < b.index.length; t += 3) {
    const [x, y, z] = [b.index[t], b.index[t + 1], b.index[t + 2]];
    if (b.attrs._mat[x] !== 0 || !filter(x) || !filter(y) || !filter(z)) continue;
    tris.push([x, y, z]);
  }
  return { grid: triGrid(b.P, tris, 0.03), tris, P: b.P };
}

/** the principal axis of a point set (power iteration on the covariance), signed along `hint` */
export function principalAxis(pts, hint) {
  const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const q = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += q[i] * q[j];
  }
  let v = norm(hint);
  for (let it = 0; it < 60; it++) v = norm([0, 1, 2].map((i) => C[i * 3] * v[0] + C[i * 3 + 1] * v[1] + C[i * 3 + 2] * v[2]));
  return dot(v, hint) < 0 ? v.map((x) => -x) : v;
}

/** the glove dimensions in the hand frame (SPEC §7a, §8; checklist 15), bind pose, one side */
export function gloveChecks(glb, S = "L") {
  const verts = slotVerts(glb, "kit_gloves", [MAT.glove, MAT.gloveTarget, MAT.gloveCuff]).filter((v) => v.j.includes(`_${S}_`));
  const panel = slotVerts(glb, "kit_gloves", [MAT.gloveTarget]).filter((v) => v.j.includes(`_${S}_`));
  const tape = slotVerts(glb, "kit_gloves", [MAT.gloveCuff]).filter((v) => v.j.includes(`_${S}_`));
  const wrist = jointAt(glb, `Bip01_${S}_Hand`),
    elbow = jointAt(glb, `Bip01_${S}_Forearm`);
  const idx = jointAt(glb, `Bip01_${S}_Finger1`),
    pinky = jointAt(glb, `Bip01_${S}_Finger4`),
    thumbTip = jointAt(glb, `Bip01_${S}_Finger02`) ?? jointAt(glb, `Bip01_${S}_Finger0`);
  if (!verts.length || !wrist || !elbow) return null;
  // the glove's own long axis (principal axis of its vertices), pointing from the cuff to the striking face
  const a = principalAxis(verts.map((v) => v.p), sub(wrist, elbow));
  let r = sub(idx, pinky);
  r = norm(sub(r, a.map((x) => x * dot(r, a))));
  let d = cross(a, r);
  if (thumbTip && dot(sub(thumbTip, wrist), d) > 0) d = d.map((x) => -x); // the thumb is on the palm side (−d)
  const loc = (p) => {
    const q = sub(p, wrist);
    return [dot(q, a), dot(q, r), dot(q, d)];
  };
  const L = verts.map((v) => loc(v.p));
  const sMax = Math.max(...L.map((x) => x[0])),
    sMin = Math.min(...L.map((x) => x[0]));
  // across the knuckles: the slice 1.5–4 cm behind the striking face (in front of the thumb lobe)
  const block = L.filter((x) => x[0] > sMax - 0.04 && x[0] < sMax - 0.015);
  const width = Math.max(...block.map((x) => x[1])) - Math.min(...block.map((x) => x[1]));
  const depth = Math.max(...block.map((x) => x[2])) - Math.min(...block.map((x) => x[2]));
  // the cuff section round the wrist: where the tape band wraps it (the opening flares wider)
  const tapeS = tape.map((v) => loc(v.p)[0]);
  const tMid = tapeS.length ? (Math.min(...tapeS) + Math.max(...tapeS)) / 2 : sMin + 0.05;
  const cuffSec = L.slice()
    .sort((p, q) => Math.abs(p[0] - tMid) - Math.abs(q[0] - tMid))
    .slice(0, 60);
  const cuffDia = Math.max(Math.max(...cuffSec.map((x) => x[1])) - Math.min(...cuffSec.map((x) => x[1])), Math.max(...cuffSec.map((x) => x[2])) - Math.min(...cuffSec.map((x) => x[2])));
  let crease = sMin;
  for (let s = sMin + 0.01; s < sMax; s += 0.004) {
    const sec = L.filter((x) => Math.abs(x[0] - s) < 0.004);
    if (!sec.length) continue;
    const w = Math.max(Math.max(...sec.map((x) => x[1])) - Math.min(...sec.map((x) => x[1])), Math.max(...sec.map((x) => x[2])) - Math.min(...sec.map((x) => x[2])));
    crease = s;
    if (w > cuffDia * 1.15) break;
  }
  const T = tape.map((v) => loc(v.p)[0]);
  const P = panel.map((v) => loc(v.p));
  const thumb = L.filter((x) => x[1] > width * 0.3 && x[2] < -0.01 && x[0] > sMax - 0.13 && x[0] < sMax - 0.03).length;
  return {
    length: r3(sMax - sMin),
    // the spec's overall length is "along the back": the straight length plus the knuckle roll's quarter arc (Ø 5.2 cm)
    lengthAlongBack: r3(sMax - sMin + (Math.PI / 2 - 1) * 0.026),
    knuckleWidth: r3(width),
    knuckleDepth: r3(depth),
    // (SPEC §7a: the cuff's length is measured behind the wrist joint — "cuff 10.4 cm behind it")
    cuff: r3(-sMin),
    cuffToCrease: r3(crease - sMin),
    tape: T.length ? r3(Math.max(...T) - Math.min(...T)) : null,
    blockToCuff: r3(Math.max(width, depth) / cuffDia),
    panelBelowDorsal: P.filter((x) => x[2] < -0.035).length,
    panelBehindFace: P.filter((x) => x[0] < sMax - 0.06).length,
    panelOk: P.length > 0 && P.every((x) => x[2] >= -0.035 && x[0] >= sMax - 0.06),
    thumbVerts: thumb,
    thumbOk: thumb > 15,
  };
}

/** headgear padding over the head (checklist 16): outer-surface distance to the head's skin */
export function headgearChecks(glb) {
  const hg = slotVerts(glb, "kit_headgear", [MAT.headgear]);
  const b = glb.meshes.get("body");
  const head = jointAt(glb, "Bip01_Head");
  const eyeL = jointAt(glb, "Bip01_L_Eye");
  const hj = glb.joints.findIndex((j) => j.name === "Bip01_Head");
  const headV = (i) => {
    for (let q = 0; q < 4; q++) if (b.J[i * 4 + q] === hj && b.W[i * 4 + q] > 0.6) return true;
    return false;
  };
  // the covered area: head skin the build culled under the headgear (COVER.headgear = 16)
  const surf = skinSurface(glb, (i) => headV(i) && (b.attrs._cover[i] & 16) !== 0);
  const centre = [head[0], head[1] + 0.06, head[2]];
  const th = [],
    brow = [],
    rim = [];
  for (const v of hg) {
    const h = closestSurface(surf.grid, v.p, 0.08);
    if (!h) continue;
    // outer surface only: farther from the head centre than the skin point it covers
    if (len(sub(v.p, centre)) < len(sub(h.q, centre)) + 0.004) continue;
    // the pad's face (normal within ~35° of radial), not its rounded rim at the face opening / jaw edge
    const hm = glb.meshes.get("kit_headgear");
    const n = [hm.attrs.NORMAL[v.i * 3], hm.attrs.NORMAL[v.i * 3 + 1], hm.attrs.NORMAL[v.i * 3 + 2]];
    if (dot(norm(n), norm(sub(v.p, centre))) < 0.82) {
      rim.push(h.d);
      continue;
    }
    th.push(h.d);
    if (eyeL && v.p[2] > head[2] + 0.04 && v.p[1] > eyeL[1] + 0.015 && v.p[1] < eyeL[1] + 0.06 && Math.abs(v.p[0]) < 0.05) brow.push(h.d);
  }
  return { paddingP02: r3(pct(th, 0.02)), paddingMedian: r3(pct(th, 0.5)), browRoll: r3(brow.length ? Math.max(...brow) : null), sampled: th.length, rimSamples: rim.length, rimMin: r3(rim.length ? Math.min(...rim) : null) };
}

/** the band, trunks hem and opening, singlet tuck (checklist 9–13), bind pose */
export function garmentChecks(glb, patterns, kitHex) {
  const band = slotVerts(glb, "kit_trunks", [MAT.belt]).map((v) => v.p);
  const trunks = slotVerts(glb, "kit_trunks", [MAT.trunks]).map((v) => v.p);
  const vest = slotVerts(glb, "kit_vest", [MAT.vest, MAT.vestTrim]).map((v) => v.p);
  const H = measureGlb(glb).stature;
  const bTop = Math.max(...band.map((p) => p[1])),
    bBot = Math.min(...band.map((p) => p[1]));
  const bx = band.reduce((s, p) => s + p[0], 0) / band.length,
    bz = band.reduce((s, p) => s + p[2], 0) / band.length;
  const bins = new Map();
  for (const p of band) {
    const k = Math.floor((((Math.atan2(p[2] - bz, p[0] - bx) / (2 * Math.PI)) + 1) % 1) * 48);
    const e = bins.get(k) ?? [Infinity, -Infinity];
    e[0] = Math.min(e[0], p[1]);
    e[1] = Math.max(e[1], p[1]);
    bins.set(k, e);
  }
  const bandW = pct([...bins.values()].map(([lo, hi]) => hi - lo), 0.5);
  const skin = skinSurface(glb);
  const dev = band.map((p) => closestSurface(skin.grid, p, 0.05)?.d ?? 0.05);
  // the singlet inside the band within its height: radius from the band's axis at the same azimuth
  const cx = band.reduce((s, p) => s + p[0], 0) / band.length,
    cz = band.reduce((s, p) => s + p[2], 0) / band.length;
  const NA = 72;
  const bandR = new Array(NA).fill(0);
  for (const p of band) {
    const k = Math.floor((((Math.atan2(p[2] - cz, p[0] - cx) / (2 * Math.PI)) + 1) % 1) * NA);
    bandR[k] = Math.max(bandR[k], Math.hypot(p[0] - cx, p[2] - cz));
  }
  let tuckBad = 0,
    tuckTested = 0,
    tuckWorst = 0;
  for (const p of vest) {
    if (p[1] > bTop - 0.002 || p[1] < bBot) continue;
    // against the nearest band vertex, radially round the band's centroid
    let nb = null,
      nd = 0.05;
    for (const q of band) {
      const dd = len(sub(q, p));
      if (dd < nd) ((nd = dd), (nb = q));
    }
    if (!nb) continue;
    tuckTested++;
    const gap = Math.hypot(nb[0] - cx, nb[2] - cz) - Math.hypot(p[0] - cx, p[2] - cz);
    if (gap < 0.001) {
      tuckBad++;
      tuckWorst = Math.max(tuckWorst, 0.001 - gap);
    }
  }
  // hem and opening per leg (stand = bind pose)
  const legs = {};
  for (const S of ["L", "R"]) {
    const sg = S === "L" ? 1 : -1;
    const leg = trunks.filter((p) => p[0] * sg > 0);
    const low = Math.min(...leg.map((p) => p[1]));
    const ring = leg.filter((p) => p[1] < low + 0.02);
    // (the hem line: the mean height of the lowest 2 cm — one fold hanging lower is not the hem)
    const hem = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const ccx = ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ccz = ring.reduce((s, p) => s + p[2], 0) / ring.length;
    const opening = hullPerimeter(ring.map((p) => [p[0] - ccx, p[2] - ccz]));
    const b = glb.meshes.get("body");
    const thighPts = [];
    for (let i = 0; i < b.P.length / 3; i++) {
      const y = b.P[i * 3 + 1];
      if (Math.abs(y - hem) < 0.008 && b.P[i * 3] * sg > 0.02 && b.attrs._mat[i] === 0) thighPts.push([b.P[i * 3], b.P[i * 3 + 2]]);
    }
    const thigh = hullPerimeter(thighPts);
    const hip = jointAt(glb, `Bip01_${S}_Thigh`),
      knee = jointAt(glb, `Bip01_${S}_Calf`);
    legs[S] = { hem: r3(hem), midThigh: r3((hip[1] + knee[1]) / 2), kneeTop: r3(knee[1] + 0.04), hemOk: hem <= (hip[1] + knee[1]) / 2 && hem >= knee[1] + 0.04, opening: r3(opening), thighAtHem: r3(thigh), openingRatio: r3(opening / thigh) };
  }
  const d = patterns.dims;
  return {
    bandWidth: r3(bandW),
    bandExtentY: r3(bTop - bBot),
    bandTop: r3(bTop),
    navelGap: r3(0.6 * H - bTop),
    bandDevP95: r3(pct(dev, 0.95)),
    bandContrastDE: r3(Math.min(...kitHex.map((k) => deltaE("#e8e1d0", k)))),
    tuck: { tested: tuckTested, outside: tuckBad, worstMm: r3(tuckWorst * 1000) },
    legs,
    hemOk: legs.L.hemOk && legs.R.hemOk,
    openingRatio: r3(Math.min(legs.L.openingRatio, legs.R.openingRatio)),
    gathers: r3((d.legTop * 2) / d.band),
  };
}

/** mean torso albedo of a baked tone (checklist 18): the source map sampled at the body's torso uvs */
export function toneAlbedo(glb, file) {
  const raw = execFileSync("magick", [file, "-depth", "8", "rgb:-"], { maxBuffer: 64 << 20 });
  const size = Math.round(Math.sqrt(raw.length / 3));
  const b = glb.meshes.get("body");
  const uv = b.attrs.TEXCOORD_0;
  const torso = new Set(["Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2"].map((n) => glb.joints.findIndex((j) => j.name === n)));
  const acc = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < b.P.length / 3; i++) {
    if (b.attrs._mat[i] !== 0) continue;
    let bj = 0,
      bw = -1;
    for (let q = 0; q < 4; q++) if (b.W[i * 4 + q] > bw) ((bw = b.W[i * 4 + q]), (bj = b.J[i * 4 + q]));
    if (!torso.has(bj)) continue;
    const x = Math.min(size - 1, Math.max(0, Math.floor(uv[i * 2] * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor(uv[i * 2 + 1] * size)));
    const o = (y * size + x) * 3;
    acc[0] += raw[o];
    acc[1] += raw[o + 1];
    acc[2] += raw[o + 2];
    n++;
  }
  return acc.map((v) => Math.round(v / n));
}

export function staticChecks() {
  const out = { body: {}, garments: {}, gloves: {}, headgear: {}, skin: {}, perf: {}, people: {} };
  const shapes = JSON.parse(readFileSync(join(SRC, "shape-targets.json"), "utf8"));
  const classes = { mW: ["m", null], mH: ["m", "heavy"], fL: ["f", null], fM: ["f", "heavy"] };
  const target = { mW: { H: 1.76, ua: 35.7 }, mH: { H: 1.87, ua: 39.4 }, fL: { H: 1.65, ua: 30.2 }, fM: { H: 1.7, ua: 32.7 } };
  const glbs = {};
  for (const g of ["m", "f"]) {
    const f = join(CHAR, "v8", `boxer-${g}.glb`);
    if (existsSync(f)) glbs[g] = readBoxerGlb(f);
  }
  if (!glbs.m || !glbs.f) return { missing: true };
  for (const [k, [g, morph]] of Object.entries(classes)) {
    const m = measureGlb(glbs[g], { morph });
    out.body[k] = {
      stature: m.stature,
      statureErr: r3(Math.abs(m.stature - target[k].H)),
      headsTall: m.headsTall,
      neckPerH: m.neckLengthPerH,
      bideltoidPerH: m.bideltoidPerH,
      waistToHip: m.waistToHip,
      neckGirth: m.neckGirth,
      upperArmMid: m.upperArmGirth[1],
      upperArmErr: r3(Math.abs(m.upperArmGirth[1] - target[k].ua)),
    };
  }
  // the worst over the classes, for scoring
  const B = Object.values(out.body);
  const male = [out.body.mW, out.body.mH],
    fem = [out.body.fL, out.body.fM];
  out.body.worst = {
    statureErr: Math.max(...B.map((b) => b.statureErr)),
    whrMaleMin: Math.min(...male.map((b) => b.waistToHip)),
    whrMaleMax: Math.max(...male.map((b) => b.waistToHip)),
    whrFemMin: Math.min(...fem.map((b) => b.waistToHip)),
    whrFemMax: Math.max(...fem.map((b) => b.waistToHip)),
    bidMaleMin: Math.min(...male.map((b) => b.bideltoidPerH)),
    bidMaleMax: Math.max(...male.map((b) => b.bideltoidPerH)),
    bidFemMin: Math.min(...fem.map((b) => b.bideltoidPerH)),
    bidFemMax: Math.max(...fem.map((b) => b.bideltoidPerH)),
    neckMin: Math.min(...B.map((b) => b.neckPerH)),
    neckMax: Math.max(...B.map((b) => b.neckPerH)),
    headsMin: Math.min(...B.map((b) => b.headsTall)),
    headsMax: Math.max(...B.map((b) => b.headsTall)),
    neckGirthMale: Math.min(...male.map((b) => b.neckGirth)),
    upperArmErr: Math.max(...B.map((b) => b.upperArmErr)),
  };
  const kitHex = ["#b3282d", "#1f4fb5"].map((h) => {
    // the kit colours as the palette darkens them (boxer-material.ts: 82 %)
    const c = [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.82));
    return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  });
  for (const g of ["m", "f"]) {
    const pat = JSON.parse(readFileSync(join(SRC, `patterns-${g === "m" ? "mW" : "fL"}.json`), "utf8"));
    out.garments[g] = garmentChecks(glbs[g], pat, kitHex);
    out.gloves[g] = { L: gloveChecks(glbs[g], "L"), R: gloveChecks(glbs[g], "R") };
    out.headgear[g] = headgearChecks(glbs[g]);
    const names = [...glbs[g].meshes.keys()];
    const tri = fighterTriangles(glbs[g], { meshes: ["body", "kit_vest", "kit_trunks", "kit_boots", "kit_gloves", "kit_headgear"] });
    const b = glbs[g].meshes.get("body");
    let skinTris = 0;
    for (let t = 0; t < b.index.length; t += 3) if (b.attrs._mat[b.index[t]] === 0) skinTris++;
    out.garments[g].separateMeshes = ["kit_vest", "kit_trunks", "kit_gloves", "kit_headgear", "kit_boots"].every((n) => names.includes(n));
    out.garments[g].hiddenBodyTris = b.index.length / 3 - tri.byMesh.body;
    out.perf[g] = { lod0Tris: tri.total, byMesh: tri.byMesh, influences: 4 };
  }
  const G = (f) => Math.min(...["m", "f"].map(f));
  const GX = (f) => Math.max(...["m", "f"].map(f));
  const gl = (g) => [out.gloves[g].L, out.gloves[g].R];
  out.garments.worst = {
    bandWidthMin: G((g) => out.garments[g].bandWidth),
    bandWidthMax: GX((g) => out.garments[g].bandWidth),
    navelGapMin: G((g) => out.garments[g].navelGap),
    bandDev: GX((g) => out.garments[g].bandDevP95),
    bandContrast: G((g) => out.garments[g].bandContrastDE),
    tuckOutside: GX((g) => out.garments[g].tuck.outside),
    hemOk: ["m", "f"].every((g) => out.garments[g].hemOk),
    openingRatio: G((g) => out.garments[g].openingRatio),
    gathers: G((g) => out.garments[g].gathers),
    separate: ["m", "f"].every((g) => out.garments[g].separateMeshes),
  };
  out.gloves.worst = {
    lengthMin: G((g) => Math.min(...gl(g).map((x) => x.lengthAlongBack))),
    lengthMax: GX((g) => Math.max(...gl(g).map((x) => x.lengthAlongBack))),
    widthMin: G((g) => Math.min(...gl(g).map((x) => x.knuckleWidth))),
    widthMax: GX((g) => Math.max(...gl(g).map((x) => x.knuckleWidth))),
    depthMin: G((g) => Math.min(...gl(g).map((x) => x.knuckleDepth))),
    depthMax: GX((g) => Math.max(...gl(g).map((x) => x.knuckleDepth))),
    cuffMin: G((g) => Math.min(...gl(g).map((x) => x.cuff))),
    cuffMax: GX((g) => Math.max(...gl(g).map((x) => x.cuff))),
    tapeMin: G((g) => Math.min(...gl(g).map((x) => x.tape))),
    tapeMax: GX((g) => Math.max(...gl(g).map((x) => x.tape))),
    blockToCuff: G((g) => Math.min(...gl(g).map((x) => x.blockToCuff))),
    panelOk: ["m", "f"].every((g) => gl(g).every((x) => x.panelOk)),
    thumbOk: ["m", "f"].every((g) => gl(g).every((x) => x.thumbOk)),
  };
  out.headgear.worst = { padding: G((g) => out.headgear[g].paddingP02), brow: G((g) => out.headgear[g].browRoll) };
  // skin tones (checklist 18) and the shader's one F0 (20)
  const T = ["#46302a", "#664234", "#895c42", "#a77b55"];
  const names = ["t1-deep", "t2-dark", "t3-brown", "t4-light"];
  out.skin.tones = {};
  let worstDE = 0;
  for (const g of ["m", "f"])
    names.forEach((nm, k) => {
      const c = toneAlbedo(glbs[g], join(SRC, `skin-${g}-albedo-${nm}.webp`));
      const hex = `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      const de = deltaE(hex, T[k]);
      worstDE = Math.max(worstDE, de);
      out.skin.tones[`${g}-t${k + 1}`] = { mean: hex, target: T[k], deltaE: r3(de) };
    });
  out.skin.worstToneDE = r3(worstDE);
  const mat = readFileSync(join(ROOT, "apps/web/src/world/human/boxer/boxer-material.ts"), "utf8");
  out.skin.singleF0 = /export const SKIN_F0 = 0\.028;/.test(mat) && /material\.specularColor = vec3\(uSkinF0\)/.test(mat);
  out.skin.t1TargetChroma = r3(chroma(T[0]));
  // kit (17): the mouth (teeth slot) is not red
  const teeth = /p\[SLOT\.teeth\] = c\("(#[0-9a-f]{6})"\)/i.exec(mat)?.[1] ?? "#ff0000";
  const tl = lab(teeth);
  out.people.mouthNotRed = !(tl[1] > 25 && tl[1] > Math.abs(tl[2]));
  // phone textures per person (24): the v8 skin set as the phone GPU transcodes it + the shared detail / iris maps
  out.perf.phoneTextureMB = budget(
    [
      { w: 2048, h: 2048, codec: "etc1s" },
      { w: 2048, h: 2048, codec: "uastc" },
      { w: 1024, h: 1024, codec: "etc1s" },
      { w: 512, h: 512, codec: "etc1s" },
      { w: 512, h: 512, format: "rgba8" },
      { w: 512, h: 512, format: "rgba8" },
    ],
    "phone",
  ).mb;
  out.perf.lod0Max = GX((g) => out.perf[g].lod0Tris);
  // people (25): adults only — the age macro of every class shipped
  const ages = ["mW", "mH", "fL", "fM"].map((k) => shapes.fighters[k].macro.age);
  out.people.ageMin = Math.min(...ages);
  out.people.ageMax = Math.max(...ages);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(staticChecks(), null, process.argv.includes("--json") ? 0 : 1));
