// Quick screenshot helper (P3-FGT-18): node qa/e2e/shoot.mjs <out.png> <path?query> [WxH[@dpr]] [waitMs]
// Waits for the boxing lab (__gkProbe) or the fight lab (__gkRingLab) to have drawn 40 frames, then shoots; prints the
// frame's draw calls / triangles / fps. QA_WEB defaults to http://localhost:3962.
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3962";
const [out, path, size = "1280x720", wait = "1200"] = process.argv.slice(2);
const [wh, dpr = "1"] = size.split("@");
const [w, h] = wh.split("x").map(Number);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: Number(dpr), isMobile: h < 500, hasTouch: h < 500 });
  page.on("pageerror", (e) => console.error("pageerror", process.env.STACK ? e.stack : e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console", m.text().slice(0, 300)));
  await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await page.waitForFunction(() => (window.__gkProbe?.frames ?? 0) > 40 || (window.__gkRingLab?.frames ?? 0) > 40 || (window.__gkRingLab?.fps ?? 0) > 0, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, Number(wait)));
  await page.screenshot({ path: out });
  const p = await page.evaluate(() => {
    const s = window.__gkProbe ?? window.__gkRingLab;
    return s ? { calls: s.calls, tris: s.tris, fps: s.fps } : null;
  });
  console.log(out, JSON.stringify(p));
} finally {
  await browser.close();
}
