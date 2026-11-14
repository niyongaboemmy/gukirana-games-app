// QA-01 PvP over the realtime protocol (two seeded players, no browser): challenge decline / accept / expiry, stake
// escrow + settlement in the ledger, quick match, daily stake limit and self-exclusion enforcement.
//   node qa/e2e/pvp.mjs            (add --no-expiry to skip the 60 s expiry wait)
import { Client } from "colyseus.js";
import { api, signIn, suite, email, RT, ADMIN_TOKEN, sleep } from "./lib.mjs";

const { check, note, done } = suite("pvp");
const adm = { "x-admin-token": ADMIN_TOKEN };
const skipExpiry = process.argv.includes("--no-expiry");

async function join(key, room = "plaza") {
  const s = key ? await signIn(email(key)) : { token: undefined };
  const c = new Client(RT);
  const r = await c.joinOrCreate(room, { token: s.token, name: key ?? "guest" });
  const inbox = [];
  r.onMessage("*", (type, msg) => inbox.push({ type, msg, at: Date.now() }));
  return { key, token: s.token, client: c, room: r, inbox, sid: r.sessionId };
}
async function next(p, type, { timeout = 8000, where = () => true } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const i = p.inbox.findIndex((m) => m.type === type && where(m.msg));
    if (i >= 0) return p.inbox.splice(i, 1)[0].msg;
    await sleep(50);
  }
  return null;
}
const stars = async (p) => (await api("/wallet", { token: p.token })).json?.stars;
const recon = async () => (await api("/admin/reports/reconciliation", { headers: adm })).json;
const summary = async () => (await api("/admin/reports/summary", { headers: adm })).json?.byCurrency?.STAR;

const a = await join("pvp1");
const b = await join("pvp2");
check("pvp.both in the same plaza room", a.room.roomId === b.room.roomId, `${a.room.roomId} / ${b.room.roomId}`);
await sleep(500);

// guest cannot challenge
const g = await join(null);
g.room.send("propose", { to: a.sid, game: "igisoro", stake: 0 });
const gf = await next(g, "proposal-failed");
check("pvp.guest cannot challenge", gf?.reason === "LOGIN_REQUIRED", JSON.stringify(gf));
await g.room.leave();

// invalid stake
a.room.send("propose", { to: b.sid, game: "igisoro", stake: 30 });
check("pvp.invalid stake refused", (await next(a, "proposal-failed"))?.reason === "INVALID_PROPOSAL");
a.room.send("propose", { to: a.sid, game: "igisoro", stake: 25 });
check("pvp.cannot challenge yourself", (await next(a, "proposal-failed"))?.reason === "PLAYER_UNAVAILABLE");

// decline
a.room.send("propose", { to: b.sid, game: "igisoro", stake: 50 });
const p1 = await next(b, "proposal");
check("pvp.challenge delivered", p1?.stake === 50 && p1?.from?.name === "qa_pvp1", JSON.stringify(p1));
check("pvp.challenger sees proposal-sent", !!(await next(a, "proposal-sent")));
b.room.send("proposal-respond", { id: p1?.id, accept: false });
const closed = await next(a, "proposal-closed");
check("pvp.decline reaches challenger", closed?.reason === "DECLINED", JSON.stringify(closed));

// accept → escrow
const sa0 = await stars(a);
const sb0 = await stars(b);
const r0 = await summary();
a.room.send("propose", { to: b.sid, game: "igisoro", stake: 50 });
const p2 = await next(b, "proposal");
b.room.send("proposal-respond", { id: p2?.id, accept: true });
const readyA = await next(a, "match-ready", { timeout: 10000 });
const readyB = await next(b, "match-ready", { timeout: 10000 });
check("pvp.accept → match-ready for both", !!readyA && readyA?.roomId === readyB?.roomId, JSON.stringify(readyA));
const sa1 = await stars(a);
const sb1 = await stars(b);
check("pvp.stake escrowed from both", sa0 - sa1 === 50 && sb0 - sb1 === 50, `pvp1 ${sa0}→${sa1}, pvp2 ${sb0}→${sb1}`);
const r1 = await summary();
check("pvp.escrow outstanding = pot", (r1?.escrowOutstanding ?? 0) - (r0?.escrowOutstanding ?? 0) === 100, `escrow ${r0?.escrowOutstanding}→${r1?.escrowOutstanding}`);

// play: both join the match room; pvp2 resigns → pvp1 wins the pot
if (readyA) {
  const ma = await new Client(RT).joinById(readyA.roomId, { token: a.token });
  const mb = await new Client(RT).joinById(readyA.roomId, { token: b.token });
  const ia = [];
  const ib = [];
  ma.onMessage("*", (t, m) => ia.push({ type: t, msg: m }));
  mb.onMessage("*", (t, m) => ib.push({ type: t, msg: m }));
  // a stranger cannot join the match
  let stranger = "joined";
  try {
    const sTok = (await signIn(email("lv1"))).token;
    await new Client(RT).joinById(readyA.roomId, { token: sTok });
  } catch (e) {
    stranger = String(e.message ?? e);
  }
  check("pvp.non-player cannot join a match room", stranger !== "joined", stranger);
  await sleep(1500);
  // init/state can arrive before the catch-all handler is attached (test-tool timing) — informational only
  note("pvp.match messages seen", ia.map((m) => m.type).join(",") || "(init/state arrived before the handler)");
  mb.send("resign");
  const t0 = Date.now();
  while (!ia.some((m) => m.type === "result") && Date.now() - t0 < 10000) await sleep(100);
  const res = ia.find((m) => m.type === "result")?.msg;
  check("pvp.resign → result", !!res, JSON.stringify(res)?.slice(0, 300));
  await sleep(1000);
  const sa2 = await stars(a);
  const sb2 = await stars(b);
  note("pvp.settlement balances", `pvp1 ${sa1}→${sa2} (net ${sa2 - sa0}), pvp2 ${sb1}→${sb2} (net ${sb2 - sb0})`);
  check("pvp.winner gets the pot (Stars, no fee)", sa2 - sa1 === 100 && sb2 === sb1, `pvp1 +${sa2 - sa1}, pvp2 +${sb2 - sb1}`);
  const r2 = await summary();
  check("pvp.escrow released after settle", (r2?.escrowOutstanding ?? 0) === (r0?.escrowOutstanding ?? 0), `escrow ${r2?.escrowOutstanding}`);
  check("money.balances are integers", [sa2, sb2].every(Number.isSafeInteger));
  const hist = (await api("/wallet", { token: a.token })).json?.history?.map((h) => `${h.type}:${h.amount}`) ?? [];
  check("pvp.activity shows stake + win", hist.some((h) => h.startsWith("stake_lock:-50")) && hist.some((h) => h.startsWith("settle:")), hist.slice(0, 5).join(","));
  await ma.leave().catch(() => undefined);
  await mb.leave().catch(() => undefined);
}

// quick match (ludo, 25)
{
  const s0 = await summary();
  a.room.send("quickmatch-join", { game: "ludo", stake: 25 });
  const w = await next(a, "quickmatch");
  check("quickmatch.first waits", w?.status === "waiting", JSON.stringify(w));
  b.room.send("quickmatch-join", { game: "ludo", stake: 25 });
  const qa = await next(a, "match-ready", { timeout: 10000 });
  const qb = await next(b, "match-ready", { timeout: 10000 });
  check("quickmatch.pairs both", !!qa && qa?.roomId === qb?.roomId, JSON.stringify(qa));
  if (qa) {
    const ma = await new Client(RT).joinById(qa.roomId, { token: a.token });
    const mb = await new Client(RT).joinById(qa.roomId, { token: b.token });
    const ib = [];
    mb.onMessage("*", (t, m) => ib.push({ type: t, msg: m }));
    ma.onMessage("*", () => undefined);
    await sleep(1200);
    await ma.leave(true); // consented leave = forfeit
    const t0 = Date.now();
    while (!ib.some((m) => m.type === "result") && Date.now() - t0 < 10000) await sleep(100);
    check("quickmatch.match room sends init + state", ib.some((m) => m.type === "init") || ib.some((m) => m.type === "state"), ib.map((m) => m.type).join(","));
  check("quickmatch.leaving forfeits → result", ib.some((m) => m.type === "result"), ib.map((m) => m.type).join(","));
    await mb.leave().catch(() => undefined);
    await sleep(800);
    const s1 = await summary();
    check("quickmatch.escrow released", (s1?.escrowOutstanding ?? 0) === (s0?.escrowOutstanding ?? 0), `${s0?.escrowOutstanding}→${s1?.escrowOutstanding}`);
  }
  a.room.send("quickmatch-join", { game: "pool", stake: 0 });
  await next(a, "quickmatch");
  a.room.send("quickmatch-leave");
  check("quickmatch.leave queue → idle", (await next(a, "quickmatch", { where: (m) => m.status === "idle" }))?.status === "idle");
}

// responsible play: daily stake limit (100) and a break
{
  const lim = await join("limit");
  const brk = await join("break");
  await sleep(400);
  // FIX-A (GAP-011): limits / breaks are checked when the challenge is made; (GAP-005) only the player concerned
  // hears the precise reason, the other side hears OPPONENT_CANT_PLAY.
  lim.room.send("propose", { to: a.sid, game: "igisoro", stake: 200 });
  const cl = await next(lim, "proposal-failed", { timeout: 8000 });
  check("limits.daily stake limit enforced", cl?.reason === "DAILY_LIMIT_REACHED", JSON.stringify(cl));
  check("limits.refused when the challenge is made (opponent not bothered)", !(await next(a, "proposal", { timeout: 1000 })));
  brk.room.send("propose", { to: a.sid, game: "igisoro", stake: 25 });
  const cb = await next(brk, "proposal-failed", { timeout: 8000 });
  check("limits.self-exclusion blocks staked games", cb?.reason === "ON_A_BREAK", JSON.stringify(cb));
  a.room.send("propose", { to: brk.sid, game: "igisoro", stake: 25 });
  const ca = await next(a, "proposal-failed", { timeout: 8000 });
  check("limits.challenger told only 'they can't play right now'", ca?.reason === "OPPONENT_CANT_PLAY", JSON.stringify(ca));
  a.room.send("propose", { to: lim.sid, game: "igisoro", stake: 200 });
  const cal = await next(a, "proposal-failed", { timeout: 8000 });
  check("limits.limit not disclosed to the challenger", cal?.reason === "OPPONENT_CANT_PLAY", JSON.stringify(cal));
  brk.room.send("quickmatch-join", { game: "pool", stake: 25 });
  const qbErr = await next(brk, "quickmatch", { where: (m) => m.status === "error", timeout: 8000 });
  check("limits.break player cannot quick-match staked", qbErr?.reason === "ON_A_BREAK", JSON.stringify(qbErr));
  b.room.send("quickmatch-join", { game: "pool", stake: 25 });
  const bw = await next(b, "quickmatch", { timeout: 3000 });
  check("limits.opponent never paired with / told about the break", bw?.status === "waiting" && !JSON.stringify(b.inbox).includes("ON_A_BREAK"), JSON.stringify(bw));
  b.room.send("quickmatch-leave");
  await next(b, "quickmatch", { where: (m) => m.status === "idle", timeout: 3000 });
  // free games remain allowed on a break
  brk.room.send("propose", { to: a.sid, game: "igisoro", stake: 0 });
  const pf = await next(a, "proposal");
  a.room.send("proposal-respond", { id: pf?.id, accept: true });
  const fr = await next(brk, "match-ready", { timeout: 8000 });
  check("limits.free game allowed on a break", !!fr, JSON.stringify(fr));
  await lim.room.leave();
  await brk.room.leave();
}

// a player suspended while connected: still in the room? can they still stake into a match?
{
  a.inbox.length = 0; // the free game above also sent pvp1 a match-ready: only count what happens from here
  const sus = await join("lv30");
  await sleep(400);
  const sid = (await api("/console/users?q=lv30", { headers: adm })).json?.items?.[0]?.id;
  const sr = await api(`/console/users/${sid}/status`, { method: "POST", headers: adm, body: { status: "suspended", reason: "QA: suspended while connected" } });
  check("suspension.setup: lv30 suspended", sr.status === 200 && sr.json?.status === "suspended", `${sr.status} ${JSON.stringify(sr.json)}`);
  await sleep(1500);
  const kicked = sus.inbox.some((m) => /kick|suspend|removed/i.test(m.type)) || !sus.room.connection.isOpen;
  check("suspension.connected player is removed from the world", kicked, `still connected=${sus.room.connection.isOpen}`);
  sus.room.send("chat", { text: "suspended but still talking", scope: "room" });
  const heard = await next(a, "chat", { timeout: 3000, where: (m) => /suspended but still talking/.test(m.text) });
  check("suspension.suspended player can no longer chat", !heard, heard ? "chat delivered to others" : "");
  const before = await stars(a);
  sus.room.send("propose", { to: a.sid, game: "igisoro", stake: 25 });
  const ps = await next(a, "proposal", { timeout: 3000 });
  if (ps) a.room.send("proposal-respond", { id: ps.id, accept: true });
  const mr = await next(a, "match-ready", { timeout: 5000 });
  check("suspension.suspended player cannot be staked into a match", !mr, mr ? `match created ${mr.matchId}; pvp1 stake locked ${before}→${await stars(a)}` : "");
  if (mr) {
    const m1 = await new Client(RT).joinById(mr.roomId, { token: a.token });
    m1.onMessage("*", () => undefined);
    await sleep(800);
    m1.send("resign");
    await sleep(1500);
    await m1.leave().catch(() => undefined);
  }
  await api(`/console/users/${sid}/status`, { method: "POST", headers: adm, body: { status: "active", reason: "QA: restore" } });
  if (sus.room.connection.isOpen) await sus.room.leave().catch(() => undefined); // closed by the server: leaving again never resolves
}

// expiry (60 s)
if (!skipExpiry) {
  a.inbox.length = 0;
  a.room.send("propose", { to: b.sid, game: "pool", stake: 25 });
  const pe = await next(b, "proposal");
  const ex = await next(a, "proposal-closed", { timeout: 66000, where: (m) => m.id === pe?.id });
  check("pvp.challenge expires after 60 s", ex?.reason === "EXPIRED", JSON.stringify(ex));
} else note("pvp.expiry", "skipped (--no-expiry)");

// ledger invariant after all PvP
const rc = await recon();
check("money.ledger balanced after PvP", rc?.ok === true && rc?.currencyNets?.every((c) => c.net === 0), JSON.stringify(rc));
await a.room.leave();
await b.room.leave();
done();
process.exit(0);
