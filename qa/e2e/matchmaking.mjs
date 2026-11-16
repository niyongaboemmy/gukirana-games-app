// P2-MM-05 browser check (docs/MATCHMAKING-V2.md): real browsers, separate accounts, separate contexts.
//   1. find an opponent: A sits at a Ludo table (25 Stars), B is on the plaza (phone) and asks Quick Play for a
//      Friendly Ludo game → both see each other searching at another stake → A widens (asked first) → Opponent found
//      on both → both accept → B is taken into the Ludo Lounge and walked to A's table → the match starts for both.
//   2. challenge across rooms: C in the Igisoro Court (phone), D on the plaza challenges C from the "online" list →
//      C sees the challenge card → accepts → both are walked to the same Igisoro table → the match starts.
//   3. decline and expiry: E and F on the plaza; E challenges F → F declines → E is told; again → nobody answers →
//      both told it expired.
//   4. Quick Play guided flow: G on the plaza → Quick Play → Igisoro, Practice vs AI → walked into the court, to the
//      nearest free table, seated → the practice game opens.
// Stack from env (defaults: web :3947, api :4920). Chrome at /Applications/Google Chrome.app. Screenshots (desktop
// 1280×720, phone 844×390) → $QA_SHOTS (default docs/QA/matchmaking).
//   node qa/e2e/matchmaking.mjs            (--skip-expiry skips the 45 s expiry wait, --only=1,4 runs some)
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.QA_WEB ?? "http://localhost:3947";
const SHOTS = process.env.QA_SHOTS ?? join(dirname(fileURLToPath(import.meta.url)), "../../docs/QA/matchmaking");
mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));
const skipExpiry = process.argv.includes("--skip-expiry");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (id, ok, detail = "") => {
  results.push({ id, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? `  — ${detail}` : ""}`);
  return !!ok;
};
const run = Date.now().toString(36).slice(-5);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox", "--use-gl=angle", "--window-size=1280,720"] });

const DESK = { width: 1280, height: 720 };
const PHONE = { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

async function person(key, view = DESK) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(view);
  if (view === PHONE) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded" });
  const name = `${key}${run}`;
  const out = await page.evaluate(
    async (identifier, username) => {
      const j = (r) => r.json();
      const req = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier }) }).then(j);
      const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, code: req.devCode }) }).then(j);
      const h = { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` };
      await fetch("/api/v1/me", { method: "PATCH", headers: h, body: JSON.stringify({ username }) });
      // every rules card accepted up front (P2-NET-05's card is its own check)
      const rules = await fetch("/api/v1/games/rules", { headers: h }).then(j);
      for (const g of rules.games ?? []) await fetch("/api/v1/games/rules/accept", { method: "POST", headers: h, body: JSON.stringify({ game: g.game, version: g.version }) });
      return { token: v.accessToken };
    },
    `mm05.${key}.${run}@example.test`,
    name,
  );
  return { ctx, page, token: out.token, key, name, view };
}

const text = (page) => page.evaluate(() => document.body.innerText).catch(() => "");
async function waitText(page, re, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(await text(page))) return true;
    await sleep(300);
  }
  return false;
}
async function waitUrl(page, re, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(page.url())) return true;
    await sleep(300);
  }
  return false;
}
/** connected to the world room for 3 s (the dev server may reload a fresh page once while it compiles) */
async function joined(page, ms = 120000, hall = false) {
  const t0 = Date.now();
  let since = 0;
  while (Date.now() - t0 < ms) {
    const ok = await page.evaluate((hall) => !!window.__gkNet?.().joined && (!hall || !!window.__gkRoomQA?.layout), hall).catch(() => false);
    if (!ok) since = 0;
    else if (!since) since = Date.now();
    else if (Date.now() - since > 3000) return true;
    await sleep(400);
  }
  return false;
}
/** click the last visible button whose text matches */
const click = (page, re) =>
  page.evaluate((src) => {
    const r = new RegExp(src);
    const b = [...document.querySelectorAll("button, a")].filter((x) => r.test((x.textContent ?? "").trim()) && x.getClientRects().length && !x.disabled).pop();
    b?.click();
    return !!b;
  }, re.source);
async function clickWhen(page, re, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await click(page, re)) return true;
    await sleep(300);
  }
  return false;
}
const shot = (p, name) => p.page.screenshot({ path: join(SHOTS, `${name}-${p.view === PHONE ? "phone-844x390" : "desktop-1280x720"}.jpg`), type: "jpeg", quality: 72 }).catch((e) => console.log("  (shot failed)", name, e.message));
const sitAt = (p, seat) => p.page.evaluate((s) => window.__gkRoomQA.sit(s), seat);

// ---------------------------------------------------------------- 1. find an opponent (stake mismatch → widen → found → walk → start)
if (want(1)) {
  const A = await person("mma");
  const B = await person("mmb", PHONE);
  await A.page.goto(`${WEB}/room/ludo`, { waitUntil: "domcontentloaded" });
  check("1.A in the Ludo Lounge", await joined(A.page, 120000, true));
  await sleep(1500);
  const TA = Number(process.env.QA_TABLE ?? (Date.now() % 8) + 4);
  await sitAt(A, `t${TA}s0`);
  check(`1.A seated at table ${TA + 1}`, await waitText(A.page, new RegExp(`Table ${TA + 1} · Ludo`), 15000));
  await sleep(1200);
  await shot(A, "01-seat-panel");
  check("1.seat panel: accurate guidance, no misleading tip", /pairs you with anyone looking for Ludo/.test(await text(A.page)) && !/stand near another player/.test(await text(A.page)));
  // A: 25 Stars (the default) → Find an opponent
  check("1.A presses Find an opponent", await clickWhen(A.page, /^Find an opponent$/));
  check("1.A sees the search card", await waitText(A.page, /Looking for a Ludo opponent/, 10000));
  // B on the plaza (phone): Quick Play → Ludo → Find an opponent → Friendly
  await B.page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded" });
  check("1.B on the plaza", await joined(B.page));
  await sleep(2000);
  await B.page.evaluate(() => window.dispatchEvent(new Event("gk:quick-match")));
  check("1.B Quick Play sheet open", await waitText(B.page, /how do you want to play\?/i, 10000));
  await click(B.page, /^Ludo$/);
  await sleep(600);
  await click(B.page, /^Find an opponentAnyone looking/);
  await sleep(300);
  await click(B.page, /^Friendly$/);
  await sleep(1500);
  await shot(B, "02-quick-play-sheet");
  check("1.B Quick Play shows the hall and live tables", /hall: ludo lounge/i.test(await text(B.page)) && /Nearest free one is picked/.test(await text(B.page)));
  check("1.B Go and find an opponent", await click(B.page, /^Go and find an opponent$/));
  check("1.B searching (Friendly)", await waitText(B.page, /Looking for a Ludo opponent/, 15000));
  check("1.A sees someone looking at another stake", await waitText(A.page, /1 looking at other stakes/, 15000));
  await shot(A, "03-searching-other-stake");
  // (B's Quick Play trip takes B into the Ludo Lounge while searching: shoot once the hall is up)
  if (await joined(B.page, 60000, true)) await sleep(1500);
  await shot(B, "03-searching-other-stake");
  // after 30 s nobody at 25: A is asked whether to widen
  check("1.A asked to widen the stake (after 30 s)", await waitText(A.page, /Also accept/, 45000));
  await shot(A, "04-widen-offer");
  await click(A.page, /^Yes, widen$/);
  check("1.A: Opponent found", await waitText(A.page, /Opponent found/, 15000));
  check("1.B: Opponent found", await waitText(B.page, /Opponent found/, 15000));
  await shot(A, "05-opponent-found");
  await shot(B, "05-opponent-found");
  check("1.found card names the opponent", new RegExp(`${B.name} wants to play Ludo`).test(await text(A.page)));
  await click(A.page, /^Accept$/);
  await sleep(500);
  check("1.A waiting for B to accept", await waitText(A.page, /Accepted\. Waiting for/, 5000));
  await click(B.page, /^Accept$/);
  check("1.B taken into the Ludo Lounge", await waitUrl(B.page, /\/room\/ludo/, 30000));
  await sleep(1500);
  await shot(B, "06-walking-to-table");
  check("1.B told where to go", /Go to Table \d+ · Ludo Lounge/.test(await text(B.page)) || /\/match\//.test(B.page.url()));
  const aMatch = await waitUrl(A.page, /\/match\//, 90000);
  const bMatch = await waitUrl(B.page, /\/match\//, 30000);
  check("1.both reach the table and the match starts", aMatch && bMatch, `${A.page.url()} | ${B.page.url()}`);
  check("1.the same match for both", aMatch && A.page.url().split("?")[0] === B.page.url().split("?")[0]);
  check("1.at the widened shared stake (Friendly)", /stake=0/.test(A.page.url()));
  await sleep(2500);
  await shot(A, "07-match-started");
  await shot(B, "07-match-started");
  await A.ctx.close();
  await B.ctx.close();
}

// ---------------------------------------------------------------- 2. challenge across rooms (plaza → Igisoro Court)
if (want(2)) {
  const C = await person("mmc", PHONE);
  const D = await person("mmd");
  await C.page.goto(`${WEB}/room/igisoro`, { waitUntil: "domcontentloaded" });
  await D.page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded" });
  check("2.C in the Igisoro Court", await joined(C.page, 120000, true));
  check("2.D on the plaza", await joined(D.page));
  await sleep(2000);
  // D: Quick Play → Igisoro → Challenge someone → the challenge sheet lists C online elsewhere
  await D.page.evaluate(() => window.dispatchEvent(new Event("gk:quick-match")));
  await waitText(D.page, /how do you want to play\?/i, 10000);
  await click(D.page, /^Igisoro$/);
  await sleep(400);
  await click(D.page, /^Challenge someonePick a person/);
  await click(D.page, /^Choose who to challenge$/);
  check("2.D challenge sheet lists C (online elsewhere)", await waitText(D.page, new RegExp(`(?:Online elsewhere|ONLINE ELSEWHERE)[\\s\\S]*${C.name}`), 10000));
  await click(D.page, new RegExp(`^${C.name}`));
  await sleep(300);
  await click(D.page, /^Friendly$/);
  await sleep(800);
  await shot(D, "08-challenge-sheet");
  check("2.D sends the challenge", await click(D.page, /^Send challenge$/));
  check("2.D waits for the answer", await waitText(D.page, new RegExp(`Waiting for ${C.name}`), 10000));
  check("2.C sees the challenge (in another room)", await waitText(C.page, new RegExp(`${D.name} challenges you`), 10000));
  await sleep(500);
  await shot(C, "09-challenge-received");
  await shot(D, "09-challenge-waiting");
  check("2.challenge card shows game, stake and place", /Igisoro · Friendly/.test(await text(C.page)));
  await click(C.page, /^Accept$/);
  check("2.D told it was accepted / walked into the Igisoro Court", await waitUrl(D.page, /\/room\/igisoro/, 30000));
  await sleep(2500);
  await shot(D, "10-walking-to-table");
  await shot(C, "10-walking-to-table");
  const cm = await waitUrl(C.page, /\/match\//, 90000);
  const dm = await waitUrl(D.page, /\/match\//, 30000);
  check("2.both walk to the same table and the game starts", cm && dm && C.page.url().split("?")[0] === D.page.url().split("?")[0], `${C.page.url()} | ${D.page.url()}`);
  await sleep(2000);
  await shot(C, "11-challenge-match");
  await C.ctx.close();
  await D.ctx.close();
}

// ---------------------------------------------------------------- 3. decline + expiry
if (want(3)) {
  const E = await person("mme");
  const F = await person("mmf");
  for (const p of [E, F]) await p.page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded" });
  check("3.E and F on the plaza", (await joined(E.page)) && (await joined(F.page)));
  await sleep(2000);
  const challenge = async () => {
    await E.page.evaluate(() => window.dispatchEvent(new Event("gk:quick-match")));
    await waitText(E.page, /how do you want to play\?/i, 10000);
    await click(E.page, /^Ludo$/);
    await click(E.page, /^Challenge someonePick a person/);
    await click(E.page, /^Choose who to challenge$/);
    await waitText(E.page, new RegExp(F.name), 10000);
    await click(E.page, new RegExp(`^${F.name}`));
    await sleep(300);
    await click(E.page, /^Friendly$/);
    await sleep(300);
    return click(E.page, /^Send challenge$/);
  };
  check("3.E challenges F", await challenge());
  check("3.F sees it", await waitText(F.page, new RegExp(`${E.name} challenges you`), 10000));
  await click(F.page, /^Decline$/);
  check("3.E told F said no", await waitText(E.page, new RegExp(`${F.name} said no this time`), 10000));
  await shot(E, "12-declined");
  if (!skipExpiry) {
    await sleep(1500);
    check("3.E challenges F again", await challenge());
    check("3.F sees the second one", await waitText(F.page, new RegExp(`${E.name} challenges you`), 10000));
    check("3.nobody answers: E told it expired", await waitText(E.page, new RegExp(`No answer from ${F.name}`), 60000));
    check("3.F's card is gone", !new RegExp(`${E.name} challenges you`).test(await text(F.page)));
    await shot(E, "13-expired");
  }
  await E.ctx.close();
  await F.ctx.close();
}

// ---------------------------------------------------------------- 4. Quick Play guided flow → practice
if (want(4)) {
  const G = await person("mmg");
  await G.page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded" });
  check("4.G on the plaza", await joined(G.page));
  await sleep(2000);
  check("4.Quick Play in the HUD", await click(G.page, /^Quick Play$/));
  check("4.sheet open", await waitText(G.page, /how do you want to play\?/i, 10000));
  await click(G.page, /^Igisoro$/);
  await sleep(400);
  await click(G.page, /^Practice vs AIFree, any time/);
  await sleep(1200);
  await shot(G, "14-quick-play-practice");
  check("4.a free table is preselected", /table: \d+/i.test(await text(G.page)));
  check("4.Go and practise", await click(G.page, /^Go and practise$/));
  check("4.walked into the Igisoro Court", await waitUrl(G.page, /\/room\/igisoro/, 30000));
  await sleep(3000);
  await shot(G, "15-quick-play-walking");
  check("4.seated → the practice game opens", await waitUrl(G.page, /\/play\/igisoro/, 90000), G.page.url());
  await sleep(2000);
  await shot(G, "16-quick-play-practice-open");
  await G.ctx.close();
}

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
