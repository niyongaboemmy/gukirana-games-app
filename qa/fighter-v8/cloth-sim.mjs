#!/usr/bin/env node
// P3-FGT-19A fighter v8 prototype (DEV ONLY): dress a fighter by simulation.
// Sewing patterns (IBA-style singlet: front / back panels with deep arm holes, scooped neck, shoulder and side seams;
// trunks: two leg panels with inseams, centre-front / centre-back rise seams, sewn into a shorter elastic band that
// gathers them), placed round the rest-pose body, sewn and draped by the solver in lib/cloth.mjs, then carried into
// each pose by skinning and relaxed again against the posed body (folds, sag and tension lines come from the
// simulation, not from a sculpt). Output: out/cloth/<fighter>-<pose>.json (read by the page).
//
//   node qa/fighter-v8/cloth-sim.mjs mW [stand,guard,jab,hook]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { bez, Cloth, edgeVerts, meshPanel } from "./lib/cloth.mjs";
import { solidify, vertexNormals } from "./lib/geo.mjs";
import { loadGlbNode } from "./lib/load-node.mjs";
import { poseAndBake } from "./lib/pose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(join(OUT, "cloth"), { recursive: true });
const key = process.argv[2] ?? "mW";
const poses = (process.argv[3] ?? "stand,guard,jab,hook").split(",");
const FR = Number(process.env.FRAMES ?? 1); // frame budget multiplier (quick tests: 0.3)
const meta = JSON.parse(readFileSync(join(OUT, `${key}.json`), "utf8"));
const L = meta.landmarks;
const M = meta.measure;
const female = key.startsWith("f");
const sc = L.stature / 1.76;

/* ------------------------------------------------------------------------------------------- fabrics */
// density kg/m²; stretch / bend are relaxation softness (0 = rigid); jersey is soft and drapey, satin crisper
const FABRIC = {
  jersey: { density: 0.15, stretch: 0.08, bend: 9 },
  satin: { density: 0.12, stretch: 0.01, bend: 2.5 },
  band: { density: 0.45, stretch: 0.02, bend: 0.6 },
};

/* ------------------------------------------------------------------------------------------- patterns */
const hemY = L.bandTop - 0.03; // the vest is tucked 3 cm under the band top (IBA bouts: tucked in)
const bandW = 0.085; // amateur trunks: 8–10 cm elastic band (IBA belt line 6–10 cm)
const bandBot = L.bandTop - bandW;
function singletPanel(front) {
  const W = (M.chestGirth * 1.06) / 2; // front / back panel width (6 % ease over the chest: snug to relaxed)
  const Wh = (M.waistGirth * 1.08) / 2; // tapered to the waist (the tucked hem does not balloon)
  const Lt = L.notchY - hemY + (front ? 0.06 : 0.075) * sc;
  const arm = (female ? 0.18 : 0.2) * sc; // strap top → side seam top: arm hole bottom 2–4 cm under the armpit
  const xi = (female ? 0.078 : 0.085) * sc; // neck half-width at the strap
  const strap = (female ? 0.05 : 0.056) * sc;
  const xo = xi + strap;
  const nd = front ? (female ? 0.1 : 0.11) * sc : 0.045 * sc;
  const right = [
    [Wh / 2, 0],
    [W / 2, Lt - arm],
    ...bez([W / 2, Lt - arm], [xo + 0.012, Lt - arm * 0.62], [xo, Lt], 12).slice(1),
    [xi, Lt],
    ...bez([xi, Lt], [xi - 0.006, Lt - nd], [0, Lt - nd], 10).slice(1),
  ];
  const left = right.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
  const poly = [[-Wh / 2, 0], ...right, ...left.slice(0, -1)];
  return { poly, W, Wh, Lt, arm, xi, xo, nd };
}
function legPanel() {
  // inseam length (hem 10 cm above the knee). P3-FGT-19B: draped, the rise's ease let the hem settle at the knee top
  // (checklist 11 asks between mid-thigh and the knee top): the inseam is 7 cm shorter (INSEAM_SHORTEN, m)
  const yc = L.crotchY - (L.kneeL[1] + 0.1) + 0.012 - Number(process.env.INSEAM_SHORTEN ?? 0.07);
  const rise = bandBot - L.crotchY + 0.05 * sc;
  const Ht = yc + rise;
  const ef = 0.055 * sc, eb = 0.1 * sc;
  const top = (M.hipGirth * 1.16) / 2;
  const Wlc = top + ef + eb;
  const Wlh = Math.max((M.thighGirth[0] / 100) * 1.32, Wlc * 0.92); // measure.mjs gives limb girths in cm
  const poly = [
    [0, 0],
    [Wlh, 0],
    [Wlc, yc],
    ...bez([Wlc, yc], [Wlc - eb * 0.15, yc + rise * 0.7], [Wlc - eb, Ht], 8).slice(1),
    [ef, Ht],
    ...bez([ef, Ht], [ef * 0.2, yc + rise * 0.6], [0, yc], 8).slice(1, -1),
  ];
  return { poly, yc, Ht, ef, eb, Wlc, Wlh, top };
}

/* ------------------------------------------------------------------------------------------- body */
const gltf = await loadGlbNode(join(OUT, `${key}.glb`));
function bodyAt(pose, alpha = 1) {
  const r = poseAndBake(gltf, pose, alpha);
  const body = r.baked.get("body");
  return { ...r, body };
}
/** the arm mask of the body vertices (upper arm, forearm, hand weights) from the skinned source */
const armMask = (() => {
  let sm = null;
  gltf.scene.traverse((o) => o.isSkinnedMesh && o.name === "body" && (sm = o));
  const si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
  const names = sm.skeleton.bones.map((b) => b.name);
  const isArm = names.map((n) => /^(upperarm|lowerarm|wrist|finger|metacarpal)/.test(n));
  const m = new Float32Array(si.count);
  for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) if (isArm[si.getComponent(i, c)]) m[i] += sw.getComponent(i, c);
  return m;
})();
/** collider set for a posed body: full body, the torso without the arms, the arms as capsules */
function colliders(r) {
  const body = r.body;
  const idx = body.index.array;
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) if (armMask[idx[t]] < 0.5 && armMask[idx[t + 1]] < 0.5 && armMask[idx[t + 2]] < 0.5) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  const torso = new THREE.BufferGeometry();
  torso.setAttribute("position", body.attributes.position);
  torso.setAttribute("normal", body.attributes.normal);
  torso.setIndex(keep);
  const J = (n) => r.worldPos(n).toArray();
  const arms = [];
  for (const S of ["L", "R"]) {
    const sh = J(`upperarm01.${S}`), el = J(`lowerarm01.${S}`), wr = J(`wrist.${S}`);
    // the upper-arm capsule starts a quarter of the way down (the strap lies over the shoulder joint itself)
    const a0 = sh.map((v, k) => v + (el[k] - v) * 0.25);
    arms.push({ a: a0, b: el, r: 0.052 * sc }, { a: el, b: wr, r: 0.044 * sc });
  }
  const sp = J("spine02");
  return { torso, arms, torsoCentre: sp };
}
function setBodyAll(r) {
  const c = colliders(r);
  cloth.setBody(r.body, { torso: c.torso, arms: c.arms, vestMax: vB.id, torsoCentre: c.torsoCentre });
}
const rest = bodyAt("rest");
const restBody = rest.body;
restBody.computeVertexNormals();

/** perimeter + centre of the body slice at height y (vertices within 6 mm, arms excluded by |x|) */
function slice(geo, y, maxX = 0.25) {
  const pos = geo.attributes.position;
  const pts = [];
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    if (Math.abs(py - y) > 0.006 || Math.abs(pos.getX(i)) > maxX) continue;
    pts.push([pos.getX(i), pos.getZ(i)]);
  }
  let cx = 0, cz = 0, minx = 9, maxx = -9, minz = 9, maxz = -9;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    minz = Math.min(minz, z);
    maxz = Math.max(maxz, z);
  }
  return { cx, cz, a: (maxx - minx) / 2, b: (maxz - minz) / 2 };
}
/** a point on an ellipse at arclength fraction s (0 = front, increasing towards +x) */
function ellipseAt(a, b, s) {
  // arclength table
  const N = 256;
  if (!ellipseAt.cache || ellipseAt.cache.a !== a || ellipseAt.cache.b !== b) {
    const cum = [0];
    for (let i = 1; i <= N; i++) {
      const t0 = ((i - 1) / N) * Math.PI * 2, t1 = (i / N) * Math.PI * 2;
      cum.push(cum[i - 1] + Math.hypot(a * (Math.sin(t1) - Math.sin(t0)), b * (Math.cos(t1) - Math.cos(t0))));
    }
    ellipseAt.cache = { a, b, cum };
  }
  const { cum } = ellipseAt.cache;
  const target = (((s % 1) + 1) % 1) * cum[N];
  let i = 1;
  while (i < N && cum[i] < target) i++;
  const t = (((i - 1) + (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)) / N) * Math.PI * 2;
  return [a * Math.sin(t), b * Math.cos(t)];
}

/* ------------------------------------------------------------------------------------------- dress */
const cloth = new Cloth();
const H = 0.0105;
// singlet
const pf = singletPanel(true), pb = singletPanel(false);
const chest = slice(restBody, L.chestY + 0.05, 0.2);
const ea = Math.max(chest.a + 0.03, 0.17 * sc), eb = Math.max(chest.b + 0.035, 0.14 * sc);
const perim = 2 * pf.W;
const placeVest = (front) => (x, y) => {
  const s = front ? x / perim : 0.5 - x / perim;
  const [ex, ez] = ellipseAt(ea, eb, s);
  return [chest.cx + ex, hemY + y, chest.cz + ez];
};
const mF = meshPanel(pf.poly, H), mB = meshPanel(pb.poly, H);
const vF = cloth.addPanel("vestFront", mF, placeVest(true), FABRIC.jersey);
const vB = cloth.addPanel("vestBack", mB, placeVest(false), FABRIC.jersey);
const tol = H * 0.7;
let seams = 0;
const seamLog = [];
for (const sx of [1, -1]) {
  // side seams
  const sideF = edgeVerts(mF, [sx * pf.Wh / 2, 0], [sx * pf.W / 2, pf.Lt - pf.arm], tol), sideB = edgeVerts(mB, [sx * pb.Wh / 2, 0], [sx * pb.W / 2, pb.Lt - pb.arm], tol);
  // both directions: every vertex of both edges is joined (one-way pairing left slits along the seam)
  seams += cloth.sew(sideF, sideB, vF.base, vB.base) + cloth.sew(sideB, sideF, vB.base, vF.base);
  // shoulder seams (strap tops): both directions so every vertex of both edges is joined
  const shF = edgeVerts(mF, [sx * pf.xi, pf.Lt], [sx * pf.xo, pf.Lt], tol * 1.4), shB = edgeVerts(mB, [sx * pb.xi, pb.Lt], [sx * pb.xo, pb.Lt], tol * 1.4);
  seams += cloth.sew(shF, shB, vF.base, vB.base) + cloth.sew(shB, shF, vB.base, vF.base);
  seamLog.push(`side${sx}:${sideF.length}/${sideB.length} shoulder${sx}:${shF.length}/${shB.length}`);
}
console.log(seamLog.join(" "));
// the strap tops (shoulder seams): kept on the trapezius ridge like a garment on a hanger, until they are sewn and
// settled; afterwards (poses) held by a soft grip where they lie
const strapVerts = [];
for (const sx of [1, -1]) {
  for (const [v] of edgeVerts(mF, [sx * pf.xi, pf.Lt], [sx * pf.xo, pf.Lt], tol * 1.4)) strapVerts.push(vF.base + v);
  for (const [v] of edgeVerts(mB, [sx * pb.xi, pb.Lt], [sx * pb.xo, pb.Lt], tol * 1.4)) strapVerts.push(vB.base + v);
}
// trunks: two leg panels
const lp = legPanel();
const mLeg = meshPanel(lp.poly, H * 1.1);
const hemT = L.kneeL[1] + 0.1;
const placeLeg = (S) => {
  const hip = S === "L" ? L.hipL : L.hipR, knee = S === "L" ? L.kneeL : L.kneeR;
  const ax = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]];
  const al = Math.hypot(...ax);
  const d = ax.map((v) => v / al);
  const sg = S === "L" ? 1 : -1;
  // panel edges at height y (for the angle mapping)
  const edgesAt = (y) => {
    let x0 = Infinity, x1 = -Infinity;
    const poly = lp.poly;
    for (let i = 0; i < poly.length; i++) {
      const [ax0, ay0] = poly[i], [bx0, by0] = poly[(i + 1) % poly.length];
      if ((ay0 - y) * (by0 - y) > 0 || ay0 === by0) continue;
      const t = (y - ay0) / (by0 - ay0);
      const xx = ax0 + (bx0 - ax0) * t;
      x0 = Math.min(x0, xx);
      x1 = Math.max(x1, xx);
    }
    return [x0, x1];
  };
  return (x, y) => {
    const wy = hemT + y; // world height
    // point on the leg axis at that height (extended above the hip)
    const t = (wy - hip[1]) / d[1];
    const c = [hip[0] + d[0] * t, wy, hip[2] + d[2] * t];
    const [x0, x1] = edgesAt(Math.min(Math.max(y, 0.0005), lp.Ht - 0.0005));
    const wdt = Math.max(0.05, x1 - x0);
    const phi = -Math.PI / 2 + (2 * Math.PI * (x - x0)) / wdt;
    const r = wdt / (2 * Math.PI) + 0.012;
    let px = c[0] + sg * Math.sin(phi) * r;
    if (sg > 0) px = Math.max(px, 0.006);
    else px = Math.min(px, -0.006);
    return [px, wy, c[2] + Math.cos(phi) * r];
  };
};
const tL = cloth.addPanel("legL", mLeg, placeLeg("L"), FABRIC.satin);
const tR = cloth.addPanel("legR", mLeg, placeLeg("R"), FABRIC.satin);
const tolT = H * 0.8;
for (const base of [tL.base, tR.base]) {
  const a = edgeVerts(mLeg, [0, 0], [0, lp.yc], tolT), b = edgeVerts(mLeg, [lp.Wlh, 0], [lp.Wlc, lp.yc], tolT);
  seams += cloth.sew(a, b, base, base) + cloth.sew(b, a, base, base); // inseams
}
const riseF = edgeVerts(mLeg, [0, lp.yc], [lp.ef, lp.Ht], tolT * 1.6);
const riseB = edgeVerts(mLeg, [lp.Wlc, lp.yc], [lp.Wlc - lp.eb, lp.Ht], tolT * 1.6);
seams += cloth.sew(riseF, riseF, tL.base, tR.base) + cloth.sew(riseB, riseB, tL.base, tR.base);
// waistband: an elastic ring 6 % shorter than the body under it, closed at the back
const bandS = slice(restBody, bandBot + bandW / 2, 0.22);
const bandA = bandS.a + 0.006, bandB = bandS.b + 0.006;
const bandPerim = (() => {
  let p = 0;
  for (let i = 0; i < 360; i++) {
    const [x0, z0] = ellipseAt(bandA, bandB, i / 360), [x1, z1] = ellipseAt(bandA, bandB, (i + 1) / 360);
    p += Math.hypot(x1 - x0, z1 - z0);
  }
  return p;
})();
const Lb = bandPerim * 0.94;
const mBand = meshPanel([[0, 0], [Lb, 0], [Lb, bandW], [0, bandW]], H * 0.75);
const placeBand = (x, y) => {
  const [ex, ez] = ellipseAt(bandA, bandB, 0.5 + x / Lb);
  return [bandS.cx + ex, bandBot + y, bandS.cz + ez];
};
const bd = cloth.addPanel("band", mBand, placeBand, FABRIC.band);
{
  const a = edgeVerts(mBand, [0, 0], [0, bandW], H * 0.6), b = edgeVerts(mBand, [Lb, 0], [Lb, bandW], H * 0.6);
  seams += cloth.sew(a, b, bd.base, bd.base) + cloth.sew(b, a, bd.base, bd.base);
}
// trunks tops into the band's lower edge (longer than the band: gathers)
const topE = edgeVerts(mLeg, [lp.ef, lp.Ht], [lp.Wlc - lp.eb, lp.Ht], tolT);
const bandBotE = edgeVerts(mBand, [0, 0], [Lb, 0], H * 0.6);
const half = (from, to) => bandBotE.filter(([, t]) => t >= Math.min(from, to) - 0.01 && t <= Math.max(from, to) + 0.01).map(([v, t]) => [v, (t - from) / (to - from)]);
seams += cloth.sew(topE, half(0.5, 1.0), tL.base, bd.base) + cloth.sew(topE, half(0.5, 0.0), tR.base, bd.base);
// and the band edge onto the trunks (no unjoined band vertex: no gap between band and trunks)
seams += cloth.sew(half(0.5, 1.0), topE, bd.base, tL.base) + cloth.sew(half(0.5, 0.0), topE, bd.base, tR.base);
console.log(cloth.panels.map((p) => `${p.name}:${p.count}`).join(" "), JSON.stringify(pf.poly.slice(0, 4)), JSON.stringify(lp.poly));
console.log(`${key}: ${cloth.x.length / 3} particles, ${cloth.dist.length} constraints, ${seams} seam pairs`);

/* soft attachments: the band grips the body; the singlet hem is held under the band */
function attachTo(body, bvh, verts, offset, soft) {
  const out = [];
  const tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const P = new THREE.Vector3();
  const nrm = new THREE.Vector3(), tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const pos = body.attributes.position, idx = body.index.array;
  for (const [v, x, y, z] of verts) {
    P.set(x, y, z);
    bvh.closestPointToPoint(P, tgt);
    const f = tgt.faceIndex;
    a.fromBufferAttribute(pos, idx[f * 3]);
    b.fromBufferAttribute(pos, idx[f * 3 + 1]);
    c.fromBufferAttribute(pos, idx[f * 3 + 2]);
    tri.set(a, b, c);
    tri.getNormal(nrm);
    out.push([v, [tgt.point.x + nrm.x * offset, tgt.point.y + nrm.y * offset, tgt.point.z + nrm.z * offset], soft]);
  }
  return out;
}
/** the top of the shoulder (trapezius ridge) at lateral x on the rest body */
function trapTop(body, xq) {
  const pos = body.attributes.position;
  let best = null;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(x - xq) > 0.008 || y < L.notchY - 0.02 || y > L.notchY + 0.16 || Math.abs(z - L.neckZ) > 0.09) continue;
    if (!best || y > best[1]) best = [x, y, z];
  }
  return best;
}
function setAttachments(body, hanger = false) {
  const bvh = new MeshBVH(body);
  const x = cloth.x;
  const band = [], hem = [];
  for (let i = bd.base; i < bd.base + mBand.uv.length; i++) band.push([i, x[i * 3], x[i * 3 + 1], x[i * 3 + 2]]);
  for (const [panel, mesh] of [[vF, mF], [vB, mB]])
    mesh.uv.forEach(([, y], k) => {
      if (y < 0.025) hem.push([panel.base + k, x[(panel.base + k) * 3], x[(panel.base + k) * 3 + 1], x[(panel.base + k) * 3 + 2]]);
    });
  // the elastic grips: it follows the body's curvature (stronger grip than before), the tucked hem sits under it
  cloth.attach = [...attachTo(body, bvh, band, 0.0058, 1.5), ...attachTo(body, bvh, hem, 0.0025, 2)];
  if (hanger) {
    for (const v of strapVerts) {
      const u = cloth.uv[v * 2];
      const t = trapTop(body, u);
      if (t) cloth.attach.push([v, [t[0], t[1] + 0.004, t[2]], 5]);
    }
  } else {
    const sv = strapVerts.map((v) => [v, x[v * 3], x[v * 3 + 1], x[v * 3 + 2]]);
    cloth.attach.push(...attachTo(body, bvh, sv, 0.003, 8));
  }
}

/* ------------------------------------------------------------------------------------------- simulate at rest */
setBodyAll(rest);
setAttachments(restBody, true);
if (process.env.DEBUG) {
  const hemA = cloth.attach.filter(([a]) => a >= vF.base && a < vF.base + mF.uv.length).slice(0, 3);
  console.log("attach count", cloth.attach.length, "hem sample", JSON.stringify(hemA.map(([a, t]) => [a, [cloth.x[a * 3], cloth.x[a * 3 + 1], cloth.x[a * 3 + 2]].map((v) => +v.toFixed(3)), t.map((v) => +v.toFixed(3))])));
}
let t0 = Date.now();
cloth.run(Math.round(260 * FR), { substeps: 8, sewFrames: Math.round(110 * FR), thickness: 0.0028, friction: 0.35, selfDist: 0.0035, onFrame: process.env.DEBUG ? (f, x) => { if (f % 8) return; let s = 0, mx = -9, mn = 9; const a = vF.base, b = vB.base + mB.uv.length; for (let i = a; i < b; i++) { s += x[i * 3 + 1]; mx = Math.max(mx, x[i * 3 + 1]); mn = Math.min(mn, x[i * 3 + 1]); } console.log(f, "vest y mean", (s / (b - a)).toFixed(3), "min", mn.toFixed(3), "max", mx.toFixed(3)); } : null });
// re-grip after the trunks settled, then settle again
setAttachments(restBody);
cloth.run(Math.round(80 * FR), { substeps: 8, thickness: 0.0028, friction: 0.35, selfDist: 0.0035 });
console.log(`  rest drape ${(Date.now() - t0) / 1000}s`);

/* ------------------------------------------------------------------------------------------- carry into each pose */
// skin each particle by the rest body (closest point → barycentric mix of its triangle's skin weights)
const restSkin = (() => {
  const g = gltf.scene.getObjectByName("body") ?? (() => {
    let m = null;
    gltf.scene.traverse((o) => o.isSkinnedMesh && o.name === "body" && (m = o));
    return m;
  })();
  return g.geometry;
})();
const restBVH = new MeshBVH(restBody);
const skins = [];
{
  const tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const P = new THREE.Vector3(), tri = new THREE.Triangle(), bary = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const pos = restBody.attributes.position, idx = restBody.index.array;
  const si = restSkin.attributes.skinIndex, sw = restSkin.attributes.skinWeight;
  const names = rest.bones.map((bn) => bn.name);
  const spine1 = names.indexOf("spine01");
  const rootB = names.indexOf("root");
  for (let i = 0; i < cloth.x.length / 3; i++) {
    P.set(cloth.x[i * 3], cloth.x[i * 3 + 1], cloth.x[i * 3 + 2]);
    restBVH.closestPointToPoint(P, tgt);
    const f = tgt.faceIndex;
    const vs = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
    a.fromBufferAttribute(pos, vs[0]);
    b.fromBufferAttribute(pos, vs[1]);
    c.fromBufferAttribute(pos, vs[2]);
    tri.set(a, b, c);
    tri.getBarycoord(tgt.point, bary);
    const m = new Map();
    const isVest = cloth.panel[i] <= vB.id;
    [bary.x, bary.y, bary.z].forEach((bw, k) => {
      for (let q = 0; q < 4; q++) {
        const w = sw.getComponent(vs[k], q) * bw;
        if (!w) continue;
        let bi = si.getComponent(vs[k], q);
        // the jersey does not follow the arm; each trunks leg follows only its own leg (the crotch would tear)
        if (isVest && /^(upperarm|lowerarm|wrist|finger|metacarpal)/.test(names[bi])) bi = spine1;
        const pnl = cloth.panel[i];
        if ((pnl === tL.id && /\.R$/.test(names[bi])) || (pnl === tR.id && /\.L$/.test(names[bi]))) bi = rootB;
        m.set(bi, (m.get(bi) ?? 0) + w);
      }
    });
    skins.push(m);
  }
}
// diffuse the weights over the cloth (and across the seams) so neighbouring particles move together
{
  const n = cloth.x.length / 3;
  const nb = Array.from({ length: n }, () => new Set());
  for (const [a, b, c] of cloth.tris) {
    nb[a].add(b).add(c);
    nb[b].add(a).add(c);
    nb[c].add(a).add(b);
  }
  for (const [a, b] of cloth.seams) {
    nb[a].add(b);
    nb[b].add(a);
  }
  for (let it = 0; it < 8; it++) {
    const next = skins.map((m, v) => {
      const o = new Map();
      for (const [b, x] of m) o.set(b, x * 0.5);
      const k = nb[v].size || 1;
      for (const q of nb[v]) for (const [b, x] of skins[q]) o.set(b, (o.get(b) ?? 0) + (x * 0.5) / k);
      return o;
    });
    for (let v = 0; v < n; v++) skins[v] = next[v];
  }
}
const restX = Float64Array.from(cloth.x);
const restState = cloth.x.slice();
// P3-FGT-19B: the rest (bind-pose) drape as the game's garment source: single layer, seams welded, with its skin
// weights (MakeHuman bone names) — scripts/boxer/build.mjs (V8) re-meshes, skins and bakes it
if (poses.includes("rest")) writeFile("rest", true);

for (const pose of poses.filter((p) => p !== "rest")) {
  t0 = Date.now();
  // carry the cloth into the pose in stages: skin it to each partial pose, relax against that body
  const STAGES = [0.34, 0.67, 1];
  let cur = Float64Array.from(restX);
  for (const alpha of STAGES) {
    const r = bodyAt(pose, alpha);
    r.body.computeVertexNormals();
    const mats = r.bones.map((bn, i) => new THREE.Matrix4().multiplyMatrices(bn.matrixWorld, r.skeleton.boneInverses[i]));
    const v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3();
    // skin the rest drape to this stage, keep the relaxed offsets of the previous stage
    const nx = [];
    for (let i = 0; i < restX.length / 3; i++) {
      v.set(restX[i * 3], restX[i * 3 + 1], restX[i * 3 + 2]);
      acc.set(0, 0, 0);
      let ws = 0;
      for (const [bi, w] of skins[i]) {
        acc.add(t.copy(v).applyMatrix4(mats[bi]).multiplyScalar(w));
        ws += w;
      }
      acc.multiplyScalar(1 / (ws || 1));
      nx.push(acc.x, acc.y, acc.z);
    }
    if (alpha !== STAGES[0]) {
      // previous stage's relaxed shape, moved by the skinning delta between the stages
      for (let i = 0; i < nx.length; i++) nx[i] = cur[i] + (nx[i] - prevSkinned[i]);
    }
    var prevSkinned = Float64Array.from(nx.map((x, i) => x));
    // (prevSkinned must be the pure skinned position: recompute)
    prevSkinned = skinTo(mats);
    cloth.x = nx.slice();
    cloth.p = nx.slice();
    setBodyAll(r);
    setAttachments(r.body);
    cloth.run(Math.round((alpha === 1 ? 110 : 45) * FR), { substeps: 8, thickness: 0.0028, friction: 0.4, selfDist: 0.0035 });
    cur = Float64Array.from(cloth.x);
  }
  function skinTo(mats) {
    const v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3();
    const out = new Float64Array(restX.length);
    for (let i = 0; i < restX.length / 3; i++) {
      v.set(restX[i * 3], restX[i * 3 + 1], restX[i * 3 + 2]);
      acc.set(0, 0, 0);
      let ws = 0;
      for (const [bi, w] of skins[i]) {
        acc.add(t.copy(v).applyMatrix4(mats[bi]).multiplyScalar(w));
        ws += w;
      }
      acc.multiplyScalar(1 / (ws || 1));
      out[i * 3] = acc.x;
      out[i * 3 + 1] = acc.y;
      out[i * 3 + 2] = acc.z;
    }
    return out;
  }
  console.log(`  ${pose} relax ${(Date.now() - t0) / 1000}s`);
  writeFile(pose);
  cloth.x = restState.slice();
  cloth.p = restState.slice();
}

/* ------------------------------------------------------------------------------------------- export */
function writeFile(pose, single = false) {
  const n = cloth.x.length / 3;
  // weld the seam pairs
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (const [a, b] of cloth.seams) parent[find(a)] = find(b);
  const X = Float64Array.from(cloth.x);
  const cnt = new Float64Array(n), sum = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    cnt[r]++;
    for (let k = 0; k < 3; k++) sum[r * 3 + k] += X[i * 3 + k];
  }
  const garments = { vest: [vF.id, vB.id], trunks: [tL.id, tR.id], band: [bd.id] };
  const out = { fighter: key, pose, meshes: [] };
  for (const [name, ids] of Object.entries(garments)) {
    const remap = new Map();
    const P = [], UV = [], PAN = [];
    const tris = [];
    for (const tr of cloth.tris) {
      if (!ids.includes(cloth.panel[tr[0]])) continue;
      const t2 = tr.map((v) => {
        const r = find(v);
        if (!remap.has(r)) {
          remap.set(r, P.length / 3);
          P.push(sum[r * 3] / cnt[r], sum[r * 3 + 1] / cnt[r], sum[r * 3 + 2] / cnt[r]);
          UV.push(cloth.uv[v * 2], cloth.uv[v * 2 + 1]);
          PAN.push(cloth.panel[v]);
        }
        return remap.get(r);
      });
      if (t2[0] !== t2[1] && t2[1] !== t2[2] && t2[0] !== t2[2]) tris.push(t2);
    }
    if (single) {
      // per welded vertex: its skin weights (MakeHuman bone name → weight) from the first source particle
      const first = new Map();
      for (let v = 0; v < n; v++) if (!first.has(find(v))) first.set(find(v), v);
      const sk = [...remap.keys()].map((r) => Object.fromEntries([...skins[first.get(r)]].filter(([, w]) => w > 1e-4).map(([b, w]) => [rest.bones[b].name, +w.toFixed(5)])));
      out.meshes.push({ name, P: P.map((x) => +x.toFixed(5)), UV: UV.map((x) => +x.toFixed(5)), panel: PAN, tris, skin: sk });
      continue;
    }
    const thick = name === "band" ? 0.0026 : name === "vest" ? 0.0014 : 0.0012;
    const sol = solidify(Float64Array.from(P), tris, thick, { rimSteps: 5, bead: name === "band" ? 0.0008 : 0.0012 });
    const N = vertexNormals(sol.P, sol.tris, sol.P.length / 3);
    const uv = [], cls = [];
    for (let i = 0; i < sol.P.length / 3; i++) {
      const s = sol.src[i];
      uv.push(UV[s * 2], UV[s * 2 + 1]);
      // binding: the rolled rim of the arm holes / neck (vest) — classified by the rim and its pattern position
      let c = 0;
      if (name === "vest" && sol.side[i] === 2) c = UV[s * 2 + 1] > 0.05 ? 1 : 0;
      cls.push(c);
    }
    out.meshes.push({
      name,
      position: Buffer.from(Float32Array.from(sol.P).buffer).toString("base64"),
      normal: Buffer.from(Float32Array.from(N).buffer).toString("base64"),
      uv: Buffer.from(Float32Array.from(uv).buffer).toString("base64"),
      cls: Buffer.from(Uint8Array.from(cls).buffer).toString("base64"),
      index: Buffer.from(Uint32Array.from(sol.tris.flat()).buffer).toString("base64"),
      panels: name === "trunks" ? { Wlc: lp.Wlc, Wlh: lp.Wlh } : null,
    });
  }
  out.pattern = { singletFront: pf.poly, singletBack: pb.poly, leg: lp.poly, band: [[0, 0], [Lb, 0], [Lb, bandW], [0, bandW]], dims: { W: pf.W, Lt: pf.Lt, arm: pf.arm, strap: pf.xo - pf.xi, neckFront: pf.nd, neckBack: pb.nd, legTop: lp.top, legHem: lp.Wlh, inseam: lp.yc, rise: lp.Ht - lp.yc, band: Lb, bandW } };
  writeFileSync(join(OUT, "cloth", `${key}-${pose}.json`), JSON.stringify(out));
}
