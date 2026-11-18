// P2-AVA-17: women's tops — the simulated garments against the baked blazer, same look, camera, light and frozen clock.
// Raw Chrome DevTools protocol over Node's built-in WebSocket (no puppeteer). Saves PNG frames; combine / compress them
// into docs/QA/women-tops/ separately (before | after side by side, JPG ≤ 120 KB).
//
//   node qa/e2e/human-assess/women-tops.mjs --web http://localhost:3214 --out <dir> [--items tee,hoodie] [--shots] [--perf]
//
// Before = `wtops=none` (every top on the baked blazer), after = `wtops=all` (every simulated garment on), both dev-only
// lab overrides of the shipped per-item switch (world/human/women-tops.ts).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", "http://localhost:3214");
const OUT = arg("out", "women-tops-shots");
const FREEZE = Number(arg("freeze", 240));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// a virtual clock: performance.now / Date.now / rAF timestamps advance 1/60 s per frame, then stop at frame FREEZE
// (the scene keeps rendering, every animation holds the same pose: before and after show the same idle / walk frame)
const CLOCK = `(() => {
  const F = ${FREEZE}; let frame = 0; const t0 = performance.now(); const d0 = Date.now();
  const vnow = () => t0 + Math.min(frame, F) * (1000 / 60);
  const raf = window.requestAnimationFrame.bind(window);
  performance.now = vnow;
  Date.now = () => d0 + (vnow() - t0);
  window.requestAnimationFrame = (cb) => raf(() => { frame++; cb(vnow()); });
  window.__gkClock = { get frame() { return frame; } };
})();`;

const PORT = Number(arg("port", 9437));
const chrome = spawn(
  process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "gk-wt-"))}`, "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio", "--disable-frame-rate-limit", "about:blank"],
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
  } else if (m.method === "Runtime.exceptionThrown") console.error("pageerror", JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
    console.error("console", m.params.type, JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

async function newPage(vp, freeze) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Runtime.enable");
  await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor, mobile: !!vp.isMobile });
  if (freeze) await s("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  const evaluate = async (expr) => {
    const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  return {
    evaluate,
    goto: (url) => s("Page.navigate", { url }),
    async waitFor(expr, timeout = 240_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await evaluate(expr).catch(() => false)) return;
        await sleep(400);
      }
      throw new Error(`timeout: ${expr}`);
    },
    async shot(path) {
      const r = await s("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    close: () => send("Target.closeTarget", { targetId }),
  };
}
const VP = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true },
  square: { width: 560, height: 560, deviceScaleFactor: 1 },
  tall: { width: 420, height: 700, deviceScaleFactor: 1 },
};

// item -> look code (feminine, a mid skin tone, bun, jeans, sneakers; accent a muted terracotta, so "accent" tops vary)
const look = (top, bottom = "jeans") => `1|f|6E4530|bun|141010|${top}|${bottom}|sneakers|none|none|9a4a32`;
const ITEMS = arg("items", "tee,tee-white,jersey,hoodie,track,kitenge-sun,kitenge-leaf,imigongo-top,mushanana,sash-wave,blazer-cream").split(",");
// [name, viewport, view {az, el, dist, target, fov} | lab preset, extra query]
const VIEWS = [
  ["front", "square", { az: 0, el: 4, dist: 1.25, target: "chest", fov: 32 }, "anim=0"],
  ["q34", "square", { az: 38, el: 6, dist: 1.25, target: "chest", fov: 32 }, "anim=0"],
  ["profile", "square", { az: 90, el: 4, dist: 1.25, target: "chest", fov: 32 }, "anim=0"],
  ["back", "square", { az: 180, el: 6, dist: 1.3, target: "chest", fov: 32 }, "anim=0"],
  ["neck", "square", { az: 25, el: 12, dist: 0.9, target: "head", fov: 32 }, "anim=0"],
  ["wrist", "square", { az: -60, el: 8, dist: 0.55, target: "handR", fov: 32 }, "anim=0"],
  ["full", "tall", { az: 20, el: 3, dist: 4.2, target: "body", fov: 30 }, "anim=0"],
  ["walk", "tall", { az: 40, el: 4, dist: 4.4, target: "body", fov: 30 }, "walk=1.2"],
];
const ONLY = arg("views", "").split(",").filter(Boolean);
const VARIANTS = arg("variants", "none,all").split(",");

if (process.argv.includes("--shots"))
  for (const item of ITEMS)
    for (const [vname, vpName, view, extra] of VIEWS) {
      if (ONLY.length && !ONLY.includes(vname)) continue;
      for (const variant of VARIANTS) {
        const page = await newPage(VP[vpName], true);
        await page.goto(`${WEB}/play/human-lab?light=day&${extra}&wtops=${variant}&look=${encodeURIComponent(look(item))}`);
        await page.waitFor("window.__gkHuman?.ready");
        await page.evaluate(`Object.assign(window.__gkHuman.view, ${JSON.stringify(view)}), true`);
        await page.waitFor(`window.__gkClock.frame > ${FREEZE + 30}`);
        await sleep(1200);
        await page.shot(join(OUT, `${item}_${vname}_${variant}.png`));
        console.log("shot", item, vname, variant);
        await page.close();
      }
    }

if (process.argv.includes("--perf")) {
  const res = {};
  const REPEAT = Number(arg("repeat", 3));
  for (let rep = 0; rep < REPEAT; rep++)
    for (const variant of VARIANTS)
      for (const vpName of ["desktop", "phone"]) {
        const vp = VP[vpName];
        const page = await newPage(vp, false);
        // 20 people: the lab person + 19 round it; the lab person wears a feminine tee
        await page.goto(`${WEB}/play/human-lab?crowd=19&light=day&cam=full&wtops=${variant}&dpr=${vp.deviceScaleFactor}&look=${encodeURIComponent(look("tee"))}`);
        await page.waitFor("window.__gkHuman?.ready");
        await page.evaluate(`Object.assign(window.__gkHuman.view, { az: 0, el: 8, dist: 9, target: "body", fov: 50 }), true`);
        await sleep(9000);
        const r = await page.evaluate(`(async () => {
          const gl = window.__gkHuman.gl; const f0 = window.__gkHuman.frames; const t0 = performance.now();
          await new Promise((ok) => setTimeout(ok, 6000));
          const fps = ((window.__gkHuman.frames - f0) * 1000) / (performance.now() - t0);
          const i = gl.info;
          return { fps: +fps.toFixed(1), calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length ?? null };
        })()`);
        const key = `${variant}/${vpName}`;
        (res[key] ??= []).push(r);
        console.log(key, JSON.stringify(r));
        await page.close();
      }
  writeFileSync(join(OUT, "perf.json"), JSON.stringify(res, null, 2));
}
ws.close();
chrome.kill();
