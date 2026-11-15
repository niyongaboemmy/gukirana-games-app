// P2-WLD-20 door audit: every hall door from the plaza (front closed, oblique, the user's close angle, approaching /
// opening / open, looking into the lobby) and from inside the hall looking back at the entrance; plus draw calls
// (ground / aerial) and the GPU memory of the glass captures (window.__gkGlass).
//   BASE=http://localhost:3970 OUT=/tmp/doors node door-audit.mjs [desktop|phone] [pool ludo …]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE ?? "http://localhost:3970";
const OUT = process.env.OUT ?? "/tmp/gk-doors";
const vp = process.argv[2] === "phone" ? { width: 844, height: 390, deviceScaleFactor: 2 } : { width: 1280, height: 720 };
const tag = process.argv[2] === "phone" ? "phone" : "desktop";
const only = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });

// world/layout.ts: door bearing, ring, door line (doorInset), room depth (rooms/layouts HALLS)
const R0 = 38.5;
const B = {
  pool: { deg: -44, ring: R0, inset: -0.55, d: 28 },
  ludo: { deg: 44, ring: R0, inset: -0.4, d: 26 },
  igisoro: { deg: -88, ring: R0, inset: -2.15, d: 26 },
  arena: { deg: 0, ring: R0, inset: -1.15, d: 68.8 },
  admin: { deg: 62, ring: 108, inset: -1.6, d: 28 },
  fight: { deg: 88, ring: R0, inset: -0.8, d: 14 },
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
  await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "dr" + (Date.now() % 100000) }) });
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
if (!(await waitFor(() => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza" && !!window.__gkPlayer, 240000))) { await page.screenshot({ path: path.join(OUT, `boot-fail-${tag}.jpg`) }); throw new Error("world did not boot"); }
await sleep(6000);
// the 3D view only (no HUD, guide cards or prompts over it)
await page.addStyleTag({ content: "body * { visibility: hidden !important } canvas { visibility: visible !important }" });
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}-${tag}.jpg`), type: "jpeg", quality: 78 });
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
const report = { base: BASE, vp: tag, perf: {}, glass: null };
report.perf.ground = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 640 }));
await sleep(3500);
report.perf.aerial = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 7, pitch: 0.3 }));
await sleep(2500);

const place = async (b, l) => {
  const w = L2W(b, l);
  await waitFor(() => !!window.__gkPlayer && window.__gkProbe.view === "plaza", 120000);
  await page.evaluate(([x, z]) => {
    window.__gkNav.goal = null;
    window.__gkNav.target = null;
    Object.assign(window.__gkPlayer.pos, { x, z });
  }, [w[0], w[2]]);
};
const cam = (b, p, l) => page.evaluate((p, l) => (window.__gkPlazaCam = { p, l }), L2W(b, p), L2W(b, l));

const halls = only.length ? only : Object.keys(B);
for (const g of halls) {
  const b = B[g];
  const i = b.inset;
  // away from the door (closed): 13 m out on the door axis, off to the side so the person is not in the shot
  await place(b, [5, 0, 13]);
  await sleep(4500);
  await cam(b, [0, 1.65, 6.5], [0, 1.9, i]);
  await sleep(1200);
  await shot(`${g}-front`);
  await cam(b, [4.6, 1.65, 5.2], [0, 1.9, i - 1]);
  await sleep(900);
  await shot(`${g}-oblique`);
  // close, a little off axis, at eye height (the angle of the user's arena screenshot)
  await cam(b, [-1.3, 1.6, 3.4], [0.2, 2.0, i]);
  await sleep(900);
  await shot(`${g}-close`);
  // approaching: walk up to the sensor, the doors slide open
  await cam(b, [-2.4, 1.7, 7.5], [0, 1.8, i - 2.5]);
  await place(b, [0.9, 0, 3.4]);
  await sleep(450);
  await shot(`${g}-opening`);
  await sleep(2400);
  await shot(`${g}-open`);
  // into the open doorway (the lobby behind it), from the doorstep
  await cam(b, [0.4, 1.65, 2.6], [0, 1.6, i - 4]);
  await sleep(900);
  await shot(`${g}-lobby`);
  await page.evaluate(() => (window.__gkPlazaCam = null));
}
report.glass = await page.evaluate(() => (window.__gkGlass ? { ...window.__gkGlass, targets: undefined, textures: window.__gkProbe.textures } : null));
await place(B.pool, [0, 0, 30]);
await page.evaluate(() => Object.assign(window.__gkPlayer.pos, { x: 0, z: 30 }));
await sleep(4000);
report.perf.groundAfter = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 640 }));
await sleep(3500);
report.perf.aerialAfter = await calls();
await page.evaluate(() => Object.assign(window.__gkCam, { distance: 7, pitch: 0.3 }));

// inside each hall: the entrance seen from the room (door leaves, the entrance glazing, the plaza beyond)
for (const g of halls) {
  const b = B[g];
  await page.evaluate((w) => window.__gkStage.getState().show(w), `hall:${g}`);
  await waitFor((h) => window.__gkProbe.ready && window.__gkProbe.view === `hall:${h}`, 60000, g);
  await sleep(4000);
  await page.evaluate((d) => window.__gkRoomQA && (window.__gkRoomQA.cam = { p: [0, 1.6, d / 2 - 6], l: [0, 1.7, d / 2] }), b.d);
  await sleep(1200);
  await shot(`${g}-in-back`);
  await page.evaluate((d) => window.__gkRoomQA && (window.__gkRoomQA.cam = { p: [-3.4, 1.7, d / 2 - 4.5], l: [0.6, 1.7, d / 2] }), b.d);
  await sleep(1200);
  await shot(`${g}-in-oblique`);
  await page.evaluate(() => window.__gkRoomQA && (window.__gkRoomQA.cam = null));
  await page.evaluate(() => window.__gkStage.getState().show("plaza"));
  await waitFor(() => window.__gkProbe.ready && window.__gkProbe.view === "plaza", 60000);
  await sleep(1500);
}
report.errors = errors.slice(0, 20);
fs.writeFileSync(path.join(OUT, `report-${tag}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ perf: report.perf, glass: report.glass, errors: report.errors }, null, 1));
await browser.close();
