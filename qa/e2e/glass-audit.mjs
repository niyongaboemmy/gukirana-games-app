// P2-WLD-18 glass audit: for every glazed hall, what its glass shows from the plaza vs. the real room behind it at
// that spot, and the view out of the hall vs. the plaza at its door; plus draw calls (ground / aerial) and the GPU
// memory of the glass captures (window.__gkGlass).
//   BASE=http://localhost:3920 OUT=/tmp/glass node glass-audit.mjs [desktop|phone] [pool ludo …]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE ?? "http://localhost:3920";
const OUT = process.env.OUT ?? "/tmp/gk-glass";
const vp = process.argv[2] === "phone" ? { width: 844, height: 390, deviceScaleFactor: 2 } : { width: 1280, height: 720 };
const tag = process.argv[2] === "phone" ? "phone" : "desktop";
const only = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });

// world/layout.ts + world/glass-capture.ts (door angle, ring, glass line zf in the door frame, a pane centre x, room size)
const R0 = 38.5;
const B = {
  pool: { deg: -44, ring: R0, zf: -0.535, x: 4.6, y: 2.2, d: 28 },
  ludo: { deg: 44, ring: R0, zf: -0.335, x: -4.6, y: 2.0, d: 26 },
  igisoro: { deg: -88, ring: R0, zf: -2.11, x: -5.2, y: 1.7, d: 26 },
  arena: { deg: 0, ring: R0, zf: -1.225, x: 4.2, y: 2.4, d: 68.8 },
  admin: { deg: 62, ring: 108, zf: -1.535, x: -4.4, y: 2.0, d: 28 },
  fight: { deg: 88, ring: R0, zf: -0.36, x: 5.8, y: 2.0, d: 14 },
};
const frameOf = (b) => {
  const a = (b.deg * Math.PI) / 180;
  return { x: b.ring * Math.sin(a), z: -b.ring * Math.cos(a), rotY: -a };
};
/** door frame (local) → world */
const L2W = (b, [lx, ly, lz]) => {
  const f = frameOf(b);
  const c = Math.cos(f.rotY);
  const s = Math.sin(f.rotY);
  return [f.x + c * lx + s * lz, ly, f.z - s * lx + c * lz];
};
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport(vp);
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
await page.goto(BASE + "/gate", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  const phone = "0788" + String(Date.now() % 1000000).padStart(6, "0");
  const r = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone }) }).then((r) => r.json());
  const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone, code: r.devCode }) }).then((r) => r.json());
  await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "gl" + (Date.now() % 100000) }) });
});
await page.goto(BASE + "/world", { waitUntil: "domcontentloaded" });
const waitFor = async (fn, ms, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
await waitFor(() => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza", 120000);
await sleep(6000);
// the 3D view only (no HUD, guide cards or prompts over it)
await page.addStyleTag({ content: "body * { visibility: hidden !important } canvas { visibility: visible !important }" });
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}-${tag}.jpg`), type: "jpeg", quality: 72 });
const calls = () =>
  page.evaluate(async () => {
    const c = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      await new Promise((r) => requestAnimationFrame(r));
      c.push(window.__gkProbe.calls);
    }
    c.sort((a, b) => a - b);
    return c[c.length >> 1];
  });
const report = { base: BASE, vp: tag, perf: {}, glass: null, halls: {} };
const has = await page.evaluate(() => !!window.__gkGlass);

// draw calls: ground (the spawn view) and aerial, before any capture has been asked for nearby
report.perf.ground = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 640 }));
await sleep(3500);
report.perf.aerial = await calls();
await shot("aerial");
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 7, pitch: 0.3 }));
await sleep(2500);

const halls = only.length ? only : Object.keys(B);
for (const g of halls) {
  const b = B[g];
  // walk to 9 m in front of the door (admin: over the campus walks), so the hall is captured (or warmed) like a visitor
  const stand = L2W(b, [0, 0, 9]);
  // (placed there: a long walk can cut through another hall's door)
  await waitFor(() => !!window.__gkPlayer && window.__gkProbe.view === "plaza", 120000);
  await page.evaluate(([x, z]) => {
    window.__gkNav.goal = null;
    window.__gkNav.target = null;
    Object.assign(window.__gkPlayer.pos, { x, z });
  }, [stand[0], stand[2]]);
  await waitFor(([x, z]) => Math.hypot(window.__gkProbe.self.x - x, window.__gkProbe.self.z - z) < 1.5 && window.__gkProbe.view === "plaza", 30000, [stand[0], stand[2]]);
  if (has) await waitFor((h) => window.__gkGlass.reflections.includes(h), 60000, g);
  await sleep(has ? 2500 : 8000);
  const T = [b.x, b.y, b.zf];
  const views = {
    // oblique, standing on the forecourt, looking at a vision pane
    oblique: { p: [b.x * 1.9, 1.65, 7], l: T },
    // head-on, close
    front: { p: [b.x, 1.65, 3.6], l: [b.x, 1.75, b.zf] },
    // the entrance from the forecourt, a little off axis: the open door and what shows through it
    entrance: { p: [-3.2, 1.65, 9], l: [0, 2.0, b.zf - 2] },
  };
  report.halls[g] = {};
  for (const [name, v] of Object.entries(views)) {
    if (name === "entrance") {
      // step up to the door so it opens (the sensor), a little to the side of the line of sight
      const at = L2W(b, [1.6, 0, 2.2]);
      await page.evaluate(([x, z]) => Object.assign(window.__gkPlayer.pos, { x, z }), [at[0], at[2]]);
      await sleep(2500);
    }
    const p = L2W(b, v.p);
    const l = L2W(b, v.l);
    await page.evaluate((p, l) => (window.__gkPlazaCam = { p, l }), p, l);
    await sleep(1200);
    await shot(`${g}-out-${name}`);
    // the same line of sight from just inside the room's south wall (room = local + (0, 0, d/2 − zf))
    const dir = norm([v.l[0] - v.p[0], v.l[1] - v.p[1], v.l[2] - v.p[2]]);
    const tr = [v.l[0], v.l[1], b.d / 2];
    report.halls[g][name] = { cam: v, room: { p: tr.map((x, i) => x + dir[i] * 0.35), l: tr.map((x, i) => x + dir[i] * 6) } };
  }
  // the plaza seen from right outside the door (pairs with the hall's view out of its door)
  await page.evaluate((p, l) => (window.__gkPlazaCam = { p, l }), L2W(b, [0, 1.6, 1.2]), L2W(b, [0, 1.4, 20]));
  await sleep(1200);
  await shot(`${g}-plaza-from-door`);
  await page.evaluate(() => (window.__gkPlazaCam = null));
}
report.glass = has ? await page.evaluate(() => ({ ...window.__gkGlass, textures: window.__gkProbe.textures })) : null;
// back at the spawn: draw calls with every capture in place
await waitFor(() => !!window.__gkPlayer, 120000);
await page.evaluate(() => {
  window.__gkNav.goal = null;
  window.__gkNav.target = null;
  Object.assign(window.__gkPlayer.pos, { x: 0, z: 30 });
});
await waitFor(() => Math.hypot(window.__gkProbe.self.x, window.__gkProbe.self.z - 30) < 1.2, 90000);
await sleep(2500);
report.perf.groundAfter = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 640 }));
await sleep(3500);
report.perf.aerialAfter = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 7, pitch: 0.3 }));

// inside each hall: the same lines of sight from just inside the glass, and the view out of the door / windows
for (const g of halls) {
  const b = B[g];
  await page.evaluate((w) => window.__gkStage.getState().show(w), `hall:${g}`);
  await waitFor((h) => window.__gkProbe.ready && window.__gkProbe.view === `hall:${h}`, 60000, g);
  await sleep(4000);
  for (const name of ["oblique", "front"]) {
    const r = report.halls[g][name].room;
    await page.evaluate((p, l) => window.__gkRoomQA && (window.__gkRoomQA.cam = { p, l }), r.p, r.l);
    await sleep(1200);
    await shot(`${g}-in-${name}`);
  }
  await page.evaluate((d) => window.__gkRoomQA && (window.__gkRoomQA.cam = { p: [0, 1.6, d / 2 - 3.2], l: [0, 1.4, d / 2 + 10] }), b.d);
  await sleep(1200);
  await shot(`${g}-in-door-out`);
  // the entrance wall from inside (its glazing, the plaza beyond)
  await page.evaluate((d) => window.__gkRoomQA && (window.__gkRoomQA.cam = { p: [-3, 1.7, d / 2 - 9], l: [3, 1.8, d / 2] }), b.d);
  await sleep(1200);
  await shot(`${g}-in-south-wall`);
  await page.evaluate((d) => window.__gkRoomQA && (window.__gkRoomQA.cam = { p: [0, 1.7, 0], l: [0, 1.6, -d] }), b.d);
  await sleep(1200);
  await shot(`${g}-in-windows-out`);
  await page.evaluate(() => window.__gkRoomQA && (window.__gkRoomQA.cam = null));
  await page.evaluate(() => window.__gkStage.getState().show("plaza"));
  await waitFor(() => window.__gkProbe.ready && window.__gkProbe.view === "plaza", 60000);
  await sleep(1500);
}
report.errors = errors.slice(0, 20);
fs.writeFileSync(path.join(OUT, `report-${tag}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ perf: report.perf, glass: report.glass, errors: report.errors }, null, 1));
await browser.close();
