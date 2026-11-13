/**
 * Headless multi-client simulation of the plaza room (test-only bots, an in-process server on a random port —
 * never a production room; no fake players are ever shown to users). ~20 signed-in clients walk, sit on the
 * benches, chat nearby / room-wide, DM, call and block each other while we check what each client receives:
 * batched movement at steady rates, exclusive seats, nearby-chat range, DM requests, call flow, block = invisible.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { NEARBY_CHAT_RANGE, PLAZA_SEATS } from "@gukirana/contracts";
import { WorldRoom } from "../rooms/world-room.js";

const N = Number(process.env.CROWD_N ?? 20); // CROWD_N=45 for a fuller room (max 50 per instance, one late joiner in the block test)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot {
  name: string;
  uid: string;
  room: Room;
  sid: string;
  x: number;
  z: number;
  inbox: { type: string; msg: unknown; at: number }[];
  of: <T = Record<string, unknown>>(type: string) => T[];
}

let http: HttpServer;
let game: Server;
let url = "";
const bots: Bot[] = [];

async function token(uid: string, name: string) {
  return new SignJWT({ sub: uid, name, color: "#3DA9FC", lvl: 3 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("gukirana-api")
    .setAudience("gukirana")
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(loadEnv().JWT_SECRET));
}

async function bot(i: number, blocks: string[] = []): Promise<Bot> {
  const name = `Bot${String(i).padStart(2, "0")}`;
  const uid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const room = await new Client(url).joinOrCreate("plaza", { name, token: await token(uid, name), blocks });
  const inbox: Bot["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg, at: Date.now() }));
  const b: Bot = { name, uid, room, sid: room.sessionId, x: 0, z: 0, inbox, of: <T,>(t: string) => inbox.filter((m) => m.type === t).map((m) => m.msg as T) };
  return b;
}

const send = (b: Bot, x: number, z: number, yaw = 0, anim = 1) => {
  b.x = x;
  b.z = z;
  b.room.send("move", { x: Math.round(x * 100), y: 0, z: Math.round(z * 100), yaw, anim, t: Date.now() });
};
const clear = () => bots.forEach((b) => (b.inbox.length = 0));

beforeAll(async () => {
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("plaza", WorldRoom);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  for (let i = 0; i < N; i++) bots.push(await bot(i));
  await wait(300);
}, 30_000);

afterAll(async () => {
  for (const b of bots) await b.room.leave().catch(() => undefined);
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);

describe(`crowd simulation (${N} clients)`, () => {
  it("everyone sees everyone; movement arrives batched at steady, distance-tiered rates", async () => {
    // half walk a ring around the fountain (8 m), half far away (60 m) → near / far interest tiers
    clear();
    const t0 = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      bots.forEach((b, i) => {
        const r = i < N / 2 ? 8 : 60;
        const a = (i / N) * Math.PI * 2 + t * 0.15;
        send(b, Math.sin(a) * r, Math.cos(a) * r, 0, 1);
      });
    }, 66); // ≈15 Hz like the web client
    await wait(3000);
    clearInterval(timer);
    await wait(200);
    const secs = 3;
    const rates: number[] = [];
    const gaps: number[] = [];
    let entries = 0;
    for (const b of bots.slice(0, N / 2)) {
      const batches = b.inbox.filter((m) => m.type === "moves");
      expect(b.of("move")).toHaveLength(0); // no more per-move relays
      rates.push(batches.length / secs);
      // a near walker's updates: no gap over ~250 ms (10 Hz tick)
      const other = bots[(bots.indexOf(b) + 1) % (N / 2)]!;
      const times = batches.filter((m) => (m.msg as [string][]).some((e) => e[0] === other.sid)).map((m) => m.at);
      for (let k = 1; k < times.length; k++) gaps.push(times[k]! - times[k - 1]!);
      entries += batches.reduce((s, m) => s + (m.msg as unknown[]).length, 0);
    }
    // near viewer: near people every tick, far ones every 4th → far entries ≈ quarter of near entries
    const viewer = bots[0]!;
    const count = (sid: string) => viewer.of<[string][]>("moves").flat().filter((e) => e[0] === sid).length;
    const nearCount = count(bots[1]!.sid);
    const farCount = count(bots[N - 1]!.sid);
    console.log(
      `[crowd] ${N} clients · moves batches/s per client ≈ ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)} · ` +
        `entries/s per client ≈ ${(entries / (N / 2) / secs).toFixed(0)} · max near gap ${Math.max(...gaps)} ms · near/far updates ${nearCount}/${farCount}`,
    );
    for (const r of rates) expect(r).toBeLessThanOrEqual(11); // one message per tick at most
    expect(Math.max(...rates)).toBeGreaterThan(7);
    expect(Math.max(...gaps)).toBeLessThan(350);
    expect(farCount).toBeLessThan(nearCount / 2);
    expect(farCount).toBeGreaterThan(0);
  }, 20_000);

  it("bench seats are exclusive and released when walking away", async () => {
    clear();
    const seat = PLAZA_SEATS[0]!;
    const [a, b, c] = [bots[0]!, bots[1]!, bots[2]!];
    send(a, seat.x, seat.z, 0, 13);
    a.room.send("sit", { seat: seat.id });
    await wait(150);
    b.room.send("sit", { seat: seat.id });
    c.room.send("sit", { seat: "b99s0" }); // not a real bench place → ignored
    await wait(250);
    expect(b.of("seat-taken")).toHaveLength(1);
    const last = c.of<Record<string, string>>("seats").at(-1)!;
    expect(last[seat.id]).toBe(a.sid);
    expect(Object.keys(last)).not.toContain("b99s0");
    // a walks away → the server frees the place for everyone
    clear();
    send(a, seat.x + 3, seat.z + 3, 0, 1);
    await wait(250);
    expect(b.of<Record<string, string>>("seats").at(-1)?.[seat.id]).toBeUndefined();
    // seated pose (anim 13) reaches others on the next tick
    clear();
    b.room.send("sit", { seat: seat.id });
    send(b, seat.x, seat.z, 0, 13);
    await wait(250);
    const seen = c.of<[string, number, number, number, number][]>("moves").flat().filter((e) => e[0] === b.sid);
    expect(seen.at(-1)?.[4]).toBe(13);
  });

  it("nearby chat reaches only people within range; room chat reaches everyone; payment requests are blocked", async () => {
    // stop everyone at known spots
    bots.forEach((b, i) => send(b, i < N / 2 ? i * 3 : 100 + i, 0, 0, 0));
    await wait(300);
    clear();
    const speaker = bots[0]!;
    speaker.room.send("chat", { text: "hello nearby", scope: "nearby" });
    await wait(250);
    for (const b of bots) {
      const got = b.of<{ text: string; scope: string }>("chat").some((m) => m.text === "hello nearby");
      expect(got).toBe(Math.hypot(b.x - speaker.x, b.z - speaker.z) <= NEARBY_CHAT_RANGE);
    }
    await wait(900);
    speaker.room.send("chat", { text: "hello plaza", scope: "room" });
    await wait(250);
    expect(bots.every((b) => b.of<{ text: string }>("chat").some((m) => m.text === "hello plaza"))).toBe(true);
    await wait(900);
    clear();
    speaker.room.send("chat", { text: "send me money on momo first", scope: "room" });
    await wait(250);
    expect(speaker.of("chat-warning")).toHaveLength(1);
    expect(bots[1]!.of("chat")).toHaveLength(0);
  });

  it("DMs: first message is a request, the sender waits, a reply opens the thread", async () => {
    clear();
    const [a, b] = [bots[3]!, bots[4]!];
    a.room.send("dm", { to: b.sid, text: "hi, want to play igisoro?" });
    await wait(200);
    const req = b.of<{ request: boolean; from: string; text: string }>("dm");
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ request: true, from: a.sid });
    expect(bots[5]!.of("dm")).toHaveLength(0); // private
    a.room.send("dm", { to: b.sid, text: "hello??" });
    await wait(200);
    expect(a.of<{ reason: string }>("dm-failed")[0]?.reason).toBe("WAITING");
    b.room.send("dm", { to: a.sid, text: "sure, call 0788 123 456" });
    await wait(200);
    const reply = a.of<{ request: boolean; text: string }>("dm").filter((m) => !m.request);
    expect(reply.at(-1)?.text).toContain("•••"); // phone numbers masked in DMs too
    a.room.send("dm", { to: b.sid, text: "great" });
    await wait(200);
    expect(b.of<{ text: string }>("dm").some((m) => m.text === "great")).toBe(true);
  });

  it("private call: request → accept → both connected → end", async () => {
    clear();
    const [a, b] = [bots[6]!, bots[N - 2]!]; // far apart
    a.room.send("call-request", { to: b.sid });
    await wait(200);
    const inc = b.of<{ id: string; from: { id: string } }>("call-incoming")[0]!;
    expect(inc.from.id).toBe(a.sid);
    expect(a.of("call-ringing")).toHaveLength(1);
    // a third person cannot ring someone already ringing
    bots[7]!.room.send("call-request", { to: b.sid });
    b.room.send("call-respond", { id: inc.id, accept: true });
    await wait(200);
    expect(bots[7]!.of<{ reason: string }>("call-failed")[0]?.reason).toBe("TARGET_BUSY");
    expect(a.of<{ peer: { id: string } }>("call-start")[0]?.peer.id).toBe(b.sid);
    expect(b.of<{ peer: { id: string } }>("call-start")[0]?.peer.id).toBe(a.sid);
    a.room.send("call-end", {});
    await wait(200);
    expect(b.of<{ reason: string }>("call-ended")[0]?.reason).toBe("ENDED");
  });

  it("block = invisible + silent both ways: no moves, chat, DMs, calls, voice or proposals", async () => {
    clear();
    const [a, b, c] = [bots[8]!, bots[9]!, bots[1]!];
    a.room.send("block", { to: b.sid });
    await wait(200);
    expect(a.of<{ id: string }>("left").some((m) => m.id === b.sid)).toBe(true);
    expect(b.of<{ id: string }>("left").some((m) => m.id === a.sid)).toBe(true);
    const blocked = a.of<{ key: string; uid: string }>("blocked")[0]!;
    expect(blocked.key).toBe(`u:${b.uid}`);
    clear();
    send(b, 0.5, 0.5, 0, 1);
    b.room.send("chat", { text: "can you see me", scope: "room" });
    b.room.send("dm", { to: a.sid, text: "hey" });
    b.room.send("call-request", { to: a.sid });
    b.room.send("propose", { to: a.sid, game: "ludo", stake: 0 });
    b.room.send("voice-signal", { to: a.sid, data: { candidate: {} } });
    b.room.send("emote", { emote: 10, to: a.sid });
    await wait(300);
    expect(a.inbox.filter((m) => ["chat", "dm", "call-incoming", "proposal", "voice-signal", "emote", "waved"].includes(m.type))).toHaveLength(0);
    expect(a.of<[string][]>("moves").flat().some((e) => e[0] === b.sid)).toBe(false);
    expect(c.of<{ text: string }>("chat").some((m) => m.text === "can you see me")).toBe(true); // others still see b
    expect(b.of<{ reason: string }>("dm-failed")[0]?.reason).toBe("UNAVAILABLE");
    expect(b.of<{ reason: string }>("call-failed")[0]?.reason).toBe("UNAVAILABLE");
    expect(b.of<{ reason: string }>("proposal-failed")[0]?.reason).toBe("PLAYER_UNAVAILABLE");
    // a block list given on join (from the API) applies before the snapshot
    const late = await bot(50, [`u:${b.uid}`]);
    await wait(250);
    const snap = late.of<{ players: { id: string }[] }>("snapshot")[0]!;
    expect(snap.players.some((p) => p.id === b.sid)).toBe(false);
    expect(snap.players.some((p) => p.id === a.sid)).toBe(true);
    expect(b.of<{ id: string }>("joined").some((p) => p.id === late.sid)).toBe(false);
    await late.room.leave();
    // unblock → visible again both ways
    clear();
    a.room.send("unblock", { key: blocked.key });
    await wait(250);
    expect(a.of<{ id: string }>("joined").some((m) => m.id === b.sid)).toBe(true);
    expect(b.of<{ id: string }>("joined").some((m) => m.id === a.sid)).toBe(true);
  });

  it("emotes have a short cooldown and are seen by everyone", async () => {
    await wait(1600);
    clear();
    const a = bots[10]!;
    a.room.send("emote", { emote: 11 });
    a.room.send("emote", { emote: 12 });
    await wait(250);
    expect(bots[0]!.of<{ id: string; emote: number }>("emote").filter((m) => m.id === a.sid)).toEqual([{ id: a.sid, emote: 11 }]);
    expect(bots.filter((b) => b !== a).every((b) => b.of("emote").length === 1)).toBe(true);
  });

  it("contact actions need consent: no hug in anyone's pose until the other person accepts", async () => {
    const a = bots[12]!;
    const b = bots[13]!;
    const viewer = bots[14]!;
    send(a, 30, 30, 0, 0);
    send(b, 31.5, 30, 0, 0);
    send(viewer, 30.6, 32, 0, 0);
    await wait(300);
    clear();
    // a hug code in a pose update without a pair is rewritten to plain idle
    send(a, 30, 30, 0, 23);
    await wait(250);
    const animOf = (sid: string) => viewer.of<[string, number, number, number, number][]>("moves").flat().filter((e) => e[0] === sid).map((e) => e[4]);
    expect(animOf(a.sid)).not.toContain(23);
    // ask → invitation → accept → both get their places, face to face 0.42 m apart
    a.room.send("pair-request", { to: b.sid, kind: "hug" });
    await wait(200);
    const inv = b.of<{ id: string; kind: string; from: { id: string } }>("pair-invite")[0]!;
    expect(inv.kind).toBe("hug");
    expect(inv.from.id).toBe(a.sid);
    expect(a.of("pair-pending")).toHaveLength(1);
    // someone else cannot answer for b
    viewer.room.send("pair-respond", { id: inv.id, accept: true });
    await wait(150);
    expect(a.of("pair-start")).toHaveLength(0);
    b.room.send("pair-respond", { id: inv.id, accept: true });
    await wait(200);
    const start = a.of<{ kind: string; a: { id: string; x: number; z: number }; b: { id: string; x: number; z: number }; alignMs: number }>("pair-start")[0]!;
    expect(start.kind).toBe("hug");
    expect(b.of("pair-start")).toHaveLength(1);
    expect(Math.hypot(start.a.x - start.b.x, start.a.z - start.b.z)).toBeCloseTo(0.42, 2);
    // now the hug shows for both
    clear();
    send(a, start.a.x, start.a.z, 0, 23);
    send(b, start.b.x, start.b.z, 0, 23);
    await wait(250);
    expect(animOf(a.sid)).toContain(23);
    expect(animOf(b.sid)).toContain(23);
    // while hugging, a is busy for anyone else
    clear();
    a.room.send("pair-request", { to: viewer.sid, kind: "handshake" });
    await wait(150);
    expect(a.of<{ reason: string }>("pair-closed").map((m) => m.reason)).toContain("BUSY");
    // a declined handshake never starts; the asker is told
    const c = bots[15]!;
    send(c, 31, 33.5, 0, 0);
    await wait(200);
    clear();
    c.room.send("pair-request", { to: viewer.sid, kind: "handshake" });
    await wait(150);
    const inv2 = viewer.of<{ id: string }>("pair-invite")[0]!;
    viewer.room.send("pair-respond", { id: inv2.id, accept: false });
    await wait(150);
    expect(c.of<{ reason: string }>("pair-closed").map((m) => m.reason)).toContain("DECLINED");
    expect(c.of("pair-start")).toHaveLength(0);
  });
});
