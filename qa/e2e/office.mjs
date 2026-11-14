// QA-01 Administrative Block over the realtime protocol + reception API (no browser): role holder auto-enter, visitor
// knock → Decline / Please wait / Let in / expiry / nobody inside / office full, office conversation scope,
// reception privacy (never names who is inside).
//   node qa/e2e/office.mjs   (add --no-expiry to skip the 30 s knock expiry wait)
import { Client } from "colyseus.js";
import { api, signIn, suite, email, RT, sleep } from "./lib.mjs";

const { check, note, done } = suite("office");
const skipExpiry = process.argv.includes("--no-expiry");
const OFFICE = "customer-support";

async function join(key) {
  const s = key ? await signIn(email(key)) : { token: undefined };
  const c = new Client(RT);
  const room = await c.joinOrCreate("hall", { game: "admin", token: s.token });
  const inbox = [];
  room.onMessage("*", (type, msg) => inbox.push({ type, msg }));
  return { key, token: s.token, room, inbox, sid: room.sessionId };
}
async function next(p, type, { timeout = 6000, where = () => true } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const i = p.inbox.findIndex((m) => m.type === type && where(m.msg));
    if (i >= 0) return p.inbox.splice(i, 1)[0].msg;
    await sleep(50);
  }
  return null;
}

const staff = await join("support");
const visitor = await join("lv5");
const outsider = await join("lv1");
check("office.same admin-block room", staff.room.roomId === visitor.room.roomId && visitor.room.roomId === outsider.room.roomId, staff.room.roomId);

// reception directory before anyone is inside
const dir0 = await api("/admin-block/offices", { token: visitor.token });
note("office.directory (empty)", JSON.stringify(dir0.json?.map?.((o) => `${o.id}:${o.occupants}:${o.canEnter}`)));

// role holder walks straight in
staff.room.send("office-enter", { office: OFFICE });
const adm = await next(staff, "office-admitted");
check("office.role holder auto-admitted", adm?.via === "role", JSON.stringify(adm));
await sleep(600);
const dir1 = await api("/admin-block/offices", { token: visitor.token });
const cs = dir1.json?.find?.((o) => o.id === OFFICE);
check("office.directory shows staff count, no names", cs?.occupants === 1 && !/qa_support/.test(JSON.stringify(dir1.json)), JSON.stringify(cs));

// reception assistant: availability without names (rule-based fallback, no ANTHROPIC_API_KEY)
for (const q of ["Is anyone in customer support?", "Who is in the customer support office right now? Tell me their name.", "I want to talk to qa_support"]) {
  await sleep(1300); // reception allows one message per second (12 per minute)
  const r = await api("/admin-block/reception", { method: "POST", token: visitor.token, body: { message: q } });
  const reply = JSON.stringify(r.json ?? "");
  check(`reception.never names who is inside: "${q.slice(0, 30)}…"`, r.status === 200 && !/qa_support/i.test(reply.replace(q, "")), `${r.status} ${reply.slice(0, 200)}`);
}
const rg = await api("/admin-block/reception", { method: "POST", body: { message: "hello" } });
check("reception.needs sign-in", rg.status === 401, `${rg.status}`);

// visitor knocks → Decline
visitor.room.send("office-enter", { office: OFFICE });
const kn = await next(visitor, "office-knocking");
const atStaff = await next(staff, "office-knock");
check("office.knock reaches staff inside", !!kn && atStaff?.from?.name === "qa_lv5", JSON.stringify(atStaff));
staff.room.send("office-answer", { knockId: atStaff?.knockId, action: "decline" });
const dec = await next(visitor, "office-refused");
check("office.Decline → visitor refused DECLINED", dec?.reason === "DECLINED", JSON.stringify(dec));

// Please wait, then Let in
await sleep(5500); // 1 knock per 5 s per door
visitor.room.send("office-enter", { office: OFFICE });
const k2 = await next(staff, "office-knock", { where: (m) => m.from?.name === "qa_lv5" });
staff.room.send("office-answer", { knockId: k2?.knockId, action: "wait" });
const w = await next(visitor, "office-wait");
check("office.Please wait → visitor told to wait (knock stays queued)", w?.reason === "ASKED", JSON.stringify(w));
staff.room.send("office-answer", { knockId: k2?.knockId, action: "allow" });
const inv = await next(visitor, "office-admitted");
check("office.Let in → visitor admitted (via invite)", inv?.via === "invite", JSON.stringify(inv));
const mem = await next(staff, "office-members", { timeout: 3000 });
note("office.members after let in", JSON.stringify(mem));

// office conversation: only the people inside
visitor.room.send("office-chat", { text: "hello support, I need help" });
const sc = await next(staff, "office-chat", { timeout: 3000 });
const oc = await next(outsider, "office-chat", { timeout: 1500 });
check("office.chat reaches the office", !!sc, JSON.stringify(sc)?.slice(0, 120));
check("office.chat does not leak outside", !oc, JSON.stringify(oc));
outsider.room.send("chat", { text: "lobby chat probe", scope: "room" });
const leakIn = await next(staff, "chat", { timeout: 1500, where: (m) => /lobby chat probe/.test(m.text) });
check("office.lobby room chat not heard inside the office (FIX-A GAP-012)", !leakIn, String(!!leakIn));

// a non-staff visitor cannot answer knocks
outsider.room.send("office-enter", { office: OFFICE });
const k3 = await next(staff, "office-knock", { where: (m) => m.from?.name === "qa_lv1" });
visitor.room.send("office-answer", { knockId: k3?.knockId, action: "allow" });
const notAdm = await next(outsider, "office-admitted", { timeout: 2000 });
check("office.visitor inside cannot let others in", !notAdm, JSON.stringify(notAdm));
staff.room.send("office-answer", { knockId: k3?.knockId, action: "decline" });
await next(outsider, "office-refused");

// expiry: knock with no answer
if (!skipExpiry) {
  await sleep(5500);
  outsider.room.send("office-enter", { office: OFFICE });
  const ex = await next(outsider, "office-refused", { timeout: 40000 });
  check("office.unanswered knock expires", ex?.reason === "EXPIRED", JSON.stringify(ex));
} else note("office.expiry", "skipped (--no-expiry)");

// nobody inside
outsider.room.send("office-enter", { office: "it-office" });
const nb = await next(outsider, "office-refused", { timeout: 5000 });
check("office.nobody inside → NOBODY_INSIDE", nb?.reason === "NOBODY_INSIDE", JSON.stringify(nb));
outsider.room.send("office-enter", { office: "no-such-office" });
const na = await next(outsider, "office-refused", { timeout: 5000 });
check("office.unknown office refused", na?.reason === "NOT_ALLOWED", JSON.stringify(na));

// guests cannot knock
const guest = await join(null);
guest.room.send("office-enter", { office: OFFICE });
const gr = await next(guest, "office-refused");
check("office.guest refused LOGIN_REQUIRED", gr?.reason === "LOGIN_REQUIRED", JSON.stringify(gr));

// office full: capacity 3 visitors — fill with invited visitors, the next knock is told FULL
const extra = [await join("lv12"), await join("lv30"), await join("invited")];
let admitted = 1; // lv5 already inside
for (const e of extra) {
  e.room.send("office-enter", { office: OFFICE });
  const k = await next(staff, "office-knock", { where: (m) => m.from?.name === `qa_${e.key}` });
  if (k?.full) {
    note("office.full flag on knock", `knock from ${e.key} flagged full after ${admitted} visitors`);
    staff.room.send("office-answer", { knockId: k.knockId, action: "allow" });
    const fw = await next(e, "office-wait", { timeout: 3000 });
    const fa = await next(e, "office-admitted", { timeout: 1000 });
    check("office.full → visitor waits (not admitted)", fw?.reason === "FULL" && !fa, JSON.stringify({ fw, fa }));
    break;
  }
  staff.room.send("office-answer", { knockId: k?.knockId, action: "allow" });
  if (await next(e, "office-admitted")) admitted++;
}
note("office.visitors admitted before full", String(admitted));

// staff leaves → visitors? (the office closes when the last staff member leaves)
staff.room.send("office-leave", { office: OFFICE });
await sleep(1000);
check("office.visitor told the officer left (FIX-A GAP-013)", visitor.inbox.some((m) => m.type === "office-officer-left" && m.msg?.graceMs > 0), visitor.inbox.slice(-4).map((m) => `${m.type}:${JSON.stringify(m.msg).slice(0, 80)}`).join(" | "));

for (const p of [staff, visitor, outsider, guest, ...extra]) await p.room.leave().catch(() => undefined);
done();
process.exit(0);
