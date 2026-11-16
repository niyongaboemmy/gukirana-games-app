// P2-AVA-12 crowd performance: the human lab's crowd mode (N people walking / running / idling around the camera)
// with the old people (?people=v1) and the realistic campus people (v2), desktop 1280×720 and phone 844×390 DPR 2.
// Records fps (frames over a fixed window), draw calls, triangles, geometries / textures (renderer.info) and the
// character asset bytes.
//
//   node qa/e2e/human-assess/crowd-perf.mjs --web http://localhost:3995 --out docs/QA/campus-humans/perf.json [--n 30]
import { mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", "http://localhost:3995");
const OUT = arg("out", join(HERE, "crowd-perf.json"));
const N = Number(arg("n", 30));
// variants: "v1" (before), "v2" (after), "v2-off:sheen+motion" (after with parts switched off, dev only)
const VARIANTS = arg("variants", "v1,v2").split(",");
const REPEAT = Number(arg("repeat", 3));
const VPS = arg("vps", "desktop,phone").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};
const browser = await puppeteer.launch({
  executablePath: process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio", "--disable-frame-rate-limit"],
  protocolTimeout: 600_000,
});
const res = { at: new Date().toISOString(), n: N, runs: {}, samples: {} };
// interleaved repeats (the machine is shared: fps drifts), the median of each
for (let rep = 0; rep < REPEAT; rep++)
for (const variant of VARIANTS) {
  const [people, offPart] = variant.split("-off:");
  const off = offPart ? `&rhoff=${offPart.replaceAll("+", ",")}` : "";
  for (const vpName of VPS) {
    const vp = VIEWPORTS[vpName];
    const page = await browser.newPage();
    await page.setViewport(vp);
    page.on("pageerror", (e) => console.error("pageerror", String(e.message).slice(0, 200)));
    await page.goto(`${WEB}/play/human-lab?crowd=${N}&people=${people}${off}&light=day&cam=full&dpr=${vp.deviceScaleFactor}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.__gkHuman?.ready, { timeout: 180_000 });
    // a wide view over the crowd from eye height behind the first ring
    await page.evaluate(() => Object.assign(window.__gkHuman.view, { az: 0, el: 8, dist: 9, target: "body", fov: 50 }));
    await sleep(9000); // models + life clips streamed, shaders compiled
    const r = await page.evaluate(async () => {
      const gl = window.__gkHuman.gl;
      const f0 = window.__gkHuman.frames;
      const t0 = performance.now();
      await new Promise((ok) => setTimeout(ok, 5000));
      const fps = ((window.__gkHuman.frames - f0) * 1000) / (performance.now() - t0);
      const i = gl.info;
      return { fps: +fps.toFixed(1), calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? null };
    });
    const key = `${variant}/${vpName}`;
    (res.samples[key] ??= []).push(r);
    // (a sample whose page reloaded mid-window — a dev hot reload — counts frames from 0: dropped)
    const fpsAll = res.samples[key].map((x) => x.fps).filter((f) => f > 0).sort((a, b) => a - b);
    res.runs[key] = { ...r, fps: fpsAll[Math.floor(fpsAll.length / 2)], fpsSamples: fpsAll };
    console.log(variant, vpName, JSON.stringify(r));
    await page.close();
  }
}
await browser.close();
// character asset bytes shipped (unchanged by P2-AVA-12 unless a file is listed here)
const dir = join(HERE, "../../../apps/web/public/assets/characters");
res.assets = Object.fromEntries(readdirSync(dir).map((f) => [f, statSync(join(dir, f)).size]));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(res, null, 1));
void readFileSync;
console.log(`→ ${OUT}`);
