// Anthropometric audit of a built boxer body (P3-FGT-18, docs/FIGHT-REALISM-V7.md §2): stature, head height, neck
// length / breadth / girth, shoulder breadths, chest / waist / hip girths, arm and leg girths along their length — all
// from the skin surface in the bind pose, so they can be compared with published athlete anthropometry.
// Used by build.mjs when MEASURE=1 (prints one JSON line per gender).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** perimeter of the 2-D convex hull of points (a tape measure round a limb / the trunk) */
export function hullPerimeter(pts) {
  if (pts.length < 3) return 0;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let s = 0;
  for (let i = 0; i < h.length; i++) s += Math.hypot(h[(i + 1) % h.length][0] - h[i][0], h[(i + 1) % h.length][1] - h[i][1]);
  return s;
}

/**
 * @param P body positions (metres, flat)
 * @param bodyV body vertex indices
 * @param bp (bone name) → joint position
 * @param wOf (vertex, bone name) → skin weight
 */
export function measureBody({ P, bodyV, bp, wOf }) {
  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const verts = [...bodyV];
  let H = 0;
  for (const i of verts) H = Math.max(H, P[i * 3 + 1]);
  const head = bp("Bip01_Head");
  const neck = bp("Bip01_Neck");
  const headish = (i) => wOf(i, "Bip01_Head") + wOf(i, "Bip01_Jaw") > 0.6;
  // chin: the lowest head-weighted point in front of the neck joint
  let chinY = Infinity;
  let headW = 0;
  for (const i of verts) {
    const p = V(i);
    if (!headish(i)) continue;
    if (p[2] > head[2] + 0.03) chinY = Math.min(chinY, p[1]);
  }
  // head breadth (biparietal-ish: widest head-weighted slice above the ears' bottom)
  for (const i of verts) if (headish(i) && P[i * 3 + 1] > head[1] + 0.04) headW = Math.max(headW, Math.abs(P[i * 3]) * 2);
  // horizontal slab of the trunk (no arm vertices) at height y → girth, breadth, depth
  const armish = (i) => wOf(i, "Bip01_L_UpperArm") + wOf(i, "Bip01_R_UpperArm") + wOf(i, "Bip01_L_Forearm") + wOf(i, "Bip01_R_Forearm") + wOf(i, "Bip01_L_Hand") + wOf(i, "Bip01_R_Hand") > 0.25;
  const slab = (y, filter, dy = 0.006) => {
    const pts = [];
    let w = 0,
      d0 = Infinity,
      d1 = -Infinity;
    for (const i of verts) {
      const p = V(i);
      if (Math.abs(p[1] - y) > dy || !filter(i, p)) continue;
      pts.push([p[0], p[2]]);
      w = Math.max(w, Math.abs(p[0]) * 2);
      d0 = Math.min(d0, p[2]);
      d1 = Math.max(d1, p[2]);
    }
    return { girth: hullPerimeter(pts), breadth: w, depth: d1 - d0 };
  };
  // the neck: halfway between the chin and the neck base; its breadth / girth with head / trunk weights excluded
  const neckMidY = (chinY + neck[1]) / 2;
  const neckS = slab(neckMidY, (i, p) => Math.abs(p[0]) < 0.09 && !armish(i) && p[2] < head[2] + 0.06 && p[2] > head[2] - 0.09);
  // shoulders: biacromial ≈ the distance between the shoulder joints + 2 × 2.5 cm; bideltoid = widest arm-incl. slab
  const shL = bp("Bip01_L_UpperArm");
  // (bind pose is an A-pose: the deltoids' lateral points = the widest vertices from the shoulder joint height up)
  let bidelt = 0;
  for (const i of verts) {
    const p = V(i);
    if (p[1] > shL[1] - 0.01 && !headish(i)) bidelt = Math.max(bidelt, Math.abs(p[0]) * 2);
  }
  // the suprasternal notch ≈ the sternoclavicular joints' height (the clavicle bones' heads)
  const notchY = bp("Bip01_L_Clavicle")[1];
  // the trunk girths: chest at the armpit fold, waist = narrowest between the ribs and the pelvis, hips = widest round the seat
  const trunk = (i) => !armish(i);
  const chest = slab(shL[1] - 0.12, trunk);
  const pelvis = bp("Bip01_Pelvis");
  let waist = { girth: Infinity },
    hips = { girth: 0 },
    waistY = 0,
    hipY = 0;
  for (let y = pelvis[1] + 0.06; y < shL[1] - 0.2; y += 0.01) {
    const s = slab(y, trunk);
    if (s.girth > 0 && s.girth < waist.girth) {
      waist = s;
      waistY = y;
    }
  }
  const legL = (i) => wOf(i, "Bip01_L_Thigh") + wOf(i, "Bip01_R_Thigh") + wOf(i, "Bip01_Pelvis") > 0.3;
  for (let y = pelvis[1] - 0.12; y < pelvis[1] + 0.05; y += 0.01) {
    const s = slab(y, legL);
    if (s.girth > hips.girth) {
      hips = s;
      hipY = y;
    }
  }
  // a limb's girth along its length: slices perpendicular to the bone (from → to), the vertices of that segment
  const limb = (from, to, bones, ts) => {
    const a = bp(from),
      b = bp(to);
    const ax = norm(sub(b, a));
    const L = len(sub(b, a));
    const u = norm(cross(ax, Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const v = cross(ax, u);
    return ts.map((t) => {
      const pts = [];
      for (const i of verts) {
        if (bones.reduce((n, bn) => n + wOf(i, bn), 0) < 0.5) continue;
        const d = sub(V(i), a);
        if (Math.abs(dot(d, ax) - t * L) > 0.012) continue;
        if (Math.hypot(dot(d, u), dot(d, v)) > 0.12) continue;
        pts.push([dot(d, u), dot(d, v)]);
      }
      return +(hullPerimeter(pts) * 100).toFixed(1);
    });
  };
  const r = (x) => +x.toFixed(3);
  return {
    stature: r(H),
    headHeight: r(H - chinY),
    headsTall: +(H / (H - chinY)).toFixed(2),
    headBreadth: r(headW),
    neckLength_chinToNotch: r(chinY - notchY),
    neckLengthPerH: +((chinY - notchY) / H).toFixed(3),
    neckBreadth: r(neckS.breadth),
    neckGirth: r(neckS.girth),
    neckToHeadBreadth: +(neckS.breadth / headW).toFixed(2),
    biacromial: r(Math.abs(shL[0]) * 2 + 0.05),
    bideltoid: r(bidelt),
    bideltoidPerH: +(bidelt / H).toFixed(3),
    chestGirth: r(chest.girth),
    waistGirth: r(waist.girth),
    waistY: r(waistY),
    hipGirth: r(hips.girth),
    hipY: r(hipY),
    waistToHip: +(waist.girth / hips.girth).toFixed(2),
    // cm, 15 / 35 / 55 / 75 % along the segment
    upperArmGirth: limb("Bip01_L_UpperArm", "Bip01_L_Forearm", ["Bip01_L_UpperArm", "Bip01_L_ShoulderHelper"], [0.25, 0.45, 0.6, 0.8]),
    forearmGirth: limb("Bip01_L_Forearm", "Bip01_L_Hand", ["Bip01_L_Forearm", "Bip01_L_ForearmTwist"], [0.15, 0.35, 0.6, 0.9]),
    thighGirth: limb("Bip01_L_Thigh", "Bip01_L_Calf", ["Bip01_L_Thigh"], [0.2, 0.5, 0.8]),
    calfGirth: limb("Bip01_L_Calf", "Bip01_L_Foot", ["Bip01_L_Calf"], [0.3, 0.6, 0.9]),
  };
}
