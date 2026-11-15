// P2-NET-06 browser check: keep my table / ring through a reload, release it after the hold. Sit at a Ludo table →
// reload → back on the same chair; the tab closed → the other player sees "Held · returning"; reopen from the plaza →
// back on the chair; claim a Boxing ring → reload → back at the ring, still waiting; away past the hold → the ring is
// free for the other player and the returning one is told. Stack ports from env (defaults: web :3900, api :4900,
// realtime :3167). Chrome at /Applications/Google Chrome.app; screenshots go to $QA_OUT (default $TMPDIR/gk-qa).
//   node qa/e2e/place-hold.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB = process.env.QA_WEB ?? "http://localhost:3900";
const API = process.env.QA_API ?? "http://127.0.0.1:4900";
const SHOTS = join(process.env.QA_OUT ?? join(tmpdir(), "gk-qa"), "p2-net-06") + "/";
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (id, ok, detail = "") => {
  results.push({ id, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? `  — ${detail}` : ""}`);
};
const adm = { "x-admin-token": "dev-admin-service-token", "x-admin-user": "qa", "content-type": "application/json" };
const run = Date.now().toString(36).slice(-5);
// a table / ring of its own per run (a place held by an earlier run stays held for its hold time: the feature)
const TI = Number(process.env.QA_TABLE ?? Date.now() % 16);
const SEAT = `t${TI}s0`;
const TN = TI + 1;
const RING = `R${3 + (Date.now() % 28)}`;
const RN = RING.slice(1);
/** call a QA hook once it is there (after a dev-server reload the page is a new document) */
async function qa(page, fn, arg) {
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate((src, a) => (window.__gkRoomQA?.layout ? (new Function("a", `return (${src})(a)`)(a), true) : false), fn.toString(), arg).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Boxing on in the scratch game settings
const games = await (await fetch(`${API}/console/games`, { headers: adm })).json();
const boxing = games.find((g) => g.game === "boxing");
if (boxing && !boxing.settings.enabled)
  await fetch(`${API}/console/games/boxing`, { method: "PUT", headers: adm, body: JSON.stringify({ settings: { ...boxing.settings, enabled: true }, reason: "P2-NET-06 browser check" }) });

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox", "--use-gl=angle"] });

async function person(key) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(
    async (identifier, username) => {
      const j = (r) => r.json();
      const req = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier }) }).then(j);
      const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, code: req.devCode }) }).then(j);
      const h = { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` };
      await fetch("/api/v1/me", { method: "PATCH", headers: h, body: JSON.stringify({ username }) });
      // every rules card accepted up front (the card is P2-NET-05's check)
      const rules = await fetch("/api/v1/games/rules", { headers: h }).then(j);
      for (const g of rules.games ?? []) await fetch("/api/v1/games/rules/accept", { method: "POST", headers: h, body: JSON.stringify({ game: g.game, version: g.version }) });
      return { token: v.accessToken };
    },
    `p2net06.${key}.${run}@example.test`,
    `net06${key}${run}`,
  );
  return { ctx, page, token: out.token, key };
}
const text = (page) => page.evaluate(() => document.body.innerText);
async function waitText(page, re, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(await text(page).catch(() => ""))) return true;
    await sleep(400);
  }
  return false;
}
/**
 * the hall scene is up and connected (QA hooks are there) and stays so for 4 s: the dev server sometimes reloads a
 * freshly opened page once while it compiles (a page that was "in" a moment ago is a new document then)
 */
async function inHall(page, ms = 90000) {
  const t0 = Date.now();
  let since = 0;
  while (Date.now() - t0 < ms) {
    const ok = await page.evaluate(() => !!window.__gkRoomQA?.layout && !!window.__gkNet?.().joined).catch(() => false);
    if (!ok) since = 0;
    else if (!since) since = Date.now();
    else if (Date.now() - since > 4000) return true;
    await sleep(500);
  }
  return false;
}
const clickText = (page, re) =>
  page.evaluate((src) => {
    const r = new RegExp(src);
    const b = [...document.querySelectorAll("button")].find((x) => r.test(x.textContent ?? ""));
    b?.click();
    return !!b;
  }, re.source);
async function both(page, name) {
  await page.screenshot({ path: `${SHOTS}${name}-1280x720.png` });
  // (a mobile viewport reloads the page: wait for the hall again — itself a reload the hold covers)
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await inHall(page);
  await sleep(2500);
  await page.screenshot({ path: `${SHOTS}${name}-phone-844x390.png` });
  await page.setViewport({ width: 1280, height: 720 });
  await inHall(page);
  await sleep(2500);
}
const place = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("gk-place") ?? "null"));

const A = await person("a");
const B = await person("b");
check("signed in both", !!A.token && !!B.token);

// ---------------------------------------------------------------- 1. Ludo table: reload → same chair
await A.page.goto(`${WEB}/room/ludo`, { waitUntil: "domcontentloaded" });
check("A in the Ludo Lounge", await inHall(A.page));
await sleep(2500);
await qa(A.page, (s) => window.__gkRoomQA.sit(s), SEAT);
check(`A seated at table ${TN}`, await waitText(A.page, new RegExp(`Table ${TN} · Ludo`), 15000));
await sleep(1500);
const ref = await place(A.page);
check("place remembered (no secrets)", ref?.place === SEAT && ref.kind === "seat" && !JSON.stringify(ref).includes(A.token.slice(0, 20)), JSON.stringify(ref));
await A.page.reload({ waitUntil: "domcontentloaded" });
check("after the reload: back in the hall", await inHall(A.page));
check(`after the reload: on the same chair (seat panel Table ${TN})`, await waitText(A.page, new RegExp(`Table ${TN} · Ludo`), 30000));
await sleep(1500);
await both(A.page, "ludo-after-reload");

// ---------------------------------------------------------------- 2. tab closed → the other player sees Held; reopen from the plaza
await B.page.goto(`${WEB}/room/ludo`, { waitUntil: "domcontentloaded" });
check("B in the Ludo Lounge", await inHall(B.page));
await sleep(2500);
await A.page.close();
const heldSeen = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const t = await B.page.evaluate((n) => [...document.querySelectorAll("button[title]")].map((b) => b.title).find((x) => x.startsWith(`Table ${n} ·`)) ?? "", TN).catch(() => "");
    if (/Held · returning \(0:[0-5]\d\)/.test(t)) return t;
    await sleep(400);
  }
  return "";
})();
check(`B sees table ${TN} as Held · returning (m:ss)`, !!heldSeen, heldSeen || B.page.url());
// walk B up to table 1: the near label reads Held too
await qa(B.page, (id) => {
  const t = window.__gkRoomQA.layout.tables.find((x) => x.id === id);
  window.__gkRoomQA.teleport(t.x + t.w / 2 + 1.2, t.z, -Math.PI / 2);
}, `t${TI}`);
await sleep(1500);
await both(B.page, "ludo-held-seen-by-other");
const bSit = await qa(B.page, (s) => window.__gkRoomQA.sit(s), SEAT);
await sleep(1500);
check("B can't take the held chair", bSit && !new RegExp(`Table ${TN} · Ludo`).test(await text(B.page)));
A.page = await A.ctx.newPage();
await A.page.setViewport({ width: 1280, height: 720 });
await A.page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded" });
const t0 = Date.now();
while (Date.now() - t0 < 30000 && !A.page.url().includes("/room/ludo")) await sleep(300);
check("reopened on the plaza → sent back to the Ludo Lounge", A.page.url().includes("/room/ludo"), A.page.url());
check("… and on the same chair", (await inHall(A.page)) && (await waitText(A.page, new RegExp(`Table ${TN} · Ludo`), 30000)));
await sleep(1200);
await A.page.screenshot({ path: `${SHOTS}ludo-back-from-plaza-1280x720.png` });
// standing up releases at once and forgets the place
await clickText(A.page, /Stand up/);
await sleep(1500);
check("Stand up clears the remembered place", (await place(A.page)) === null);

// ---------------------------------------------------------------- 3. Boxing ring: claim → reload → back at the ring, still waiting
async function toRing(p, id) {
  await qa(p.page, (rid) => {
    const r = window.__gkRingGoto.route(rid);
    window.__gkRoomQA.teleport(r.steps.x, r.steps.z, 0);
  }, id);
  await sleep(1500);
}
await A.page.goto(`${WEB}/room/boxing`, { waitUntil: "domcontentloaded" });
check("A in the Boxing hall", await inHall(A.page));
await sleep(3000);
let claimed = false;
for (let i = 0; i < 4 && !claimed; i++) {
  await toRing(A, RING);
  await clickText(A.page, /^.*Wait for an opponent$/);
  await sleep(600);
  await clickText(A.page, /^Friendly$/);
  await sleep(300);
  await clickText(A.page, /Wait for an opponent/);
  claimed = await waitText(A.page, /Waiting for an opponent…/, 8000);
  if (!claimed) console.log("  (claim retry)", (await text(A.page)).match(/Ring \d+ · \w+/)?.[0] ?? "");
}
check(`A claimed Ring ${RN}`, claimed);
await sleep(1500);
check("ring remembered", (await place(A.page))?.place === RING);
await A.page.reload({ waitUntil: "domcontentloaded" });
check("after the reload: back in the Boxing hall", await inHall(A.page));
check(`after the reload: at Ring ${RN}, still waiting`, await waitText(A.page, new RegExp(`Ring ${RN} · Waiting[\\s\\S]*Waiting for an opponent…`), 30000));
await sleep(1500);
await both(A.page, "boxing-after-reload");

// ---------------------------------------------------------------- 4. away past the hold → free for the other player, notice on return
await B.page.goto(`${WEB}/room/boxing`, { waitUntil: "domcontentloaded" });
check("B in the Boxing hall", await inHall(B.page));
await sleep(3000);
await toRing(B, RING);
await A.page.close();
check(`B sees Ring ${RN} held (prompt)`, await waitText(B.page, /Held · returning \(0:[0-5]\d\)/, 15000));
await sleep(800);
await both(B.page, "boxing-held-seen-by-other");
console.log("… waiting out the 60 s hold");
check(`after the hold: Ring ${RN} free for B`, await waitText(B.page, new RegExp(`Ring ${RN} · Free`), 75000));
await B.page.screenshot({ path: `${SHOTS}boxing-freed-1280x720.png` });
A.page = await A.ctx.newPage();
await A.page.setViewport({ width: 1280, height: 720 });
await A.page.goto(`${WEB}/room/boxing`, { waitUntil: "domcontentloaded" });
check("returning A: told the ring was released", await waitText(A.page, new RegExp(`Your place at Ring ${RN} was released after 60 s away`), 60000));
await sleep(500);
await A.page.screenshot({ path: `${SHOTS}boxing-released-notice-1280x720.png` });
check("returning A: the remembered place is gone", (await place(A.page)) === null);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.id).join(", ")}` : ""}\nscreenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
