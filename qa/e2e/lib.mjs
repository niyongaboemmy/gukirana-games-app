// Shared helpers for the QA-01 end-to-end scripts (API-level checks + puppeteer-core UI runs).
// Ports default to the isolated QA stack: web :3500, api :4300, realtime :2600, admin :3501.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API = process.env.QA_API ?? "http://127.0.0.1:4300";
export const WEB = process.env.QA_WEB ?? "http://localhost:3500";
export const ADMIN_WEB = process.env.QA_ADMIN_WEB ?? "http://localhost:3501";
export const RT = process.env.QA_RT ?? "ws://localhost:2600";
export const ADMIN_TOKEN = process.env.QA_ADMIN_TOKEN ?? "dev-admin-service-token";
export const INTERNAL_TOKEN = process.env.QA_INTERNAL_TOKEN ?? "dev-internal-service-token";
export const OUT = process.env.QA_OUT ?? join(tmpdir(), "gk-qa");
// screenshots go to $TMPDIR/gk-qa/shots; copy the ones a P0 / P1 gap needs into docs/QA/evidence/ (keep them small)
export const EVIDENCE = process.env.QA_EVIDENCE ?? join(tmpdir(), "gk-qa", "shots");
mkdirSync(OUT, { recursive: true });

export const email = (key) => `qa.${key}@example.test`;

/** fetch JSON against the API; never throws on HTTP status */
export async function api(path, { method = "GET", token, body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h.authorization = `Bearer ${token}`;
  if (cookie) h.cookie = cookie;
  const t0 = performance.now();
  const r = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: r.status, json, ms: Math.round(performance.now() - t0), setCookie: r.headers.get("set-cookie") };
}

// OTP is rate limited (3 per identifier per 10 min): cache sessions (access token 15 min + refresh cookie 30 days)
const CACHE = join(OUT, "sessions.json");
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const save = () => writeFileSync(CACHE, JSON.stringify(cache, null, 1));

/** Sign in with the dev OTP (or reuse a cached session). Returns { token, cookie, status, json } */
export async function signIn(identifier, { fresh = false } = {}) {
  const c = cache[identifier];
  if (!fresh && c) {
    if (c.token && Date.now() - c.at < 12 * 60_000) return { token: c.token, cookie: c.cookie, status: 200 };
    const r = await api("/auth/refresh", { method: "POST", cookie: c.cookie });
    if (r.status === 200 && r.json?.accessToken) {
      const cookie = (r.setCookie ?? "").split(";")[0] || c.cookie;
      cache[identifier] = { token: r.json.accessToken, cookie, at: Date.now() };
      save();
      return { token: r.json.accessToken, cookie, status: 200 };
    }
  }
  const req = await api("/auth/otp/request", { method: "POST", body: { identifier } });
  if (req.status !== 200 || !req.json?.devCode) return { token: null, status: req.status, json: req.json, step: "request" };
  const v = await api("/auth/otp/verify", { method: "POST", body: { identifier, code: req.json.devCode } });
  if (v.status !== 200) return { token: null, status: v.status, json: v.json, step: "verify" };
  const cookie = (v.setCookie ?? "").split(";")[0];
  cache[identifier] = { token: v.json.accessToken, cookie, at: Date.now() };
  save();
  return { token: v.json.accessToken, cookie, status: 200, isNew: v.json.isNew };
}

/** Tiny test recorder: check(name, ok, detail) → results; summary written to OUT/<suite>.json */
export function suite(name) {
  const results = [];
  const check = (id, ok, detail = "") => {
    results.push({ id, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? `  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    return !!ok;
  };
  const note = (id, detail) => {
    results.push({ id, ok: null, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    console.log(`NOTE  ${id}  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  };
  const done = () => {
    const pass = results.filter((r) => r.ok === true).length;
    const fail = results.filter((r) => r.ok === false).length;
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ suite: name, at: new Date().toISOString(), pass, fail, results }, null, 1));
    console.log(`\n${name}: ${pass} pass, ${fail} fail → ${join(OUT, `${name}.json`)}`);
    return { pass, fail, results };
  };
  return { check, note, done, results };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- browser helpers (puppeteer-core)
export const CHROME = process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
  tablet: { width: 1180, height: 820, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true },
  portrait: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export async function launch() {
  const { default: puppeteer } = await import("puppeteer-core");
  return puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
    protocolTimeout: 120_000,
  });
}

/** New page with console / page-error capture. */
export async function openPage(browser, viewport = VIEWPORTS.desktop) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  // count WebGL draw calls per animation frame (renderer.info is not exposed by the app)
  await page.evaluateOnNewDocument(() => {
    const st = { calls: 0, lastFrame: 0, perFrame: [] };
    window.__qaGL = st;
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue;
      for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
        const orig = C.prototype[fn];
        if (!orig) continue;
        C.prototype[fn] = function (...a) {
          st.calls++;
          return orig.apply(this, a);
        };
      }
    }
    const tick = () => {
      st.perFrame.push(st.calls - st.lastFrame);
      if (st.perFrame.length > 120) st.perFrame.shift();
      st.lastFrame = st.calls;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const errors = [];
  const warnings = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message ?? e).slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 300)}`);
    else if (m.type() === "warn" || m.type() === "warning") warnings.push(m.text().slice(0, 200));
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.includes("_next/webpack-hmr") && !u.startsWith("data:")) errors.push(`requestfailed: ${u.slice(0, 160)} ${r.failure()?.errorText ?? ""}`);
  });
  return { ctx, page, errors, warnings };
}

/**
 * Put a signed-in session into a browser context: the refresh cookie on the web origin (SessionBoot refreshes it).
 * Refresh cookies rotate, so call `saveSession(page, identifier)` before closing the page to keep the chain alive
 * (OTP requests are limited to 3 per identifier per 10 minutes).
 */
export async function loginContext(page, identifier) {
  let c = cache[identifier];
  if (!c?.cookie) {
    const s = await signIn(identifier, { fresh: true });
    if (!s.cookie) throw new Error(`no session for ${identifier}: ${s.status} ${JSON.stringify(s.json)}`);
    c = cache[identifier];
  }
  const [name] = c.cookie.split("=");
  const host = new URL(WEB).hostname;
  await page.setCookie({ name, value: c.cookie.slice(name.length + 1), domain: host, path: "/", httpOnly: true, sameSite: "Lax" });
  // the browser now owns the chain: forget the API copy until saveSession hands it back
  delete cache[identifier];
  save();
  return { cookie: c.cookie };
}

/** Hand the browser's current refresh cookie back to the session cache (call before closing the context). */
export async function saveSession(page, identifier) {
  try {
    const ck = (await page.cookies(WEB)).find((x) => x.name === "gk_rt");
    if (ck) {
      cache[identifier] = { token: null, cookie: `gk_rt=${ck.value}`, at: 0 };
      save();
    }
  } catch {
    /* page gone */
  }
}

export async function shot(page, file, { quality = 55 } = {}) {
  mkdirSync(EVIDENCE, { recursive: true });
  const p = join(EVIDENCE, file.endsWith(".jpg") ? file : `${file}.jpg`);
  await page.screenshot({ path: p, type: "jpeg", quality });
  return p;
}

/** Visible text of all buttons / role=button elements */
export const buttons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button,[role=button],a")]
      .filter((b) => b.offsetParent !== null || b.getClientRects().length)
      .map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "))
      .filter(Boolean),
  );

/** Click the first visible button whose text / aria-label matches */
export async function clickText(page, re, { timeout = 8000 } = {}) {
  const src = re instanceof RegExp ? re.source : String(re);
  const flags = re instanceof RegExp ? re.flags : "i";
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(
      (src, flags) => {
        const rx = new RegExp(src, flags);
        const els = [...document.querySelectorAll("button,[role=button],a,[role=menuitem],[role=tab],label")];
        const el = els.find((b) => (b.offsetParent !== null || b.getClientRects().length) && !b.disabled && rx.test((b.innerText || b.getAttribute("aria-label") || b.title || "").trim()));
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      },
      src,
      flags,
    );
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

export const bodyText = (page) => page.evaluate(() => document.body.innerText);

/** wait until fn() (in page) is truthy */
export async function waitFor(page, fn, { timeout = 20000, arg } = {}) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 250 }, arg);
    return true;
  } catch {
    return false;
  }
}

/** Sample frame rate + draw calls for `ms` (uses __gkStage / __gkWorld when present). */
export async function perf(page, ms = 3000) {
  return page.evaluate(async (ms) => {
    let frames = 0;
    let stop = false;
    const tick = () => {
      frames++;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, ms));
    stop = true;
    const pf = (window.__qaGL?.perFrame ?? []).filter((n) => n > 0).sort((a, b) => a - b);
    const calls = pf.length ? pf[Math.floor(pf.length / 2)] : null; // median draw calls per drawn frame
    const p = window.__gkProbe;
    return { fps: Math.round((frames * 1000) / ms), calls, maxCalls: pf.length ? pf[pf.length - 1] : null, probeCalls: p?.calls ?? null, tris: p?.tris ?? null, programs: p?.programs ?? null, textures: p?.textures ?? null, geometries: p?.geometries ?? null };
  }, ms);
}
