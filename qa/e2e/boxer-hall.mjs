// P3-FGT-14 evidence in the real boxing hall (own stack: web QA_WEB, the API behind its /api/v1 proxy): a practice
// fight on a feature ring (R1: judges at their tables), the side camera, the rest on the stool, a knockdown count.
//   QA_WEB=http://localhost:3940 SIZE=1280x720 node qa/e2e/boxer-hall.mjs <outDir> [ring]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3940";
const [out, ring = "R1"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const [w, h] = (process.env.SIZE ?? "1280x720").split("x").map(Number);
const tag = process.env.TAG ?? `${w}x${h}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"], protocolTimeout: 600000 });
const perf = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: Number(process.env.DPR ?? 1), isMobile: h < 500, hasTouch: h < 500 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const phone = "0788414" + String(Date.now() % 1000).padStart(3, "0");
    const r = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone }) }).then((x) => x.json());
    const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone, code: r.devCode }) }).then((x) => x.json());
    await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "bx" + (Date.now() % 100000) }) });
  });
  await page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded" });
  await sleep(25000);
  await page.evaluate(() => window.__gkStage.getState().show("hall:boxing"));
  await sleep(15000);
  const st = () => page.evaluate(() => window.__gkFight?.bridge.getState().mine?.snap ?? null);
  const shot = async (name) => {
    const p = await page.evaluate(() => {
      const gl = document.querySelector("canvas");
      return { fps: Math.round(window.__gkPerf?.fps ?? 0), w: gl?.width };
    });
    perf.push({ name, ...p });
    await page.screenshot({ path: join(out, `${name}-${tag}.jpg`), type: "jpeg", quality: 80 });
    console.log("shot", name);
  };
  await shot("hall-arrive");
  await page.evaluate((r) => window.__gkFight.actions.practice(r, 1), ring);
  // the rules card (first fight): tick and accept
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => {
      const box = [...document.querySelectorAll('input[type="checkbox"]')].find((b) => b.closest("label")?.textContent?.includes("accept"));
      if (!box) return false;
      if (!box.checked) box.click();
      const btn = [...document.querySelectorAll("button")].find((b) => /Accept and continue/.test(b.textContent ?? ""));
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });
    if (done) break;
    await sleep(500);
  }
  for (let i = 0; i < 120 && (await st())?.phase !== "round"; i++) await sleep(500);
  await sleep(1500);
  await page.keyboard.down("w");
  await sleep(1000);
  await page.keyboard.up("w");
  for (const [k, name] of [
    ["j", "jab"],
    ["u", "lead-hook"],
    ["l", "guard"],
  ]) {
    await page.keyboard.press(k);
    await sleep(name === "guard" ? 800 : 220);
    await shot(`hall-${name}`);
    await sleep(600);
  }
  // the round's end, now: the rest on the stool, the corner team, the judges at their tables beyond
  await page.evaluate(() => {
    const s = window.__gkPractice?.session();
    if (s) s.state.left = 20;
  });
  for (let i = 0; i < 60 && (await st())?.phase !== "rest"; i++) await sleep(250);
  await sleep(600);
  await shot("hall-rest-stool-carried");
  await sleep(3000);
  await shot("hall-rest-on-stool");
  // round 2: a knockdown and the count
  await page.evaluate(() => {
    const s = window.__gkPractice?.session();
    if (s) s.state.left = 20;
  });
  for (let i = 0; i < 120 && (await st())?.phase !== "round"; i++) await sleep(250);
  for (let i = 0; i < 80 && (await st())?.phase === "round"; i++) {
    await page.evaluate(() => {
      window.__gkPractice.session().state.fighters[1].composure = 1;
    });
    await page.keyboard.down("w");
    await sleep(120);
    await page.keyboard.up("w");
    await page.keyboard.press(i % 2 ? "j" : "k");
    await sleep(160);
  }
  for (let i = 0; i < 40 && ((await st())?.count ?? 0) < 4; i++) await sleep(250);
  await shot("hall-count-4");
  for (let i = 0; i < 40 && ((await st())?.count ?? 0) < 7; i++) await sleep(250);
  await shot("hall-count-7");
} finally {
  writeFileSync(join(out, `hall-perf-${tag}.json`), JSON.stringify(perf, null, 1));
  await browser.close();
}
