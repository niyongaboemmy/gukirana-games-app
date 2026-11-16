// P3-FGT-16: triangles / vertices of one ring person (the merged skinned mesh after the covered body faces are dropped)
// and the lab frame's draw calls / triangles, per body and outfit.  node qa/e2e/boxer-tris.mjs   (QA_WEB default :3960)
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3960";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390 });
  for (const q of ["gender=m", "gender=f", "gender=m&headgear=0", "gender=m&outfit=referee"]) {
    await page.goto(`${WEB}/play/boxing-lab?mode=boxer&clip=guard&${q}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 10, { timeout: 180000 });
    const r = await page.evaluate(() => {
      const m = window.__gkBoxer.probe.inst.mesh;
      return { tris: m.geometry.index.count / 3, verts: m.geometry.attributes.position.count, frameTris: window.__gkProbe.tris, calls: window.__gkProbe.calls };
    });
    console.log(q, JSON.stringify(r));
  }
} finally {
  await browser.close();
}
