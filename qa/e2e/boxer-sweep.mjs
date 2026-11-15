// Boxer body sweep (P3-FGT-14): every action at its key frame from a few chest-frame views, one tile per clip, all in
// one contact sheet. node qa/e2e/boxer-sweep.mjs <out.jpg> "<extra query>" [views] [clips]
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3940";
const [out, extra = "", views = "full,shoulderL,backR", clipsArg] = process.argv.slice(2);
const CLIPS = (clipsArg ?? "guard,jab,cross,leadHook,rearHook,leadUppercut,rearUppercut,leadBody,rearBody,blockHigh,blockLow,parry,slipLeft,duck,clinch,hitHeadHeavy,hitBodyHeavy,knockdown,count,getUp,cornerSit").split(",");
const V = views.split(",");
const dir = mkdtempSync(join(tmpdir(), "boxer-sweep-"));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 420, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const c of CLIPS) {
    const files = [];
    for (const v of V) {
      await page.goto(`${WEB}/play/boxing-lab?mode=boxer&clip=${c}&cam=${v}${extra ? `&${extra}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 8, { timeout: 120000 });
      await new Promise((r) => setTimeout(r, 300));
      const f = join(dir, `${c}-${v}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
    const row = join(dir, `${c}.png`);
    execFileSync("magick", [...files, "+append", row]);
    rows.push(row);
    console.log("clip", c);
  }
} finally {
  await browser.close();
}
execFileSync("magick", ["montage", ...rows, "-tile", "3x", "-geometry", "+3+3", "-background", "#111", "-resize", "50%", "-quality", "80", out]);
console.log("sweep", out);
