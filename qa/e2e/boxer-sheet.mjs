// Boxer body contact sheets (P3-FGT-14): one pose from several views of the lab's chest-frame camera, tiled.
//   node qa/e2e/boxer-sheet.mjs <out.jpg> "<base query>" view1,view2,...   (QA_WEB defaults to http://localhost:3940)
// e.g. node qa/e2e/boxer-sheet.mjs /tmp/jab.jpg "mode=boxer&clip=jab&at=impact&bare=1" front,shoulderL,backL,armpitL
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3940";
const [out, base, views = "front,shoulderL,backL,shoulderR"] = process.argv.slice(2);
const list = views.split(",");
const dir = mkdtempSync(join(tmpdir(), "boxer-sheet-"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const files = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const v of list) {
    await page.goto(`${WEB}/play/boxing-lab?${base}&cam=${v}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 10, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 500));
    const f = join(dir, `${files.length}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
} finally {
  await browser.close();
}
execFileSync("magick", ["montage", ...files, "-tile", `${Math.min(list.length, 4)}x`, "-geometry", "480x480+2+2", "-background", "#111", "-quality", "82", out]);
console.log("sheet", out);
