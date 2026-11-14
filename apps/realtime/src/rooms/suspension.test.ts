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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let http: HttpServer;
let game: Server;
let url = "";
let n = 0;
const inactive = new Set<string>();
let feed: { id: string; userId: string; at: string }[] = [];

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
