// P3-FGT-19A: render prototype shots with the path tracer in headless Chrome (dev only).
//   node qa/fighter-v8/shoot.mjs <shot-list.json | name=query …>
// Each shot: [name, query]. PNGs go to qa/fighter-v8/raw/<name>.png (git-ignored). Port 3987 (never the app's).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve } from "./serve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
mkdirSync(RAW, { recursive: true });
const PORT = Number(process.env.PORT ?? 3987);
const args = process.argv.slice(2);
let shots = [];
for (const a of args) {
  if (a.endsWith(".json")) shots.push(...JSON.parse(readFileSync(a, "utf8")));
  else {
    const i = a.indexOf("=");
    shots.push([a.slice(0, i), a.slice(i + 1)]);
  }
}
if (process.env.ONLY) shots = shots.filter(([n]) => process.env.ONLY.split(",").some((o) => n.includes(o)));

const server = await serve(PORT);
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-gpu-watchdog", "--disable-renderer-backgrounding"],
  protocolTimeout: 1800000,
});
const log = [];
// warm-up page: the first path-traced page of a browser session can come out black (texture upload race)
shots.unshift(["_warmup", "f=" + (new URLSearchParams(shots[0]?.[1] ?? "").get("f") ?? "mW") + "&w=200&h=200&spp=4&light=arena"]);
try {
  for (const [name, query] of shots) {
    const page = await browser.newPage();
    const q = new URLSearchParams(query);
    const w = Number(q.get("w") ?? 900), h = Number(q.get("h") ?? 1200);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") console.log(`  [${name}] ${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => console.log(`  [${name}] pageerror: ${e.message}`));
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/page/index.html?${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fighter && (window.__fighter.done || window.__fighter.error), { timeout: 1700000, polling: 1000 });
    const st = await page.evaluate(() => window.__fighter);
    if (st.error) {
      console.log(`${name}: ERROR ${st.error}`);
      log.push({ name, error: st.error });
      await page.close();
      continue;
    }
    const data = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
    writeFileSync(join(RAW, `${name}.png`), Buffer.from(data.split(",")[1], "base64"));
    console.log(`${name}: ${st.samples} spp, ${((Date.now() - t0) / 1000).toFixed(1)} s, pushed ${JSON.stringify(st.info.pushedFraction)}`);
    log.push({ name, query, samples: st.samples, seconds: (Date.now() - t0) / 1000, info: st.info });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  writeFileSync(join(RAW, `log-${Date.now()}.json`), JSON.stringify(log, null, 1));
}
