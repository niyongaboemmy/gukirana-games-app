// P2-AVA-13: the v9 scanned people against the current campus people in the human lab, same camera and light rig.
// Saves PNG frames (combine / compress them into docs/QA/human-v9/ separately) and measures fps with 20 people.
//
//   node qa/e2e/human-assess/v9-compare.mjs --web http://localhost:3211 --out <dir> [--shots] [--perf]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", "http://localhost:3211");
const OUT = arg("out", "v9-shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// a minimal Chrome DevTools Protocol client over Node's built-in WebSocket (no puppeteer dependency)
const PORT = Number(arg("port", 9433));
const chrome = spawn(
  process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "gk-v9-"))}`, "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio", "--disable-frame-rate-limit", "about:blank"],
  { stdio: "ignore" },
);
let ver = null;
for (let i = 0; i < 80 && !ver; i++) {
  await sleep(250);
  ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { ok, no } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) no(new Error(JSON.stringify(m.error)));
    else ok(m.result);
  } else if (m.method === "Runtime.exceptionThrown") console.error("pageerror", JSON.stringify(m.params.exceptionDetails).slice(0, 300));
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const browser = {
  async newPage() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await s("Runtime.enable");
    await s("Page.enable");
    return {
      setViewport: (vp) => s("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor, mobile: !!vp.isMobile }),
      on() {},
      goto: (url) => s("Page.navigate", { url }),
      async evaluate(fn) {
        const r = await s("Runtime.evaluate", { expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true });
        return r.result.value;
      },
      async waitForFunction(fn, { timeout }) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
          if (await this.evaluate(fn).catch(() => false)) return;
          await sleep(500);
        }
        throw new Error("timeout waiting for the lab");
      },
      async screenshot({ path }) {
        const r = await s("Page.captureScreenshot", { format: "png" });
        writeFileSync(path, Buffer.from(r.data, "base64"));
      },
      close: () => send("Target.closeTarget", { targetId }),
    };
  },
  async close() {
    ws.close();
    chrome.kill();
  },
};
const VP = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};

async function open(query, vp = VP.desktop) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on("pageerror", (e) => console.error("pageerror", String(e.message).slice(0, 300)));
  page.on("console", (m) => m.type() === "warning" && /v9/.test(m.text()) && console.error("console", m.text()));
  await page.goto(`${WEB}/play/human-lab?${query}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(() => window.__gkHuman?.ready, { timeout: 240_000 });
  await sleep(7000);
  return page;
}

// [name, query]: current (no v9) and v9=only at the same camera / light
const SHOTS = [];
for (const light of ["day"]) {
  for (const [cam, extra] of [
    ["face", "anim=0"],
    ["full", "anim=0"],
    ["walk", "walk=1.2"],
  ]) {
    SHOTS.push([`current-${cam}-${light}`, `light=${light}&cam=${cam}&${extra}&body=masculine&skin=6`]);
    for (const p of ["in3d-dima", "in3d-woman", "fwild-fullbody"])
      SHOTS.push([`v9-${p}-${cam}-${light}`, `light=${light}&cam=${cam}&${extra}&v9=only&v9person=${p}`]);
  }
}
SHOTS.push(["v9-in3d-dima-talk", "light=day&cam=full&v9=only&v9person=in3d-dima&v9clip=talk"]);
SHOTS.push(["v9-in3d-woman-sit", "light=day&cam=full34&v9=only&v9person=in3d-woman&v9clip=sit"]);
SHOTS.push(["v9-fwild-wave", "light=day&cam=full&v9=only&v9person=fwild-fullbody&v9clip=wave"]);
SHOTS.push(["v9-crowd", "light=day&cam=full&v9=only&crowd=20"]);
SHOTS.push(["current-crowd", "light=day&cam=full&crowd=20"]);

if (process.argv.includes("--shots"))
  for (const [name, q] of SHOTS) {
    const page = await open(q);
    if (name.endsWith("crowd")) await page.evaluate(() => Object.assign(window.__gkHuman.view, { az: 0, el: 8, dist: 9, target: "body", fov: 50 }));
    await sleep(1500);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log("shot", name);
    await page.close();
  }

if (process.argv.includes("--perf")) {
  const res = {};
  for (const variant of ["current", "v9"])
    for (const [vpName, vp] of Object.entries(VP)) {
      const page = await open(`crowd=19&light=day&cam=full&dpr=${vp.deviceScaleFactor}${variant === "v9" ? "&v9=only" : ""}`, vp);
      await page.evaluate(() => Object.assign(window.__gkHuman.view, { az: 0, el: 8, dist: 9, target: "body", fov: 50 }));
      await sleep(6000);
      const r = await page.evaluate(async () => {
        const gl = window.__gkHuman.gl;
        const f0 = window.__gkHuman.frames;
        const t0 = performance.now();
        await new Promise((ok) => setTimeout(ok, 6000));
        const fps = ((window.__gkHuman.frames - f0) * 1000) / (performance.now() - t0);
        const i = gl.info;
        return { fps: +fps.toFixed(1), calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures };
      });
      res[`${variant}/${vpName}`] = r;
      console.log(variant, vpName, JSON.stringify(r));
      await page.close();
    }
  writeFileSync(join(OUT, "perf.json"), JSON.stringify(res, null, 2));
}
await browser.close();
