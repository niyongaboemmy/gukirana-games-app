#!/usr/bin/env node
// P3-FGT-19B authoring aid: fit the keyed-arm angles of the v8 guard / jab / hook to the design's targets
// (docs/design/fighter-v8/SPEC.md §9, checklist 15a) ON THE REAL RIG AND BODIES — the boxing lab's boxer view poses each
// fighter synchronously (BoxerProbe.poseNow) while a coordinate descent (node side) moves the free angles; the cost is
// summed over the male and the female body, so one set of angles (the clips are shared) serves both. Wrist fixed
// straight. Prints the angles for pose.ts (GUARD_V8_*_ARM) and clips.ts (V8_KEYS).
//
//   node qa/e2e/fighter-v8/fit-pose.mjs [--web http://localhost:3971] [--only guard,jab,hook]
import puppeteer from "puppeteer-core";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", "http://localhost:3971");
const ONLY = arg("only", "guard,jab,hook").split(",");
const GENDERS = arg("genders", "m,f").split(",");
const FREE_LEAD = arg("freeLead");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** in the page: install the job's pose and an evaluator (angles in degrees → cost + numbers) */
function install(job) {
  const { probe, sampleClip, P, ARM } = window.__gkBoxer;
  const THREE = window.__gkProbe.three;
  const DEG = Math.PI / 180;
  const pose = sampleClip(job.clip, job.t);
  const off = job.side === "lead" ? P.la : P.ra;
  const W = (n) => {
    const v = probe.inst.bone(n).getWorldPosition(new THREE.Vector3());
    return [v.x, v.y, v.z];
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => scl(a, 1 / (len(a) || 1));
  window.__fit = (angles) => {
    for (const [k, v] of Object.entries(angles)) pose[off + ARM[k]] = v * DEG;
    probe.poseNow(pose);
    const q = probe.inst.bone("Bip01_Head").getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const fwd = norm([f.x, 0, f.z]);
    const left = [fwd[2], 0, -fwd[0]];
    const eyes = scl(add(W("Bip01_L_Eye"), W("Bip01_R_Eye")), 0.5);
    const S = job.side === "lead" ? "L" : "R";
    const sh = W(`Bip01_${S}_UpperArm`),
      el = W(`Bip01_${S}_Forearm`),
      wr = W(`Bip01_${S}_Hand`),
      kn = W(`Bip01_${S}_Finger2`),
      tip = W(`Bip01_${S}_Finger22`);
    const shL = W("Bip01_L_UpperArm"),
      shR = W("Bip01_R_UpperArm");
    const mid = scl(add(shL, shR), 0.5);
    const xA = norm(sub(shL, shR));
    const halfW = len(sub(shL, mid));
    const fa = norm(sub(wr, el));
    const pr = sub(tip, kn);
    const palm = norm(sub(pr, scl(fa, dot(pr, fa))));
    const glove = add(wr, scl(fa, 0.08));
    const d = sub(glove, eyes);
    const g = { fwd: dot(d, fwd), left: dot(d, left), up: d[1] };
    const toMid = norm([mid[0] - wr[0], 0, mid[2] - wr[2]]);
    const r = {
      g,
      forearm: (Math.asin(Math.min(1, Math.abs(fa[1]))) * 180) / Math.PI,
      elbowBelow: sh[1] - el[1],
      elbowLat: Math.abs(dot(sub(el, mid), xA)),
      halfW,
      palmDown: -palm[1],
      palmIn: dot(palm, toMid),
      ext: len(sub(wr, sh)) / (len(sub(el, sh)) + len(sub(wr, el))),
      elbowAngle: (Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(sh, el)), norm(sub(wr, el)))))) * 180) / Math.PI,
      elbowVsShoulder: el[1] - sh[1],
    };
    const sq = (x) => x * x;
    let c = 0;
    if (job.glove) c += 40 * (sq(g.fwd - job.glove.fwd) + sq(g.left - job.glove.left) + sq(g.up - job.glove.up));
    if (job.gloveUpMin !== undefined) c += 200 * sq(Math.min(0, g.up - job.gloveUpMin));
    if (job.gloveUpAbs) c += 400 * sq(Math.max(0, Math.abs(g.up) - job.gloveUpAbs));
    if (job.gloveLeftMin) c += 400 * sq(Math.min(0, g.left - job.gloveLeftMin));
    if (job.forearm) c += 0.003 * sq(r.forearm - job.forearm);
    if (job.forearmMin) c += 0.05 * sq(Math.min(0, r.forearm - job.forearmMin));
    if (job.elbowBelow) c += 300 * sq(Math.min(0, r.elbowBelow - job.elbowBelow));
    if (job.elbowInside) c += 600 * sq(Math.max(0, r.elbowLat - (halfW - 0.02)));
    if (job.palmIn) c += 0.5 * sq(Math.min(0, r.palmIn - job.palmIn));
    if (job.palmDown) c += 2 * sq(Math.min(0, r.palmDown - job.palmDown));
    if (job.ext) c += 20 * sq(r.ext - job.ext);
    if (job.elbowAngle) c += 0.004 * sq(r.elbowAngle - job.elbowAngle);
    if (job.elbowAtShoulder) c += 40 * sq(r.elbowVsShoulder);
    return { c, r };
  };
  return Object.fromEntries(Object.entries(ARM).map(([k, i]) => [k, Math.round((pose[off + i] / DEG) * 10) / 10]));
}

const JOBS = {
  guard: [
    // the lead fist out in front at eye height (the eyes look past it: it sits to the lead side of the lead eye),
    // 25 cm in front; forearm ~65°, the elbow down and in
    { name: "guard", clip: "guard", t: 0.5, side: "lead", fixed: { wrist: 0, elev: 11, prot: 13 }, free: ["flex", "abd", "rot", "elbow", "pron"], glove: { fwd: 0.25, left: 0.11, up: 0.0 }, gloveUpAbs: 0.03, gloveLeftMin: 0.095, forearm: 65, elbowBelow: 0.192, elbowInside: true, palmIn: 0.4 },
    // the rear glove low on the cheekbone beside the face (its top below the eye line), forearm ≥ 58°
    { name: "guard", clip: "guard", t: 0.5, side: "rear", fixed: { wrist: 0, elev: 7, prot: 30 }, free: ["flex", "abd", "rot", "elbow", "pron"], glove: { fwd: 0.0, left: -0.08, up: -0.07 }, forearmMin: 58, forearm: 64, elbowBelow: 0.195, elbowInside: true, palmIn: 0.4 },
  ],
  jab: [{ name: "jab", clip: "jab", t: 0.14, side: "lead", fixed: { wrist: 0, elev: 17, prot: 11 }, free: ["flex", "abd", "rot", "elbow", "pron"], glove: { fwd: 0.68, left: 0.02, up: -0.07 }, ext: 0.95, palmDown: 0.9 }],
  hook: [{ name: "hook", clip: "leadHook", t: 0.24, side: "lead", fixed: { wrist: 0 }, free: ["flex", "abd", "rot", "elbow", "pron"], glove: { fwd: 0.32, left: -0.04, up: -0.12 }, elbowAngle: 90, elbowAtShoulder: true, palmDown: 0.6 }],
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal"] });
try {
  for (const name of ONLY) {
    const clip = name === "hook" ? "leadHook" : name;
    const pages = [];
    for (const g of GENDERS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 400, height: 500 });
      await page.goto(`${WEB}/play/boxing-lab?mode=boxer&gender=${g}&clip=${clip}&at=${name === "guard" ? 0.5 : "impact"}&cam=full&boxer=v8`, { waitUntil: "domcontentloaded", timeout: 300000 });
      await page.waitForFunction(() => window.__gkBoxer?.ready && (window.__gkProbe?.frames ?? 0) > 20, { timeout: 300000 });
      pages.push(page);
    }
    for (const job of JOBS[name]) {
      const start = await Promise.all(pages.map((p) => p.evaluate(install, job)));
      const a = { ...start[0], ...job.fixed };
      if (FREE_LEAD && job.side === "lead") job.free = FREE_LEAD.split(",");
      const evalAll = async () => {
        const rs = await Promise.all(pages.map((p) => p.evaluate((x) => window.__fit(x), a)));
        return { c: rs.reduce((s, r) => s + r.c, 0), rs };
      };
      let best = (await evalAll()).c;
      for (let step = 8; step > 0.15; step *= 0.6)
        for (let it = 0; it < 60; it++) {
          let improved = false;
          for (const k of job.free)
            for (const sg of [1, -1]) {
              const v = a[k];
              a[k] = v + sg * step;
              const c2 = (await evalAll()).c;
              if (c2 < best - 1e-9) {
                best = c2;
                improved = true;
              } else a[k] = v;
            }
          if (!improved) break;
        }
      const { rs } = await evalAll();
      const R = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(3) : Object.fromEntries(Object.entries(v).map(([k2, v2]) => [k2, +v2.toFixed(3)]))]));
      console.log(JSON.stringify({ job: job.name, side: job.side, angles: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v)])), cost: +best.toFixed(4), ...Object.fromEntries(GENDERS.map((g, i) => [g, R(rs[i].r)])) }));
    }
    for (const p of pages) await p.close();
  }
} finally {
  await browser.close();
}
