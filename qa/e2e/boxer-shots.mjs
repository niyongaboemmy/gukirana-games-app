// Boxer body close-ups in the dev boxing lab (P3-FGT-14): one screenshot per "name|query" line.
//   node qa/e2e/boxer-shots.mjs <outDir> "<name>|<query>" ...    (QA_WEB defaults to http://localhost:3940)
// Example query: mode=boxer&clip=jab&at=impact&cam=shoulderL&debug=weights
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3940";
const [out, ...jobs] = process.argv.slice(2);
if (!out || !jobs.length) throw new Error("usage: boxer-shots.mjs <outDir> name|query ...");
mkdirSync(out, { recursive: true });
const [w, h] = (process.env.SIZE ?? "1280x720").split("x").map(Number);
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", `--window-size=${w},${h}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const job of jobs) {
    const [name, query] = job.split("|");
    await page.goto(`${WEB}/play/boxing-lab?${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => (window).__gkProbe?.frames > 20, { timeout: 120000 });
    if (query.includes("mode=boxer")) await page.waitForFunction(() => (window).__gkBoxer?.ready, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: join(out, `${name}.jpg`), type: "jpeg", quality: 82 });
    console.log("shot", name);
  }
} finally {
  await browser.close();
}
