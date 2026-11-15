// P2-WLD-21 night lighting evidence: every campus location at night (21:00) and dusk (18:30), the Agaseke close-up,
// a frame strip of the Tournament Arena's night show, desktop 1280x720 and phone 844x390, draw calls / fps / programs
// per view and phase.
//   BASE=http://localhost:3990 TAG=after node qa/e2e/night-lighting.mjs [views|strip|phone|transition|all] [--tier=lite]
// Times are pinned with the dev hook window.__gkTod; the person is placed with window.__gkPlayer (dev only).
// Screenshots -> $QA_EVIDENCE (default $TMPDIR/gk-qa/night); results-<tag>.json beside them.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = process.env.BASE ?? "http://localhost:3990";
const OUT = process.env.QA_EVIDENCE ?? join(tmpdir(), "gk-qa", "night");
const TAG = process.env.TAG ?? "after";
mkdirSync(OUT, { recursive: true });
const what = process.argv[2] ?? "all";
const tier = process.argv.find((a) => a.startsWith("--tier="))?.slice(7);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7)?.split(",");
const q = tier ? `?tier=${tier}` : "";
const sfx = tier ? `-${tier}` : "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (d) => (d * Math.PI) / 180;
const ring = (deg, r) => ({ x: r * Math.sin(rad(deg)), z: -r * Math.cos(rad(deg)) });
/** camera yaw that looks along the direction (dx, dz) (the follow camera sits behind the person) */
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

/** stand at p, look along yaw, camera pitch / distance */
const front = (deg, r = 25, pitch = 0.1, distance = 8) => ({ ...ring(deg, r), yaw: -rad(deg), pitch, distance });
const VIEWS = [
  { name: "plaza", x: 0, z: 30, yaw: 0, pitch: 0.2, distance: 9 },
  { name: "agaseke", x: 2.6, z: 7.2, yaw: yawTo(-2.6, -7.2), pitch: 0.05, distance: 3.2 },
  { name: "fountain-high", x: 0, z: 14, yaw: 0, pitch: 0.38, distance: 10 },
  { name: "arena", ...front(0, 18, 0.22, 14) },
  { name: "pool", ...front(-44) },
  { name: "ludo", ...front(44) },
  { name: "igisoro", ...front(-88) },
  { name: "fight", ...front(88) },
  { name: "cafe", ...front(122, 27) },
  { name: "soon", ...front(-122, 27) },
  { name: "admin", ...front(62, 97, 0.14, 7) },
  { name: "gate-in", x: 0, z: 46, yaw: Math.PI, pitch: 0.14, distance: 4 },
  { name: "gate-out", x: 0, z: 72, yaw: 0, pitch: 0.12, distance: 8 },
  { name: "walk", ...ring(-40, 102.5), yaw: yawTo(Math.cos(rad(-40)), Math.sin(rad(-40))), pitch: 0.12, distance: 7 },
  { name: "road", x: 60, z: 70, yaw: yawTo(-1, 0), pitch: 0.18, distance: 9 },
  { name: "aerial", x: 0, z: 30, yaw: 0.35, pitch: 0.62, distance: 260 },
].filter((v) => !only || only.includes(v.name));
const phaseArg = process.argv.find((a) => a.startsWith("--phase="))?.slice(8);
const PHASES = [
  ["night", 21 * 60],
  ["dusk", 18 * 60 + 30],
].filter(([n]) => !phaseArg || n === phaseArg);

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio"],
  protocolTimeout: 600000,
});
const results = { at: new Date().toISOString(), tag: TAG, tier: tier ?? "auto", views: [], strip: [], transition: [], notes: [] };

async function signedInPage(viewport = { width: 1280, height: 720 }) {
  const p = await b.newPage();
  await p.setViewport(viewport);
  p.on("pageerror", (e) => results.notes.push(`pageerror: ${String(e).slice(0, 200)}`));
  await p.goto(`${BASE}/gate`, { waitUntil: "domcontentloaded" });
  await p.evaluate(async () => {
    const phone = "0788" + String(Date.now() % 1000000).padStart(6, "0");
    const r = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone }) }).then((r) => r.json());
    const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone, code: r.devCode }) }).then((r) => r.json());
    await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "nite" + (Date.now() % 100000) }) });
  });
  return p;
}

async function toWorld(p) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await p.goto(`${BASE}/world${q}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      // (a new account sometimes lands at the arrival gate: walk through it to the plaza)
      const ok = await p
        .evaluate(() => {
          if (window.__gkProbe?.view === "gate" && window.__gkNav) {
            window.__gkNav.goal = null;
            window.__gkNav.target = { x: 0, z: 30 };
          }
          return window.__gkProbe?.ready && window.__gkProbe?.view === "plaza";
        })
        .catch(() => false);
      if (ok) {
        await sleep(6000);
        return true;
      }
      await sleep(1000);
    }
    results.notes.push(`world: view ${await p.evaluate(() => window.__gkProbe?.view).catch(() => "?")} after 150 s`);
  }
  return false;
}

/** median whole-frame draw calls and fps over ~1.5 s, the compiled program count */
const calls = (p) =>
  p.evaluate(async () => {
    const c = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      await new Promise((r) => requestAnimationFrame(r));
      if (window.__gkProbe?.calls) c.push(window.__gkProbe.calls);
    }
    c.sort((a, b) => a - b);
    return { calls: c[Math.floor(c.length / 2)] ?? null, fps: Math.round(c.length / 1.5), programs: window.__gkProbe?.programs, tier: window.__gkStage?.getState().tier, fx: window.__gkStage?.getState().fx };
  });

const setTime = (p, min, instant = true) => p.evaluate((m, i) => window.__gkTod?.pin(m, i), min, instant);
const closeCards = (p) =>
  p.evaluate(() => {
    for (const b of document.querySelectorAll(".pcard .pcard-hbtn[aria-label]")) if (/close|dismiss|not now/i.test(b.getAttribute("aria-label"))) b.click();
  });
async function place(p, v) {
  await p.evaluate((v) => {
    window.__gkNav.goal = null;
    window.__gkNav.target = null;
    const pl = window.__gkPlayer;
    if (pl?.pos) {
      pl.pos.x = v.x;
      pl.pos.z = v.z;
    }
    Object.assign(window.__gkCam, { yaw: v.yaw, pitch: v.pitch, distance: v.distance });
  }, v);
}
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 72 });

if (what === "all" || what === "views") {
  const p = await signedInPage();
  await toWorld(p);
  await closeCards(p);
  for (const [phase, min] of PHASES) {
    await setTime(p, min, true);
    await sleep(1500);
    for (const v of VIEWS) {
      await place(p, v);
      await sleep(v.name === "aerial" ? 3500 : 2200);
      await place(p, v); // (a second time: the follow camera has settled, the person may have been nudged)
      await sleep(600);
      const m = await calls(p);
      await closeCards(p);
      await shot(p, `${TAG}-${v.name}-${phase}${sfx}`);
      results.views.push({ view: v.name, phase, ...m });
      console.log(phase, v.name, JSON.stringify(m));
    }
  }
  await p.close();
}

if (what === "all" || what === "strip") {
  // the arena's night show: one frame every 0.75 s for ~9 s, and the Agaseke close-up
  const p = await signedInPage();
  await toWorld(p);
  await closeCards(p);
  await setTime(p, 21 * 60, true);
  await place(p, { x: 0, z: -12, yaw: 0, pitch: 0.06, distance: 10 });
  await sleep(3000);
  for (let i = 0; i < 12; i++) {
    await shot(p, `${TAG}-arena-show-${String(i).padStart(2, "0")}${sfx}`);
    results.strip.push({ i, t: Date.now() });
    await sleep(750);
  }
  await p.close();
}

if (what === "all" || what === "transition") {
  // dusk switch-on: 17:40 -> 18:40 in 1-minute steps (instant pins), the photocells' staggered wave, and the program
  // count before / after (no shader compiled during the transition)
  const p = await signedInPage();
  await toWorld(p);
  await closeCards(p);
  await place(p, VIEWS.find((v) => v.name === "plaza") ?? { x: 0, z: 30, yaw: 0, pitch: 0.2, distance: 9 });
  await setTime(p, 17 * 60 + 30, true);
  // wait until the program count has settled (deferred content finishing its first compiles): ≥ 8 s unchanged
  let before = await p.evaluate(() => window.__gkProbe?.programs);
  for (let still = 0, t0 = Date.now(); still < 8 && Date.now() - t0 < 90000; ) {
    await sleep(1000);
    const n = await p.evaluate(() => window.__gkProbe?.programs);
    still = n === before ? still + 1 : 0;
    before = n;
  }
  for (let m = 17 * 60 + 40, i = 0; m <= 18 * 60 + 40; m += 6, i++) {
    await setTime(p, m, true);
    await sleep(500);
    const st = await p.evaluate(() => ({ ...window.__gkTod?.state(), programs: window.__gkProbe?.programs }));
    results.transition.push(st);
    await shot(p, `${TAG}-dusk-${String(i).padStart(2, "0")}${sfx}`);
  }
  // a preset run (animated), Midday -> Night
  await p.evaluate(() => window.__gkTod?.preset("midday", true));
  await sleep(2000);
  await p.evaluate(() => window.__gkTod?.preset("night", false));
  await sleep(5000);
  const after = await p.evaluate(() => window.__gkProbe?.programs);
  results.notes.push(`programs before dusk ${before}, after the dusk walk and a Midday -> Night preset ${after}`);
  console.log("programs", before, "->", after);
  await p.close();
}

if (what === "all" || what === "phone") {
  const p = await signedInPage({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await toWorld(p);
  await closeCards(p);
  await setTime(p, 21 * 60, true);
  for (const v of VIEWS.filter((v) => ["plaza", "agaseke", "arena"].includes(v.name))) {
    await place(p, v);
    await sleep(2500);
    await place(p, v);
    await sleep(600);
    const m = await calls(p);
    await shot(p, `${TAG}-phone-${v.name}-night${sfx}`);
    results.views.push({ view: `phone-${v.name}`, phase: "night", ...m });
  }
  await p.close();
}

writeFileSync(join(OUT, `results-${TAG}${sfx}.json`), JSON.stringify(results, null, 2));
console.log("notes", results.notes);
await b.close();
