// P3-FGT-16: garment-edge close-ups (0.4 m) of a boxer in every kind of pose — the vest's arm holes, straps and
// neckline from the front, the sides, the back and under the arm — one row per pose, tiled into one sheet.
//   node qa/e2e/boxer-edges.mjs <out.jpg> [extra query]   (QA_WEB defaults to http://localhost:3960)
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3960";
const [out, extra = ""] = process.argv.slice(2);
const POSES = (process.env.POSES ?? "guard@0.5,jab@impact,cross@impact,leadHook@impact,rearUppercut@impact,leadBody@impact,blockHigh@impact,clinch@0.4,knockdown@1.5,getUp@0.7").split(",");
const VIEWS = (process.env.VIEWS ?? "front&dist=0.5&el=12,shoulderL&dist=0.4,shoulderR&dist=0.4,backL&dist=0.4,backR&dist=0.4,armpitL&dist=0.42").split(",");
const dir = mkdtempSync(join(tmpdir(), "boxer-edges-"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const files = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 420, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const ps of POSES) {
    const [clip, at] = ps.split("@");
    for (const v of VIEWS) {
      await page.goto(`${WEB}/play/boxing-lab?mode=boxer&headgear=0&clip=${clip}&at=${at}&cam=${v}${extra}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 10, { timeout: 180000 });
      await new Promise((r) => setTimeout(r, 300));
      const f = join(dir, `${files.length}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
  }
} finally {
  await browser.close();
}
execFileSync("magick", ["montage", ...files, "-tile", `${VIEWS.length}x`, "-geometry", "300x300+1+1", "-background", "#111", "-quality", "70", out]);
console.log("sheet", out);
