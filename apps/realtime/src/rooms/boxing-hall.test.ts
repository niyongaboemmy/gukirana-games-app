/**
 * Boxing hall ring registry (P3-FGT-01, FIGHT-GAMES-PLAN §7.1) on a fake host: claim / join / quick / practice /
 * watch / leave with every denial, claim races, one ring per person, reach, latency, the start failure paths, fight
 * status + spectator relay from the fight room, the result → free cycle and the world-move area of interest.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BoxingHallEvt, RING_WATCHERS_MAX, type RingId, type RingState } from "@gukirana/contracts";
import { BoxingHall, boxingHallConfig, matchWindow, type BoxingDeps, type StartFightInput } from "./boxing-hall.js";
import { RING_SPOTS } from "./boxing-rings.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
let hallN = 0;

interface Who {
  uid?: string;
  name: string;
  x: number;
  z: number;
}
function setup(opts: { refuse?: Record<string, string>; startError?: Error & { userId?: string }; ratings?: Record<string, number> } = {}) {
  const people = new Map<string, Who>();
  const inbox = new Map<string, { type: string; msg: Record<string, unknown> }[]>();
  const all: { type: string; msg: unknown }[] = [];
  const timers: (() => void)[] = [];
  const started: StartFightInput[] = [];
  const left: [string, string][] = [];
  let n = 0;
  const deps: BoxingDeps = {
    eligibility: async (uid) => (opts.refuse?.[uid] ? { ok: false, reason: opts.refuse[uid] } : { ok: true }),
    start: async (input) => {
      started.push(input);
      if (opts.startError) throw opts.startError;
      return { roomId: `room${++n}`, matchId: `m${n}`, rules: { settingsVersion: 1, turnSeconds: 30, reconnectSeconds: 60, joinSeconds: 60, maxTimeouts: 3, maxMatchMinutes: 15, fight: { rounds: 3, roundSeconds: 60, restSeconds: 15, idleSeconds: 20 } } };
    },
    leaveFight: (roomId, uid) => void left.push([roomId, uid]),
    rating: async (uid) => (opts.ratings?.[uid] !== undefined ? { rating: opts.ratings[uid]!, rd: 80 } : null),
  };
  const hall = new BoxingHall(
    {
      roomId: `hall-${++hallN}`,
      uidOf: (sid) => people.get(sid)?.uid,
      nameOf: (sid) => people.get(sid)?.name ?? "?",
      levelOf: () => 3,
      posOf: (sid) => people.get(sid),
      has: (sid) => people.has(sid),
      send: (sid, type, msg) => inbox.get(sid)?.push({ type, msg: msg as Record<string, unknown> }),
      broadcast: (type, msg) => void all.push({ type, msg }),
      later: (fn) => void timers.push(fn),
    },
    deps,
  );
  const at = (ring: RingId) => ({ x: RING_SPOTS[ring].x, z: RING_SPOTS[ring].z + RING_SPOTS[ring].half + 1 });
  const add = (sid: string, uid: string | undefined, ring: RingId = "R3") => {
    people.set(sid, { uid, name: sid, ...at(ring) });
    inbox.set(sid, []);
    hall.joined(sid);
  };
  const last = (sid: string, type: string) => inbox.get(sid)!.filter((m) => m.type === type).at(-1)?.msg;
  const denied = (sid: string) => last(sid, BoxingHallEvt.denied)?.reason;
  return { hall, people, inbox, all, timers, started, left, add, last, denied, at };
}

beforeEach(() => {
  boxingHallConfig.checkReach = true;
});

describe("claim + join", () => {
  it("claim → waiting; join → starting → fight room; both told; one ring per person", async () => {
    const t = setup();
    t.add("a", "ua");
    t.add("b", "ub");
    expect((t.last("a", BoxingHallEvt.rings) as unknown as RingState[]).length).toBe(50);
    await t.hall.onClaim("a", { ring: "R3", stake: 25 });
    expect(t.hall.ring("R3")).toMatchObject({ status: "waiting", stake: 25, red: { sid: "a", userId: "ua" } });
    expect(t.last("a", BoxingHallEvt.assigned)).toEqual({ ring: "R3", corner: "red" });
    // one ring per person
    t.people.get("a")!.x = t.at("R4").x;
    await t.hall.onClaim("a", { ring: "R4", stake: 25 });
    expect(t.denied("a")).toBe("ALREADY_IN_RING");
    // own ring / wrong stake
    t.people.get("a")!.x = t.at("R3").x;
    await t.hall.onJoin("a", { ring: "R3" });
    expect(t.denied("a")).toBe("OWN_RING");
    await t.hall.onJoin("b", { ring: "R3", stake: 50 });
    expect(t.denied("b")).toBe("STAKE_MISMATCH");
    await t.hall.onJoin("b", { ring: "R3", stake: 25 });
    expect(t.started).toHaveLength(1);
    expect(t.started[0]).toMatchObject({ ring: "R3", stake: 25, red: { userId: "ua" }, blue: { userId: "ub" } });
    expect(t.hall.ring("R3")).toMatchObject({ status: "starting", roomId: "room1", matchId: "m1", rounds: 3 });
    expect(t.last("a", BoxingHallEvt.fightReady)).toMatchObject({ ring: "R3", roomId: "room1", corner: "red", stake: 25, rules: { rounds: 3 } });
    expect(t.last("b", BoxingHallEvt.fightReady)).toMatchObject({ corner: "blue" });
  });

  it("denials: unknown ring, guest live, too far, taken, high latency, eligibility (personal reason to that player)", async () => {
    const t = setup({ refuse: { upoor: "INSUFFICIENT_FUNDS" } });
    t.add("g", undefined);
    t.add("a", "ua");
    t.add("p", "upoor");
    t.add("c", "uc");
    await t.hall.onClaim("a", { ring: "R99", stake: 0 });
    expect(t.denied("a")).toBe("UNKNOWN_RING");
    await t.hall.onClaim("g", { ring: "R3", stake: 0 });
    expect(t.denied("g")).toBe("SIGN_IN_REQUIRED");
    await t.hall.onClaim("a", { ring: "R50", stake: 0 });
    expect(t.denied("a")).toBe("TOO_FAR");
    await t.hall.onClaim("p", { ring: "R3", stake: 25 });
    expect(t.denied("p")).toBe("INSUFFICIENT_FUNDS");
    t.hall.noteRtt("c", 450);
    await t.hall.onClaim("c", { ring: "R3", stake: 0 });
    expect(t.denied("c")).toBe("HIGH_LATENCY");
    await t.hall.onClaim("a", { ring: "R3", stake: 0 });
    t.hall.noteRtt("c", 40);
    t.hall.noteRtt("c", 40);
    await t.hall.onClaim("c", { ring: "R3", stake: 0 });
    expect(t.denied("c")).toBe("RING_TAKEN");
  });

  it("claim race: two claims of the same free ring — exactly one gets it", async () => {
    const t = setup();
    t.add("a", "ua");
    t.add("b", "ub");
    await Promise.all([t.hall.onClaim("a", { ring: "R3", stake: 0 }), t.hall.onClaim("b", { ring: "R3", stake: 0 })]);
    expect(t.hall.ring("R3")!.red!.sid).toBe("a");
    expect(t.denied("b")).toBe("RING_TAKEN");
  });

  it("createMatch refused for the joiner: only they hear the personal reason; the challenger keeps waiting", async () => {
    const err = Object.assign(new Error("FRIENDLY_LIMIT_REACHED"), { userId: "ub", limit: 20 });
    const t = setup({ startError: err });
    t.add("a", "ua");
    t.add("b", "ub");
    await t.hall.onClaim("a", { ring: "R3", stake: 0 });
    await t.hall.onJoin("b", { ring: "R3" });
    expect(t.last("b", BoxingHallEvt.denied)).toMatchObject({ reason: "FRIENDLY_LIMIT_REACHED", limit: 20 });
    expect(t.denied("a")).toBe("OPPONENT_CANT_PLAY");
    expect(t.hall.ring("R3")).toMatchObject({ status: "waiting", red: { sid: "a" } });
    expect(t.hall.ring("R3")!.blue).toBeUndefined();
  });

  it("rate limited", async () => {
    const t = setup();
    t.add("a", "ua");
    for (let i = 0; i < boxingHallConfig.actionMax + 1; i++) t.hall.onWatch("a", { ring: i % 2 ? "R3" : "R4" });
    expect(t.denied("a")).toBe("RATE_LIMITED");
  });
});

describe("quick fight by rating (P3-FGT-10)", () => {
  it("the window starts narrow and widens with the wait", () => {
    expect(matchWindow(0)).toBe(150);
    expect(matchWindow(5_000)).toBe(250);
    expect(matchWindow(60_000)).toBe(Infinity);
  });
  it("pairs the closest rating in the window; a far rating waits until the window has widened", async () => {
    const t = setup({ ratings: { ua: 1500, ub: 1900, uc: 1560, ud: 2000 } });
    for (const [sid, uid] of [["a", "ua"], ["b", "ub"], ["c", "uc"], ["d", "ud"]] as const) t.add(sid, uid);
    await t.hall.onQuick("a", { stake: 10 });
    await t.hall.onQuick("b", { stake: 10 });
    // 400 apart: not yet
    expect(t.started).toHaveLength(0);
    expect(t.hall.queued(10)).toBe(2);
    // c (1560) is 60 from a and 340 from b: paired with a
    await t.hall.onQuick("c", { stake: 10 });
    expect(t.started[0]).toMatchObject({ red: { userId: "ua" }, blue: { userId: "uc" } });
    // d (2000) is 100 from b: paired with b
    await t.hall.onQuick("d", { stake: 10 });
    expect(t.started[1]).toMatchObject({ red: { userId: "ub" }, blue: { userId: "ud" } });
  });
});

describe("quick fight, practice, leave, watch", () => {
  it("quick: the second at the same stake is paired into a free ring; cancel leaves the queue", async () => {
    const t = setup();
    t.add("a", "ua");
    t.add("b", "ub");
    t.add("c", "uc");
    await t.hall.onQuick("a", { stake: 50 });
    expect(t.last("a", BoxingHallEvt.quick)).toEqual({ status: "waiting", stake: 50 });
    await t.hall.onQuick("c", { stake: 25 });
    expect(t.hall.queued(25)).toBe(1);
    t.hall.onQuickCancel("c");
    expect(t.hall.queued(25)).toBe(0);
    await t.hall.onQuick("b", { stake: 50 });
    expect(t.started[0]).toMatchObject({ ring: "R3", stake: 50, red: { userId: "ua" }, blue: { userId: "ub" } });
    expect(t.last("a", BoxingHallEvt.assigned)).toEqual({ ring: "R3", corner: "red" });
    expect(t.hall.ring("R3")!.status).toBe("starting");
  });

  it("practice: guests may; the ring shows the local score; leave frees it", async () => {
    const t = setup();
    t.add("g", undefined);
    t.hall.onPractice("g", { ring: "R3" });
    expect(t.hall.ring("R3")).toMatchObject({ status: "practice", red: { sid: "g" } });
    t.hall.onPracticeScore("g", { round: 2, score: [7, 4] });
    expect(t.hall.ring("R3")).toMatchObject({ round: 2, score: { red: 7, blue: 4 } });
    t.hall.onLeave("g");
    expect(t.hall.ring("R3")).toMatchObject({ status: "free" });
    expect(t.hall.ring("R3")!.red).toBeUndefined();
    t.hall.onLeave("g");
    expect(t.denied("g")).toBe("NOT_IN_RING");
  });

  it("leaving the hall frees a waiting ring; a running fight keeps it and a hall Leave goes to the fight room", async () => {
    const t = setup();
    t.add("a", "ua");
    t.add("b", "ub");
    t.add("c", "uc");
    await t.hall.onClaim("c", { ring: "R3", stake: 0 });
    t.people.delete("c");
    t.hall.left("c");
    expect(t.hall.ring("R3")!.status).toBe("free");
    await t.hall.onClaim("a", { ring: "R3", stake: 0 });
    await t.hall.onJoin("b", { ring: "R3" });
    t.hall.onLeave("a");
    expect(t.left).toEqual([["room1", "ua"]]);
    t.hall.left("b");
    expect(t.hall.ring("R3")!.status).toBe("starting");
    // b reloads: the ring is theirs again with the fight room
    t.add("b2", "ub");
    expect(t.hall.ring("R3")!.blue!.sid).toBe("b2");
    expect(t.last("b2", BoxingHallEvt.fightReady)).toMatchObject({ roomId: "room1", corner: "blue" });
  });

  it("fight status + spectator frames relay to watchers (cap); result shows, then the ring frees", async () => {
    const t = setup();
    t.add("a", "ua");
    t.add("b", "ub");
    t.add("w", undefined);
    await t.hall.onClaim("a", { ring: "R3", stake: 0 });
    await t.hall.onJoin("b", { ring: "R3" });
    t.hall.onWatch("w", { ring: "R3" });
    expect(t.hall.ring("R3")!.watchers).toBe(1);
    t.hall.fightStatus("R3", "m1", { status: "fighting", round: 1, score: { red: 3, blue: 1 } });
    expect(t.hall.ring("R3")).toMatchObject({ status: "fighting", round: 1, score: { red: 3, blue: 1 } });
    t.hall.fightStatus("R3", "stale", { round: 3 }); // another match id: ignored
    expect(t.hall.ring("R3")!.round).toBe(1);
    const snap = { ring: "R3", tick: 5 } as never;
    t.hall.fightFrame("R3", "m1", snap, [{ k: "bell", t: 5, round: 1 }]);
    expect(t.last("w", BoxingHallEvt.frame)).toEqual(snap);
    expect(t.last("w", BoxingHallEvt.events)).toEqual([{ k: "bell", t: 5, round: 1 }]);
    // AOI: fighters in a running fight send no world moves; far people are not sent
    expect(t.hall.sendsMove({ x: 0, z: 0 }, { id: "a", x: 0, z: 0 })).toBe(false);
    expect(t.hall.sendsMove({ x: 0, z: 0 }, { id: "w", x: 2300, z: 0 })).toBe(true);
    expect(t.hall.sendsMove({ x: 0, z: 0 }, { id: "w", x: 2500, z: 0 })).toBe(false);
    t.hall.fightOver("R3", "m1", { score: { red: 30, blue: 20 }, round: 3 });
    expect(t.hall.ring("R3")).toMatchObject({ status: "result", score: { red: 30, blue: 20 } });
    t.timers.forEach((f) => f());
    expect(t.hall.ring("R3")).toMatchObject({ status: "free", watchers: 1 });
    t.hall.onWatch("w", { ring: null });
    expect(t.hall.ring("R3")!.watchers).toBe(0);
    // the spectator rail holds RING_WATCHERS_MAX
    for (let i = 0; i < RING_WATCHERS_MAX; i++) {
      t.add(`s${i}`, undefined);
      t.hall.onWatch(`s${i}`, { ring: "R4" });
    }
    t.add("late", undefined);
    t.hall.onWatch("late", { ring: "R4" });
    expect(t.denied("late")).toBe("HALL_FULL");
    await tick();
  });

  it("proposal accepted in the hall: a free ring and a fight room for both", async () => {
    const t = setup();
    t.add("a", "ua");
    t.add("b", "ub");
    const m = await t.hall.assignProposal("a", "b", 100);
    expect(m).toEqual({ ring: "R3", roomId: "room1", matchId: "m1" });
    await expect(t.hall.assignProposal("a", "b", 100)).rejects.toThrow("ALREADY_IN_MATCH");
  });
});
