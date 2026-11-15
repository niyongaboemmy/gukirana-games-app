/**
 * Challenges and Quick Match vs. responsible play (GAP-005 / GAP-011), over a real in-process server: limits and
 * breaks are checked when the challenge / queue request is made, the player concerned hears the precise reason, and
 * the other player only ever hears a neutral one. Eligibility comes from a stub (the API's
 * /internal/players/:id/eligibility in production).
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { ApiError } from "../api-client.js";
import { OPPONENT_CANT_PLAY, reasonFor, refusalFor, WorldRoom } from "./world-room.js";
import { setAccountSources } from "../social/accounts.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let http: HttpServer;
let game: Server;
let url = "";
let n = 0;
/** uid → reason for any staked game */
const barred = new Map<string, string>();
/** uid → the game whose friendly games are used up today */
const friendlyDone = new Map<string, string>();
/** uid → the game whose current rules card they haven't accepted (P2-NET-05) */
const noRules = new Map<string, string>();

interface Person {
  room: Room;
  uid: string;
  sid: string;
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
async function person(reason?: string): Promise<Person> {
  const uid = `00000000-0000-4000-8000-${String(700 + ++n).padStart(12, "0")}`;
  if (reason) barred.set(uid, reason);
  const room = await new Client(url).joinOrCreate("plaza", { token: await token(uid) });
  const inbox: Person["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  return { room, uid, sid: room.sessionId, inbox, of: (t) => inbox.filter((m) => m.type === t).map((m) => m.msg) };
}

beforeAll(async () => {
  setAccountSources({
    eligibility: async (uid, stake, g) => {
      // the API's per-game rules: a friendly limit per game, and only its allowed stakes
      if (stake === 0 && g && friendlyDone.get(uid) === g) return { ok: false, reason: "FRIENDLY_LIMIT_REACHED", limit: 5 };
      if (stake === 30) return { ok: false, reason: "STAKE_NOT_ALLOWED" };
      if (g && noRules.get(uid) === g) return { ok: false, reason: "RULES_NOT_ACCEPTED" };
      return stake > 0 && barred.has(uid) ? { ok: false, reason: barred.get(uid)! } : { ok: true };
    },
  });
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("plaza", WorldRoom);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);
afterAll(async () => {
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);

describe("reasons are private (GAP-005)", () => {
  it("the player concerned hears the precise reason, the other one a neutral one", () => {
    const e = new ApiError("ON_A_BREAK", "u-break");
    expect(reasonFor(e, "u-break")).toBe("ON_A_BREAK");
    expect(reasonFor(e, "u-other")).toBe(OPPONENT_CANT_PLAY);
    expect(reasonFor(new ApiError("DAILY_LIMIT_REACHED"), "anyone")).toBe(OPPONENT_CANT_PLAY); // nobody named: neutral
    expect(reasonFor(new ApiError("INSUFFICIENT_FUNDS", "u-poor"), "u-poor")).toBe("INSUFFICIENT_FUNDS");
    expect(reasonFor(new Error("API_500"), "u")).toBe("API_500"); // not personal: unchanged
  });
});

describe("checked when the challenge / queue request is made (GAP-011)", () => {
  it("a player on a break can't send a staked challenge; the other player is never bothered", async () => {
    const brk = await person("ON_A_BREAK");
    const other = await person();
    await wait(150);
    brk.room.send("propose", { to: other.sid, game: "igisoro", stake: 25 });
    await wait(250);
    expect(brk.of("proposal-failed")).toEqual([{ reason: "ON_A_BREAK", game: "igisoro" }]);
    expect(other.of("proposal")).toEqual([]);
    // free games stay allowed on a break
    brk.room.send("propose", { to: other.sid, game: "igisoro", stake: 0 });
    await wait(250);
    expect(other.of("proposal")).toHaveLength(1);
    await brk.room.leave();
    await other.room.leave();
  });

  it("challenging someone over their limit: the challenger only hears that they can't play right now", async () => {
    const me = await person();
    const lim = await person("DAILY_LIMIT_REACHED");
    await wait(150);
    me.room.send("propose", { to: lim.sid, game: "pool", stake: 200 });
    await wait(250);
    expect(me.of("proposal-failed")).toEqual([{ reason: OPPONENT_CANT_PLAY }]);
    expect(lim.of("proposal")).toEqual([]);
    expect(JSON.stringify(me.inbox)).not.toMatch(/DAILY_LIMIT|BREAK/);
    await me.room.leave();
    await lim.room.leave();
  });

  it("quick match: refused before queueing, so nobody is paired with them", async () => {
    const brk = await person("ON_A_BREAK");
    const other = await person();
    await wait(150);
    brk.room.send("quickmatch-join", { game: "pool", stake: 25 });
    await wait(250);
    expect(brk.of("quickmatch")).toEqual([{ status: "error", reason: "ON_A_BREAK", game: "pool" }]);
    other.room.send("quickmatch-join", { game: "pool", stake: 25 });
    await wait(250);
    expect(other.of("quickmatch")).toEqual([{ status: "waiting", game: "pool", stake: 25 }]);
    other.room.send("quickmatch-leave");
    await wait(100);
    await brk.room.leave();
    await other.room.leave();
  });
});

describe("per-game rules from the API (P1-GAME-06)", () => {
  it("friendly games used up: the player hears the limit for that game; the other player only that they can't play", async () => {
    const done = await person();
    const other = await person();
    friendlyDone.set(done.uid, "ludo");
    await wait(150);
    done.room.send("propose", { to: other.sid, game: "ludo", stake: 0 });
    await wait(250);
    expect(done.of("proposal-failed")).toEqual([{ reason: "FRIENDLY_LIMIT_REACHED", game: "ludo", limit: 5 }]);
    other.room.send("propose", { to: done.sid, game: "ludo", stake: 0 });
    await wait(250);
    expect(other.of("proposal-failed")).toEqual([{ reason: OPPONENT_CANT_PLAY }]);
    // another game is still open to them
    done.room.send("propose", { to: other.sid, game: "igisoro", stake: 0 });
    await wait(250);
    expect(other.of("proposal")).toHaveLength(1);
    done.room.send("quickmatch-join", { game: "ludo", stake: 0 });
    await wait(250);
    expect(done.of("quickmatch")).toEqual([{ status: "error", reason: "FRIENDLY_LIMIT_REACHED", game: "ludo", limit: 5 }]);
    await done.room.leave();
    await other.room.leave();
  });

  it("a stake the game doesn't offer is refused before anyone is asked", async () => {
    const me = await person();
    const other = await person();
    await wait(150);
    me.room.send("propose", { to: other.sid, game: "pool", stake: 30 });
    await wait(250);
    expect(me.of("proposal-failed")).toEqual([{ reason: "STAKE_NOT_ALLOWED", game: "pool" }]);
    expect(other.of("proposal")).toEqual([]);
    me.room.send("propose", { to: other.sid, game: "pool", stake: 25.5 });
    await wait(200);
    expect(me.of("proposal-failed").at(-1)).toEqual({ reason: "INVALID_PROPOSAL" });
    await me.room.leave();
    await other.room.leave();
  });

  it("a refusal at accept time (API re-check) carries the friendly limit for the player it is about", () => {
    const e = new ApiError("FRIENDLY_LIMIT_REACHED", "u-done", 3);
    expect(refusalFor(e, "u-done", "igisoro")).toEqual({ reason: "FRIENDLY_LIMIT_REACHED", game: "igisoro", limit: 3 });
    expect(refusalFor(e, "u-other", "igisoro")).toEqual({ reason: OPPONENT_CANT_PLAY, game: "igisoro" });
    expect(refusalFor(new ApiError("ALREADY_IN_MATCH", "u-busy"), "u-busy", "pool")).toEqual({ reason: "ALREADY_IN_MATCH", game: "pool" });
    expect(refusalFor(new ApiError("GAME_DISABLED"), "anyone", "pool")).toEqual({ reason: "GAME_DISABLED", game: "pool" });
  });
});

describe("rules to accept (P2-NET-05)", () => {
  it("without the current rules accepted a player is never seated: refused before anyone is asked or queued", async () => {
    const me = await person();
    const other = await person();
    noRules.set(me.uid, "ludo");
    await wait(150);
    me.room.send("propose", { to: other.sid, game: "ludo", stake: 0 });
    me.room.send("quickmatch-join", { game: "ludo", stake: 25 });
    await wait(300);
    expect(me.of("proposal-failed")).toEqual([{ reason: "RULES_NOT_ACCEPTED", game: "ludo" }]);
    expect(me.of("quickmatch")).toEqual([{ status: "error", reason: "RULES_NOT_ACCEPTED", game: "ludo" }]);
    expect(other.of("proposal")).toEqual([]);
    // challenged by someone else: the one without the rules can't accept; the challenger hears only a neutral reason
    other.room.send("propose", { to: me.sid, game: "ludo", stake: 0 });
    await wait(250);
    expect(other.of("proposal-failed")).toEqual([{ reason: OPPONENT_CANT_PLAY }]);
    expect(JSON.stringify(other.inbox)).not.toMatch(/RULES_NOT_ACCEPTED/);
    // another game's rules were accepted: that one works
    me.room.send("propose", { to: other.sid, game: "pool", stake: 0 });
    await wait(250);
    expect(other.of("proposal")).toHaveLength(1);
    await me.room.leave();
    await other.room.leave();
  });
});
