// P3-FGT-15 evidence: contact sheets of the realistic human in the boxing lab (/play/boxing-lab?mode=boxer), one tile per
// query, tiled with ImageMagick.
//   node qa/e2e/human-sheet.mjs <out.jpg> <tile px> "<query 1>" "<query 2>" ...   (QA_WEB default http://localhost:3980)
// e.g. node qa/e2e/human-sheet.mjs /tmp/walk.jpg 420 "mode=boxer&outfit=casual&clip=walk&at=0&cam=fullSide" ...
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3980";
const [out, px, ...queries] = process.argv.slice(2);
const size = Number(px) || 480;
const dir = mkdtempSync(join(tmpdir(), "human-sheet-"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const files = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: Math.round(size * (Number(process.env.ASPECT ?? 1))), deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const q of queries) {
    await page.goto(`${WEB}/play/boxing-lab?${q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 10 && window.__gkBoxer.probe?.inst?.uniforms?.uTex?.value === 1, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 400));
    const f = join(dir, `${files.length}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
} finally {
  await browser.close();
}
const cols = Number(process.env.COLS ?? Math.min(queries.length, 4));
execFileSync("magick", ["montage", ...files, "-tile", `${cols}x`, "-geometry", `${size}x+2+2`, "-background", "#111", "-quality", "84", out]);
console.log("sheet", out);
