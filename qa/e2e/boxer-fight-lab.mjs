// P3-FGT-14 evidence in the fight lab (/fight-lab?scene=1: the practice ring, fighters, referee, corner team, the fight
// camera; no hall / login): punches in the round, the stool carried in and sat on at the rest, a knockdown with the
// referee's finger count. node qa/e2e/boxer-fight-lab.mjs <outDir>  (QA_WEB default http://localhost:3940, SIZE=WxH)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3940";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const [w, h] = (process.env.SIZE ?? "1280x720").split("x").map(Number);
const tag = process.env.TAG ?? `${w}x${h}`;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perf = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: Number(process.env.DPR ?? 1), isMobile: h < 500, hasTouch: h < 500 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`${WEB}/fight-lab?scene=1&auto=1&level=1&rounds=3&secs=16&name=Aline`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__gkRingLab?.frames > 30 && window.__gkPractice?.session(), { timeout: 120000 });
  const phase = () => page.evaluate(() => window.__gkPractice.session().state.phase);
  const shot = async (name) => {
    const p = await page.evaluate(() => ({ calls: window.__gkRingLab.calls, tris: window.__gkRingLab.tris, fps: window.__gkRingLab.fps }));
    perf.push({ name, ...p });
    await page.screenshot({ path: join(out, `${name}-${tag}.jpg`), type: "jpeg", quality: 80 });
    console.log("shot", name, JSON.stringify(p));
  };
  // the round: wait for it, walk in, throw a few punches
  for (let i = 0; i < 60 && (await phase()) !== "round"; i++) await sleep(250);
  await page.keyboard.down("w");
  await sleep(900);
  await page.keyboard.up("w");
  for (const [k, name] of [
    ["j", "jab"],
    ["k", "cross"],
    ["u", "lead-hook"],
    ["o", "uppercut"],
    ["l", "guard"],
  ]) {
    await page.keyboard.press(k);
    await sleep(name === "guard" ? 700 : 200);
    await shot(`round-${name}`);
    await sleep(500);
  }
  // the rest: the stool comes over the ropes, the fighter sits on it
  for (let i = 0; i < 120 && (await phase()) !== "rest"; i++) await sleep(250);
  await sleep(500);
  await shot("rest-stool-carried");
  await sleep(2600);
  await shot("rest-on-stool");
  await sleep(2500);
  await shot("rest-corner");
  // a knockdown: the opponent's composure to nothing, then jab until it lands
  for (let i = 0; i < 120 && (await phase()) !== "round"; i++) await sleep(250);
  for (let i = 0; i < 80 && (await phase()) === "round"; i++) {
    await page.evaluate(() => {
      const s = window.__gkPractice.session();
      s.state.fighters[1].composure = 1;
    });
    await page.keyboard.down("w");
    await sleep(120);
    await page.keyboard.up("w");
    await page.keyboard.press(i % 2 ? "j" : "k");
    await sleep(160);
  }
  console.log("phase", await phase());
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => window.__gkPractice.session().state.count ?? window.__gkPractice.stores.bridge.getState().mine?.snap?.count ?? 0);
    if (c >= 3) break;
    await sleep(250);
  }
  await shot("count-3");
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => window.__gkPractice.stores.bridge.getState().mine?.snap?.count ?? 0);
    if (c >= 7) break;
    await sleep(250);
  }
  await shot("count-7");
} finally {
  writeFileSync(join(out, `perf-${tag}.json`), JSON.stringify(perf, null, 1));
  await browser.close();
}
