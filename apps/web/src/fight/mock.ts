"use client";
import {
  DEFAULT_FIGHT_RULES,
  RING_IDS,
  TICK_HZ,
  type BoxingSnapshot,
  type Corner,
  type FighterAct,
  type FighterView,
  type FightEvent,
  type Punch,
  type RingId,
  type RingState,
  type RingStatus,
} from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { fightActions, setFightActions, type FightActions, fightLog } from "./actions";
import { gameFightActions } from "./game/actions";
import { useFightBridge } from "./bridge";
import { ringSteps as kitSteps } from "@/rooms/fight/ring-kit-core";
import { kitSpec } from "./climb";
import { RING_BY_ID } from "./plan";

/**
 * W's test bed until G's boxing client lands (P3-FGT-01 §9 speed plan): behind `?fightmock=1` it fills the bridge with
 * a scripted hall — about a dozen rings in each live status — and loops fake fights with scripted snapshots (any
 * fighting ring you watch, the feature fights, and your own claim / practice). It installs a scripted `fightActions`
 * that logs every call (fight/actions.ts fightLog + console) and updates the bridge like the server would.
 * Deterministic: everything is a function of the ring id and the clock (no Math.random).
 */

export const fightMockOn = () => typeof window !== "undefined" && new URLSearchParams(location.search).get("fightmock") === "1";

const NAMES = ["Aline", "Eric", "Diane", "Jean-Paul", "Clarisse", "Patrick", "Grace", "Olivier", "Sandrine", "Emmanuel", "Josiane", "Fabrice", "Nadia", "Yves", "Chantal", "Innocent", "Vestine", "Kevin", "Solange", "Thierry"];
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const name = (k: string) => NAMES[hash(k) % NAMES.length]!;

/** a dozen-ish rings in each live status (the rest free); R1 / R2 feature fights */
function statusOf(id: RingId, i: number): RingStatus {
  if (id === "R1" || id === "R2") return "fighting";
  const k = hash(id) % 10;
  return i === 30 ? "closed" : k < 3 ? "fighting" : k < 5 ? "waiting" : k === 5 ? "practice" : k === 6 ? "starting" : k === 7 ? "result" : "free";
}
const fighter = (id: RingId, corner: Corner) => ({ sid: `mock-${id}-${corner}`, name: name(`${id}${corner}`), corner, level: 3 + (hash(id + corner) % 20) });

function mockRings(): Partial<Record<RingId, RingState>> {
  const out: Partial<Record<RingId, RingState>> = {};
  RING_IDS.forEach((id, i) => {
    const status = statusOf(id, i);
    const r: RingState = { id, status, watchers: status === "fighting" ? hash(id) % 9 : 0, since: 0 };
    if (status !== "free" && status !== "closed") r.red = fighter(id, "red");
    if (status === "fighting" || status === "starting" || status === "result") r.blue = fighter(id, "blue");
    if (status === "waiting" || status === "fighting" || status === "starting") r.stake = [0, 25, 50, 100][hash(id + "s") % 4];
    if (status === "fighting" || status === "result" || status === "practice") {
      r.round = 1 + (hash(id + "r") % 3);
      r.rounds = 3;
      r.score = { red: 8 + (hash(id + "a") % 20), blue: 6 + (hash(id + "b") % 20) };
    }
    out[id] = r;
  });
  return out;
}

/* ---------------- scripted fight: a pure function of (ring, tick) ---------------- */

/** each fighter loops a script of (act, ticks); the blue corner runs it offset so the exchanges interleave */
const SCRIPT: [FighterAct, number][] = [
  ["idle", 14],
  ["jab", 12],
  ["idle", 8],
  ["cross", 16],
  ["idle", 10],
  ["slipL", 12],
  ["hook", 18],
  ["idle", 8],
  ["blockHit", 9],
  ["stepIn", 10],
  ["uppercut", 18],
  ["idle", 12],
  ["stepOut", 10],
  ["jab", 12],
  ["jab", 12],
  ["slipR", 12],
  ["idle", 10],
];
const SCRIPT_LEN = SCRIPT.reduce((a, [, n]) => a + n, 0);
const PUNCH_OF: Partial<Record<FighterAct, Punch>> = { jab: "jab", cross: "cross", hook: "hook", uppercut: "uppercut" };
function actAt(t: number): { act: FighterAct; actT: number } {
  let k = ((t % SCRIPT_LEN) + SCRIPT_LEN) % SCRIPT_LEN;
  for (const [act, n] of SCRIPT) {
    if (k < n) return { act, actT: k };
    k -= n;
  }
  return { act: "idle", actT: 0 };
}
const stageOf = (act: FighterAct, actT: number) => (PUNCH_OF[act] ? (actT < 4 ? "windup" : actT < 8 ? "active" : "recovery") : "none");

const ROUND_T = 60 * TICK_HZ;
const REST_T = 15 * TICK_HZ;
/** one fight loop: intro (3 s), 3 rounds with rests, the result (6 s); restarts */
const LOOP_T = 3 * TICK_HZ + 3 * ROUND_T + 2 * REST_T + 6 * TICK_HZ;

export function mockSnapshot(ring: RingId, tick: number, ids: [string, string] = [`mock-${ring}-red`, `mock-${ring}-blue`]): BoxingSnapshot {
  const off = hash(ring) % LOOP_T;
  const t = (tick + off) % LOOP_T;
  let phase: BoxingSnapshot["phase"] = "intro";
  let round = 1;
  let left = 3 * TICK_HZ - t;
  let inRound = 0;
  if (t >= 3 * TICK_HZ) {
    let u = t - 3 * TICK_HZ;
    phase = "over";
    left = 0;
    for (let r = 1; r <= 3; r++) {
      if (u < ROUND_T) {
        phase = "round";
        round = r;
        left = ROUND_T - u;
        inRound = u;
        break;
      }
      u -= ROUND_T;
      if (r < 3) {
        if (u < REST_T) {
          phase = "rest";
          round = r;
          left = REST_T - u;
          break;
        }
        u -= REST_T;
      }
      round = 3;
    }
  }
  const pts = (k: number) => Math.floor((round - 1) * 9 + inRound / (55 + k * 7));
  const view = (i: 0 | 1): FighterView => {
    const corner: Corner = i === 0 ? "red" : "blue";
    const a = phase === "round" ? actAt(inRound + i * 37) : { act: phase === "over" ? (i === 0 ? "celebrate" : "dejected") : "idle", actT: t % 60 };
    return {
      id: ids[i],
      corner,
      act: a.act as FighterAct,
      actT: a.actT,
      stage: stageOf(a.act as FighterAct, a.actT),
      guard: a.act !== "idle" || inRound % 90 > 20,
      stamina: 1000 - Math.floor((inRound / ROUND_T) * 500),
      composure: 800,
      points: pts(i),
      knockdowns: 0,
      warnings: 0,
      connected: true,
    };
  };
  const dist = 150 + Math.round(30 * Math.sin(t / 47));
  const orbit = Math.round((t * 0.9) % 3600);
  return { ring, tick: t, phase, round, rounds: 3, left: Math.max(0, left), dist, orbit, fighters: [view(0), view(1)] };
}

/** the hits of one tick of the script (a punch landing at its first active tick, alternately clean / blocked) */
function mockEvents(s: BoxingSnapshot): FightEvent[] {
  const out: FightEvent[] = [];
  s.fighters.forEach((f, i) => {
    const p = PUNCH_OF[f.act];
    if (!p || f.actT !== 5 || s.phase !== "round") return;
    const clean = (s.tick + i) % 3 !== 0;
    out.push(clean ? { k: "hit", t: s.tick, by: i as 0 | 1, punch: p, points: p === "jab" ? 1 : 2, counter: false, combo: 1 } : { k: "block", t: s.tick, by: i as 0 | 1, punch: p });
  });
  return out;
}

/** QA: where to stand for a ring's red steps, and a camera that sees the climb (screenshots) */
function qaPlace(id: RingId) {
  const r = RING_BY_ID[id];
  if (!r) return null;
  const s = kitSteps(kitSpec(r), "red");
  // the camera stands in the aisle in front of the ring, looking along the side with the steps
  return { fx: s.foot.x, fz: s.foot.z, yaw: s.foot.yaw, cx: s.foot.x + (s.top.x - s.foot.x) * 0.3, cz: r.z + r.half + 2.6, lx: s.top.x, lz: s.top.z };
}

/* ---------------- running it ---------------- */

let timer: ReturnType<typeof setInterval> | null = null;
let t0 = 0;
const nowTick = () => Math.floor(((performance.now() - t0) / 1000) * TICK_HZ);

export function startFightMock() {
  if (timer || !fightMockOn()) return;
  t0 = performance.now();
  useFightBridge.setState({ mock: true, rings: mockRings(), watched: null, mine: null, myEvents: [] });
  const set = (id: RingId, p: Partial<RingState>) => {
    const r = useFightBridge.getState().rings[id] ?? { id, status: "free" as RingStatus, watchers: 0, since: 0 };
    useFightBridge.setState({ rings: { ...useFightBridge.getState().rings, [id]: { ...r, ...p, since: Date.now() } } });
  };
  const me = () => {
    const w = useWorld.getState();
    return { sid: w.you ?? "me", name: "You" };
  };
  const log =
    (action: keyof FightActions) =>
    (...args: unknown[]) => {
      fightLog.push({ action, args, at: Date.now() });
      console.info("[fightActions mock]", action, ...args);
    };
  const actions: FightActions = {
    claim: (ring, stake) => {
      log("claim")(ring, stake);
      set(ring, { status: "waiting", red: { ...me(), corner: "red" }, stake });
      // a scripted opponent turns up after 4 s
      setTimeout(() => {
        if (useFightBridge.getState().rings[ring]?.status !== "waiting") return;
        set(ring, { status: "starting", blue: fighter(ring, "blue") });
        startMine(ring, "red", "live", stake);
      }, 4000);
    },
    join: (ring) => {
      log("join")(ring);
      set(ring, { status: "starting", blue: { ...me(), corner: "blue" } });
      startMine(ring, "blue", "live", useFightBridge.getState().rings[ring]?.stake ?? 0);
    },
    leave: () => {
      log("leave")();
      const m = useFightBridge.getState().mine;
      if (m?.mode === "practice") gameFightActions.leave();
      const you = me().sid;
      const held = Object.values(useFightBridge.getState().rings).find((r) => r && (r.red?.sid === you || r.blue?.sid === you));
      const id = m?.ring ?? held?.id;
      if (id) set(id, { status: "free", red: undefined, blue: undefined, stake: undefined, score: undefined });
      useFightBridge.setState({ mine: null });
    },
    quick: (stake) => log("quick")(stake),
    quickCancel: () => log("quickCancel")(),
    practice: (ring, level) => {
      // the real local practice engine (fight/game); the mock only marks the ring in its registry
      log("practice")(ring, level);
      set(ring, { status: "practice", red: { ...me(), corner: "red" }, round: 1, rounds: 3, score: { red: 0, blue: 0 } });
      gameFightActions.practice(ring, level);
    },
    watch: (ring) => {
      log("watch")(ring);
      useFightBridge.setState({ watched: ring ? { ring, snap: null, events: [] } : null });
    },
  };
  const startMine = (ring: RingId, corner: Corner, mode: "live" | "practice", stake: number) => {
    useFightBridge.setState({ mine: { ring, corner, mode, stake, rules: DEFAULT_FIGHT_RULES, snap: null, predicted: null } });
    setTimeout(() => set(ring, { status: mode === "practice" ? "practice" : "fighting", round: 1, rounds: 3, score: { red: 0, blue: 0 } }), 1500);
  };
  setFightActions(actions);
  // 10 Hz: snapshots for the watched ring and my fight, scores on the registry
  timer = setInterval(() => {
    const b = useFightBridge.getState();
    const tick = nowTick();
    const patch: Partial<typeof b> = {};
    if (b.watched) {
      const st = b.rings[b.watched.ring]?.status;
      const live = st === "fighting" || st === "practice" || st === "result";
      const snap = live ? mockSnapshot(b.watched.ring, tick) : null;
      patch.watched = { ring: b.watched.ring, snap, events: snap ? mockEvents(snap) : [] };
    }
    if (b.mine && b.mine.mode === "live" && b.rings[b.mine.ring]?.status === "fighting") {
      const r = b.rings[b.mine.ring]!;
      const ids: [string, string] = [r.red?.sid ?? "a", r.blue?.sid ?? `ai-${b.mine.ring}`];
      const snap = mockSnapshot(b.mine.ring, tick, ids);
      patch.mine = { ...b.mine, snap };
      const ev = mockEvents(snap);
      if (ev.length) patch.myEvents = [...b.myEvents, ...ev].slice(-20);
    }
    if (Object.keys(patch).length) useFightBridge.setState(patch);
  }, 100);
  if (process.env.NODE_ENV !== "production") Object.assign(window as unknown as Record<string, unknown>, { __gkFight: { bridge: useFightBridge, actions: fightActions, log: fightLog, snapshot: mockSnapshot, place: qaPlace } });
}

export function stopFightMock() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  setFightActions(null);
  useFightBridge.setState({ mock: false, rings: {}, watched: null, mine: null, myEvents: [] });
}
