// P3-FGT-19B fighter-v8 harness: the pure metric maths (no imports, no DOM), shared by the node runner (run.mjs) and
// the page (inpage.js gets this file injected with its `export`s stripped). Unit-tested in
// apps/web/src/world/human/boxer/v8/harness-metrics.test.ts.
//
// Everything works on plain [x, y, z] arrays in metres, y up.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const DEG = 180 / Math.PI;

/** the angle at b between b→a and b→c, degrees (180 = straight) */
export function angleAt(a, b, c) {
  const u = sub(a, b),
    v = sub(c, b);
  const l = len(u) * len(v);
  if (l < 1e-12) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * DEG;
}

/** flexion of a hinge a–b–c (0 = straight, 150 = tightly bent), degrees */
export const flexion = (a, b, c) => 180 - angleAt(a, b, c);

/** the angle between two directions, degrees */
export function between(u, v) {
  const l = len(u) * len(v);
  if (l < 1e-12) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * DEG;
}

/**
 * How far the knee is BEHIND the hip–ankle line along the foot's forward direction (m; > 0 = hyperextended).
 * A real knee only bends forward over the toes.
 */
export function kneeBehind(hip, knee, ankle, footFwd) {
  const d = sub(ankle, hip);
  const t = Math.max(0, Math.min(1, dot(sub(knee, hip), d) / Math.max(1e-9, dot(d, d))));
  const onLine = [hip[0] + d[0] * t, hip[1] + d[1] * t, hip[2] + d[2] * t];
  // the foot's forward direction across the leg (its part along the hip–ankle line says nothing about which way the
  // knee bends); undetermined (NaN: not checked) when the foot points along the leg, e.g. a rear leg driven back on
  // its toes in a cross
  const fl = len(footFwd) || 1;
  const f = [footFwd[0] / fl, footFwd[1] / fl, footFwd[2] / fl];
  const dl = len(d) || 1;
  const du = [d[0] / dl, d[1] / dl, d[2] / dl];
  const k = dot(f, du);
  const p = [f[0] - du[0] * k, f[1] - du[1] * k, f[2] - du[2] * k];
  const pl = len(p);
  if (pl < 0.35) return NaN;
  return -dot(sub(knee, onLine), [p[0] / pl, p[1] / pl, p[2] / pl]);
}

/** joint limits checked on the posed skeleton (degrees / metres); the acceptance config may override them */
export const JOINT_LIMITS = {
  elbowFlexMax: 155,
  kneeFlexMax: 155,
  kneeBehindMax: 0.015,
  wristDevMax: 35,
  neckBendMax: 55,
  spineTwistMax: 75,
};

/**
 * Check one posed skeleton. `j` = world joint positions by short name:
 *   pelvis, chest, neck, head, and per side S (L / R): S.shoulder, S.elbow, S.wrist, S.knuckle, S.hip, S.knee,
 *   S.ankle, S.toe; plus `pelvisFwd` / `chestFwd` (horizontal forward directions) for the spine twist.
 * → { checks: [{ joint, value, limit, ok }], violations }
 */
export function jointChecks(j, limits = JOINT_LIMITS) {
  const L = { ...JOINT_LIMITS, ...limits };
  const out = [];
  const put = (joint, value, limit) => {
    if (!Number.isFinite(value)) return;
    out.push({ joint, value: +value.toFixed(3), limit, ok: value <= limit });
  };
  for (const s of ["L", "R"]) {
    const g = (k) => j[`${s}.${k}`];
    if (g("shoulder") && g("elbow") && g("wrist")) put(`${s}.elbowFlex`, flexion(g("shoulder"), g("elbow"), g("wrist")), L.elbowFlexMax);
    if (g("elbow") && g("wrist") && g("knuckle")) put(`${s}.wristDev`, between(sub(g("wrist"), g("elbow")), sub(g("knuckle"), g("wrist"))), L.wristDevMax);
    if (g("hip") && g("knee") && g("ankle")) {
      put(`${s}.kneeFlex`, flexion(g("hip"), g("knee"), g("ankle")), L.kneeFlexMax);
      if (g("toe")) put(`${s}.kneeBehind`, kneeBehind(g("hip"), g("knee"), g("ankle"), sub(g("toe"), g("ankle"))), L.kneeBehindMax);
    }
  }
  if (j.chest && j.neck && j.head) put("neckBend", between(sub(j.neck, j.chest), sub(j.head, j.neck)), L.neckBendMax);
  if (j.pelvisFwd && j.chestFwd) put("spineTwist", between([j.pelvisFwd[0], 0, j.pelvisFwd[2]], [j.chestFwd[0], 0, j.chestFwd[2]]), L.spineTwistMax);
  return { checks: out, violations: out.filter((c) => !c.ok).length };
}

/**
 * Foot sliding from sampled toe positions: frames = [{ t, L: [x,y,z], R: [x,y,z] }]. A foot is planted while it is
 * within `plantH` of its lowest height in the window and moving up / down slower than `plantV`; the slide is its
 * horizontal travel while planted.
 * → { maxSlideCm (one plant's worst travel), slideCmPerS (planted travel per planted second), plants, plantedS }
 */
export function footSlide(frames, { plantH = 0.025, plantV = 0.12 } = {}) {
  let maxSlide = 0,
    travel = 0,
    planted = 0,
    plants = 0;
  for (const s of ["L", "R"]) {
    const ys = frames.map((f) => f[s]?.[1]).filter((y) => Number.isFinite(y));
    if (!ys.length) continue;
    const floor = Math.min(...ys);
    let cur = null;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1][s],
        b = frames[i][s];
      const dt = frames[i].t - frames[i - 1].t;
      if (!a || !b || dt <= 0) continue;
      const vy = Math.abs(b[1] - a[1]) / dt;
      const down = b[1] - floor < plantH && a[1] - floor < plantH && vy < plantV;
      if (down) {
        const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (!cur) ((cur = { d: 0 }), plants++);
        cur.d += d;
        travel += d;
        planted += dt;
        if (cur.d > maxSlide) maxSlide = cur.d;
      } else cur = null;
    }
  }
  return { maxSlideCm: +(maxSlide * 100).toFixed(2), slideCmPerS: planted ? +((travel / planted) * 100).toFixed(2) : 0, plants, plantedS: +planted.toFixed(2) };
}

/**
 * Cavity visibility from an id render (inpage.js cavity): RGBA bytes where B > 127 marks the person, R > 127 a back
 * face, G > 127 skin. → shares of the person's pixels showing the inside of the body (skin back faces: a hole) and
 * the inside of a garment (garment back faces: arm holes, hems, the neck opening).
 */
export function cavityStats(rgba) {
  let person = 0,
    skinBack = 0,
    garmentBack = 0,
    vest = 0,
    vestBack = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 2] < 128) continue;
    person++;
    // (alpha > 200: the singlet — jersey or its binding)
    const isVest = rgba[i + 3] > 200;
    if (isVest) vest++;
    if (rgba[i] < 128) continue;
    if (rgba[i + 1] >= 128) skinBack++;
    else garmentBack++;
    if (isVest) vestBack++;
  }
  const f = (n) => (person ? +(n / person).toFixed(5) : 0);
  return { personPx: person, skinBackPx: skinBack, garmentBackPx: garmentBack, skinBackShare: f(skinBack), garmentBackShare: f(garmentBack), vestPx: vest, vestBackPx: vestBack, vestBackShare: vest ? +(vestBack / vest).toFixed(5) : 0 };
}

/** mean and worst of a list (null on an empty list) */
export function summary(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return { mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4), worst: +Math.max(...v).toFixed(4), min: +Math.min(...v).toFixed(4), n: v.length };
}

/** read a dotted path ("proportions.m.waistToHip") from an object */
export function pick(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Score a metrics object against the acceptance config:
 *   { items: [{ id, label, metric: "<dotted path>", min?, max?, equals?, source? }] }
 * An item with none of min / max / equals set (null) is "unset" (the design's checklist fills it in); a metric that was not
 * measured is "missing". → { items: [{ id, label, value, min, max, status: pass|fail|unset|missing }], pass, fail, unset, missing, ok }
 */
export function score(metrics, acceptance) {
  const items = acceptance.items.map((it) => {
    const raw = pick(metrics, it.metric);
    const value = raw && typeof raw === "object" && "worst" in raw ? raw.worst : raw;
    const min = it.min ?? null,
      max = it.max ?? null,
      equals = it.equals ?? null;
    let status;
    if (min === null && max === null && equals === null) status = "unset";
    else if (value === undefined || value === null || (typeof value === "number" && Number.isNaN(value))) status = "missing";
    else if (equals !== null) status = value === equals ? "pass" : "fail";
    else status = (min === null || value >= min) && (max === null || value <= max) ? "pass" : "fail";
    return { id: it.id, label: it.label, metric: it.metric, value: value ?? null, min, max, ...(equals !== null ? { equals } : {}), status, ...(it.source ? { source: it.source } : {}) };
  });
  const n = (s) => items.filter((i) => i.status === s).length;
  return { items, pass: n("pass"), fail: n("fail"), unset: n("unset"), missing: n("missing"), ok: n("fail") === 0 && n("missing") === 0 };
}
