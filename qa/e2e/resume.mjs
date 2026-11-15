// P2-NET-05 browser check: rules card, reload resume, resume from another page, offline → reconnecting + opponent
// waiting countdown → forfeit (staked Ludo, ledger checked). Stack ports from env (defaults: web :3600, api :4600,
// realtime :2867). Needs Chrome at /Applications/Google Chrome.app; screenshots go to $QA_OUT (default $TMPDIR/gk-qa).
//   node qa/e2e/resume.mjs
import puppeteer from "puppeteer-core";
import { Client } from "colyseus.js";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB = process.env.QA_WEB ?? "http://localhost:3600";
const API = process.env.QA_API ?? "http://127.0.0.1:4600";
const RT = process.env.QA_RT ?? "ws://localhost:2867";
const SHOTS = join(process.env.QA_OUT ?? join(tmpdir(), "gk-qa"), "p2-net-05") + "/";
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (id, ok, detail = "") => {
  results.push({ id, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? `  — ${detail}` : ""}`);
};
const adm = { "x-admin-token": "dev-admin-service-token", "x-admin-user": "qa", "content-type": "application/json" };
const run = Date.now().toString(36).slice(-5);

// shorter wait for the check (admin-tunable): 30 s
const cur = await (await fetch(`${API}/console/games`, { headers: adm })).json();
const ludo = cur.find((g) => g.game === "ludo");
await fetch(`${API}/console/games/ludo`, { method: "PUT", headers: adm, body: JSON.stringify({ settings: { ...ludo.settings, reconnectSeconds: 30 }, reason: "P2-NET-05 browser check: 30 s wait" }) });

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox", "--use-gl=angle"] });

async function person(key) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded" });
  const ident = `p2net05.${key}.${run}@example.test`;
  const out = await page.evaluate(async (identifier, username) => {
    const j = (r) => r.json();
    const req = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier }) }).then(j);
    const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, code: req.devCode }) }).then(j);
    const h = { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` };
    await fetch("/api/v1/me", { method: "PATCH", headers: h, body: JSON.stringify({ username }) });
    await fetch("/api/v1/wallet/daily-stars", { method: "POST", headers: h });
    return { token: v.accessToken };
  }, ident, `net05${key}${run}`);
  return { ctx, page, token: out.token, key };
}
const gotIt = (page) => page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Got it")?.click());
const authed = (p, path, init = {}) => fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, ...(init.headers ?? {}) } }).then((r) => r.json());
async function plaza(p) {
  const r = await new Client(RT).joinOrCreate("plaza", { token: p.token, name: p.key });
  const inbox = [];
  r.onMessage("*", (type, msg) => inbox.push({ type, msg }));
  return { r, inbox, next: async (t, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const i = inbox.findIndex((m) => m.type === t); if (i >= 0) return inbox.splice(i, 1)[0].msg; await sleep(50); } return null; } };
}

const A = await person("a");
const B = await person("b");
check("signed in both", !!A.token && !!B.token);

// 1. the server refuses a live match without the rules accepted
const pa = await plaza(A);
const pb = await plaza(B);
await sleep(400);
pa.r.send("propose", { to: pb.r.sessionId, game: "ludo", stake: 25 });
const refused = await pa.next("proposal-failed");
check("no rules accepted → challenge refused RULES_NOT_ACCEPTED", refused?.reason === "RULES_NOT_ACCEPTED", JSON.stringify(refused));

// 2. the rules card (practice page shows it once per version): desktop + phone landscape; A accepts in the UI
await A.page.goto(`${WEB}/play/ludo`, { waitUntil: "domcontentloaded" });
await A.page.waitForSelector('[data-testid="rules-card"]', { timeout: 60000 });
await sleep(800);
await A.page.screenshot({ path: `${SHOTS}rules-card-desktop-1280x720.png` });
await A.page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
await sleep(600);
await A.page.screenshot({ path: `${SHOTS}rules-card-phone-844x390.png` });
await A.page.setViewport({ width: 1280, height: 720 });
const disabled = await A.page.$eval('[data-testid="rules-card"] .pbtn-primary', (b) => b.disabled);
check("Accept disabled until ticked", disabled === true);
await A.page.click('[data-testid="rules-card"] input[type=checkbox]');
await A.page.click('[data-testid="rules-card"] .pbtn-primary');
await sleep(800);
const stA = await authed(A, "/games/rules");
check("A's acceptance stored by the API (via the card)", stA.games.find((g) => g.game === "ludo")?.accepted === true);
await authed(B, "/games/rules/accept", { method: "POST", body: JSON.stringify({ game: "ludo", version: stA.games.find((g) => g.game === "ludo").version }) });

// 3. a staked Ludo match
const starsA0 = (await authed(A, "/wallet")).stars;
const starsB0 = (await authed(B, "/wallet")).stars;
pa.r.send("propose", { to: pb.r.sessionId, game: "ludo", stake: 25 });
const prop = await pb.next("proposal");
pb.r.send("proposal-respond", { id: prop?.id, accept: true });
const ready = await pa.next("match-ready", 10000);
check("match created after both accepted the rules", !!ready?.roomId, JSON.stringify(ready));
const roomId = ready.roomId;
const url = `${WEB}/match/${roomId}?game=ludo&stake=25`;
await Promise.all([A.page.goto(url, { waitUntil: "domcontentloaded" }), B.page.goto(url, { waitUntil: "domcontentloaded" })]);
await sleep(6000);
await gotIt(A.page);
await gotIt(B.page);
await sleep(500);
const active = await authed(B, "/games/active");
check("API knows the live match and its room (resume)", active.match?.roomId === roomId, JSON.stringify(active.match));

// first move (a side session of whoever is on turn rolls once, then leaves; the browsers stay seated)
async function side(p) {
  const r = await new Client(RT).joinById(roomId, { token: p.token, clientSeed: "abcdef0123456789" });
  const box = [];
  r.onMessage("*", (type, msg) => box.push({ type, msg }));
  r.send("sync");
  await sleep(500);
  return { r, last: (t) => box.filter((m) => m.type === t).at(-1)?.msg };
}
const meA = await authed(A, "/me");
const meB = await authed(B, "/me");
let obs = await side(A);
let turn = obs.last("state")?.turn;
const onTurn = turn === meA.id ? A : B;
if (onTurn === B) {
  await obs.r.leave(true);
  obs = await side(B);
}
obs.r.send("intent", { type: "roll" });
await sleep(800);
const st1 = obs.last("state");
check("first move made (roll)", st1?.started === true, `turn ${st1?.turn === meA.id ? "A" : "B"}`);
await obs.r.leave(true);
await sleep(500);

// 4. reload A mid-game: back in the same match, same state
const hashBefore = st1?.hash;
await A.page.reload({ waitUntil: "domcontentloaded" });
await sleep(6000);
await gotIt(A.page);
await sleep(500);
check("reload keeps the URL (same match)", A.page.url().includes(roomId));
const after = await side(B);
check("state after the reload is the same (server hash)", after.last("state")?.hash === hashBefore);
check("the match goes on (no result)", !after.last("result"));
await after.r.leave(true);
await A.page.screenshot({ path: `${SHOTS}after-reload-1280x720.png` });

// 5. B opens another page: put straight back into the live match
await B.page.goto(`${WEB}/play/igisoro`, { waitUntil: "domcontentloaded" });
await B.page.waitForFunction((id) => location.pathname === `/match/${id}`, { timeout: 30000 }, roomId).catch(() => undefined);
check("another page → resumed into the live match", B.page.url().includes(`/match/${roomId}`), B.page.url());
await sleep(5000);
await gotIt(B.page);
await sleep(500);
await B.page.screenshot({ path: `${SHOTS}resumed-from-another-page-1280x720.png` });

// 6. A loses the network: A sees Reconnecting, B the waiting countdown; after the wait B wins by forfeit
await A.page.setOfflineMode(true);
await A.page.evaluate(() => window.__gkMatch?.drop());
await B.page.waitForSelector('[data-testid="opponent-waiting"]', { timeout: 15000 }).catch(() => undefined);
await A.page.waitForSelector('[data-testid="reconnecting"]', { timeout: 15000 }).catch(() => undefined);
await sleep(1500);
const waitText = await B.page.$eval('[data-testid="opponent-waiting"]', (e) => e.textContent).catch(() => "");
check("B sees the waiting countdown", /lost connection/i.test(waitText) && /\d:\d\d/.test(waitText), waitText.slice(0, 120));
const reText = await A.page.$eval('[data-testid="reconnecting"]', (e) => e.textContent).catch(() => "");
check("A sees Reconnecting with time left", /Reconnecting/.test(reText), reText);
await B.page.screenshot({ path: `${SHOTS}opponent-waiting-1280x720.png` });
await A.page.screenshot({ path: `${SHOTS}reconnecting-1280x720.png` });
await B.page.setViewport({ width: 844, height: 390 });
await sleep(800);
await B.page.screenshot({ path: `${SHOTS}opponent-waiting-phone-844x390.png` });
await B.page.setViewport({ width: 1280, height: 720 });
// wait out the 30 s
await B.page.waitForFunction(() => /didn't come back in time/i.test(document.body.innerText), { timeout: 60000 }).catch(() => undefined);
await sleep(1500);
const body = await B.page.evaluate(() => document.body.innerText);
check("forfeit win shown to B", /didn't come back in time/i.test(body));
await B.page.screenshot({ path: `${SHOTS}forfeit-result-1280x720.png` });
const starsA1 = (await authed(A, "/wallet")).stars;
const starsB1 = (await authed(B, "/wallet")).stars;
check("settled once through the ledger: B +25, A -25", starsB1 - starsB0 === 25 && starsA1 - starsA0 === -25, `A ${starsA0}→${starsA1}, B ${starsB0}→${starsB1}`);
check("no active match left", (await authed(A, "/games/active")).match === null);

await pa.r.leave();
await pb.r.leave();
await browser.close();
await fetch(`${API}/console/games/ludo`, { method: "PUT", headers: adm, body: JSON.stringify({ settings: ludo.settings, reason: "restore" }) });
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
