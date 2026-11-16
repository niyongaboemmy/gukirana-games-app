// P3-FGT-16: measure a ring person's arms in the boxer lab, per clip / time: the gloves and elbows in the fighter's root
// frame (x = the person's left, y up, z forward), the elbow flexion and how far the forearm leaves the elbow's hinge
// plane ("side": a real elbow bends in one plane only, 0°; the P3-FGT-14 IK reached 20–60°), and whether the elbow is
// over-straightened (hyper: flexion below 0).
//   node qa/e2e/boxer-probe.mjs "jab@0.14,cross@0.2" [extra query, e.g. "&arms=ik"]   (QA_WEB defaults to :3960)
//   JSON=1 prints one JSON line per sample (for the evidence tables)
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3960";
const list = process.argv[2].split(",").map((s) => s.split("@"));
const extra = process.argv[3] ?? "";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 400 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const [clip, at] of list) {
    await page.goto(`${WEB}/play/boxing-lab?mode=boxer&clip=${clip}&at=${at}${extra}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 10, { timeout: 180000 });
    await new Promise((r) => setTimeout(r, 300));
    const r = await page.evaluate(() => {
      const p = window.__gkBoxer.probe;
      const root = p.inst.root;
      root.updateMatrixWorld(true);
      const inv = root.matrixWorld.clone().invert();
      const V = p.inst.bone("Bip01_Head").position.constructor;
      const at = (n) => p.inst.bone(n).getWorldPosition(new V()).applyMatrix4(inv);
      const out = {};
      for (const S of ["L", "R"]) {
        const up = p.inst.bone(`Bip01_${S}_UpperArm`),
          fo = p.inst.bone(`Bip01_${S}_Forearm`),
          ha = p.inst.bone(`Bip01_${S}_Hand`);
        const qu = up.getWorldQuaternion(up.quaternion.clone()),
          qf = fo.getWorldQuaternion(fo.quaternion.clone());
        const rel = qu.clone().invert().multiply(qf);
        // bind directions (identity bind rotations: local = root axes in the bind pose)
        const ub = fo.position.clone().normalize(),
          fb = ha.position.clone().normalize();
        const hb = ub.clone().cross(fb).normalize();
        const fd = fb.clone().applyQuaternion(rel);
        const side = (Math.asin(Math.min(1, Math.abs(fd.dot(hb)))) * 180) / Math.PI;
        // signed flexion in the hinge plane, from straight (along ub)
        const inPlane = fd.clone().addScaledVector(hb, -fd.dot(hb)).normalize();
        const flex = (Math.atan2(ub.clone().cross(inPlane).dot(hb), ub.dot(inPlane)) * 180) / Math.PI;
        const sh = at(`Bip01_${S}_UpperArm`),
          el = at(`Bip01_${S}_Forearm`),
          wr = at(`Bip01_${S}_Hand`);
        const gl = wr.clone().add(wr.clone().sub(el).normalize().multiplyScalar(0.085));
        out[S] = { glove: gl.toArray().map((x) => +x.toFixed(3)), elbow: el.toArray().map((x) => +x.toFixed(3)), shoulderY: +sh.y.toFixed(3), flex: +flex.toFixed(1), side: +side.toFixed(1) };
      }
      return out;
    });
    if (process.env.JSON) console.log(JSON.stringify({ clip, at, ...r }));
    else console.log(`${clip}@${at}: L flex ${r.L.flex}° side ${r.L.side}° glove ${r.L.glove} | R flex ${r.R.flex}° side ${r.R.side}° glove ${r.R.glove}`);
  }
} finally {
  await browser.close();
}
