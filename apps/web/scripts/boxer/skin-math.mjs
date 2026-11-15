// Skinning maths of the boxer-body build (P3-FGT-14), pure and tested (src/world/human/boxer/skin-math.test.ts).

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * How much of a vertex's static weight (clavicle / chest / neck) the shoulder helper takes: 1 on the deltoid cap and
 * in the armpit next to the joint, 0 from 15 cm away, 0 medially (collarbone, pec, trapezius); under the joint only
 * where the arm already pulls on the vertex (the torso's side under the armpit keeps its chest weights), over it
 * everywhere (the top of the shoulder rounds with the deltoid instead of folding under it).
 * @param {number[]} p vertex (m), @param {number[]} j shoulder joint (m, same side), @param {number} armShare 0…1
 */
export function shoulderShare(p, j, armShare) {
  // over the joint (the shoulder top, where a vest strap sits) the share reaches further in; under it (pec, breast,
  // the torso's side) it stays tight round the armpit
  const up = smooth(-0.02, 0.04, p[1] - j[1]);
  const lateral = Math.abs(p[0]) - (Math.abs(j[0]) - (0.06 + 0.06 * up));
  const d = Math.hypot(p[0] - j[0], p[1] - j[1], p[2] - j[2]);
  const gate = Math.max(smooth(0, 0.3, armShare), up);
  return smooth(0, 0.06, lateral) * (1 - smooth(0.07 + 0.02 * up, 0.12 + 0.04 * up, d)) * gate;
}

/**
 * Four [bone, weight] pairs as glTF bytes: weights rounded to /255 and re-summed to exactly 255 on the largest, so no
 * vertex drifts off its bones (glTF wants the sum to be 1).
 * @param {number[]} w four weights (sum ≈ 1) @returns {number[]}
 */
export function weightBytes(w) {
  const q = w.map((x) => Math.round(clamp(x, 0, 1) * 255));
  let big = 0;
  for (let k = 1; k < q.length; k++) if (q[k] > q[big]) big = k;
  q[big] += 255 - q.reduce((n, x) => n + x, 0);
  return q;
}
