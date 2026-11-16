// Boxing v5 evidence (P3-FGT-16): every action of the fight on the realistic ring people, two fighters + the referee in
// the boxing lab (/play/boxing-lab?body=boxer), frozen at the moment that matters (impact / defence peak / on the
// floor / tied up), from the side fight camera and closer, at desktop 1280×720 and phone 844×390; one contact sheet per
// action plus one sheet of all actions.
//   node qa/e2e/boxing-v5-sheet.mjs <outDir> [action,...]   (QA_WEB defaults to http://localhost:3960; TAG=before|after)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3960";
const out = process.argv[2];
const only = process.argv[3]?.split(",");
const tag = process.env.TAG ?? "after";
mkdirSync(out, { recursive: true });

/** [action, lab clip, freeze (at=…), extra query] */
const ACTIONS = [
  ["guard", "guard", "0.5", "&gap=1.1"],
  ["jab", "jab", "impact", "&gap=1.1"],
  ["cross", "cross", "impact", "&gap=1.1"],
  ["hook", "leadHook", "impact", "&gap=0.9"],
  ["uppercut", "rearUppercut", "impact", "&gap=0.82"],
  ["rear-hook", "rearHook", "impact", "&gap=0.9"],
  ["lead-uppercut", "leadUppercut", "impact", "&gap=0.82"],
  ["rear-body", "rearBody", "impact", "&gap=0.95"],
  ["body-shot", "leadBody", "impact", "&gap=0.9"],
  ["block", "blockHigh", "impact", "&gap=1.1"],
  ["clinch", "clinch", "1.7", ""],
  ["hit-reaction", "hitHeadHeavy", "impact", "&gap=1.1"],
  ["knockdown", "knockdown", "1.5", ""],
  ["referee-count", "knockdown", "2.6", ""],
  ["knockdown-landing", "knockdown", "0.72", ""],
  ["get-up", "getUp", "0.5", ""],
];
const CAMS = (process.env.CAMS ?? "side,close,front").split(",");
const SIZES = (process.env.SIZES ?? "1280x720,844x390").split(",");

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const perf = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const [name, clip, at, extra] of ACTIONS) {
    if (only && !only.includes(name)) continue;
    const files = [];
    for (const size of SIZES) {
      const [w, h] = size.split("x").map(Number);
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: h < 500, hasTouch: h < 500 });
      for (const cam of CAMS) {
        const url = `${WEB}/play/boxing-lab?body=boxer&headgear=1&clip=${clip}&at=${at}&cam=${cam}${extra}${process.env.EXTRA ?? ""}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
        await page.waitForFunction(() => window.__gkProbe?.frames > 40, { timeout: 180000 });
        await new Promise((r) => setTimeout(r, 900));
        const f = join(out, `${tag}-${name}-${cam}-${size}.jpg`);
        await page.screenshot({ path: f, type: "jpeg", quality: 82 });
        const p = await page.evaluate(() => ({ calls: window.__gkProbe.calls, tris: window.__gkProbe.tris }));
        perf.push({ name, cam, size, ...p });
        files.push(f);
      }
    }
    const sheet = join(out, `${tag}-${name}.jpg`);
    execFileSync("magick", ["montage", ...files, "-tile", `${CAMS.length}x`, "-geometry", "640x360+2+2", "-background", "#111", "-quality", "80", sheet]);
    console.log("sheet", sheet);
  }
} finally {
  writeFileSync(join(out, `${tag}-perf.json`), JSON.stringify(perf, null, 1));
  await browser.close();
}
