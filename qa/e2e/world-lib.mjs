// World helpers for the UI journeys: walk with the click-to-walk target (window.__gkNav), track frame gaps.
import { sleep, waitFor } from "./lib.mjs";

export const PLAZA_RADIUS = 37;
export const DOOR_RING = PLAZA_RADIUS + 1.5;
export const DOORS = { igisoro: -88, pool: -44, arena: 0, ludo: 44, admin: 88 };
export const ring = (deg, r) => ({ x: r * Math.sin((deg * Math.PI) / 180), z: -r * Math.cos((deg * Math.PI) / 180) });

export const view = (page) => page.evaluate(() => window.__gkProbe?.view ?? null);
export const pose = (page) => page.evaluate(() => ({ x: window.__gkProbe?.self?.x, z: window.__gkProbe?.self?.z, view: window.__gkProbe?.view }));

/** install a frame-gap recorder (worst rAF gap since reset) */
export async function installFrameMeter(page) {
  await page.evaluate(() => {
    if (window.__qaFrames) return;
    const m = { last: performance.now(), worst: 0, n: 0, gaps: [] };
    window.__qaFrames = m;
    const tick = (t) => {
      const d = t - m.last;
      if (d > m.worst) m.worst = d;
      if (d > 100) m.gaps.push(Math.round(d));
      m.last = t;
      m.n++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
export const resetFrames = (page) => page.evaluate(() => Object.assign(window.__qaFrames, { worst: 0, n: 0, gaps: [], last: performance.now() }));
export const frames = (page) => page.evaluate(() => ({ worst: Math.round(window.__qaFrames.worst), n: window.__qaFrames.n, gaps: window.__qaFrames.gaps.slice(0, 10) }));

/** Walk to (x, z) with the click-to-walk target; resolves when arrived, the view changes, or timeout. */
export async function walkTo(page, x, z, { timeout = 30000, until } = {}) {
  const v0 = await view(page);
  await page.evaluate((x, z) => {
    window.__gkNav.goal = null;
    window.__gkNav.target = { x, z };
  }, x, z);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = await pose(page);
    if (until ? await until(p) : p.view !== v0 || Math.hypot(p.x - x, p.z - z) < 0.6) return { ...p, ms: Date.now() - t0 };
    await sleep(150);
  }
  return { ...(await pose(page)), ms: Date.now() - t0, timeout: true };
}

/** Walk from the plaza through a building door; returns timing of the crossing. */
export async function enterDoor(page, id) {
  const deg = DOORS[id];
  const near = ring(deg, DOOR_RING - 4);
  await walkTo(page, near.x, near.z, { timeout: 40000 });
  await resetFrames(page);
  const beyond = ring(deg, DOOR_RING + 3);
  const t0 = Date.now();
  const r = await walkTo(page, beyond.x, beyond.z, { timeout: 20000, until: (p) => p.view && p.view !== "plaza" });
  const crossMs = Date.now() - t0;
  const ready = await waitFor(page, () => window.__gkProbe?.ready, { timeout: 15000 });
  await sleep(500);
  return { view: r.view, crossMs, ready, frames: await frames(page), url: page.url() };
}

/** Hold a key for ms (keyboard walking). */
export async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}
