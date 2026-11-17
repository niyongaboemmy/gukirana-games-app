import { describe, expect, it } from "vitest";
import { MatchService, mmConfig } from "./matchmaker-v2.js";
import type { HallPort, Reservation } from "./social/mm-hub.js";
import { ApiError } from "./api-client.js";

/** a fake world: sessions in rooms, one Ludo hall with 2 tables, a clock we move by hand */
function world(opts: { refuse?: Record<string, string>; failStart?: Error } = {}) {
  let now = 1_000;
  const started: { game: string; stake: number; uids: string[] }[] = [];
  const svc = new MatchService(
    {
      eligibility: async (uid) => (opts.refuse?.[uid] ? { ok: false, reason: opts.refuse[uid] } : { ok: true }),
      startMatch: async (game, stake, uids) => {
        if (opts.failStart) throw opts.failStart;
        started.push({ game, stake, uids });
        return { roomId: "match1", matchId: "mid1" };
      },
      createHall: async () => {
        throw new Error("no");
      },
    },
    () => now,
  );
  const inbox: Record<string, { type: string; msg: Record<string, unknown> }[]> = {};
  const blocks: Record<string, string[]> = {};
  const offs: Record<string, () => void> = {};
  const join = (uid: string, roomId = "plaza1", hall: string | null = null) => {
    inbox[uid] ??= [];
    offs[uid] = svc.register(uid, {
      sid: `s-${uid}-${roomId}`,
      roomId,
      hall,
      send: (type, msg) => inbox[uid]!.push({ type, msg: msg as Record<string, unknown> }),
      blocks: () => blocks[uid] ?? [],
      person: () => ({ uid, name: uid.toUpperCase() }),
    });
  };
  // the Ludo hall: t0, t1 (two chairs each); who sits where
  const seats: Record<string, string> = {};
  const released: string[][] = [];
  const hall: HallPort = {
    roomId: "ludo1",
    game: "ludo",
    places: () => ({}),
    reserve: (uids, want): Reservation | null => {
      const table = want ?? "t0";
      const out: Reservation = { table, seats: {}, seated: [] };
      uids.forEach((u, i) => {
        if (seats[u]?.startsWith(table)) {
          out.seats[u] = seats[u]!;
          out.seated.push(u);
        } else out.seats[u] = `${table}s${i}`;
      });
      return out;
    },
    release: (uids) => void released.push(uids),
    keepAlive: () => undefined,
  };
  svc.addHall(hall);
  const last = (uid: string, type: string) => [...(inbox[uid] ?? [])].reverse().find((m) => m.type === type)?.msg;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { svc, join, inbox, last, blocks, seats, released, started, offs, flush, tick: (ms: number) => ((now += ms), svc.tick(now)) };
}

describe("matchmaking service (P2-MM-05)", () => {
  it("find → found → both accept → walk to the reserved table → both seated → the match starts", async () => {
    const w = world();
    w.join("a", "plaza1");
    w.join("b", "ludo1", "ludo");
    await w.svc.find("a", { game: "ludo", stakes: [25] });
    expect(w.last("a", "mm-status")).toMatchObject({ status: "searching", game: "ludo", searching: {} });
    await w.svc.find("b", { game: "ludo", stakes: [25, 0], venue: { place: "t1" } });
    const fa = w.last("a", "mm-found")!;
    expect(fa).toMatchObject({ game: "ludo", stake: 25, opponent: { name: "B" }, ttlMs: mmConfig.acceptMs });
    expect(w.last("b", "mm-found")).toMatchObject({ opponent: { name: "A" } });
    w.svc.respond("a", { id: fa.id, accept: true });
    w.svc.respond("b", { id: fa.id, accept: true });
    await w.flush();
    // b chose table 2 in the hall: the meeting is there; a walks over from the plaza
    const ga = w.last("a", "mm-go")!;
    expect(ga).toMatchObject({ hall: "ludo", roomId: "ludo1", table: "t1", seat: "t1s0", opponent: { name: "B" } });
    expect(w.last("b", "mm-go")).toMatchObject({ table: "t1", seat: "t1s1" });
    await w.svc.seated("a", "ludo1", "t1s0");
    expect(w.started).toEqual([]);
    await w.svc.seated("b", "ludo1", "t0s0"); // the wrong chair does not count
    await w.svc.seated("b", "ludo1", "t1s1");
    expect(w.started).toEqual([{ game: "ludo", stake: 25, uids: ["a", "b"] }]);
    expect(w.last("a", "match-ready")).toMatchObject({ roomId: "match1", game: "ludo", stake: 25 });
    expect(w.last("b", "match-ready")).toMatchObject({ roomId: "match1" });
    expect(w.released).toEqual([["a", "b"]]);
  });

  it("searching shows how many others look for this game; cancel leaves", async () => {
    const w = world();
    for (const u of ["a", "b"]) w.join(u);
    await w.svc.find("a", { game: "pool", stakes: [50] });
    await w.svc.find("b", { game: "pool", stakes: [25] });
    expect(w.last("a", "mm-status")).toMatchObject({ status: "searching", searching: { "25": 1 } });
    w.svc.cancel("b");
    expect(w.last("b", "mm-status")).toEqual({ status: "idle" });
    expect(w.last("a", "mm-status")).toMatchObject({ searching: {} });
  });

  it("decline: the other one is told and searches on; timeout drops the silent one", async () => {
    const w = world();
    for (const u of ["a", "b", "c"]) w.join(u);
    await w.svc.find("a", { game: "ludo", stakes: [0] });
    await w.svc.find("b", { game: "ludo", stakes: [0] });
    const f = w.last("a", "mm-found")!;
    w.svc.respond("b", { id: f.id, accept: false });
    expect(w.last("a", "mm-closed")).toMatchObject({ reason: "OPPONENT_DECLINED", requeued: true });
    expect(w.last("a", "mm-status")).toMatchObject({ status: "searching" });
    expect(w.last("b", "mm-status")).toEqual({ status: "idle" });
    await w.svc.find("c", { game: "ludo", stakes: [0] });
    const g = w.last("c", "mm-found")!;
    w.svc.respond("c", { id: g.id, accept: true });
    w.tick(mmConfig.acceptMs + 10);
    expect(w.last("a", "mm-closed")).toMatchObject({ id: g.id, reason: "EXPIRED" });
    expect(w.last("c", "mm-closed")).toMatchObject({ id: g.id, reason: "OPPONENT_TIMEOUT", requeued: true });
  });

  it("a stake I can't play is dropped from my search; none left → the reason, only to me", async () => {
    const w = world({ refuse: { a: "INSUFFICIENT_FUNDS" } });
    w.join("a");
    await w.svc.find("a", { game: "ludo", stakes: [100] });
    expect(w.last("a", "mm-status")).toMatchObject({ status: "error", reason: "INSUFFICIENT_FUNDS" });
    expect(w.svc.finder.ticketOf("a")).toBeUndefined();
  });

  it("challenge: delivered anywhere, accepted → both sent to the same table; decline / expiry tell the sender", async () => {
    const w = world();
    w.join("a", "plaza1");
    w.join("b", "ludo1", "ludo");
    await w.svc.invite("a", { to: "b", game: "ludo", stake: 0 });
    const inv = w.last("b", "invite")!;
    expect(inv).toMatchObject({ from: { name: "A" }, game: "ludo", stake: 0, ttlMs: mmConfig.inviteMs });
    expect(w.last("a", "invite-sent")).toMatchObject({ to: { name: "B" } });
    w.svc.inviteRespond("b", { id: inv.id, accept: false });
    expect(w.last("a", "invite-closed")).toMatchObject({ id: inv.id, reason: "DECLINED", name: "B" });

    await w.svc.invite("a", { to: "b", game: "ludo", stake: 0 });
    const inv2 = w.last("b", "invite")!;
    w.tick(mmConfig.inviteMs + 10);
    expect(w.last("a", "invite-closed")).toMatchObject({ id: inv2.id, reason: "EXPIRED" });

    await w.svc.invite("a", { to: "b", game: "ludo", stake: 0 });
    const inv3 = w.last("b", "invite")!;
    w.svc.inviteRespond("b", { id: inv3.id, accept: true });
    await w.flush();
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "ACCEPTED" });
    expect(w.last("a", "mm-go")).toMatchObject({ roomId: "ludo1", table: "t0" });
    expect(w.last("b", "mm-go")).toMatchObject({ roomId: "ludo1", table: "t0" });
  });

  it("challenge edge cases: offline, blocked (never revealed), busy, can't afford, duplicates", async () => {
    const w = world({ refuse: { poor: "INSUFFICIENT_FUNDS", playing: "ALREADY_IN_MATCH" } });
    for (const u of ["a", "b", "poor", "playing", "blocker"]) w.join(u);
    await w.svc.invite("a", { to: "nobody", game: "ludo", stake: 0 });
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "OFFLINE" });
    w.blocks.blocker = ["u:a"];
    await w.svc.invite("a", { to: "blocker", game: "ludo", stake: 0 });
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "PLAYER_UNAVAILABLE" });
    expect(w.last("blocker", "invite")).toBeUndefined();
    await w.svc.invite("a", { to: "playing", game: "ludo", stake: 0 });
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "BUSY" });
    await w.svc.invite("a", { to: "poor", game: "ludo", stake: 200 });
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "OPPONENT_CANT_PLAY" });
    await w.svc.invite("a", { to: "b", game: "ludo", stake: 0 });
    await w.svc.invite("a", { to: "b", game: "ludo", stake: 0 });
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "DUPLICATE" });
    await w.svc.invite("b", { to: "a", game: "ludo", stake: 0 });
    expect(w.last("b", "invite-closed")).toMatchObject({ reason: "CROSSED" });
  });

  it("a challenge reaches someone who has not accepted that game's rules yet (they accept them on Accept)", async () => {
    const w = world({ refuse: { fresh: "RULES_NOT_ACCEPTED" } });
    w.join("a");
    w.join("fresh");
    await w.svc.invite("a", { to: "fresh", game: "boxing", stake: 0 });
    expect(w.last("a", "invite-closed")).toBeUndefined();
    expect(w.last("fresh", "invite")).toMatchObject({ from: { name: "A" }, game: "boxing" });
    // my own rules card still comes first (the web asks for it before sending)
    const w2 = world({ refuse: { a: "RULES_NOT_ACCEPTED" } });
    w2.join("a");
    w2.join("b");
    await w2.svc.invite("a", { to: "b", game: "boxing", stake: 0 });
    expect(w2.last("a", "invite-closed")).toMatchObject({ reason: "RULES_NOT_ACCEPTED" });
  });

  it("a hall change does not cancel anything; gone past the grace does", async () => {
    const w = world();
    w.join("a");
    w.join("b");
    await w.svc.invite("a", { to: "b", game: "ludo", stake: 0 });
    w.offs.b!();
    w.tick(2000);
    w.join("b", "ludo1", "ludo"); // back in another room: the open challenge is shown again
    expect(w.inbox.b!.filter((m) => m.type === "invite")).toHaveLength(2);
    w.offs.b!();
    w.tick(mmConfig.offlineGraceMs + 10);
    expect(w.last("a", "invite-closed")).toMatchObject({ reason: "PLAYER_LEFT" });
  });

  it("nobody reaches the table in time: called off, nothing was staked", async () => {
    const w = world();
    w.join("a");
    w.join("b");
    await w.svc.invite("a", { to: "b", game: "ludo", stake: 50 });
    w.svc.inviteRespond("b", { id: w.last("b", "invite")!.id, accept: true });
    await w.flush();
    await w.svc.seated("a", "ludo1", "t0s0");
    w.tick(mmConfig.arriveMs + 10);
    expect(w.last("a", "mm-closed")).toMatchObject({ kind: "meet", reason: "OPPONENT_NO_SHOW" });
    expect(w.last("b", "mm-closed")).toMatchObject({ kind: "meet", reason: "NO_SHOW" });
    expect(w.started).toEqual([]);
    expect(w.released).toEqual([["a", "b"]]);
  });

  it("the API refuses at the table: each hears their own reason (privacy kept)", async () => {
    const w = world({ failStart: new ApiError("INSUFFICIENT_FUNDS", "b") });
    w.join("a");
    w.join("b");
    w.seats.a = "t0s0";
    w.seats.b = "t0s1";
    await w.svc.invite("a", { to: "b", game: "ludo", stake: 50 });
    w.svc.inviteRespond("b", { id: w.last("b", "invite")!.id, accept: true });
    await w.flush();
    await w.flush();
    expect(w.last("a", "mm-closed")).toMatchObject({ kind: "meet", reason: "OPPONENT_CANT_PLAY" });
    expect(w.last("b", "mm-closed")).toMatchObject({ kind: "meet", reason: "INSUFFICIENT_FUNDS" });
  });
});
