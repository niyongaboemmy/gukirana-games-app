// P3-FGT-24 Boxing end to end in real browsers: two signed-in players on the campus → Quick Play Boxing (hall + ring
// picked in the sheet, "Find an opponent") or a direct challenge → both accept → the walk to the ring → the fight room
// (both fighters drawn, v8 GLBs + KTX2 loaded, no shader errors) → punches the server counts → the round's end → the
// result card → leave. Console errors, failed requests and HTTP errors are collected per player.
//   QA_WEB=http://localhost:3220 QA_API=http://127.0.0.1:4220 VIEW=desktop|phone FLOW=quick|challenge STAKE=0 \
//     OUT=/tmp/box node qa/e2e/boxing-e2e.mjs
// The stack's boxing rules should be short for a run (1 round of 30 s): SHORT=1 sets them through the console API.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3220";
const API = process.env.QA_API ?? "http://127.0.0.1:4220";
const VIEW = process.env.VIEW ?? "desktop";
const FLOW = process.env.FLOW ?? "quick";
const STAKE = Number(process.env.STAKE ?? 25);
const stakeChip = STAKE === 0 ? /^Friendly$/ : new RegExp(`^${STAKE}$`);
const OUT = process.env.OUT ?? "/tmp/gk-boxing-e2e";
const BOXER = process.env.BOXER ?? ""; // "v7" | "v8": the dev per-page override (generation.ts)
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const t = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
const results = [];
const check = (id, ok, detail = "") => {
  results.push({ id, ok: !!ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"} [${t()}] ${id}${detail ? `  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`,
  );
  return !!ok;
};
/** a step the rest depends on: stop the run when it fails */
const must = (id, ok, detail) => {
  if (!check(id, ok, detail)) throw new Error(`stopped at: ${id}`);
};
const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};
const adm = {
  "x-admin-token": process.env.QA_ADMIN_TOKEN ?? "dev-admin-service-token",
  "x-admin-user": "qa",
  "content-type": "application/json",
};

async function apiJ(path, { method = "GET", token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body) h["content-type"] = "application/json";
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

if (process.env.SHORT === "1") {
  const games = (await apiJ("/console/games", { headers: adm })).json;
  const b = games.find((g) => g.game === "boxing");
  const settings = {
    ...b.settings,
    enabled: true,
    fight: { ...b.settings.fight, rounds: 1, roundSeconds: 30, restSeconds: 10 },
  };
  await apiJ("/console/games/boxing", {
    method: "PUT",
    headers: adm,
    body: { settings, reason: "P3-FGT-24 e2e short fight" },
  });
}

const browser = await puppeteer.launch({
  executablePath: process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio"],
  protocolTimeout: 600_000,
});

async function player(key) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(VIEWPORTS[VIEW]);
  const p = { key, page, errors: [], warns: [], glb: [], ktx2: [], http: [] };
  page.on("pageerror", (e) => p.errors.push(`pageerror: ${String(e.stack ?? e.message ?? e).slice(0, 900)}`));
  page.on("console", (m) => {
    const s = m.text();
    if (m.type() === "error") p.errors.push(`console.error: ${s.slice(0, 400)}`);
    else if (m.type() === "warn" || m.type() === "warning") p.warns.push(s.slice(0, 300));
    if (s.includes("QADBG")) console.log(`[${key}] ${s.slice(0, 1200)}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    const why = r.failure()?.errorText ?? "";
    // navigations abort in-flight requests (net::ERR_ABORTED): not a failure of the app
    if (!u.includes("webpack-hmr") && !u.startsWith("data:") && why !== "net::ERR_ABORTED")
      p.errors.push(`requestfailed: ${u.slice(0, 160)} ${why}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400) p.http.push(`${r.status()} ${u.slice(0, 160)}`);
    if (/\.glb(\?|$)/.test(u)) p.glb.push(`${r.status()} ${u.replace(WEB, "")}`);
    if (/\.ktx2(\?|$)/.test(u)) p.ktx2.push(`${r.status()} ${u.replace(WEB, "")}`);
  });
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  const who = await page.evaluate(async (key) => {
    const id = `0788${String(Date.now() % 100000).padStart(5, "0")}${key === "a" ? 1 : 2}`;
    const j = (path, init) =>
      fetch(`/api/v1${path}`, {
        credentials: "include",
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      }).then((x) => x.json());
    const r = await j("/auth/otp/request", { method: "POST", body: JSON.stringify({ identifier: id }) });
    const v = await j("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ identifier: id, code: r.devCode }),
    });
    const name = `bx${key}${Date.now() % 100000}`;
    await j("/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${v.accessToken}` },
      body: JSON.stringify({ username: name }),
    });
    return { name, token: v.accessToken };
  }, key);
  p.name = who.name;
  p.token = who.token;
  return p;
}

const phone = VIEW === "phone";
/** tap / click the first visible element whose text or aria-label matches (real pointer events at its centre) */
async function tap(page, re, { timeout = 10_000, within } = {}) {
  const t1 = Date.now();
  while (Date.now() - t1 < timeout) {
    const box = await page.evaluate(
      (src, flags, within) => {
        const rx = new RegExp(src, flags);
        const root = within ? document.querySelector(within) : document;
        if (!root) return null;
        const els = [...root.querySelectorAll("button,[role=button],a,[role=radio],[role=menuitem],label")];
        const el = els.find(
          (b) =>
            b.getClientRects().length &&
            !b.disabled &&
            (rx.test((b.innerText || "").trim().replace(/\s+/g, " ")) ||
              rx.test((b.getAttribute("aria-label") || "").trim())),
        );
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, html: el.outerHTML.slice(0, 160) };
      },
      re.source,
      re.flags,
      within ?? null,
    );
    if (box) {
      if (process.env.DEBUG)
        console.log(`  tap ${re} → (${Math.round(box.x)},${Math.round(box.y)}) ${box.html}`);
      if (phone) await page.touchscreen.tap(box.x, box.y);
      else await page.mouse.click(box.x, box.y);
      return true;
    }
    await sleep(250);
  }
  return false;
}
const text = (page) => page.evaluate(() => document.body.innerText);
async function waitText(page, re, timeout = 30_000) {
  const t1 = Date.now();
  while (Date.now() - t1 < timeout) {
    if (re.test(await text(page).catch(() => ""))) return true;
    await sleep(300);
  }
  return false;
}
/** the house rules card (first live match of a game): tick and accept, if it is up */
async function rulesCard(page) {
  return page.evaluate(() => {
    const box = [...document.querySelectorAll('input[type="checkbox"]')].find((b) =>
      b.closest("label")?.textContent?.toLowerCase().includes("accept"),
    );
    if (!box) return false;
    if (!box.checked) box.click();
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Accept and continue/.test(b.textContent ?? ""),
    );
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  });
}
async function shot(p, name) {
  const file = join(OUT, `${VIEW}-${FLOW}-${name}-${p.key}.jpg`);
  await p.page.screenshot({ path: file, type: "jpeg", quality: phone ? 45 : 55 });
  return file;
}
const mine = (p) =>
  p.page.evaluate(() => {
    const m = window.__gkFight?.bridge.getState().mine;
    return m
      ? {
          mode: m.mode,
          ring: m.ring,
          corner: m.corner,
          phase: m.snap?.phase ?? null,
          round: m.snap?.round ?? null,
          left: m.snap?.left ?? null,
          tick: m.snap?.tick ?? null,
          settled: m.settled,
          names: m.names,
        }
      : null;
  });
const path = (p) => p.page.evaluate(() => location.pathname);

/** Quick Play sheet: desktop HUD button; phone: the action bar's More menu */
async function openQuickPlay(p) {
  let opened;
  if (phone) {
    opened = await tap(p.page, /^More actions/);
    await sleep(400);
    opened = opened && (await tap(p.page, /^Quick Play$/));
  } else opened = await tap(p.page, /^Quick Play$/);
  return opened && (await waitText(p.page, /How do you want to play/i, 8000));
}

/** solo: Quick Play -> Boxing -> Practice vs AI -> the ring's prompt -> a practice fight vs the AI -> result -> step out */
async function practiceFlow(p) {
  must("a: Quick Play sheet opens", await openQuickPlay(p));
  must("a: Boxing picked", await tap(p.page, /^Boxing$/, { within: '[role="dialog"]' }));
  await sleep(600);
  must("a: ring 7 picked", await tap(p.page, /^Ring 7 · free/, { within: '[role="dialog"]' }));
  must("a: Practice vs AI mode", await tap(p.page, /Practice vs AI/, { within: '[role="dialog"]' }));
  must("a: Go and practise", await tap(p.page, /Go and practise/, { within: '[role="dialog"]' }));
  // walked to ring 7's steps: its prompt offers Practice vs AI (then the level, then Practice vs AI again)
  must("a: walked to the ring's prompt", await waitText(p.page, /Wait for an opponent/, 120_000));
  await shot(p, "3-ring-prompt");
  must("a: Practice vs AI (prompt)", await tap(p.page, /^Practice vs AI$/));
  await sleep(500);
  must("a: Practice vs AI (start)", await tap(p.page, /^Practice vs AI$/));
  let m = null;
  for (let i = 0; i < 120; i++) {
    await rulesCard(p.page);
    m = await mine(p);
    if (m?.mode === "practice" && m.phase === "round") break;
    await sleep(500);
  }
  must("practice fight starts (round 1 vs the AI)", m?.mode === "practice" && m.phase === "round", m);
  for (let i = 0; i < 16; i++) {
    await p.page.keyboard.press(i % 2 ? "j" : "k");
    await sleep(150);
  }
  const f = await p.page.evaluate(() =>
    window.__gkFight.bridge.getState().mine.snap.fighters.map((x) => x.stamina),
  );
  check("practice punches count (stamina spent)", f[0] < 1000, f);
  await shot(p, "6-mid-fight");
  // fast-forward the in-browser practice clock to each bell (dev hook; practice is never counted)
  for (let i = 0; i < 400; i++) {
    const st = await mine(p);
    if (st?.phase === "over") break;
    await p.page.evaluate(() => {
      const s = window.__gkPractice?.session();
      if (s && s.state.left > 20) s.state.left = 20;
    });
    await sleep(250);
  }
  check("practice result card", await waitText(p.page, /you (win|won|lose|lost)|draw/i, 30_000));
  await shot(p, "7-result");
  check("a: steps out", await tap(p.page, /^Step out$/));
  await sleep(2000);
  check("a: out of the ring", !(await mine(p)));
}

let A, B;
try {
  [A, B] = await Promise.all([player("a"), player("b")]);
  check("sign in both", !!A.token && !!B.token, `${A.name} / ${B.name}`);
  const q = BOXER ? `?boxer=${BOXER}` : "";
  await Promise.all(
    [A, B].map((p) => p.page.goto(`${WEB}/world${q}`, { waitUntil: "domcontentloaded", timeout: 300_000 })),
  );
  // the HUD is up: the Quick Play button (desktop) / the action bar's More menu (phone)
  const hudUp = (p) =>
    p.page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("button")].some(
            (b) =>
              b.getClientRects().length &&
              (/^Quick Play$/.test(b.innerText.trim()) || b.getAttribute("aria-label") === "More actions"),
          ),
        { timeout: 240_000, polling: 500 },
      )
      .then(
        () => true,
        () => false,
      );
  const campus = await Promise.all([A, B].map(hudUp));
  check("campus loads (both)", campus.every(Boolean));
  await sleep(6000);
  await shot(A, "1-campus");

  if (FLOW === "practice") await practiceFlow(A);
  else {
    if (FLOW === "quick") {
      for (const [p, ring] of [
        [A, "7"],
        [B, "7"],
      ]) {
        // Quick Play: desktop HUD button; phone: the action bar's More menu
        let opened = false;
        if (phone) {
          opened = await tap(p.page, /^More actions/);
          await sleep(400);
          if (process.env.DEBUG) await shot(p, "dbg-more");
          opened = opened && (await tap(p.page, /^Quick Play$/));
        } else opened = await tap(p.page, /^Quick Play$/);
        must(
          `${p.key}: Quick Play sheet opens`,
          opened && (await waitText(p.page, /How do you want to play/i, 8000)),
        );
        must(`${p.key}: Boxing picked`, await tap(p.page, /^Boxing$/, { within: '[role="dialog"]' }));
        await sleep(600);
        must(
          `${p.key}: ring ${ring} picked`,
          await tap(p.page, new RegExp(`^Ring ${ring} · free`), { within: '[role="dialog"]' }),
        );
        await tap(p.page, /Find an opponent/, { within: '[role="dialog"]' });
        check(
          `${p.key}: stake ${STAKE || "Friendly"}`,
          await tap(p.page, stakeChip, { within: '[role="dialog"]' }),
        );
        if (p === A) await shot(p, "2-quickplay-sheet");
        check(
          `${p.key}: Go and find`,
          await tap(p.page, /Go and find an opponent/, { within: '[role="dialog"]' }),
        );
      }
      const inHall = await Promise.all(
        [A, B].map(async (p) => {
          const t1 = Date.now();
          while (Date.now() - t1 < 120_000) {
            await rulesCard(p.page);
            if ((await path(p)) === "/room/boxing") return true;
            await sleep(500);
          }
          return false;
        }),
      );
      must(
        "both go to the Boxing hall (/room/boxing)",
        inHall.every(Boolean),
        (await Promise.all([A, B].map(path))).join(" "),
      );
      // the search starts on arrival (the rules card first, when it is the first live boxing match)
      const searching = await Promise.all(
        [A, B].map(async (p) => {
          const t1 = Date.now();
          while (Date.now() - t1 < 90_000) {
            await rulesCard(p.page);
            const s = await text(p.page);
            if (/Looking for a Boxing opponent|Opponent found/.test(s)) return true;
            await sleep(500);
          }
          return false;
        }),
      );
      must("both searching (queue)", searching.every(Boolean));
      await shot(A, "3-queue");
    } else {
      // direct challenge: both walk into the Boxing hall, A challenges B from the challenge sheet
      for (const p of [A, B])
        await p.page.goto(`${WEB}/room/boxing${q}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      const hall = await Promise.all([A, B].map((p) => waitText(p.page, /Boxing|ring/i, 180_000)));
      check("both in the Boxing hall", hall.every(Boolean));
      await sleep(8000);
      let opened = false;
      if (phone) opened = (await tap(A.page, /^More actions/)) && (await tap(A.page, /Quick Play/));
      else opened = await tap(A.page, /^Quick Play$/);
      must("a: Quick Play sheet opens", opened && (await waitText(A.page, /How do you want to play/i, 8000)));
      await tap(A.page, /^Boxing$/, { within: '[role="dialog"]' });
      await tap(A.page, /Challenge someone/, { within: '[role="dialog"]' });
      check(
        "a: Choose who to challenge",
        await tap(A.page, /Choose who to challenge/, { within: '[role="dialog"]' }),
      );
      must(
        "a: picks b in the challenge sheet",
        await tap(A.page, new RegExp(B.name), { within: '[role="dialog"]', timeout: 15_000 }),
      );
      check(`a: stake ${STAKE || "Friendly"}`, await tap(A.page, stakeChip, { within: '[role="dialog"]' }));
      await shot(A, "2-challenge-sheet");
      check("a: Send challenge", await tap(A.page, /Send challenge/, { within: '[role="dialog"]' }));
      for (let i = 0; i < 10; i++) {
        await rulesCard(A.page);
        await sleep(400);
        if (process.env.DEBUG && i % 3 === 0)
          console.log(`  a after send: ${(await text(A.page)).replace(/\n+/g, " | ").slice(0, 500)}`);
      }
      must("b: sees the challenge", await waitText(B.page, new RegExp(`${A.name} challenges you`), 20_000));
      await shot(B, "3-invite");
      check("b: accepts", await tap(B.page, /^Accept$/));
      for (let i = 0; i < 10; i++) {
        await rulesCard(B.page);
        await sleep(400);
      }
    }

    if (FLOW === "quick") {
      const found = await Promise.all([A, B].map((p) => waitText(p.page, /Opponent found/, 60_000)));
      must("Opponent found (both)", found.every(Boolean));
      await shot(B, "4-accept");
      for (const p of [A, B]) {
        check(`${p.key}: Accept`, await tap(p.page, /^Accept$/));
        for (let i = 0; i < 6; i++) {
          await rulesCard(p.page);
          await sleep(300);
        }
      }
    }

    // the fight room: the bridge's `mine` is live on both, then the bell
    const live = await Promise.all(
      [A, B].map(async (p) => {
        const t1 = Date.now();
        while (Date.now() - t1 < 90_000) {
          await rulesCard(p.page);
          const m = await mine(p);
          if (m?.mode === "live" && m.phase) return m;
          await sleep(500);
        }
        return mine(p);
      }),
    );
    must(
      "fight room live on both",
      live.every((m) => m?.mode === "live" && m.phase),
      live,
    );
    check(
      "same ring, opposite corners",
      live[0]?.ring && live[0].ring === live[1]?.ring && live[0].corner !== live[1]?.corner,
      live.map((m) => `${m?.ring}/${m?.corner}`).join(" "),
    );
    await sleep(2500);
    const stale = await Promise.all([A, B].map((p) => text(p.page)));
    check(
      "no stale 'Go to a ring' card once the fight is on",
      stale.every((s) => !/s to get there/.test(s)),
      stale.map((s) => (s.match(/Go to[^|]*\|[^|]*\|[^|]*s to get there/) ?? ["-"])[0]),
    );
    await shot(A, "5-ring-entry");
    await shot(B, "5-ring-entry");

    // round: wait for the bell, then trade punches (keyboard on desktop, the touch pads on the phone)
    const bell = await Promise.all(
      [A, B].map(async (p) => {
        for (let i = 0; i < 120; i++) {
          if ((await mine(p))?.phase === "round") return true;
          await sleep(500);
        }
        return false;
      }),
    );
    must(
      "the bell (round 1 on both)",
      bell.every(Boolean),
      (await Promise.all([A, B].map(mine))).map((m) => m?.phase).join(" "),
    );
    const stamina0 = await A.page.evaluate(() =>
      Math.max(...(window.__gkFight?.bridge.getState().mine?.snap?.fighters ?? []).map((f) => f.stamina)),
    );
    const acts = new Set();
    for (let i = 0; i < 24; i++) {
      for (const a of await A.page.evaluate(() =>
        (window.__gkFight?.bridge.getState().mine?.snap?.fighters ?? []).map((f) => f.act),
      ))
        if (a && a !== "idle" && a !== "guard") acts.add(a);
      for (const [p, keys] of [
        [A, ["w", "j", "k"]],
        [B, ["w", "k", "j"]],
      ]) {
        const k = keys[i % keys.length];
        if (k === "w") {
          await p.page.keyboard.down("w");
          await sleep(90);
          await p.page.keyboard.up("w");
        } else await p.page.keyboard.press(k);
      }
      await sleep(140);
    }
    // the server's snapshots: each fighter's act (jab / cross / … once a press is accepted) and stamina (punches cost it)
    const actsSeen = (p) =>
      p.page.evaluate(() => {
        const f = window.__gkFight?.bridge.getState().mine?.snap?.fighters ?? [];
        return f.map((x) => ({ act: x.act, stamina: x.stamina, points: x.points }));
      });
    const sv = await Promise.all([A, B].map(actsSeen));
    const punched = acts.size > 0 && sv.every((f) => f.length === 2 && f.every((x) => x.stamina < stamina0));
    check("punches register server-side (server acts + stamina spent by both)", punched, {
      acts: [...acts],
      snap: sv,
      stamina0,
    });
    await shot(A, "6-mid-fight");
    await shot(B, "6-mid-fight");
    // render health: canvases, GLBs, KTX2, shader errors
    for (const p of [A, B]) {
      // (Chrome's "GL_INVALID_*: glGetProgramiv" warnings come from three polling a program deleted mid-compile: counted below, not compile errors)
      const shaderErr = p.errors
        .concat(p.warns)
        .filter((s) => /THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS|shader compil/i.test(s));
      check(`${p.key}: no shader compile errors`, shaderErr.length === 0, shaderErr.slice(0, 3));
      check(
        `${p.key}: boxer GLBs loaded`,
        p.glb.some((g) => /^200 .*boxer-[mf]\.glb/.test(g)),
        p.glb.filter((g) => /boxer/.test(g)),
      );
      if (BOXER === "v7")
        check(
          `${p.key}: v7 fallback: no v8 asset requested`,
          !p.glb.concat(p.ktx2).some((g) => /\/v8\//.test(g)),
          p.glb.concat(p.ktx2).filter((g) => /\/v8\//.test(g)),
        );
      if (BOXER !== "v7")
        check(
          `${p.key}: v8 KTX2 skins loaded`,
          p.ktx2.some((g) => /^200 /.test(g)),
          p.ktx2.slice(0, 4),
        );
    }

    // the round's end and the result card (1 round in SHORT mode; else up to 4 min)
    const over = await Promise.all(
      [A, B].map(async (p) => {
        const t1 = Date.now();
        while (Date.now() - t1 < 300_000) {
          const m = await mine(p);
          if (m?.settled) return m;
          // keep the fighters busy (the idle rule)
          if (m?.phase === "round" && (Date.now() - t1) % 5000 < 600) await p.page.keyboard.press("j");
          await sleep(500);
        }
        return mine(p);
      }),
    );
    check(
      "result settled on both",
      over.every((m) => !!m?.settled),
      over.map((m) => JSON.stringify(m?.settled)),
    );
    const resultText = await Promise.all(
      [A, B].map(async (p) =>
        (await waitText(p.page, /Step out/, 30_000))
          ? text(p.page)
          : `(no result card) ${(await text(p.page)).slice(0, 300)}`,
      ),
    );
    check(
      "result card shown on both",
      resultText.every((s) => /you (win|won|lose|lost)|draw/i.test(s)),
      resultText.map((s) =>
        (s.match(/(you (win|won|lose|lost)|draw)[^|]{0,80}/i) ?? [s.slice(0, 200)])[0].replace(/\n/g, " | "),
      ),
    );
    // stake match: the pot moved in the ledger (integer Stars; the API settles, LedgerService.post)
    const wallets = await Promise.all(
      [A, B].map(async (p) => (await apiJ("/wallet", { token: p.token })).json),
    );
    const stakeNow = over[0]?.settled ? Math.abs(over[0].settled.stars) : 0;
    if (stakeNow) {
      const st = wallets.map((w) => w?.stars);
      check(
        "stake settled in the wallets (winner +stake, loser -stake)",
        st.every(Number.isInteger) && st[0] + st[1] === 1000 && Math.abs(st[0] - st[1]) === 2 * stakeNow,
        { stars: st, stake: stakeNow, settled: over.map((m) => m?.settled) },
      );
    }
    await shot(A, "7-result");
    await shot(B, "7-result");

    // leave: the result card's leave / back button, then the hall again
    for (const p of [A, B]) {
      const left = await tap(p.page, /^Step out$/, { timeout: 8000 });
      await sleep(2500);
      const m = await mine(p);
      check(`${p.key}: leaves the ring`, left && !m, JSON.stringify(m));
    }
    if (stakeNow) {
      const pills = await Promise.all(
        [A, B].map((p) =>
          p.page.evaluate(
            () =>
              document.querySelector('[aria-label^="Open your wallet"]')?.getAttribute("aria-label") ?? "",
          ),
        ),
      );
      check(
        "HUD wallet shows the settled balance after stepping out",
        pills.every((t, i) => t.includes(`${wallets[i]?.stars} Stars`)),
        { pills, stars: wallets.map((w) => w?.stars) },
      );
    }
    await shot(A, "8-left");
  }
} catch (e) {
  check("no crash in the run", false, String(e?.stack ?? e).slice(0, 600));
  for (const p of [A, B].filter(Boolean)) {
    await shot(p, "fail").catch(() => undefined);
    console.log(
      `[${p.key}] at ${await path(p).catch(() => "?")}: ${(await text(p.page).catch(() => "")).slice(0, 600).replace(/\n/g, " | ")}`,
    );
  }
} finally {
  for (const p of [A, B].filter(Boolean)) {
    const glErr = p.warns.filter((w) => /GL_INVALID|WebGL/.test(w));
    console.log(
      `\n[${p.key}] errors (${p.errors.length}):\n  ${[...new Set(p.errors)].slice(0, 25).join("\n  ")}`,
    );
    console.log(
      `[${p.key}] http>=400 (${p.http.length}):\n  ${[...new Set(p.http)].slice(0, 20).join("\n  ")}`,
    );
    console.log(`[${p.key}] gl warnings: ${glErr.length} (${[...new Set(glErr)].slice(0, 4).join(" | ")})`);
    console.log(`[${p.key}] glb: ${[...new Set(p.glb)].join(", ")}`);
    console.log(`[${p.key}] ktx2: ${p.ktx2.length}`);
  }
  writeFileSync(
    join(OUT, `${VIEW}-${FLOW}-result.json`),
    JSON.stringify(
      {
        view: VIEW,
        flow: FLOW,
        results,
        errors: [A, B].filter(Boolean).map((p) => ({ key: p.key, errors: p.errors, http: p.http })),
      },
      null,
      1,
    ),
  );
  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${VIEW}/${FLOW}: ${results.length - fail} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}
