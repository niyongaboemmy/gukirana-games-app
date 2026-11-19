// P2-AVA-18: campus people realism v2 — the same human-lab shot taken on two builds / query variants (main against this
// branch, or flag off against flag on), with the page clock frozen so both hold the same pose. Raw CDP over Node's
// WebSocket (no puppeteer). Writes `<shot>_<label>.png` per variant and `<shot>.jpg` (A | B side by side, labelled).
//
//   node qa/e2e/human-assess/realism-v2.mjs --a "main,http://localhost:3200," --b "v2,http://localhost:3220,hv2=1" \
//     --out <dir> [--shots face_f,walk_m] [--freeze 240] [--perf] [--cpu 4]
//
// --perf: the lab crowd (20 people), phone viewport 844×390 DPR 2, CPU throttled ×4 (Emulation.setCPUThrottlingRate),
// frame time measured over 8 s from rAF, median of 3 interleaved runs per variant.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const parseVariant = (s) => {
  const [label, web, ...q] = s.split(",");
  return { label, web, query: q.join(",") };
};
const A = parseVariant(arg("a", "main,http://localhost:3200,"));
const B = parseVariant(arg("b", "v2,http://localhost:3220,"));
const OUT = arg("out", "realism-v2-shots");
const FREEZE = Number(arg("freeze", 240));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// Virtual clock: performance.now / Date.now / rAF timestamps advance exactly 1/60 s per frame. Default ("freeze"): the
// clock stops at frame FREEZE and the scene keeps rendering (every animation holds its pose; fine for standing shots).
// --halt H: the clock never stops, and H frames after the lab is ready the page stops running frames altogether, so the
// canvas keeps that frame (a walking person keeps walking up to it: the gait needs moving time).
const HALT = Number(arg("halt", 0));
const CLOCK = `(() => {
  const F = ${FREEZE}; const H = ${HALT}; let frame = 0; let readyAt = -1; const t0 = performance.now(); const d0 = Date.now();
  const vnow = () => t0 + (H > 0 ? frame : Math.min(frame, F)) * (1000 / 60);
  const raf = window.requestAnimationFrame.bind(window);
  performance.now = vnow;
  Date.now = () => d0 + (vnow() - t0);
  window.requestAnimationFrame = (cb) => raf(() => {
    if (H > 0) {
      if (readyAt < 0 && window.__gkHuman?.ready) readyAt = frame;
      if (readyAt >= 0 && frame >= readyAt + H) { window.__gkClock.halted = true; return; }
    }
    frame++; cb(vnow());
  });
  window.__gkClock = { halted: false, get frame() { return frame; } };
})();`;

const PORT = Number(arg("port", 9451));
const chrome = spawn(
  process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "gk-rv2-"))}`, "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio", "--disable-frame-rate-limit", "about:blank"],
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
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
    console.error("console", JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 300));
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

async function newPage(vp, freeze, cpu = 1) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Runtime.enable");
  await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor, mobile: !!vp.isMobile });
  if (cpu > 1) await s("Emulation.setCPUThrottlingRate", { rate: cpu });
  if (freeze) await s("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  const evaluate = async (expr) => {
    const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  return {
    evaluate,
    goto: (url) => s("Page.navigate", { url }),
    async waitFor(expr, timeout = 300_000) {
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
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true },
  square: { width: 560, height: 560, deviceScaleFactor: 1 },
  tall: { width: 420, height: 700, deviceScaleFactor: 1 },
  wide: { width: 900, height: 560, deviceScaleFactor: 1 },
};
// looks: adult Rwandan campus people (feminine braids + tee, masculine short + hoodie, a 50+ man, a darker-skinned woman)
const LOOK = {
  f: "1|f|6E4530|braids|141010|tee|jeans|sneakers|none|none|9a4a32",
  m: "1|m|4A2C21|short|141010|hoodie|chinos|sneakers|none|none|5a4636",
  s: "1|m|5C3A26|short|3a3632|kitenge-sun|chinos|loafers|none|none|6a3a22",
  d: "1|f|3B2219|bun|141010|imigongo-top|skirt|sandals|none|none|7a3a2a",
  a: "1|f|5C3A26|afro|141010|tee|jeans|sneakers|none|none|6a4a3a",
  l: "1|m|6E4530|locs|141010|tee|jeans|sneakers|none|none|4a4a3a",
  // a top still drawn as the feminine base blazer (the jersey garment is held)
  j: "1|f|85562C|puffs|141010|jersey|chinos|sneakers|none|none|2f4a3a",
};
const V = {
  face: { az: 0, el: 2, dist: 0.62, target: "head", fov: 28 },
  face34: { az: 35, el: 3, dist: 0.62, target: "head", fov: 28 },
  eyes: { az: 10, el: 0, dist: 0.32, target: "eyes", fov: 24 },
  torso: { az: 25, el: 4, dist: 1.35, target: "chest", fov: 32 },
  full: { az: 20, el: 3, dist: 4.2, target: "body", fov: 30 },
  walk: { az: 70, el: 4, dist: 4.4, target: "body", fov: 30 },
  hand: { az: -60, el: 8, dist: 0.55, target: "handR", fov: 32 },
  far: { az: 20, el: 8, dist: 11, target: "body", fov: 30 },
  front: { az: 0, el: 4, dist: 1.25, target: "chest", fov: 32 },
  q34: { az: 38, el: 6, dist: 1.25, target: "chest", fov: 32 },
  side: { az: 90, el: 4, dist: 1.25, target: "chest", fov: 32 },
  back: { az: 180, el: 6, dist: 1.3, target: "chest", fov: 32 },
  armpit: { az: 70, el: -4, dist: 0.8, target: "chest", fov: 32 },
};
// [name, viewport, look, view, extra query]
const SHOTS = [
  ["face_f", "square", "f", "face", "anim=0"],
  ["face34_f", "square", "f", "face34", "anim=0"],
  ["face_m", "square", "m", "face", "anim=0"],
  ["face34_m", "square", "m", "face34", "anim=0"],
  ["face34_s", "square", "s", "face34", "anim=0&age=senior"],
  ["face34_d", "square", "d", "face34", "anim=0"],
  ["face34_a", "square", "a", "face34", "anim=0"],
  ["face34_l", "square", "l", "face34", "anim=0"],
  ["eyes_f", "square", "f", "eyes", "anim=0"],
  ["torso_f", "square", "f", "torso", "anim=0"],
  ["torso_m", "square", "m", "torso", "anim=0"],
  ["hand_m", "square", "m", "hand", "anim=0"],
  ["full_f", "tall", "f", "full", "anim=0"],
  ["full_m", "tall", "m", "full", "anim=0"],
  ["full_s", "tall", "s", "full", "anim=0&age=senior"],
  ["walk_f", "tall", "f", "walk", "walk=1.25"],
  ["walk_m", "tall", "m", "walk", "walk=1.25"],
  ["wave_m", "tall", "m", "full", "anim=10"],
  ["clap_f", "tall", "f", "full", "anim=12"],
  ["far_f", "tall", "f", "far", "anim=0"],
  ["torso_j", "square", "j", "torso", "anim=0"],
  ["full_j", "tall", "j", "full", "anim=0"],
  ["walk_j", "tall", "j", "walk", "walk=1.25"],
  ["walk_d", "tall", "d", "walk", "walk=1.25"],
  ["tee_front", "square", "f", "front", "anim=0"],
  ["tee_q34", "square", "f", "q34", "anim=0"],
  ["tee_side", "square", "f", "side", "anim=0"],
  ["tee_back", "square", "f", "back", "anim=0"],
  ["tee_armpit", "square", "f", "armpit", "anim=0"],
  ["tee_full", "tall", "f", "full", "anim=0"],
];
const ONLY = arg("shots", "").split(",").filter(Boolean);
const LIGHT = arg("light", "day");
// debugging: an expression evaluated in the page just before each shot (e.g. hide a mesh)
const EVAL = arg("eval", "");

async function take(variant, shot) {
  const [name, vpName, lookKey, viewKey, extra] = shot;
  const page = await newPage(VP[vpName], true);
  const q = [`light=${LIGHT}`, extra, variant.query, `look=${encodeURIComponent(LOOK[lookKey])}`].filter(Boolean).join("&");
  await page.goto(`${variant.web}/play/human-lab?${q}`);
  await page.waitFor("window.__gkHuman?.ready");
  await page.evaluate(`Object.assign(window.__gkHuman.view, ${JSON.stringify(V[viewKey])}), true`);
  await page.waitFor(HALT > 0 ? "window.__gkClock.halted" : `window.__gkClock.frame > ${FREEZE + 40}`);
  if (EVAL) await page.evaluate(EVAL);
  await sleep(1500);
  const file = join(OUT, `${name}_${variant.label}.png`);
  await page.shot(file);
  await page.close();
  return file;
}

if (process.argv.includes("--shots") || ONLY.length) {
  for (const shot of SHOTS) {
    if (ONLY.length && !ONLY.includes(shot[0])) continue;
    const fa = await take(A, shot);
    const fb = await take(B, shot);
    const lab = (f, l) => ["(", f, "-gravity", "north", "-fill", "#f0e8dc", "-undercolor", "#00000080", "-pointsize", "16", "-annotate", "+0+6", l, ")"];
    execFileSync("magick", [...lab(fa, A.label), ...lab(fb, B.label), "+append", "-quality", "86", join(OUT, `${shot[0]}.jpg`)]);
    console.log("pair", shot[0]);
  }
}

if (process.argv.includes("--perf")) {
  const res = {};
  const REPEAT = Number(arg("repeat", 3));
  const CPU = Number(arg("cpu", 4));
  for (let rep = 0; rep < REPEAT; rep++)
    for (const variant of [A, B]) {
      const vp = VP.phone;
      const page = await newPage(vp, false, CPU);
      const q = ["crowd=19", "light=day", "cam=full", `dpr=${vp.deviceScaleFactor}`, variant.query, `look=${encodeURIComponent(LOOK.f)}`].filter(Boolean).join("&");
      await page.goto(`${variant.web}/play/human-lab?${q}`);
      await page.waitFor("window.__gkHuman?.ready");
      await page.evaluate(`Object.assign(window.__gkHuman.view, { az: 0, el: 8, dist: 9, target: "body", fov: 50 }), true`);
      await sleep(12000);
      const r = await page.evaluate(`(async () => {
        const gl = window.__gkHuman.gl; const dts = []; let last = performance.now();
        await new Promise((ok) => { const t0 = last; const f = (t) => { dts.push(t - last); last = t; if (t - t0 < 8000) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
        dts.sort((a, b) => a - b);
        const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
        const i = gl.info;
        return { frames: dts.length, medianMs: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, programs: i.programs?.length ?? null };
      })()`);
      (res[variant.label] ??= []).push(r);
      console.log(variant.label, JSON.stringify(r));
      await page.close();
    }
  writeFileSync(join(OUT, "perf.json"), JSON.stringify(res, null, 2));
}
ws.close();
chrome.kill();
