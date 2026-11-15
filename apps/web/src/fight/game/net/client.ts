"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { Client, type Room } from "colyseus.js";
import {
  BoxingHallEvt,
  BoxingHallMsg,
  DEFAULT_FIGHT_RULES,
  FightEvt,
  FightMsg,
  type BoxingAction,
  type BoxingOutcome,
  type BoxingSnapshot,
  type Corner,
  type FightEvent,
  type FightRules,
  type RingId,
  type RingState,
} from "@gukirana/contracts";
import { onRoomMessage, roomSend } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { notify } from "@/social/social-store";
import { useFightBridge, type MyFight } from "../../bridge";
import { registerLiveFight, type LiveFight } from "../actions";
import { useFightUi } from "../ui-store";
import { denialText, fn } from "./strings";

/**
 * The live Boxing client (P3-FGT-01, FIGHT-GAMES-PLAN §3, §7): the Boxing hall room's ring messages (through the shared
 * hall connection, lib/realtime `onRoomMessage` / `roomSend`) and the authoritative fight room (its own connection).
 * It writes the bridge (`rings`, `watched`, `mine`, `myEvents`) and the HUD feed (`useFightUi.push`), and plugs the
 * live half of `fightActions` in (`registerLiveFight`). The server decides everything; the client only sends presses.
 */

/** state of the live client the ring prompts may read (quick fight queue, last refusal) */
export interface BoxingNetState {
  quick: { status: "idle" | "waiting"; stake?: number };
  /** the last refusal in plain words (the prompt can show it next to the button) */
  denied: { action: string; reason: string; text: string; ring?: RingId; at: number } | null;
  /** my ring in this hall (assigned by the server), live or practice */
  ring: { id: RingId; corner: Corner } | null;
}
export const useBoxingNet = create<BoxingNetState>()(() => ({ quick: { status: "idle" }, denied: null, ring: null }));

function realtimeUrl(): string {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:2567`;
}

/* ------------------------------------------------------------ the fight room ------------------------------------------------------------ */

interface FightInit {
  you: string;
  seat: 0 | 1;
  corner: Corner;
  ring: RingId;
  matchId: string;
  stake: number;
  players: { userId: string; seat: number; name: string }[];
  fight: FightRules;
  begun: boolean;
}
interface FightResultMsg {
  ranks: Record<string, number>;
  reason: "normal" | "forfeit" | "void";
  cause?: string;
  loser?: string;
  outcome: BoxingOutcome | null;
  /** the signed result's state hash (P3-FGT-06): shown in the fight record */
  stateHash?: string;
  settlement: { xp?: Record<string, number> } | null;
  pending?: boolean;
}

let fightRoom: Room | null = null;
let fightRoomId: string | null = null;
let me: string | null = null;
let seq = 0;
let guardHeld = true;
let pinger: ReturnType<typeof setInterval> | null = null;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

const setMine = (patch: Partial<MyFight>) => {
  const cur = useFightBridge.getState().mine;
  if (!cur || cur.mode !== "live") return;
  useFightBridge.setState({ mine: { ...cur, ...patch } });
};

function closeFight(): void {
  if (pinger) clearInterval(pinger);
  if (readyTimer) clearTimeout(readyTimer);
  pinger = null;
  readyTimer = null;
  const r = fightRoom;
  fightRoom = null;
  fightRoomId = null;
  void r?.leave(true).catch(() => undefined);
}

/** Stars I won / lost from the ranks (the API pays the whole pot to the winner; a draw / void returns the stake) */
function starsFor(r: FightResultMsg, stake: number): number {
  if (!me || r.reason === "void") return 0;
  const mine = r.ranks[me];
  const best = Math.min(...Object.values(r.ranks));
  const winners = Object.values(r.ranks).filter((x) => x === best).length;
  if (winners > 1) return 0;
  return mine === best ? stake : -stake;
}

async function openFight(m: { ring: RingId; roomId: string; matchId: string; corner: Corner; stake: number; rules?: FightRules }): Promise<void> {
  if (fightRoomId === m.roomId && fightRoom) return;
  closeFight();
  fightRoomId = m.roomId;
  seq = 0;
  guardHeld = true;
  useFightUi.getState().clear();
  useFightBridge.setState({
    mine: { ring: m.ring, corner: m.corner, mode: "live", stake: m.stake, rules: m.rules ?? DEFAULT_FIGHT_RULES, snap: null, predicted: null, begun: false, settled: null },
    myEvents: [],
  });
  let room: Room;
  try {
    room = await new Client(realtimeUrl()).joinById(m.roomId, { token: useSession.getState().accessToken });
  } catch {
    if (fightRoomId === m.roomId) fightRoomId = null;
    notify(fn("fight.connectFailed"));
    return;
  }
  if (fightRoomId !== m.roomId) return void room.leave(true).catch(() => undefined);
  fightRoom = room;
  room.onMessage("init", (i: FightInit) => {
    me = i.you;
    const names = [0, 1].map((s) => i.players.find((p) => p.seat === s)?.name ?? "") as [string, string];
    setMine({ corner: i.corner, ring: i.ring, stake: i.stake, rules: i.fight ?? DEFAULT_FIGHT_RULES, names, begun: i.begun });
  });
  room.onMessage(FightEvt.snap, (snap: BoxingSnapshot) => {
    const cur = useFightBridge.getState().mine;
    if (!cur || cur.mode !== "live") return;
    // a prediction older than a snapshot round trip is dropped: the server's act wins
    const pred = cur.predicted && performance.now() - cur.predicted.at < 250 ? cur.predicted : null;
    setMine({ snap, predicted: pred });
  });
  room.onMessage(FightEvt.events, (events: FightEvent[]) => {
    const cur = useFightBridge.getState().mine;
    // "first move": any punch / defence after the bell (the server decides; this only words the Leave dialog)
    const begun = cur?.begun || events.some((e) => e.k === "hit" || e.k === "block" || e.k === "evade" || e.k === "whiff");
    if (begun && !cur?.begun) setMine({ begun: true });
    useFightBridge.setState((s) => ({ myEvents: [...s.myEvents, ...events].slice(-64) }));
    useFightUi.getState().push(events);
  });
  room.onMessage(FightEvt.result, (r: FightResultMsg) => {
    const cur = useFightBridge.getState().mine;
    const xp = me ? (r.settlement?.xp?.[me] ?? 0) : 0;
    setMine({ settled: { stars: starsFor(r, cur?.stake ?? 0), xp } });
    useFightUi.getState().setRecord({ id: m.matchId, hash: r.stateHash ?? null, kind: "match" });
    // the result card reads the outcome from the feed: make sure it is there even when no `over` event came
    if (r.outcome && !useFightUi.getState().result) useFightUi.getState().push([{ k: "over", t: cur?.snap?.tick ?? 0, result: r.outcome }]);
  });
  room.onMessage(FightEvt.rejected, () => undefined);
  room.onMessage(FightEvt.pong, () => undefined);
  room.onMessage(FightEvt.pause, () => undefined);
  room.onMessage("timeout", () => undefined);
  room.onMessage("player-removed", () => undefined);
  room.onLeave(() => {
    if (fightRoom === room) {
      fightRoom = null;
      if (pinger) clearInterval(pinger);
      pinger = null;
    }
  });
  // keep-alive (the room treats 3 s of silence as a time-out) + gloving up: ready after a short beat
  pinger = setInterval(() => room.send(FightMsg.ping, { t: Date.now() }), 1000);
  readyTimer = setTimeout(() => room.send(FightMsg.ready), 1200);
}

/* ------------------------------------------------------------ the hall room ------------------------------------------------------------ */

let started = 0;
let offs: (() => void)[] = [];

function ringsToMap(list: RingState[]) {
  const rings: Partial<Record<RingId, RingState>> = {};
  for (const r of list) rings[r.id] = r;
  return rings;
}

const live: LiveFight = {
  claim: (ring, stake) => void roomSend(BoxingHallMsg.claim, { ring, stake }),
  join: (ring) => {
    const stake = useFightBridge.getState().rings[ring]?.stake;
    roomSend(BoxingHallMsg.join, stake !== undefined ? { ring, stake } : { ring });
  },
  leave: () => {
    const mine = useFightBridge.getState().mine;
    if (mine?.mode === "live") {
      // finished: just step out; running: the room applies the exit rules (void before the first move, else forfeit)
      if (!mine.settled && fightRoom) fightRoom.send(FightMsg.resign);
      else {
        closeFight();
        useFightBridge.setState({ mine: null, myEvents: [] });
        useFightUi.getState().clear();
      }
    }
    roomSend(BoxingHallMsg.leave, {});
  },
  quick: (stake) => void roomSend(BoxingHallMsg.quick, { stake }),
  quickCancel: () => void roomSend(BoxingHallMsg.quickCancel, {}),
  watch: (ring) => {
    roomSend(BoxingHallMsg.watch, { ring });
    useFightBridge.setState({ watched: ring ? { ring, snap: null, events: [] } : null });
  },
  practiceStart: (ring) => void roomSend(BoxingHallMsg.practice, { ring }),
  practiceScore: (_ring, round, score) => void roomSend(BoxingHallMsg.practiceScore, { round, score }),
  press: (a: BoxingAction, body?: boolean) => {
    if (!fightRoom) return;
    fightRoom.send(FightMsg.input, { seq: ++seq, a, g: guardHeld, ...(body ? { b: true } : {}) });
    const snap = useFightBridge.getState().mine?.snap;
    setMine({ predicted: { act: a, at: performance.now() }, ...(snap?.phase === "round" ? { begun: true } : {}) });
  },
  guard: (g: boolean) => {
    if (!fightRoom || g === guardHeld) return;
    guardHeld = g;
    fightRoom.send(FightMsg.input, { seq: ++seq, g });
  },
  /** engine v2 footwork: the held direction, sent when it changes (the server keeps it until the next one) */
  move: (mv: [number, number]) => {
    if (!fightRoom) return;
    fightRoom.send(FightMsg.input, { seq: ++seq, g: guardHeld, mv });
  },
};

/** start the live client (idempotent, reference counted). The Boxing hall scene mounts it with `useBoxingNet`. */
export function startBoxingNet(): () => void {
  if (started++ === 0) {
    offs = [
      onRoomMessage<RingState[]>(BoxingHallEvt.rings, (list) => useFightBridge.setState({ rings: ringsToMap(list) })),
      onRoomMessage<RingState>(BoxingHallEvt.ring, (r) => useFightBridge.setState((s) => ({ rings: { ...s.rings, [r.id]: r } }))),
      onRoomMessage<{ action: string; reason: string; ring?: RingId; limit?: number }>(BoxingHallEvt.denied, (d) => {
        const text = denialText(d.reason, d.limit);
        useBoxingNet.setState({ denied: { action: d.action, reason: d.reason, text, ring: d.ring, at: Date.now() } });
        notify(text);
        // a live fight that could not be created: back to the hall
        const mine = useFightBridge.getState().mine;
        if (mine?.mode === "live" && !mine.snap && (d.action === "join" || d.action === "quick")) {
          closeFight();
          useFightBridge.setState({ mine: null });
        }
      }),
      onRoomMessage<{ ring: RingId | null; corner?: Corner }>(BoxingHallEvt.assigned, (a) =>
        useBoxingNet.setState({ ring: a.ring && a.corner ? { id: a.ring, corner: a.corner } : null }),
      ),
      onRoomMessage<{ ring: RingId; roomId: string; matchId: string; corner: Corner; stake: number; rules?: FightRules }>(BoxingHallEvt.fightReady, (m) => void openFight(m)),
      onRoomMessage<BoxingSnapshot>(BoxingHallEvt.frame, (snap) =>
        useFightBridge.setState((s) => (s.watched && s.watched.ring === snap.ring ? { watched: { ...s.watched, snap } } : s)),
      ),
      onRoomMessage<FightEvent[]>(BoxingHallEvt.events, (events) =>
        useFightBridge.setState((s) => (s.watched ? { watched: { ...s.watched, events: [...s.watched.events, ...events].slice(-32) } } : s)),
      ),
      onRoomMessage<{ n: number }>(BoxingHallEvt.ping, (p) => void roomSend(BoxingHallMsg.pong, { n: p.n })),
      onRoomMessage<{ status: "idle" | "waiting"; stake?: number }>(BoxingHallEvt.quick, (q) => useBoxingNet.setState({ quick: q })),
    ];
    registerLiveFight(live);
  }
  return () => {
    if (--started > 0) return;
    for (const off of offs) off();
    offs = [];
    registerLiveFight({});
    closeFight();
    useFightBridge.setState({ rings: {}, watched: null, ...(useFightBridge.getState().mine?.mode === "live" ? { mine: null, myEvents: [] } : {}) });
    useBoxingNet.setState({ quick: { status: "idle" }, denied: null, ring: null });
  };
}

/** React: the live client runs while the Boxing hall is mounted (W's scene calls this once). */
export function useBoxingNetClient(): void {
  useEffect(() => startBoxingNet(), []);
}

/** test hook: the live implementation that was registered */
export const liveFightImpl = live;
