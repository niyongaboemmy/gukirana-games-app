// P2-WLD-19 visual evidence: the same plaza ground view and the same campus aerial view at every phase of the day,
// a frame strip of a preset transition, the HUD time chip + menu (desktop / phone), and a hall window by day and night.
//   BASE=http://localhost:3960 node qa/e2e/time-of-day.mjs [all|views|strip|hud|hall|baseline] [--tier=lite]
// Times are pinned with the dev hook window.__gkTod (world/time-of-day/store.ts, not in production).
// Screenshots → $QA_EVIDENCE (default $TMPDIR/gk-qa/tod); draw calls are the probe's whole-frame renderer.info.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = process.env.BASE ?? "http://localhost:3960";
const OUT = process.env.QA_EVIDENCE ?? join(tmpdir(), "gk-qa", "tod");
mkdirSync(OUT, { recursive: true });
const what = process.argv[2] ?? "all";
const tier = process.argv.find((a) => a.startsWith("--tier="))?.slice(7);
const q = tier ? `?tier=${tier}` : "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kigali clock times (minutes after midnight) for each phase, on today's date
const PHASES = [
  ["dawn", 5 * 60 + 28],
  ["sunrise", 5 * 60 + 47],
  ["morning", 8 * 60],
  ["midday", 12 * 60 + 30],
  ["golden", 17 * 60 + 15],
  ["sunset", 17 * 60 + 48],
  ["twilight", 18 * 60 + 5],
  ["night", 21 * 60],
];

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio"],
  protocolTimeout: 600000,
});
const results = { at: new Date().toISOString(), tier: tier ?? "auto", views: [], strip: [], notes: [] };

async function signedInPage(viewport = { width: 1280, height: 720 }) {
  const p = await b.newPage();
  await p.setViewport(viewport);
  p.on("pageerror", (e) => results.notes.push(`pageerror: ${String(e).slice(0, 200)}`));
  await p.goto(`${BASE}/gate`, { waitUntil: "domcontentloaded" });
  await p.evaluate(async () => {
    const phone = "0788" + String(Date.now() % 1000000).padStart(6, "0");
    const r = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone }) }).then((r) => r.json());
    const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone, code: r.devCode }) }).then((r) => r.json());
    await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "tod" + (Date.now() % 100000) }) });
  });
  return p;
}

async function toWorld(p, path = "/world") {
  await p.goto(`${BASE}${path}${q}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const ok = await p.evaluate(() => window.__gkProbe?.ready && !!window.__gkProbe?.view).catch(() => false);
    if (ok) break;
    await sleep(1000);
  }
  await sleep(6000);
}

/** median whole-frame draw calls over ~1.5 s */
const calls = (p) =>
  p.evaluate(async () => {
    const c = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      await new Promise((r) => requestAnimationFrame(r));
      if (window.__gkProbe?.calls) c.push(window.__gkProbe.calls);
    }
    c.sort((a, b) => a - b);
    return { calls: c[Math.floor(c.length / 2)] ?? null, fps: Math.round(c.length / 1.5), tier: window.__gkStage?.getState().tier, fx: window.__gkStage?.getState().fx };
  });

const setTime = (p, min, instant = true) => p.evaluate((m, i) => window.__gkTod?.pin(m, i), min, instant);
const ground = (p) => p.evaluate(() => Object.assign(window.__gkCam, { yaw: 0, pitch: 0.2, distance: 9 }));
const aerial = (p) => p.evaluate(() => Object.assign(window.__gkCam, { yaw: 0.35, pitch: 0.62, distance: 260 }));
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 70 });

async function stand(p) {
  // by the avenue end of the plaza, looking north over the fountain to the arena (the perf "gate-north" pose)
  await p.evaluate(() => {
    window.__gkNav.goal = null;
    window.__gkNav.target = { x: 0, z: 30 };
  });
  await sleep(7000);
  await closeCards(p);
}
/** dismiss guide / notice cards over the view (close buttons of PaperCards) */
const closeCards = (p) =>
  p.evaluate(() => {
    for (const b of document.querySelectorAll(".pcard .pcard-hbtn[aria-label]")) if (/close|dismiss|not now/i.test(b.getAttribute("aria-label"))) b.click();
  });

if (what === "baseline" || what === "all" || what === "views") {
  const p = await signedInPage();
  await toWorld(p);
  await stand(p);
  const list = what === "baseline" ? [["baseline", null]] : PHASES;
  for (const [name, min] of list) {
    if (min != null) await setTime(p, min, true);
    await ground(p);
    await sleep(2500);
    const g = await calls(p);
    await shot(p, `plaza-${name}${tier ? `-${tier}` : ""}`);
    await aerial(p);
    await sleep(3500);
    const a = await calls(p);
    await shot(p, `aerial-${name}${tier ? `-${tier}` : ""}`);
    results.views.push({ phase: name, min, ground: g, aerial: a });
    console.log(name, "ground", JSON.stringify(g), "aerial", JSON.stringify(a));
  }
  await p.close();
}

if (what === "all" || what === "strip") {
  // a preset transition: Midday → Night (through golden hour, sunset and twilight), one frame every 0.5 s
  const p = await signedInPage();
  await toWorld(p);
  await stand(p);
  await ground(p);
  await p.evaluate(() => window.__gkTod?.preset("midday", true));
  await sleep(2500);
  await p.evaluate(() => window.__gkTod?.preset("night", false));
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await shot(p, `strip-${String(i).padStart(2, "0")}`);
    const st = await p.evaluate(() => window.__gkTod?.state());
    results.strip.push({ ms: Date.now() - t0, ...st });
    await sleep(400);
  }
  await p.close();
}

if (what === "all" || what === "hud") {
  for (const [vp, viewport] of [
    ["desktop", { width: 1280, height: 720 }],
    ["phone", { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }],
  ]) {
    const p = await signedInPage(viewport);
    await toWorld(p);
    await p.evaluate(() => window.__gkTod?.preset("night", true));
    await sleep(2000);
    await shot(p, `hud-chip-${vp}`);
    await p.evaluate(() => document.querySelector("[data-tod-chip]")?.click());
    await sleep(800);
    await shot(p, `hud-menu-${vp}`);
    await p.close();
  }
}

if (what === "all" || what === "hall") {
  const p = await signedInPage();
  for (const [name, min] of [
    ["day", 11 * 60],
    ["night", 21 * 60],
  ]) {
    await p.evaluateOnNewDocument((m) => {
      try {
        localStorage.setItem("gk.timeOfDay", JSON.stringify({ mode: "custom", minutes: m }));
      } catch {}
    }, min);
    await toWorld(p, "/room/pool");
    await p.evaluate(() => Object.assign(window.__gkCam ?? {}, { yaw: Math.PI, pitch: 0.12, distance: 6 }));
    await sleep(6000);
    await shot(p, `hall-pool-window-${name}`);
  }
  await p.close();
}

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results.notes.slice(0, 10)));
await b.close();
