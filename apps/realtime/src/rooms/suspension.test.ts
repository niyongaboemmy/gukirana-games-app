/**
 * Account suspension in the world room (GAP-001), over a real in-process server: the suspension feed (the API's
 * /internal/suspensions, stubbed here) closes the suspended account's connection at once, nothing it sends afterwards
 * reaches anyone, and a suspended account can't join again with its still-valid access token.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { WorldRoom } from "./world-room.js";
import { pollSuspensions, resetAccounts, setAccountSources } from "../social/accounts.js";
import type { SuspensionFeed } from "../api-client.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let http: HttpServer;
let game: Server;
let url = "";
let n = 0;
const inactive = new Set<string>();
let feed: SuspensionFeed["events"] = [];

interface Person {
  room: Room;
  uid: string;
  inbox: { type: string; msg: Record<string, unknown> }[];
  of: (type: string) => Record<string, unknown>[];
}

async function token(uid: string) {
  return new SignJWT({ sub: uid, name: `P${uid.slice(-2)}`, color: "#3DA9FC", lvl: 4 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("gukirana-api")
    .setAudience("gukirana")
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(loadEnv().JWT_SECRET));
}
const uidOf = (i: number) => `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`;
async function person(uid = uidOf(++n)): Promise<Person> {
  const room = await new Client(url).joinOrCreate("plaza", { token: await token(uid) });
  const inbox: Person["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  return { room, uid, inbox, of: (t) => inbox.filter((m) => m.type === t).map((m) => m.msg) };
}

beforeAll(async () => {
  setAccountSources({
    eligibility: async (uid) => (inactive.has(uid) ? { ok: false, reason: "ACCOUNT_INACTIVE" } : { ok: true }),
    feed: async () => ({ cursor: new Date().toISOString(), events: feed }),
  });
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("plaza", WorldRoom);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);
beforeEach(() => {
  resetAccounts();
  inactive.clear();
  feed = [];
});
afterAll(async () => {
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);

describe("suspension while connected", () => {
  it("closes the connection on the next feed poll; the suspended player can no longer chat or challenge", async () => {
    const a = await person();
    const s = await person();
    await wait(150);
    inactive.add(s.uid);
    feed = [{ id: "e1", userId: s.uid, at: new Date().toISOString() }];
    expect(await pollSuspensions()).toEqual([s.uid]);
    await wait(200);
    expect(s.of("account-suspended")).toEqual([{ reason: "ACCOUNT_INACTIVE" }]);
    expect(s.room.connection.isOpen).toBe(false);
    expect(a.of("left").map((m) => m.id)).toContain(s.room.sessionId);
    // the same feed event again (the feed overlaps): handled once
    expect(await pollSuspensions()).toEqual([]);
    await a.room.leave();
  });

  it("a suspended account can't join with its still-valid access token", async () => {
    const uid = uidOf(++n);
    inactive.add(uid);
    await expect(person(uid)).rejects.toThrow(/ACCOUNT_INACTIVE/);
  });

  it("an unreachable API does not lock players out (the API re-checks before any stake)", async () => {
    setAccountSources({ eligibility: async () => Promise.reject(new Error("ECONNREFUSED")) });
    const p = await person();
    expect(p.room.connection.isOpen).toBe(true);
    await p.room.leave();
    setAccountSources({ eligibility: async (uid) => (inactive.has(uid) ? { ok: false, reason: "ACCOUNT_INACTIVE" } : { ok: true }) });
  });
});

type FeedEvent = SuspensionFeed["events"][number];
describe("staff mutes, warnings and sign-outs (P2-CON-02)", () => {
  it("a mute from the feed refuses chat and DMs until lifted; the player is told; nobody is disconnected", async () => {
    const a = await person();
    const m = await person();
    await wait(150);
    const until = new Date(Date.now() + 3_600_000).toISOString();
    feed = [{ id: "mute-1", userId: m.uid, at: new Date().toISOString(), kind: "mute", until } as FeedEvent];
    expect(await pollSuspensions()).toEqual([]);
    await wait(100);
    expect(m.of("account-muted")).toEqual([{ until: Date.parse(until) }]);
    m.room.send("chat", { text: "hello everyone" });
    m.room.send("dm", { to: a.room.sessionId, text: "psst" });
    await wait(250);
    expect(m.of("chat-warning")).toEqual([{ reason: "muted", until: Date.parse(until) }]);
    expect(m.of("dm-failed")).toEqual([{ to: a.room.sessionId, reason: "MUTED" }]);
    expect(a.of("chat")).toEqual([]);
    expect(a.of("dm")).toEqual([]);
    expect(m.room.connection.isOpen).toBe(true);
    // lifted: chat flows again
    feed = [{ id: "unmute-1", userId: m.uid, at: new Date().toISOString(), kind: "unmute" } as FeedEvent];
    await pollSuspensions();
    await wait(1200); // chat min interval
    m.room.send("chat", { text: "sorry about that" });
    await wait(250);
    expect(a.of("chat").map((c) => c.text)).toEqual(["sorry about that"]);
    await a.room.leave();
    await m.room.leave();
  });

  it("a restarted realtime learns the mutes in force from the first poll", async () => {
    const m = await person();
    await wait(100);
    resetAccounts();
    setAccountSources({ feed: async () => ({ cursor: new Date().toISOString(), events: [], mutes: [{ userId: m.uid, until: new Date(Date.now() + 60_000).toISOString() }] }) });
    await pollSuspensions();
    m.room.send("chat", { text: "can anyone hear me" });
    await wait(250);
    expect(m.of("chat-warning")[0]).toMatchObject({ reason: "muted" });
    setAccountSources({ feed: async () => ({ cursor: new Date().toISOString(), events: feed }) });
    await m.room.leave();
  });

  it("a warning is shown to the player's open session; nothing else changes", async () => {
    const w = await person();
    await wait(100);
    feed = [{ id: "warn-1", userId: w.uid, at: new Date().toISOString(), kind: "warn", reason: "Please keep the chat friendly" } as FeedEvent];
    await pollSuspensions();
    await wait(150);
    expect(w.of("account-warning")).toEqual([{ reason: "Please keep the chat friendly" }]);
    expect(w.room.connection.isOpen).toBe(true);
    await w.room.leave();
  });

  it("sign out everywhere closes the session and refuses the old access token at join", async () => {
    const uid = uidOf(++n);
    const oldToken = await token(uid);
    const s = await person(uid);
    await wait(1100); // the sign-out happens in a later second than the token
    feed = [{ id: "out-1", userId: uid, at: new Date().toISOString(), kind: "signout" } as FeedEvent];
    expect(await pollSuspensions()).toEqual([uid]);
    await wait(200);
    expect(s.room.connection.isOpen).toBe(false);
    await expect(new Client(url).joinOrCreate("plaza", { token: oldToken })).rejects.toThrow(/SESSION_REVOKED/);
  });
});
