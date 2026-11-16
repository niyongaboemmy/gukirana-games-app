// P2-MM-05 Boxing over the realtime protocol (no browser): two accounts in the Boxing hall
//   1. Find an opponent (matchmaking v2) for Boxing → Opponent found on both → both accept → a free ring is assigned
//      to both and the fight room is ready (escrow happens in the API as for every fight);
//   2. the v1 bug: A waits in a ring ("Wait for an opponent", Friendly), B presses Quick Fight at Friendly → B takes
//      the blue corner of A's ring (before: both waited for ever, side by side).
// Stack from env (defaults: api :4920, realtime :3187).   node qa/e2e/matchmaking-boxing.mjs
import { Client } from "colyseus.js";

const API = process.env.QA_API ?? "http://127.0.0.1:4920";
const RT = process.env.QA_RT ?? "ws://localhost:3187";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36).slice(-5);
const results = [];
const check = (id, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? `  — ${detail}` : ""}`);
};
async function j(path, { method = "GET", token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body) h["content-type"] = "application/json";
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
}
async function account(key) {
  const id = `mm05box.${key}.${run}@example.test`;
  const req = await j("/auth/otp/request", { method: "POST", body: { identifier: id } });
  const v = await j("/auth/otp/verify", { method: "POST", body: { identifier: id, code: req.devCode } });
  await j("/me", { method: "PATCH", token: v.accessToken, body: { username: `bx${key}${run}` } });
  const rules = await j("/games/rules", { token: v.accessToken });
  for (const g of rules?.games ?? []) await j("/games/rules/accept", { method: "POST", token: v.accessToken, body: { game: g.game, version: g.version } });
  return v.accessToken;
}
async function join(token, key) {
  const r = await new Client(RT).joinOrCreate("hall", { token, name: key, game: "boxing" });
  const inbox = [];
  r.onMessage("*", (type, msg) => inbox.push({ type, msg }));
  return { r, inbox, key };
}
async function next(p, type, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const i = p.inbox.findIndex((m) => m.type === type);
    if (i >= 0) return p.inbox.splice(i, 1)[0].msg;
    await sleep(50);
  }
  return null;
}
const adm = { "x-admin-token": process.env.QA_ADMIN_TOKEN ?? "dev-admin-service-token", "x-admin-user": "qa" };
const games = await j("/console/games", { headers: adm });
const boxing = Array.isArray(games) ? games.find((g) => g.game === "boxing") : null;
if (boxing && !boxing.settings.enabled) await j("/console/games/boxing", { method: "PUT", headers: adm, body: { settings: { ...boxing.settings, enabled: true }, reason: "P2-MM-05 check" } });

// 1. v2 find in the Boxing hall
{
  const a = await join(await account("a"), "a");
  const b = await join(await account("b"), "b");
  check("1.same Boxing hall", a.r.roomId === b.r.roomId);
  await sleep(400);
  a.r.send("mm-find", { game: "boxing", stakes: [0] });
  b.r.send("mm-find", { game: "boxing", stakes: [0] });
  const fa = await next(a, "mm-found");
  const fb = await next(b, "mm-found");
  check("1.Opponent found on both", fa?.game === "boxing" && fb?.id === fa?.id, JSON.stringify(fa));
  a.r.send("mm-respond", { id: fa?.id, accept: true });
  b.r.send("mm-respond", { id: fb?.id, accept: true });
  const ga = await next(a, "boxing-assigned", 10000);
  const gb = await next(b, "boxing-assigned", 10000);
  check("1.both assigned the same ring", !!ga?.ring && ga.ring === gb?.ring, `${JSON.stringify(ga)} ${JSON.stringify(gb)}`);
  const ra = await next(a, "boxing-fight-ready", 10000);
  check("1.fight room ready", !!ra?.roomId, JSON.stringify(ra));
  await a.r.leave();
  await b.r.leave();
}

// 2. Quick Fight takes on a ring that is already waiting at that stake
{
  const a = await join(await account("c"), "c");
  const b = await join(await account("d"), "d");
  await sleep(400);
  // A walks up to ring R5 (hall metres → centimetres; just south of its platform) and waits there, Friendly
  // (at a walking pace: the server clamps speed, social/movement.ts)
  const R5 = { x: -11.9 - 2 * 7.8, z: 8.3 + 2.45 + 1 };
  const snap = a.inbox.find((m) => m.type === "snapshot")?.msg;
  const me = snap?.players?.find((p) => p.id === snap.you) ?? { x: 0, z: 650 };
  const from = { x: me.x / 100, z: me.z / 100 };
  const steps = Math.ceil(Math.hypot(R5.x - from.x, R5.z - from.z) / 0.35);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((R5.x - from.x) * i) / steps;
    const z = from.z + ((R5.z - from.z) * i) / steps;
    a.r.send("move", { x: Math.round(x * 100), y: 0, z: Math.round(z * 100), yaw: 0, anim: 1, t: i * 100 });
    await sleep(100);
  }
  await sleep(300);
  a.r.send("boxing-claim", { ring: "R5", stake: 0 });
  const claimed = await next(a, "boxing-assigned");
  check("2.A waits in ring R5", claimed?.ring === "R5", JSON.stringify(claimed ?? (await next(a, "boxing-denied", 100))));
  b.r.send("boxing-quick", { stake: 0 });
  const got = await next(b, "boxing-assigned", 10000);
  check("2.B's Quick Fight joins A's ring (blue corner)", got?.ring === "R5" && got?.corner === "blue", JSON.stringify(got ?? (await next(b, "boxing-denied", 100))));
  await a.r.leave();
  await b.r.leave();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
