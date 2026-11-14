// QA performance probe (GAP-008): draw calls / triangles per frame at fixed camera poses, plaza + every hall.
//   node qa/e2e/perf.mjs [desktop|phone] [account key, default lv12] [areas, default plaza,pool,ludo,igisoro,arena,admin] [--breakdown]
// Numbers: renderer.info for the whole frame (shadow + post passes included: window.__gkProbe.calls / .tris), the
// median of ~2 s of frames at each pose, plus the WebGL draw calls counted by lib.mjs. Budgets (DESIGN-SPEC §16.1):
// Standard ≤ 150 calls / 300k triangles; Lite lower still. `--breakdown` lists what is drawn (dev build only).
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, waitFor, email, shot } from "./lib.mjs";
import { DOORS, DOOR_RING, ring, walkTo, installFrameMeter, resetFrames, frames } from "./world-lib.mjs";

const vp = process.argv[2] ?? "desktop";
const who = process.argv[3] ?? "lv12";
const areas = (process.argv[4] ?? "plaza,pool,ludo,igisoro,arena,admin").split(",");
const breakdown = process.argv.includes("--breakdown");
const tierArg = process.argv.find((a) => a.startsWith("--tier="))?.slice(7); // force a tier (?tier=lite|standard)
const { check, note, done } = suite(`perf-${vp}${tierArg ? `-${tierArg}` : ""}`);
const BUDGET = { standard: { calls: 150, tris: 300_000 }, lite: { calls: 100, tris: 200_000 } };

/** median calls / tris over `ms` of frames (sampled once per frame from the probe) */
const sample = (page, ms = 2000) =>
  page.evaluate(async (ms) => {
    const c = [];
    const t = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = window.__gkProbe;
      if (p?.calls) {
        c.push(p.calls);
        t.push(p.tris);
      }
    }
    const med = (a) => (a.sort((x, y) => x - y), a[Math.floor(a.length / 2)] ?? null);
    const gl = (window.__qaGL?.perFrame ?? []).slice(-60).filter((n) => n > 0);
    return { calls: med(c), tris: med(t), glCalls: med(gl), fps: Math.round((c.length * 1000) / ms), tier: window.__gkStage?.getState().tier, fx: window.__gkStage?.getState().fx };
  }, ms);

/** what the frame draws: visible meshes in the camera frustum by kind, shadow casters, the heaviest meshes */
const explain = (page) =>
  page.evaluate(() => {
    const p = window.__gkProbe;
    const root = p?.root;
    const cam = p?.cam;
    if (!root || !cam) return null;
    cam.updateMatrixWorld();
    // frustum planes from projection × view (Gribb / Hartmann)
    const m = [...cam.projectionMatrix.elements];
    const v = [...cam.matrixWorldInverse.elements];
    const mul = (a, b) => {
      const o = new Array(16).fill(0);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      return o;
    };
    const e = mul(m, v);
    const row = (i) => [e[i], e[4 + i], e[8 + i], e[12 + i]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    const planes = [0, 1, 2, 3, 4, 5].map((i) => {
      const s = i % 2 ? -1 : 1;
      const rr = i < 2 ? r0 : i < 4 ? r1 : r2;
      const pl = r3.map((x, k) => x + s * rr[k]);
      const n = Math.hypot(pl[0], pl[1], pl[2]);
      return pl.map((x) => x / n);
    });
    const inFrustum = (o) => {
      const g = o.geometry;
      if (!g) return false;
      if (!o.frustumCulled) return true;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (!bs) return true;
      const w = o.matrixWorld.elements;
      const cx = w[0] * bs.center.x + w[4] * bs.center.y + w[8] * bs.center.z + w[12];
      const cy = w[1] * bs.center.x + w[5] * bs.center.y + w[9] * bs.center.z + w[13];
      const cz = w[2] * bs.center.x + w[6] * bs.center.y + w[10] * bs.center.z + w[14];
      const sc = Math.max(Math.hypot(w[0], w[1], w[2]), Math.hypot(w[4], w[5], w[6]), Math.hypot(w[8], w[9], w[10]));
      const rad = bs.radius * sc;
      return planes.every((pl) => pl[0] * cx + pl[1] * cy + pl[2] * cz + pl[3] > -rad);
    };
    const tri = (o) => {
      const g = o.geometry;
      const n = g.index ? g.index.count : g.attributes.position?.count ?? 0;
      const per = o.isPoints || o.isLine ? n : n / 3;
      const inst = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount ?? 1 : 1;
      const mats = Array.isArray(o.material) ? o.material.length : 1;
      return { tris: Math.round(per * inst), mats };
    };
    const kinds = {};
    const heavy = [];
    let casters = 0, casterTris = 0, drawn = 0, drawnTris = 0;
    const lights = [];
    root.traverseVisible((o) => {
      if (o.isLight && o.castShadow) lights.push(`${o.type}${o.shadow?.mapSize ? `@${o.shadow.mapSize.x}` : ""}`);
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const { tris, mats } = tri(o);
      if (o.castShadow) {
        casters += mats;
        casterTris += tris;
      }
      if (!inFrustum(o)) return;
      drawn += mats;
      drawnTris += tris;
      const kind = o.isInstancedMesh ? "instanced" : o.isSkinnedMesh ? "skinned" : o.text !== undefined ? "text" : o.isPoints ? "points" : o.material?.transparent ? "transparent" : "mesh";
      kinds[kind] = kinds[kind] ?? { n: 0, tris: 0 };
      kinds[kind].n += mats;
      kinds[kind].tris += tris;
      let path = o.name || o.type;
      let q = o.parent;
      for (let i = 0; i < 3 && q; i++, q = q.parent) if (q.name) path = `${q.name}/${path}`;
      heavy.push({ path: `${path}[${o.geometry.type}${o.material?.color ? ` #${o.material.color.getHexString()}` : ""}${o.material?.map ? " map" : ""}]${o.text ? `"${String(o.text).slice(0, 18)}"` : ""}`, tris, cast: !!o.castShadow, mat: o.material?.type });
    });
    heavy.sort((a, b) => b.tris - a.tris);
    return { drawn, drawnTris, casters, casterTris, lights, kinds, heavy: heavy.slice(0, 18) };
  });

/** render passes of one frame: each renderer.render() call (scene, target) and the draw calls / triangles it added */
const passes = (page) =>
  page.evaluate(async () => {
    const gl = window.__gkProbe?.gl;
    if (!gl) return null;
    const out = [];
    const orig = gl.render;
    const sm = gl.shadowMap.render;
    let inShadow = false;
    gl.shadowMap.render = function (...a) {
      const c0 = gl.info.render.calls, t0 = gl.info.render.triangles;
      inShadow = true;
      try {
        return sm.apply(this, a);
      } finally {
        inShadow = false;
        out.push({ pass: "shadow", calls: gl.info.render.calls - c0, tris: gl.info.render.triangles - t0 });
      }
    };
    gl.render = function (scene, camera) {
      if (inShadow) return orig.call(this, scene, camera);
      const c0 = gl.info.render.calls, t0 = gl.info.render.triangles;
      const rt = gl.getRenderTarget();
      try {
        return orig.call(this, scene, camera);
      } finally {
        out.push({ pass: `${scene.type}${scene.name ? `:${scene.name}` : ""}${scene.children.length ? `(${scene.children.length})` : ""}`, rt: rt ? `${rt.width}x${rt.height}` : "canvas", calls: gl.info.render.calls - c0, tris: gl.info.render.triangles - t0 });
      }
    };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    gl.render = orig;
    gl.shadowMap.render = sm;
    return out.slice(-40);
  });

/** fixed camera pose: orbit yaw / pitch / distance around the person (world/Player cameraState) */
const cam = (page, yaw, pitch, distance) => page.evaluate((y, p, d) => Object.assign(window.__gkCam, { yaw: y, pitch: p, distance: d }), yaw, pitch, distance);

const browser = await launch();
const rows = [];
const record = async (page, area, poseName, tier) => {
  await sleep(1500);
  const s = await sample(page);
  const b = BUDGET[s.tier ?? "standard"] ?? BUDGET.standard;
  rows.push({ area, pose: poseName, ...s });
  note(`perf.${area}.${poseName}`, JSON.stringify(s));
  check(`perf.${area}.${poseName} within ${s.tier} budget (${b.calls} calls / ${b.tris / 1000}k tris)`, s.calls <= b.calls && s.tris <= b.tris, `${s.calls} calls / ${Math.round(s.tris / 1000)}k tris (gl ${s.glCalls})`);
  if (breakdown) {
    const ex = await explain(page);
    if (ex) console.log(JSON.stringify({ ...ex, heavy: ex.heavy.map((h) => `${h.tris}${h.cast ? " cast" : ""} ${h.mat} ${h.path}`) }));
    console.log("passes", JSON.stringify(await passes(page)));
  }
  await shot(page, `perf-${area}-${poseName}-${vp}${tier ? `-${tier}` : ""}`, { quality: 40 });
};

const { page, ctx } = await openPage(browser, VIEWPORTS[vp]);
await loginContext(page, email(who));
const q = tierArg ? `?tier=${tierArg}` : "";
try {
  if (areas.includes("plaza")) {
    await page.goto(`${WEB}/world${q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitFor(page, () => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza" && document.querySelector("[aria-label='Account and settings']"), { timeout: 120000 });
    await installFrameMeter(page);
    await sleep(3000);
    // A: by the gate, looking up the avenue to the fountain and the arena (the widest view)
    await walkTo(page, 0, 33, { timeout: 20000 });
    await page.evaluate(() => (window.__gkNav.target = { x: 0, z: 32.6 }));
    await sleep(800);
    await cam(page, 0, 0.32, 9);
    await record(page, "plaza", "gate-north", tierArg);
    // B: fountain court, looking at the Pool Hall / Igisoro side
    await walkTo(page, 0, 12, { timeout: 30000 });
    await cam(page, Math.PI * 0.75, 0.3, 9);
    await record(page, "plaza", "court-west", tierArg);
    // C: in front of the Ludo door, looking back across the plaza
    const l = ring(DOORS.ludo, DOOR_RING - 6);
    await walkTo(page, l.x, l.z, { timeout: 30000 });
    await cam(page, ((-DOORS.ludo + 180) * Math.PI) / 180 + Math.PI, 0.3, 9);
    await record(page, "plaza", "ludo-door-back", tierArg);
    // door crossing time (walking in at the Pool Hall: worst frame, ms from the doorstep to the hall)
    const n = ring(DOORS.pool, DOOR_RING - 4);
    await walkTo(page, n.x, n.z, { timeout: 40000 });
    await resetFrames(page);
    const t0 = Date.now();
    const bb = ring(DOORS.pool, DOOR_RING + 3);
    const r = await walkTo(page, bb.x, bb.z, { timeout: 20000, until: (p) => p.view && p.view !== "plaza" });
    await sleep(800);
    const fr = await frames(page);
    note("perf.door.pool", JSON.stringify({ view: r.view, crossMs: Date.now() - t0, worst: fr.worst, gaps: fr.gaps }));
    check("perf.door.pool no freeze (worst frame < 250 ms)", fr.worst < 250 && r.view === "hall:pool", `${fr.worst} ms, ${r.view}`);
  }
  for (const hall of areas.filter((a) => a !== "plaza")) {
    await page.goto(`${WEB}/room/${hall}${q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const ok = await waitFor(page, (h) => window.__gkProbe?.ready && window.__gkProbe?.view === `hall:${h}`, { timeout: 120000, arg: hall });
    if (!ok) {
      check(`perf.${hall}.boot`, false, "hall not ready in 120 s");
      continue;
    }
    await sleep(2500);
    // the arrival pose (just inside the door, looking into the hall): fixed by the hall layout
    await record(page, hall, "arrival", tierArg);
    // a few steps in and a wide look across the room
    await page.evaluate(() => window.__gkCam && Object.assign(window.__gkCam, { pitch: 0.45, distance: 7 }));
    await record(page, hall, "wide", tierArg);
  }
} finally {
  await saveSession(page, email(who));
  await ctx.close();
  await browser.close();
}
console.log("\n| area | pose | calls | tris | gl calls | fps | tier |\n| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r.area} | ${r.pose} | ${r.calls} | ${Math.round(r.tris / 1000)}k | ${r.glCalls} | ${r.fps} | ${r.tier}${r.fx ? "+fx" : ""} |`);
done();
process.exit(0);
