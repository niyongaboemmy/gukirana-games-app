// P3-FGT-16 (docs/FIGHT-REALISM-V5.md §4): the boxing glove and the headgear as real product shapes, built in the
// hand / head frame of each body (build.mjs). Pure geometry: each builder gets a vertex sink `vert(p, n, skin, mat,
// extra)` / `face(a, b, c)` (MeshBuilder) and the frame, and returns nothing.
//
// Glove (a 10–12 oz amateur competition glove, measured from product photos / specs: ≈ 30 cm long with the cuff,
// 13 cm wide, 12–13 cm deep at the knuckles): a lofted body with a superellipse section (boxy-round, not a ball) whose
// back rises from the cuff into the knuckle padding and closes in a rounded front roll; a flat-ish palm with the
// fingers' grip line; a separate thumb lying along the side and tied to the body at its tip; a cuff with a raised
// hook-and-loop strap; stitched seams as shallow grooves (the leather panels read, no seamless balloon).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const spow = (x, e) => Math.sign(x) * Math.abs(x) ** e;

/** a grid of positions [rows][cols] (cols wrap) → vertices with smooth normals from the grid, quads as faces */
function gridSurface(m, G, skinOf, matOf, aoOf, centreOf, closeEnds = false) {
  const R = G.length,
    C = G[0].length;
  const id = [];
  for (let v = 0; v < R; v++) {
    const row = [];
    for (let u = 0; u < C; u++) {
      const p = G[v][u];
      const du = sub(G[v][(u + 1) % C], G[v][(u + C - 1) % C]);
      const dv = sub(G[Math.min(R - 1, v + 1)][u], G[Math.max(0, v - 1)][u]);
      let n = norm(cross(dv, du));
      if (Math.hypot(...n) < 0.5 || !Number.isFinite(n[0])) n = norm(sub(p, centreOf(v)));
      if (dot(n, sub(p, centreOf(v))) < 0) n = scl(n, -1);
      row.push(m.vert(p, n, skinOf(v, u), matOf(v, u), { ao: aoOf(v, u) }));
    }
    id.push(row);
  }
  for (let v = 0; v < R - 1; v++)
    for (let u = 0; u < C; u++) {
      const a0 = id[v][u],
        a1 = id[v][(u + 1) % C],
        b0 = id[v + 1][u],
        b1 = id[v + 1][(u + 1) % C];
      m.face(a0, b0, a1);
      m.face(a1, b0, b1);
    }
  void closeEnds;
  return id;
}

/**
 * One glove. Frame: wrist (the hand joint), f (towards the middle finger), n (palm normal, + = palm side), s (n × f:
 * the thumb's side). Bones: hand (rigid) and the forearm-twist bone (the cuff's far end follows the forearm).
 */
export function buildGlove(m, { wrist, f, n, s }, { hand, fore }, MAT) {
  const P3 = (x, y, z) => add(wrist, add(scl(f, x), add(scl(n, y), scl(s, z))));
  // stations along the hand: x, half width (z), back height (−y), palm height (+y), raised strap (m)
  const ST = [
    [-0.118, 0.05, 0.05, 0.049, 0],
    [-0.112, 0.052, 0.052, 0.051, 0],
    [-0.1, 0.053, 0.052, 0.051, 0],
    [-0.094, 0.053, 0.052, 0.051, 0.004],
    [-0.07, 0.052, 0.051, 0.05, 0.004],
    [-0.046, 0.051, 0.05, 0.049, 0.004],
    [-0.04, 0.05, 0.048, 0.047, 0],
    [-0.012, 0.05, 0.048, 0.046, 0],
    [0.0, 0.051, 0.05, 0.046, 0],
    [0.024, 0.057, 0.059, 0.05, 0],
    [0.05, 0.062, 0.066, 0.054, 0],
    [0.08, 0.065, 0.07, 0.056, 0],
    [0.11, 0.065, 0.07, 0.056, 0],
    [0.135, 0.062, 0.065, 0.054, 0],
    [0.155, 0.057, 0.058, 0.05, 0],
  ];
  // the front roll: a quarter ellipse closing the last station
  const last = ST[ST.length - 1];
  const R = 0.05;
  for (let k = 1; k <= 7; k++) {
    const ph = (Math.PI / 2) * (k / 7);
    const c = Math.cos(ph);
    const sc = k === 7 ? 0.0001 : c ** 0.85;
    ST.push([last[0] + R * Math.sin(ph), last[1] * sc, last[2] * sc, last[3] * sc, 0]);
  }
  const C = 36;
  const E = 0.74; // superellipse exponent (2/n, n ≈ 2.7: boxy-round)
  const G = [];
  const centre = [];
  for (const [x, hw, hb, hp, strap] of ST) {
    const row = [];
    // the back's padding peaks a little towards the thumb (the index / middle knuckles take the punch)
    for (let u = 0; u < C; u++) {
      const th = (2 * Math.PI * u) / C;
      const cy = Math.cos(th),
        sz = Math.sin(th);
      const yh = cy > 0 ? hp : hb;
      let y = yh * spow(cy, E);
      let z = hw * spow(sz, E);
      // a grip line across the palm (the fingertips curled into it): a shallow crease on the palm side
      if (x > 0.06 && x < 0.13 && cy > 0.6) y -= 0.004 * smooth(0.6, 0.95, cy) * Math.sin(((x - 0.06) / 0.07) * Math.PI);
      // the stitched side seam (between the back and palm panels): a 1.5 mm groove
      const side = Math.abs(cy) < 0.09 ? 0.0015 : 0;
      const k = strap > 0 ? 1 + strap / Math.max(hw, hb) : 1;
      y = y * k - Math.sign(y) * side;
      z = z * k - Math.sign(z) * side;
      row.push(P3(x, y, z));
    }
    G.push(row);
    centre.push(P3(x, 0, 0));
  }
  const nS = ST.length;
  const twistW = (v) => smooth(-0.03, -0.11, ST[Math.min(v, nS - 1)][0]) * 0.55;
  const skinOf = (v) => {
    const t = twistW(v);
    return t > 0.01 && fore !== undefined ? [[hand, 1 - t], [fore, t]] : [[hand, 1]];
  };
  const matOf = (v, u) => {
    const x = ST[v][0];
    if (ST[v][4] > 0) return MAT.gloveCuff;
    if (x < -0.04) return MAT.gloveCuff;
    // the target area: the knuckle face (back side towards the front) in the lighter leather
    const cy = Math.cos((2 * Math.PI * u) / C);
    if ((x > 0.09 && cy < -0.25) || x > 0.162) return MAT.gloveTarget;
    return MAT.glove;
  };
  const aoOf = (v, u) => {
    const x = ST[v][0];
    const cy = Math.cos((2 * Math.PI * u) / C);
    // seams darken: the strap's edges, the cuff joint, the side seam, the target panel's edge
    if (v === 3 || v === 5 || v === 6 || v === 8) return 0.22;
    if (Math.abs(cy) < 0.09) return 0.3;
    if (Math.abs(x - 0.09) < 0.012 && cy < -0.25) return 0.3;
    return 0.55 + 0.1 * smooth(0.0, 0.1, x);
  };
  gridSurface(m, G, skinOf, matOf, aoOf, (v) => centre[v]);
  // the cuff opening: a rolled lip inwards (the lining shows as a dark ring)
  {
    const lip = [];
    const [x0, hw0, hb0, hp0] = ST[0];
    for (let u = 0; u < C; u++) {
      const th = (2 * Math.PI * u) / C;
      const cy = Math.cos(th),
        sz = Math.sin(th);
      const yh = cy > 0 ? hp0 : hb0;
      lip.push(P3(x0 + 0.004, yh * spow(cy, E) * 0.78, hw0 * spow(sz, E) * 0.78));
    }
    const out0 = G[0];
    const ids = out0.map((p) => m.vert(p, norm(sub(P3(x0 - 1, 0, 0), wrist)), skinOf(0), MAT.gloveCuff, { ao: 0.3 }));
    const lids = lip.map((p) => m.vert(p, norm(sub(P3(x0 - 1, 0, 0), wrist)), skinOf(0), MAT.gloveCuff, { ao: 0.05 }));
    for (let u = 0; u < C; u++) {
      const a0 = ids[u],
        a1 = ids[(u + 1) % C],
        b0 = lids[u],
        b1 = lids[(u + 1) % C];
      m.face(a0, a1, b0);
      m.face(a1, b1, b0);
    }
  }
  // the thumb: a tapering tube along the thumb side, its base in the body, its tip tied to the front
  {
    const path = [
      [0.035, 0.016, 0.05],
      [0.07, 0.03, 0.06],
      [0.105, 0.036, 0.062],
      [0.138, 0.032, 0.056],
      [0.156, 0.024, 0.048],
    ];
    const rad = [0.024, 0.025, 0.023, 0.02, 0.015];
    const CT = 16;
    const T = [];
    const cen = [];
    for (let k = 0; k < path.length; k++) {
      const p = path[k];
      const t = norm(sub(path[Math.min(path.length - 1, k + 1)], path[Math.max(0, k - 1)]));
      // section axes: one along the palm normal (y) made ⟂ the path
      let a = [0, 1, 0];
      a = norm(sub(a, scl(t, dot(a, t))));
      const b = cross(t, a);
      const row = [];
      for (let u = 0; u < CT; u++) {
        const th = (2 * Math.PI * u) / CT;
        const r = rad[k];
        const q = add(p, add(scl(a, Math.cos(th) * r * 0.85), scl(b, Math.sin(th) * r)));
        row.push(P3(q[0], q[1], q[2]));
      }
      T.push(row);
      cen.push(P3(p[0], p[1], p[2]));
    }
    // a rounded tip
    const tip = path[path.length - 1];
    const tdir = norm(sub(tip, path[path.length - 2]));
    for (let k = 1; k <= 3; k++) {
      const ph = (Math.PI / 2) * (k / 3);
      const r = rad[rad.length - 1] * (k === 3 ? 0.001 : Math.cos(ph));
      const c = add(tip, scl(tdir, rad[rad.length - 1] * Math.sin(ph)));
      let a = norm(sub([0, 1, 0], scl(tdir, tdir[1])));
      const b = cross(tdir, a);
      const row = [];
      for (let u = 0; u < CT; u++) {
        const th = (2 * Math.PI * u) / CT;
        const q = add(c, add(scl(a, Math.cos(th) * r * 0.85), scl(b, Math.sin(th) * r)));
        row.push(P3(q[0], q[1], q[2]));
      }
      T.push(row);
      cen.push(P3(c[0], c[1], c[2]));
    }
    gridSurface(
      m,
      T,
      () => [[hand, 1]],
      () => MAT.glove,
      (v) => (v === 0 ? 0.25 : 0.5),
      (v) => cen[v],
    );
  }
}

/**
 * Headgear thickness (m) over the head shell by direction (el = elevation, az = azimuth, front = cos az): an amateur
 * open-face headgear — a thick forehead pad, cheek pads down the sides of the face, padded ear pieces, a thinner
 * crown in quilted panels; seams between the pads are grooves (headgearSeam).
 */
export function headgearThickness(el, az, d, eyeEl, chinEl) {
  const front = Math.cos(az);
  const side = Math.abs(Math.sin(az));
  const crown = 0.013 + 0.003 * Math.max(0, d[1]);
  // forehead pad: a rounded bolster across the brow (thickest in the middle, 2.6 cm)
  const brow = 0.014 * smooth(0.45, 0.8, front) * smooth(eyeEl + 0.02, eyeEl + 0.14, el) * (1 - smooth(eyeEl + 0.38, eyeEl + 0.52, el));
  // cheek pads: in front of the ears, down to the jaw line (2.4 cm)
  const cheek = 0.012 * smooth(0.25, 0.42, side) * smooth(0.05, 0.3, front) * (1 - smooth(eyeEl + 0.05, eyeEl + 0.25, el)) * smooth(chinEl - 0.2, chinEl, el);
  // ear pieces: a padded disc round the ear (1.9 cm)
  const ear = 0.006 * smooth(0.82, 0.95, side) * (1 - smooth(eyeEl + 0.1, eyeEl + 0.35, el)) * smooth(chinEl - 0.1, chinEl + 0.12, el);
  // the pads roll down to the face opening (a padded edge, not a shelf): the extra padding fades over the last ~6°
  // before the opening (front > 0.68 between the brow and the chin, build.mjs region)
  const inBand = el < eyeEl + 0.2 && el > chinEl - 0.05;
  const dSide = inBand ? 0.68 - front : 1;
  const dTop = front > 0.68 ? el - (eyeEl + 0.2) : 1;
  const edge = Math.max(0, Math.min(dSide * 1.4, dTop));
  const roll = 0.35 + 0.65 * smooth(0.0, 0.14, edge);
  return crown * (0.7 + 0.3 * roll) + (brow + cheek + ear) * roll;
}

/** grooves between the headgear's pads (m, subtracted from the thickness) and a darker seam (ao) */
export function headgearSeam(el, az, eyeEl) {
  const front = Math.cos(az);
  const side = Math.abs(Math.sin(az));
  let g = 0;
  // the crown's quilted panels: four seams from the top down the back and sides
  const panels = Math.abs(Math.sin(2 * az));
  if (el > eyeEl + 0.3 && front < 0.6) g = Math.max(g, 0.0025 * smooth(0.12, 0.0, panels));
  // the forehead pad's top edge and the line between brow pad and cheek pads
  if (front > 0.45 && Math.abs(el - (eyeEl + 0.5)) < 0.04) g = Math.max(g, 0.003);
  if (side > 0.3 && side < 0.45 && el < eyeEl + 0.3 && front > 0) g = Math.max(g, 0.0025);
  // the ear piece's rim
  if (Math.abs(side - 0.86) < 0.025 && el < eyeEl + 0.3) g = Math.max(g, 0.002);
  return g;
}
