// P2-WLD-22 compound realism audit: fixed camera poses over the whole campus (eye level + overviews) and every
// in-scope interior, at four Kigali clock times, desktop 1280×720 and phone 844×390 (DPR 2), with per-pose draw calls,
// triangles, fps and the uploaded texture megabytes.
//   BASE=http://localhost:3610 node qa/e2e/compound-realism.mjs <tag> [desktop|phone|both] [times=08:00,13:00,18:30,21:30] [areas=campus,ludo,igisoro,pool,fight] [--poses=a,b]
// Times are pinned with window.__gkTod (dev only), the plaza camera with window.__gkPlazaCam, the hall camera with
// window.__gkRoomQA.cam. Output → $QA_EVIDENCE (default $TMPDIR/gk-qa/realism/<tag>): <vp>-<time>-<pose>.jpg + perf.json.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = process.env.BASE ?? "http://localhost:3610";
const tag = process.argv[2] ?? "before";
const vpArg = process.argv[3] ?? "both";
const times = (process.argv[4] ?? "08:00,13:00,18:30,21:30").split(",");
const areas = (process.argv[5] ?? "campus,ludo,igisoro,pool,fight").split(",");
const only = process.argv
  .find((a) => a.startsWith("--poses="))
  ?.slice(8)
  .split(",");
const OUT = process.env.QA_EVIDENCE ?? join(tmpdir(), "gk-qa", "realism", tag);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (d) => (d * Math.PI) / 180;
const ring = (deg, r, y = 1.65) => [r * Math.sin(rad(deg)), y, -r * Math.cos(rad(deg))];

/** campus poses: [name, camera, look-at] (north = −z; halls on the door ring r 38.5 at their bearings) */
const CAMPUS = [
  ["spawn-north", [0, 1.65, 31], [0, 2.4, 0]],
  ["fountain", [4.5, 1.6, 8.5], [0, 1.2, 0]],
  ["court-east", [-9, 1.65, 4], [25, 3, -12]],
  ["court-west", [9, 1.65, 4], [-25, 3, -12]],
  ["ludo", ring(44, 24), ring(44, 40, 3.5)],
  ["pool", ring(-44, 24), ring(-44, 40, 3.5)],
  ["igisoro", ring(-88, 24), ring(-88, 40, 3)],
  ["arena", ring(0, 20), ring(0, 45, 6)],
  ["fight", ring(88, 24), ring(88, 40, 3.5)],
  ["plaza-edge", ring(-150, 33), ring(-60, 30, 2)],
  ["entry-gate", [3, 1.65, 50], [0, 3, 38]],
  ["forecourt", [8, 1.65, 76], [0, 3, 58]],
  ["public-road", [30, 1.65, 91], [-10, 2, 82]],
  ["parking", [40, 1.65, 72], [70, 1, 70]],
  ["district-walk", ring(-65, 50), ring(-72, 82, 2)],
  ["promenade-w", ring(-82, 102.5), ring(-45, 102.5, 2)],
  ["volcano-view", ring(8, 118, 1.7), ring(0, 700, 70)],
  ["aerial-plaza", [55, 45, 70], [0, 0, 0]],
  ["aerial-campus", [140, 120, 210], [0, 0, 0]],
];
/** interior poses relative to the hall's size (door on the +z wall) */
const ROOM = (s) => [
  ["door", [0, 1.65, s.d / 2 - 1.2], [0, 1.2, -s.d / 2]],
  ["corner", [s.w / 2 - 1, 2.0, s.d / 2 - 1], [-s.w / 4, 0.9, -s.d / 4]],
  ["far", [-s.w / 2 + 1, 2.1, -s.d / 2 + 1], [s.w / 4, 0.9, s.d / 4]],
  ["high", [0, s.h - 0.4, s.d / 2 - 0.8], [0, 0.4, -s.d / 6]],
  ["low", [s.w / 4, 1.2, 0], [-s.w / 4, 0.8, -s.d / 3]],
];

const VPS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};
const vps = vpArg === "both" ? ["desktop", "phone"] : [vpArg];
const mins = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio"],
  protocolTimeout: 600000,
});
const perf = { at: new Date().toISOString(), tag, poses: [], notes: [] };

async function signedInPage(viewport, todMin) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport(viewport);
  p.on("pageerror", (e) => perf.notes.push(`pageerror: ${String(e).slice(0, 200)}`));
  // texture bytes uploaded (mip 0 of 2D uploads; ×1.33 for mips) — a GPU memory estimate
  await p.evaluateOnNewDocument((m) => {
    try {
      localStorage.setItem("gk.timeOfDay", JSON.stringify({ mode: "custom", minutes: m }));
    } catch {}
    // the first-visit Go To guide (route chevrons + beacon) would sit in every shot: seen already
    const gi = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      return typeof k === "string" && k.startsWith("gk-goto-seen:") ? "1" : gi.call(this, k);
    };
    const st = { bytes: 0 };
    window.__qaTex = st;
    const C = window.WebGL2RenderingContext;
    if (!C) return;
    const ti = C.prototype.texImage2D;
    C.prototype.texImage2D = function (...a) {
      if (a[1] === 0) {
        const src = a[a.length - 1];
        const w = a.length >= 9 ? a[3] : (src?.width ?? 0);
        const h = a.length >= 9 ? a[4] : (src?.height ?? 0);
        st.bytes += w * h * 4 * 1.33;
      }
      return ti.apply(this, a);
    };
    const ts = C.prototype.texStorage2D;
    C.prototype.texStorage2D = function (t, l, f, w, h) {
      st.bytes += w * h * 4 * (l > 1 ? 1.33 : 1);
      return ts.call(this, t, l, f, w, h);
    };
  }, todMin);
  await p.goto(`${BASE}/gate`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await p.evaluate(async () => {
    const phone = "0788" + String(Date.now() % 1000000).padStart(6, "0");
    const r = await fetch("/api/v1/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: phone }),
    }).then((r) => r.json());
    const v = await fetch("/api/v1/auth/otp/verify", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: phone, code: r.devCode }),
    }).then((r) => r.json());
    await fetch("/api/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` },
      body: JSON.stringify({ username: "cr" + (Date.now() % 100000) }),
    });
  });
  return p;
}

async function toView(p, path, want) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      const ok = await p
        .evaluate((w) => window.__gkProbe?.ready && window.__gkProbe?.view === w, want)
        .catch(() => false);
      if (ok) {
        await sleep(7000);
        return true;
      }
      await sleep(1000);
    }
    perf.notes.push(
      `${path}: view ${await p.evaluate(() => window.__gkProbe?.view).catch(() => "?")} (attempt ${attempt + 1})`,
    );
  }
  return false;
}

const sample = (p, ms = 1500) =>
  p.evaluate(async (ms) => {
    const c = [];
    const t = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => requestAnimationFrame(r));
      if (window.__gkProbe?.calls) {
        c.push(window.__gkProbe.calls);
        t.push(window.__gkProbe.tris);
      }
    }
    const med = (a) => (a.sort((x, y) => x - y), a[Math.floor(a.length / 2)] ?? null);
    return {
      calls: med(c),
      tris: med(t),
      fps: Math.round((c.length * 1000) / ms),
      texMB: Math.round((window.__qaTex?.bytes ?? 0) / 1e5) / 10,
      tier: window.__gkStage?.getState().tier,
      fx: window.__gkStage?.getState().fx,
    };
  }, ms);

const closeCards = (p) =>
  p.evaluate(() => {
    for (const b of document.querySelectorAll(".pcard .pcard-hbtn[aria-label]"))
      if (/close|dismiss|not now/i.test(b.getAttribute("aria-label"))) b.click();
    for (const b of document.querySelectorAll("button"))
      if (/^\s*not now\s*$/i.test(b.textContent ?? "")) b.click();
  });
/** world only (the HUD hidden) for the realism sheets; `hud` keeps one HUD shot per viewport */
const hud = (p, on) =>
  p.evaluate((on) => {
    let s = document.getElementById("qa-nohud");
    if (!s) {
      s = document.createElement("style");
      s.id = "qa-nohud";
      document.head.appendChild(s);
    }
    s.textContent = on
      ? ""
      : "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";
  }, on);

for (const vp of vps) {
  for (const t of times) {
    const m = mins(t);
    const tt = t.replace(":", "");
    for (const area of areas) {
      const p = await signedInPage(VPS[vp], m);
      if (area === "campus") {
        if (!(await toView(p, "/world", "plaza"))) {
          await p.close();
          continue;
        }
        await p.evaluate((m) => window.__gkTod?.pin(m, true), m);
        await sleep(3000);
        await closeCards(p);
        await sleep(500);
        await hud(p, false);
        for (const [name, cam, look] of CAMPUS) {
          if (only && !only.includes(name)) continue;
          // the person stands just behind the camera (out of frame): near-only detail and LODs follow the view
          await p.evaluate(
            (cam, look) => {
              const dx = cam[0] - look[0];
              const dz = cam[2] - look[2];
              const l = Math.hypot(dx, dz) || 1;
              const pl = window.__gkPlayer;
              if (pl && cam[1] < 5) pl.pos.set(cam[0] + (dx / l) * 1.2, 0, cam[2] + (dz / l) * 1.2);
              window.__gkPlazaCam = { p: cam, l: look };
            },
            cam,
            look,
          );
          await sleep(name.startsWith("aerial") ? 4000 : 2600);
          const s = await sample(p);
          await p.screenshot({ path: join(OUT, `${vp}-${tt}-${name}.jpg`), type: "jpeg", quality: 72 });
          perf.poses.push({ vp, time: t, area, pose: name, ...s });
          console.log(vp, t, name, JSON.stringify(s));
        }
      } else {
        if (!(await toView(p, `/room/${area}`, `hall:${area}`))) {
          await p.close();
          continue;
        }
        await hud(p, false);
        const size = await p.evaluate(() => window.__gkRoomQA?.layout?.size);
        if (!size) {
          perf.notes.push(`${area}: no layout`);
          await p.close();
          continue;
        }
        for (const [name, cam, look] of ROOM(size)) {
          if (only && !only.includes(name)) continue;
          await p.evaluate((cam, look) => (window.__gkRoomQA.cam = { p: cam, l: look }), cam, look);
          await sleep(2000);
          const s = await sample(p);
          await p.screenshot({
            path: join(OUT, `${vp}-${tt}-${area}-${name}.jpg`),
            type: "jpeg",
            quality: 72,
          });
          perf.poses.push({ vp, time: t, area, pose: name, ...s });
          console.log(vp, t, area, name, JSON.stringify(s));
        }
      }
      await p.browserContext().close();
    }
  }
}
writeFileSync(join(OUT, "perf.json"), JSON.stringify(perf, null, 1));
console.log("notes", JSON.stringify(perf.notes.slice(0, 10)));
await b.close();
