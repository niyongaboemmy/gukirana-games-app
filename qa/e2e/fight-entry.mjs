// P3-FGT-25 Boxing entry smoothness: frame gaps, long tasks and what covers the world during each way into the fight
// game. One signed-in player, real Chrome (puppeteer-core), desktop or phone (landscape, touch, `?tier=lite`, CPU
// throttled 4x). Per transition it reports the longest rAF gap, the long-task total, and how long the world was hidden
// (boot screen / held frozen frame / area on screen not drawn yet) or the person stood still while a hint showed.
//
//   QA_WEB=http://localhost:3210 QA_API=http://127.0.0.1:4200 VIEW=desktop|phone FLOW=quick|walk OUT=/tmp/fe \
//     node qa/e2e/fight-entry.mjs
//
// FLOW=quick: campus → Quick Play → Boxing → Practice vs AI (the trip into the Boxing hall), the walk to the ring, then
//             the ring entry (the practice fight starts).
// FLOW=walk:  campus → walk through the Fight Games door (lobby) → walk through the lobby's Boxing doorway (hall).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3210";
const VIEW = process.env.VIEW ?? "desktop";
const FLOW = process.env.FLOW ?? "quick";
const OUT = process.env.OUT ?? "/tmp/gk-fight-entry";
const THROTTLE = Number(process.env.THROTTLE ?? (VIEW === "phone" ? 4 : 1));
const SHOTS = process.env.SHOTS !== "0";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = VIEW === "phone";
const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};

/** recorder installed before any page script: long tasks, every rAF delta, and state changes sampled per frame */
const RECORDER = `(() => {
  const qa = (window.__qaRec = { lt: [], fr: [], st: [], last: "" });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) qa.lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  } catch {}
  let last = performance.now();
  let px = NaN, pz = NaN, pf = -1;
  const tick = (t) => {
    qa.fr.push([t, t - last]);
    last = t;
    const p = window.__gkProbe;
    const boot = document.querySelector(".gk-boot");
    const bootOn = !!boot && getComputedStyle(boot).opacity > 0.05;
    const door = window.__gkDoorway?.getState().phase ?? "idle";
    const hint = !!document.querySelector("[data-gk-entry-hint]");
    const view = p?.view ?? null;
    const ready = !!p?.ready;
    // the person moved since the last frame (walk), and the stage drew a frame
    const moved = p ? Math.hypot((p.self?.x ?? 0) - px, (p.self?.z ?? 0) - pz) > 1e-4 : false;
    const drew = p ? p.frames !== pf : false;
    if (p) { px = p.self?.x; pz = p.self?.z; pf = p.frames; }
    const key = [view, ready ? 1 : 0, bootOn ? 1 : 0, door, hint ? 1 : 0, location.pathname].join("|");
    qa.st.push([t, view, ready, bootOn, door, hint, moved, drew, location.pathname]);
    if (qa.st.length > 40000) qa.st.splice(0, 20000);
    if (qa.fr.length > 40000) qa.fr.splice(0, 20000);
    qa.last = key;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const browser = await puppeteer.launch({
  executablePath: process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio"],
  protocolTimeout: 600_000,
});
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport(VIEWPORTS[VIEW]);
await page.evaluateOnNewDocument(RECORDER);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message ?? e).slice(0, 300)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
const cdp = await page.createCDPSession();

await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded", timeout: 300_000 });
await page.evaluate(async () => {
  const id = `0789${String(Date.now() % 1000000).padStart(6, "0")}`;
  const j = (path, init) => fetch(`/api/v1${path}`, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }).then((x) => x.json());
  const r = await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ identifier: id }) });
  const v = await j("/auth/otp/verify", { method: "POST", body: JSON.stringify({ identifier: id, code: r.devCode }) });
  await j("/me", { method: "PATCH", headers: { authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: `fe${Date.now() % 100000}` }) });
});
await page.goto(`${WEB}/world${phone ? "?tier=lite" : ""}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.getClientRects().length && (/^Quick Play$/.test(b.innerText.trim()) || b.getAttribute("aria-label") === "More actions")), { timeout: 240_000, polling: 500 }).catch(async (e) => {
  // the campus never came up: say where the page is stuck
  await page.screenshot({ path: join(OUT, `${VIEW}-${FLOW}-no-campus.jpg`), type: "jpeg", quality: 50 }).catch(() => undefined);
  console.log("campus did not load:", page.url(), (await page.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 300).replace(/\n/g, " | "));
  throw e;
});
// the campus settles (deferred assets stream after the reveal); then the throttle (a phone's CPU) comes on
await sleep(9000);
if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

async function tap(re, { timeout = 10_000, within } = {}) {
  const t1 = Date.now();
  while (Date.now() - t1 < timeout) {
    const box = await page.evaluate(
      (src, flags, within) => {
        const rx = new RegExp(src, flags);
        const root = within ? document.querySelector(within) : document;
        if (!root) return null;
        const el = [...root.querySelectorAll("button,[role=button],a,[role=radio],[role=menuitem],label")].find((b) => b.getClientRects().length && !b.disabled && (rx.test((b.innerText || "").trim().replace(/\s+/g, " ")) || rx.test((b.getAttribute("aria-label") || "").trim())));
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      re.source,
      re.flags,
      within ?? null,
    );
    if (box) {
      if (phone) await page.touchscreen.tap(box.x, box.y);
      else await page.mouse.click(box.x, box.y);
      return true;
    }
    await sleep(200);
  }
  return false;
}
const text = () => page.evaluate(() => document.body.innerText);
async function until(fn, timeout = 60_000, ...args) {
  const t1 = Date.now();
  while (Date.now() - t1 < timeout) {
    if (await page.evaluate(fn, ...args).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
}
const now = () => page.evaluate(() => performance.now());
const shots = [];
async function shot(name) {
  if (!SHOTS) return;
  const file = join(OUT, `${VIEW}-${FLOW}-${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: phone ? 50 : 60 });
  shots.push(file);
}
/** screenshots at fixed delays during a transition (run alongside it) */
function shotsDuring(name, delays) {
  let stop = false;
  const p = (async () => {
    const t0 = Date.now();
    for (const [i, d] of delays.entries()) {
      while (!stop && Date.now() - t0 < d) await sleep(30);
      if (stop) return;
      await shot(`${name}-${i + 1}`).catch(() => undefined);
    }
  })();
  return () => ((stop = true), p);
}

/** summary of the recorder between two page timestamps */
/** PROFILE=1: sample the main thread during a transition; prints the top functions by self time (where a stall goes) */
const PROFILE = process.env.PROFILE === "1";
async function profStart() {
  if (!PROFILE) return;
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  // the shader programs that exist now (a program created later was compiled on screen, outside the warm-up)
  await page.evaluate(() => (window.__qaProgs = new Set((window.__gkProbe?.list ?? []).map((p) => p.id))));
}
async function profStop(name) {
  if (!PROFILE) return;
  const fresh = await page.evaluate(() => (window.__gkProbe?.list ?? []).filter((p) => !window.__qaProgs.has(p.id)).map((p) => `${p.name}:${p.cacheKey.slice(0, 60).replace(/,/g, " ")}`));
  console.log(`programs created during ${name}: ${fresh.length}\n  ${fresh.slice(0, 30).join("\n  ")}`);
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    if (f.functionName === "(idle)" || f.functionName === "(program)") return;
    const k = `${f.functionName || "(anon)"} ${f.url.split("/").pop()?.split("?")[0]}:${f.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`profile ${name}:\n  ${top.map(([k, v]) => `${v.toFixed(0)}ms ${k}`).join("\n  ")}`);
  writeFileSync(join(OUT, `${VIEW}-${FLOW}-${name.replace(/\W+/g, "_")}.cpuprofile`), JSON.stringify(profile));
}

async function summary(name, t0, t1) {
  const r = await page.evaluate(
    (t0, t1) => {
      const q = window.__qaRec;
      const fr = q.fr.filter(([t]) => t >= t0 && t <= t1);
      const lt = q.lt.filter(([s, d]) => s + d >= t0 && s <= t1);
      const st = q.st.filter(([t]) => t >= t0 && t <= t1);
      const gaps = fr.map(([, d]) => d);
      let boot = 0, frozen = 0, blank = 0, hint = 0, still = 0;
      for (let i = 1; i < st.length; i++) {
        const dt = st[i][0] - st[i - 1][0];
        const [, view, ready, bootOn, door, h] = st[i - 1];
        if (bootOn) boot += dt;
        if (door === "closed" || door === "closing") frozen += door === "closed" ? dt : 0;
        if (view && !ready && !bootOn && door !== "closed") blank += dt;
        if (h) hint += dt;
      }
      // longest stretch with no stage frame drawn
      let since = st[0]?.[0] ?? t0;
      for (const s of st) {
        if (s[7]) since = s[0];
        else still = Math.max(still, s[0] - since);
      }
      // what was on screen, as it changed (ms from the start: view, ready, boot screen, doorway, hint, route)
      const timeline = [];
      let prev = "";
      for (const s of st) {
        const k = `${s[1]} ready=${s[2] ? 1 : 0}${s[3] ? " BOOT" : ""}${s[4] !== "idle" ? ` door=${s[4]}` : ""}${s[5] ? " hint" : ""} ${s[8]}`;
        if (k !== prev) timeline.push(`${Math.round(s[0] - t0)}ms ${k}`);
        prev = k;
      }
      const worst = fr.filter(([, d]) => d > 100).map(([t, d]) => `${Math.round(t - t0)}ms:${Math.round(d)}`);
      return {
        timeline: timeline.slice(0, 30),
        worstFrames: worst.slice(0, 12),
        ms: Math.round(t1 - t0),
        frames: fr.length,
        fps: Math.round((fr.length / Math.max(1, t1 - t0)) * 1000),
        maxGap: Math.round(Math.max(0, ...gaps)),
        over50: gaps.filter((d) => d > 50).length,
        over100: gaps.filter((d) => d > 100).length,
        longTaskTotal: Math.round(lt.reduce((a, [, d]) => a + d, 0)),
        longTaskMax: Math.round(Math.max(0, ...lt.map(([, d]) => d))),
        longTasks: lt.length,
        bootScreenMs: Math.round(boot),
        frozenFrameMs: Math.round(frozen),
        hiddenAreaMs: Math.round(blank),
        hintMs: Math.round(hint),
        noStageFrameMs: Math.round(still),
      };
    },
    t0,
    t1,
  );
  console.log(`${VIEW} ${name}: ${JSON.stringify(r)}`);
  return { name, ...r };
}
const results = [];

try {
  if (FLOW === "quick") {
    // 1. campus → the Boxing hall (Quick Play, practice)
    if (phone) {
      await tap(/^More actions/);
      await sleep(400);
    }
    if (!(await tap(/^Quick Play$/))) throw new Error("no Quick Play");
    await until(() => /How do you want to play/i.test(document.body.innerText), 8000);
    await tap(/^Boxing$/, { within: '[role="dialog"]' });
    await sleep(600);
    await tap(/^Ring 7 · free/, { within: '[role="dialog"]' });
    await tap(/Practice vs AI/, { within: '[role="dialog"]' });
    await sleep(300);
    await profStart();
    const t0 = await now();
    const stopShots = shotsDuring("1-to-hall", [250, 900, 1700, 2600]);
    if (!(await tap(/Go and practise/, { within: '[role="dialog"]' }))) throw new Error("no Go and practise");
    const inHall = await until(() => window.__gkProbe?.view === "hall:boxing" && window.__gkProbe.ready && !window.__gkDoorway?.getState().phase.startsWith("clos"), 120_000);
    await sleep(3000);
    await stopShots();
    results.push({ ...(await summary("campus → Boxing hall (Quick Play)", t0, await now())), ok: inHall });
    await profStop("to-hall");
    // 2. the walk to the ring (the trip walks you there)
    const t1 = await now();
    let prompt = await until(() => /Wait for an opponent/.test(document.body.innerText), 45_000);
    const walked = prompt;
    results.push({ ...(await summary("walk to ring 7", t1, await now())), ok: prompt });
    if (!prompt) {
      // the trip lost its walk (seen before P3-FGT-25 on the cold path): walk there with the ring board's own route so
      // the ring entry can still be measured
      console.log("the trip did not walk to the ring: walking with the ring route (dev hook)");
      await page.evaluate(() => window.__gkRingGoto?.walkToRing("R7"));
      prompt = await until(() => /Wait for an opponent/.test(document.body.innerText), 90_000);
    }
    results.at(-1).tripWalked = walked;
    await shot("2-ring-prompt");
    // 3. into the ring (practice fight)
    await profStart();
    const t2 = await now();
    const stopShots2 = shotsDuring("3-ring-entry", [300, 1200, 2400]);
    await tap(/^Practice vs AI$/);
    await sleep(500);
    await tap(/^Practice vs AI$/);
    const fight = await until(() => {
      // the house rules card (first boxing match of a new player): tick and accept
      const box = [...document.querySelectorAll('input[type="checkbox"]')].find((b) => b.closest("label")?.textContent?.toLowerCase().includes("accept"));
      if (box && !box.checked) box.click();
      const ok = [...document.querySelectorAll("button")].find((b) => /Accept and continue/.test(b.textContent ?? ""));
      if (ok && !ok.disabled) ok.click();
      return window.__gkFight?.bridge.getState().mine?.mode === "practice" && window.__gkFight.bridge.getState().mine.snap?.phase === "round";
    }, 90_000);
    await sleep(3000);
    await stopShots2();
    results.push({ ...(await summary("ring entry (practice vs AI)", t2, await now())), ok: fight });
    await profStop("ring-entry");
    await shot("4-fight");
  } else {
    // 1. campus → the Fight Games lobby (walk through its door, 88° on the plaza ring)
    const ring = (deg, r) => ({ x: r * Math.sin((deg * Math.PI) / 180), z: -r * Math.cos((deg * Math.PI) / 180) });
    const walk = (x, z) => page.evaluate((x, z) => { window.__gkNav.goal = null; window.__gkNav.target = { x, z }; }, x, z);
    const near = ring(88, 34.5);
    await walk(near.x, near.z);
    await until((x, z) => Math.hypot(window.__gkProbe.self.x - x, window.__gkProbe.self.z - z) < 0.8, 60_000, near.x, near.z);
    await sleep(1500);
    await profStart();
    const t0 = await now();
    const beyond = ring(88, 41.5);
    const stopShots = shotsDuring("1-to-lobby", [400, 1200, 2200]);
    await walk(beyond.x, beyond.z);
    const inLobby = await until(() => window.__gkProbe?.view === "hall:fight" && window.__gkProbe.ready && window.__gkDoorway?.getState().phase === "idle", 60_000);
    await sleep(2500);
    await stopShots();
    results.push({ ...(await summary("campus → Fight lobby (walk)", t0, await now())), ok: inLobby });
    await profStop("to-lobby");
    // 2. lobby → the Boxing hall through its doorway (x = -8.3, door line z = -3)
    await walk(-8.3, 1.5);
    await until(() => Math.hypot(window.__gkProbe.self.x + 8.3, window.__gkProbe.self.z - 1.5) < 0.8, 40_000);
    await sleep(1500);
    await profStart();
    const t1 = await now();
    const stopShots2 = shotsDuring("2-to-boxing", [400, 1200, 2200]);
    // (the ring board's own route: in front of the doorway, then deep into the passage; fight/ring-goto)
    await walk(-8.3, -1.4);
    await until(() => window.__gkProbe.self.z < -1.0 || window.__gkProbe.view === "hall:boxing", 20_000);
    await walk(-8.3, -6.4);
    const inHall = await until(() => window.__gkProbe?.view === "hall:boxing" && window.__gkProbe.ready && window.__gkDoorway?.getState().phase === "idle", 60_000);
    await sleep(2500);
    await stopShots2();
    results.push({ ...(await summary("Fight lobby → Boxing hall (walk)", t1, await now())), ok: inHall });
    await profStop("to-boxing");
  }
} catch (e) {
  console.log("run failed:", String(e?.stack ?? e).slice(0, 500));
  console.log((await text().catch(() => "")).slice(0, 500).replace(/\n/g, " | "));
  await shot("fail").catch(() => undefined);
} finally {
  if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
  writeFileSync(join(OUT, `${VIEW}-${FLOW}.json`), JSON.stringify({ web: WEB, view: VIEW, flow: FLOW, throttle: THROTTLE, results, errors: [...new Set(errors)].slice(0, 30), shots }, null, 1));
  console.log(`errors (${errors.length}): ${[...new Set(errors)].slice(0, 8).join("\n  ")}`);
  await browser.close();
}
