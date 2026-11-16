// P3-FGT-15 evidence in the fight lab (/fight-lab?scene=1, no hall / login): the first-person fight camera (my own
// gloves, forearms and — looking down — body and legs; each punch type extending out of my view and landing), the side
// broadcast camera, a knockdown with the count and the get-up, the corner, the result.
//   node qa/e2e/fpv-fight-lab.mjs <outDir>   (QA_WEB default http://localhost:3980, SIZE=WxH, DPR)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3980";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const [w, h] = (process.env.SIZE ?? "1280x720").split("x").map(Number);
const dpr = Number(process.env.DPR ?? 1);
const tag = process.env.TAG ?? `${w}x${h}`;
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perf = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: h < 500, hasTouch: h < 500 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`${WEB}/fight-lab?scene=1&auto=1&level=1&rounds=2&secs=20&name=Aline&fcam=first`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__gkRingLab?.frames > 30 && window.__gkPractice?.session(), { timeout: 180000 });
  const phase = () => page.evaluate(() => window.__gkPractice.session().state.phase);
  const cam = (c) => page.evaluate((c) => window.__gkRingLab.ui.getState().set({ fightCam: c }), c);
  const look = (yaw, pitch, held) => page.evaluate(([y, p, hd]) => Object.assign(window.__gkFpvLook ?? {}, { yaw: y, pitch: p, held: hd }), [yaw, pitch, held]);
  const shot = async (name) => {
    const p = await page.evaluate(() => ({ calls: window.__gkRingLab.calls, tris: window.__gkRingLab.tris, fps: window.__gkRingLab.fps }));
    perf.push({ name, ...p });
    await page.screenshot({ path: join(out, `${name}-${tag}.jpg`), type: "jpeg", quality: 82 });
    console.log("shot", name, JSON.stringify(p));
  };
  for (let i = 0; i < 80 && (await phase()) !== "round"; i++) await sleep(250);
  await sleep(1200);
  if (want("fpv")) {
    // walk in, the guard, then each punch type, shot near its impact frame
    await page.keyboard.down("w");
    await sleep(700);
    await page.keyboard.up("w");
    await sleep(500);
    await shot("fpv-guard");
    for (const [k, name, at] of [
      ["j", "jab", 170],
      ["k", "cross", 230],
      ["u", "lead-hook", 260],
      ["i", "rear-hook", 260],
      ["o", "uppercut", 260],
      ["e+j", "body-jab", 200],
    ]) {
      if (k.startsWith("e+")) {
        await page.keyboard.down("e");
        await page.keyboard.press(k.slice(2));
        await page.keyboard.up("e");
      } else await page.keyboard.press(k);
      await sleep(at);
      await shot(`fpv-${name}`);
      await sleep(650);
    }
    await page.keyboard.down("l");
    await sleep(500);
    await shot("fpv-block");
    await page.keyboard.up("l");
    // look down: my body and legs
    await look(0, 0.95, true);
    await sleep(900);
    await shot("fpv-look-down");
    await look(0, 0, false);
    await sleep(900);
  }
  if (want("side")) {
    await cam("fight");
    await sleep(1800);
    for (const [k, name] of [
      ["j", "jab"],
      ["u", "lead-hook"],
      ["o", "uppercut"],
    ]) {
      await page.keyboard.press(k);
      await sleep(230);
      await shot(`side-${name}`);
      await sleep(600);
    }
    await cam("first");
    await sleep(800);
  }
  if (want("rest")) {
    for (let i = 0; i < 160 && (await phase()) !== "rest"; i++) await sleep(250);
    await sleep(2400);
    await shot("rest-corner");
    for (let i = 0; i < 160 && (await phase()) !== "round"; i++) await sleep(250);
    await sleep(800);
  }
  if (want("ko")) {
    // a knockdown: the opponent's composure to nothing, then punch until it lands
    for (let i = 0; i < 80 && (await phase()) === "round"; i++) {
      await page.evaluate(() => {
        window.__gkPractice.session().state.fighters[1].composure = 1;
      });
      await page.keyboard.down("w");
      await sleep(120);
      await page.keyboard.up("w");
      await page.keyboard.press(i % 2 ? "j" : "k");
      await sleep(160);
      if (i === 2) await shot("fpv-impact");
    }
    for (let i = 0; i < 40; i++) {
      const c = await page.evaluate(() => window.__gkPractice.stores.bridge.getState().mine?.snap?.count ?? 0);
      if (c >= 3) break;
      await sleep(250);
    }
    await shot("knockdown-count");
    for (let i = 0; i < 80 && (await phase()) === "knockdown"; i++) await sleep(250);
    await sleep(900);
    await shot(`after-count-${await phase()}`);
  }
  if (want("over")) {
    // the result: finish it
    for (let i = 0; i < 200 && (await phase()) !== "over"; i++) {
      await page.evaluate(() => {
        const s = window.__gkPractice.session();
        if (s.state.phase === "round") s.state.fighters[1].composure = 1;
      });
      await page.keyboard.press(i % 2 ? "j" : "k");
      await sleep(200);
    }
    await sleep(2600);
    await shot("result");
  }
} finally {
  writeFileSync(join(out, `perf-fpv-${tag}.json`), JSON.stringify(perf, null, 2));
  await browser.close();
}
