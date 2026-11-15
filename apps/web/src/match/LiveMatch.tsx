"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { rememberOutcome } from "@/social/people";
import { useRouter, useSearchParams } from "next/navigation";
import { Client, type Room } from "colyseus.js";
import { Handshake, Loader2, WifiOff } from "lucide-react";
import { legalPits, type IgisoroState } from "@gukirana/igisoro";
import { HOME, movableTokens, type LudoState } from "@gukirana/ludo";
import { newSeed } from "@gukirana/fairness";
import type { PoolIntent, PoolState } from "@gukirana/pool";
import { GameShell, Modal, ResultModal, TurnBanner, type PanelPlayer } from "@/games/GameShell";
import { IgisoroBoard, previewMove, useConfirmTap, useSowAnimation } from "@/games/IgisoroBoard";
import { LudoBoard, LudoControls, SeatLabel, type LudoHandOf } from "@/games/LudoBoard";
import { ludoHandSide } from "@/games/hand/ludo-hand";
import { opponentHandLook } from "@/games/hand/look";
import { useMyHandLook } from "@/games/hand/useHandLook";
import { eventMs, ludoNotice } from "@/games/LudoGame";
import { seatColors } from "@/games/ludo-board";
import { PoolTable } from "@/games/PoolTable";
import { GroupBalls } from "@/games/PoolGame";
import { useGamePrefs } from "@/games/feedback";
import { t } from "@/games/i18n";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";
import { loadMe, refreshSession, useSession } from "@/lib/session";
import { levelForXp } from "@/lib/profile-store";
import { returnPath } from "@/lib/return-point";
import { useMatch } from "@/lib/match-store";
import { useGameOffer } from "@/lib/games-offer";
import { clearActive, saveActive } from "@/lib/active-match";
import { PaperCard } from "@/ui/PaperCard";
import { mmss, tr } from "@/rules/strings";

interface PlayerInfo {
  userId: string;
  seat: number;
  name: string;
  color: string;
  rating: number;
}
interface Init {
  you: string;
  game: "igisoro" | "ludo" | "pool";
  stake: number;
  players: PlayerInfo[];
  commit: string;
  matchId: string;
  /** the rules this match runs with (the game's settings when it was created) */
  rules?: { turnSeconds: number; reconnectSeconds: number; maxTimeouts: number };
  /** someone has made a move (before that, leaving cancels the match) */
  started?: boolean;
  /** P2-NET-05: players away right now (ms left for them to come back) and my own reconnect budget */
  away?: { userId: string; ms: number }[];
  budget?: { dropsLeft: number; msLeft: number };
}
interface Presence {
  userId: string;
  connected: boolean;
  /** how long the room waits for them (ms) */
  ms?: number;
  budget?: { dropsLeft: number; msLeft: number };
  budgetOut?: boolean;
}
interface Result {
  ranks: Record<string, number>;
  reason: string;
  /** why: RESIGN | DISCONNECT | TIMEOUTS (forfeit) or the void cause (NO_SHOW, BOTH_DISCONNECTED, …) */
  cause?: string;
  loser?: string;
  /** the API couldn't be reached: the stale-escrow sweep refunds the stakes */
  pending?: boolean;
  seedReveal: string;
  settlement: { xp?: Record<string, number>; ratings?: Record<string, number> } | null;
}

const TURN_S = 30;
const RECONNECT_WINDOW_S = 60;
const MAX_TIMEOUTS = 3;

/** the result screen's one-line summary for every way a live match ends (docs/GAME-EXIT-RULES.md) */
function exitSummary(r: Result, won: boolean, draw: boolean, rules: { reconnectSeconds: number; maxTimeouts: number }): string {
  const key = (k: string) => k as Parameters<typeof t>[0];
  if (r.reason === "void") {
    if (r.pending) return t("exit.pending");
    return r.cause ? t(key(`exit.void${r.cause}`)) : t("exit.void");
  }
  if (r.reason === "forfeit" && r.cause) return t(key(`exit.forfeit${won ? "Won" : "Lost"}${r.cause}`), { secs: rules.reconnectSeconds, max: rules.maxTimeouts });
  if (r.reason === "forfeit") return won ? "Your opponent forfeited." : "You forfeited the match.";
  return draw ? "Draw: stakes returned." : won ? "Settled by the server: the pot is yours." : "Well played. Rematch?";
}

/** One connection per room, shared across React re-mounts (StrictMode) and released with a short delay. */
const joins = new Map<string, Promise<Room>>();
const pendingLeave = new Map<string, ReturnType<typeof setTimeout>>();
const tokenKey = (roomId: string) => `gk-match-rt:${roomId}`;
const saveToken = (roomId: string, r: Room) => {
  try {
    sessionStorage.setItem(tokenKey(roomId), r.reconnectionToken);
  } catch {
    /* private mode */
  }
};
const loadToken = (roomId: string) => {
  try {
    return sessionStorage.getItem(tokenKey(roomId));
  } catch {
    return null;
  }
};
const dropToken = (roomId: string) => {
  try {
    sessionStorage.removeItem(tokenKey(roomId));
  } catch {
    /* ignore */
  }
};

function realtimeUrl() {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
}

/** Reconnect with the stored token (same seat, inside the 60 s window), else join by id (page reload, new tab). */
async function connect(roomId: string): Promise<Room> {
  const client = new Client(realtimeUrl());
  const rt = loadToken(roomId);
  if (rt) {
    try {
      return await client.reconnect(rt);
    } catch {
      /* the window passed or the server restarted: join fresh below */
    }
  }
  // use the current access token; refresh only when there is none or the server refuses it (an extra refresh
  // racing the session bootstrap could rotate the refresh token out from under it and sign the player out)
  const join = () => client.joinById(roomId, { token: useSession.getState().accessToken, clientSeed: newSeed().slice(0, 32) });
  if (!useSession.getState().accessToken) await refreshSession();
  try {
    return await join();
  } catch (e) {
    // only an auth refusal is worth a token refresh; a network failure must never touch the session
    // (a failed refresh marks the player signed out and sends them to the gate mid-match)
    if (!/NOT_A_PLAYER|auth|token|unauthori/i.test(String((e as Error)?.message ?? e)) || !navigator.onLine) throw e;
    await refreshSession();
    return join();
  }
}

/** Live, server-authoritative match (plan P0-GMK-04). The client renders state and sends intents only. */
export function LiveMatch({ roomId }: { roomId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const me = useSession((s) => s.me);
  const status = useSession((s) => s.status);
  const autoMove = useGamePrefs((s) => s.autoMove);
  const room = useRef<Room | null>(null);
  const [init, setInit] = useState<Init | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [state, setState] = useState<any>(null);
  const prev = useRef<IgisoroState | null>(null);
  const [turn, setTurn] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [started, setStarted] = useState(false);
  const resultRef = useRef<Result | null>(null);
  resultRef.current = result;
  const [error, setError] = useState<string | null>(null);
  // P2-NET-05: the opponent who dropped and when the room stops waiting for them (local clock)
  const [offline, setOffline] = useState<{ userId: string; since: number; until: number } | null>(null);
  const [waitOpen, setWaitOpen] = useState(true);
  const [reconnecting, setReconnecting] = useState<{ until: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const budget = useRef<{ dropsLeft: number; msLeft: number } | null>(null);
  const reconnectS = useRef(RECONNECT_WINDOW_S);
  const [rolling, setRollingState] = useState(false);
  const rollStart = useRef(0);
  // the die tumbles for at least 600 ms even when the server answers instantly
  const setRolling = useCallback((on: boolean) => {
    if (on) {
      rollStart.current = Date.now();
      return setRollingState(true);
    }
    setTimeout(() => setRollingState(false), Math.max(0, rollStart.current + 600 - Date.now()));
  }, []);
  const [drawIn, setDrawIn] = useState<string | null>(null);
  const [drawOut, setDrawOut] = useState(false);
  const [banner, setBanner] = useState<{ id: number; text: string; tone: "info" | "good" | "bad" } | null>(null);
  const bannerId = useRef(0);
  const say = useCallback((text: string, tone: "info" | "good" | "bad" = "info") => setBanner({ id: ++bannerId.current, text, tone }), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { view, hl, hand, step, captured, lastCapture, animating, animate } = useSowAnimation();
  const confirmTap = useConfirmTap();
  const seatCols = seatColors(useGamePrefs((s) => s.colorBlind));
  const alive = useRef(true);
  const lastPool = useRef<PoolState | null>(null);
  const [poolBefore, setPoolBefore] = useState<PoolState | null>(null);

  useEffect(() => {
    if (!offline && !reconnecting) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [offline, reconnecting]);
  useEffect(() => setWaitOpen(true), [offline?.userId, offline?.since]);

  const attach = useCallback(
    (r: Room) => {
      r.removeAllListeners();
      room.current = r;
      saveToken(roomId, r);
      // QA hook (dev, or NEXT_PUBLIC_GK_QA=1): simulate a dropped connection (abnormal close, not a resign)
      if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") (window as unknown as { __gkMatch: unknown }).__gkMatch = { drop: () => r.connection.close(4010) };
      r.onMessage("init", (m: Init) => {
        setInit(m);
        if (m.started) setStarted(true);
        if (m.budget) budget.current = m.budget;
        if (m.rules?.reconnectSeconds) reconnectS.current = m.rules.reconnectSeconds;
        // remember the match for a reload / a new tab / another device (no secrets; cleared at the end)
        saveActive({ matchId: m.matchId, roomId, game: m.game, seat: m.players.find((p) => p.userId === m.you)?.seat });
        const gone = m.away?.find((a) => a.userId !== m.you);
        setOffline(gone ? { userId: gone.userId, since: Date.now(), until: Date.now() + gone.ms } : null);
      });
      r.onMessage("state", async (m: { state: unknown; turn: string | null; deadline: number; started?: boolean; paused?: boolean }) => {
        setTurn(m.turn);
        setPaused(!!m.paused);
        if (m.started) setStarted(true);
        setDeadline(m.deadline);
        setRolling(false);
        const s = m.state as IgisoroState & LudoState;
        if ("pits" in s && prev.current && s.lastEvents?.length && s.moveCount !== prev.current.moveCount) await animate(prev.current, s as IgisoroState);
        if ("pits" in s) prev.current = s as IgisoroState;
        // Pool: panels keep the position before a new shot until its replay has played (no spoilers)
        if ("balls" in s) {
          const ps = s as unknown as PoolState;
          const old = lastPool.current;
          if (old && ps.shots !== old.shots && (ps.lastShot?.frames.length ?? 0) > 1) setPoolBefore(old);
          lastPool.current = ps;
        }
        setState(s);
      });
      r.onMessage("rejected", (m: { reason: string }) => {
        setRolling(false);
        setError(`Move rejected: ${m.reason}`);
      });
      r.onMessage("presence", (m: Presence) => {
        if (m.connected && m.budget && m.userId === useSession.getState().me?.id) budget.current = m.budget;
        setOffline((o) => (m.connected ? (o?.userId === m.userId ? null : o) : { userId: m.userId, since: Date.now(), until: Date.now() + (m.ms ?? reconnectS.current * 1000) }));
      });
      r.onMessage("timeout", (m: { userId: string; strikes: number; max?: number }) => say(t("exit.timeout", { n: m.strikes, max: m.max ?? MAX_TIMEOUTS }), "bad"));
      r.onMessage("emote", () => undefined);
      r.onMessage("draw-offer", (m: { from: string }) => setDrawIn(m.from));
      r.onMessage("draw-declined", () => {
        setDrawOut(false);
        setDrawIn(null);
        say(t("game.drawDeclined"));
      });
      r.onMessage("result", (m: Result) => {
        setResult(m);
        dropToken(roomId);
        clearActive();
        void loadMe();
        // friendly games left / Stars changed: the next challenge sheet shows the new numbers
        void useGameOffer.getState().load(true);
      });
      // a dropped connection (network, sleep): reconnect with the token inside the server's 60 s window
      r.onLeave((code) => {
        if (!alive.current || resultRef.current || code === 1000 || code === 4000) return;
        // P2-NET-05: the room keeps the seat for min(reconnectSeconds, my budget left); retry with backoff until then
        const graceMs = Math.min(reconnectS.current * 1000, budget.current?.msLeft ?? Infinity);
        const until = Date.now() + graceMs;
        setReconnecting({ until });
        joins.delete(roomId);
        void (async () => {
          // a few seconds past the window: a fresh join still works if the room is waiting (and tells us if not)
          for (let i = 0; alive.current && !resultRef.current && Date.now() < until + 5000; i++) {
            await new Promise((res) => setTimeout(res, Math.min(5000, 500 * 2 ** i)));
            // offline: wait for the network to come back (inside the window) without spending a retry
            while (!navigator.onLine && alive.current && Date.now() < until) await new Promise((res) => setTimeout(res, 500));
            try {
              const nr = await connect(roomId);
              joins.set(roomId, Promise.resolve(nr));
              attach(nr);
              nr.send("sync");
              setReconnecting(null);
              return;
            } catch {
              /* retry */
            }
          }
          setReconnecting(null);
          clearActive();
          setError(t("exit.gone"));
        })();
      });
      r.send("sync");
    },
    [animate, roomId, say, setRolling],
  );

  useEffect(() => {
    alive.current = true;
    if (status === "loading") return;
    if (status === "anonymous" && !room.current) return void router.replace("/gate");
    if (status === "anonymous") return void (room.current ? undefined : router.replace("/gate"));
    let cancelled = false;
    const pending = pendingLeave.get(roomId);
    if (pending) {
      clearTimeout(pending);
      pendingLeave.delete(roomId);
    }
    (async () => {
      try {
        let join = joins.get(roomId);
        if (!join) {
          join = connect(roomId);
          joins.set(roomId, join);
        }
        const r = await join;
        if (cancelled) return;
        attach(r);
      } catch {
        joins.delete(roomId);
        // never be sent back here again (a stale "match ready" for this room)
        if (useMatch.getState().ready?.roomId === roomId) useMatch.setState({ ready: null });
        clearActive();
        setError(t("exit.gone"));
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
      // a real navigation away = disconnect (server keeps the seat for 60 s); a StrictMode re-mount cancels this
      pendingLeave.set(
        roomId,
        setTimeout(() => {
          pendingLeave.delete(roomId);
          void joins.get(roomId)?.then((r) => r.leave(false));
          joins.delete(roomId);
        }, 400),
      );
    };
  }, [attach, roomId, router, status]);

  const send = useCallback((intent: unknown) => {
    setError(null);
    room.current?.send("intent", intent);
  }, []);

  const game = (init?.game ?? params.get("game")) as "igisoro" | "ludo" | "pool";
  const stake = init?.stake ?? Number(params.get("stake") ?? 0);
  const myId = init?.you ?? me?.id ?? "";
  const myTurn = turn === myId && !result && !reconnecting; // no input into a dead socket
  const players = init?.players ?? [];
  const opp = players.filter((p) => p.userId !== myId);
  const meInfo = players.find((p) => p.userId === myId);
  const nameOf = useCallback((id: string) => (id === myId ? "You" : (players.find((p) => p.userId === id)?.name ?? "Opponent")), [myId, players]);
  // the real game hands (P2-GAME-07, presentation only): yours wears your avatar's look; an opponent's their seeded
  // default look (the match does not carry look codes) in their colour, coming from their side of the table
  const myHand = useMyHandLook();
  const handLookOf = useCallback((id: string) => (id === myId ? myHand : opponentHandLook(id, null, players.find((p) => p.userId === id)?.color)), [myHand, myId, players]);
  const ludoHandOf = useCallback<LudoHandOf>(
    (id) => {
      const p = players.find((x) => x.userId === id);
      if (!p) return null;
      return { side: ludoHandSide(p.seat, meInfo?.seat ?? 0), look: handLookOf(id), me: id === myId };
    },
    [handLookOf, meInfo?.seat, myId, players],
  );
  const oppHandLook = opp[0] ? handLookOf(opp[0].userId) : undefined;

  const ranks = result ? Object.values(result.ranks) : [];
  // a voided match (no-show, server error) also has equal ranks, but it is a refund, not a draw
  const draw = !!result && result.reason !== "void" && ranks.length > 1 && ranks.every((r) => r === 1);
  const won = !!result && result.reason !== "void" && result.ranks[myId] === 1 && !draw;
  // back among people after the match, the avatar celebrates / shakes its head (social/people.ts)
  useEffect(() => void (result && rememberOutcome(won ? "win" : draw ? "draw" : "loss")), [result, won, draw]);
  const starsDelta = result ? (won ? stake : draw ? 0 : result.reason === "void" ? 0 : -stake) : 0;

  // Ludo: banners and auto-move (one legal token)
  useEffect(() => {
    if (game !== "ludo" || !state) return;
    const n = ludoNotice(state as LudoState, nameOf);
    if (n) say(n.text, n.tone);
  }, [game, state?.lastEvent]);
  const ludoMovable = game === "ludo" && state && myTurn && (state as LudoState).phase === "move" ? movableTokens((state as LudoState).players.find((p) => p.id === myId)!, (state as LudoState).dice!) : [];
  useEffect(() => {
    if (!autoMove || ludoMovable.length !== 1) return;
    const tm = setTimeout(() => send({ type: "move", token: ludoMovable[0] }), 700 + eventMs(state as LudoState));
    return () => clearTimeout(tm);
  }, [autoMove, ludoMovable.join(","), send, state]);

  let board: React.ReactNode = (
    <p className="flex items-center gap-2 text-on-glass-muted">
      <Loader2 size={18} className="animate-spin" /> {t("game.waitingPlayers")}
    </p>
  );
  let footer: React.ReactNode = null;
  let detailMe: React.ReactNode = null;
  const detailOpp: Record<string, React.ReactNode> = {};

  if (state && game === "igisoro") {
    const s = state as IgisoroState;
    const mySide = (s.players.indexOf(myId) === 1 ? 1 : 0) as 0 | 1;
    const pits = view ?? s.pits;
    const seeds = (side: 0 | 1) => pits[side].reduce((a, b) => a + b, 0);
    const canPlay = myTurn && !animating;
    const legal = canPlay ? legalPits(s, mySide) : [];
    const preview = canPlay && selected !== null && legal.includes(selected) ? previewMove(s, selected) : null;
    const coarse = confirmTap;
    board = (
      <IgisoroBoard
        pits={pits}
        me={mySide}
        legal={legal}
        hl={hl}
        hand={hand}
        step={step}
        captured={captured}
        preview={preview}
        selected={selected}
        autoFocus={canPlay}
        oppLook={oppHandLook}
        onHover={(p) => (!coarse || p !== null) && setSelected(p)}
        onPick={(pit) => {
          if (coarse && selected !== pit) return setSelected(pit);
          setSelected(null);
          send({ pit });
        }}
      />
    );
    detailMe = <p className="num flex items-center gap-1 text-sm font-bold"><SeedsIcon size={14} /> {t("igisoro.seeds", { n: seeds(mySide) })}</p>;
    for (const o of opp) detailOpp[o.userId] = <p className="num flex items-center gap-1 text-sm font-bold"><SeedsIcon size={14} /> {t("igisoro.seeds", { n: seeds((1 - mySide) as 0 | 1) })}</p>;
    const gain = preview ? `${preview.gain >= 0 ? "+" : ""}${preview.gain}` : "";
    footer = <p className="min-h-6 text-center text-sm text-on-glass-muted">{canPlay ? (preview ? t(coarse ? "igisoro.previewTouch" : "igisoro.preview", { gain }) : t("igisoro.pick")) : ""}</p>;
  }
  if (state && game === "ludo") {
    const s = state as LudoState;
    board = <LudoBoard state={s} movable={ludoMovable} onMove={(token) => send({ type: "move", token })} myId={myId} handOf={ludoHandOf} />;
    for (const p of s.players) {
      const label = <SeatLabel seat={p.seat} home={p.tokens.filter((x) => x === HOME).length} />;
      if (p.id === myId) detailMe = label;
      else detailOpp[p.id] = label;
    }
    const cur = s.players[s.turn];
    footer = (
      <LudoControls
        die={s.dice ?? (s.lastEvent?.kind === "roll" ? s.lastEvent.dice : null)}
        rolling={rolling}
        color={seatCols[cur?.seat ?? 0]!}
        rollId={s.rolls}
        handOf={ludoHandOf}
        rollerId={cur?.id ?? null}
        throwerId={s.lastEvent?.kind === "roll" || s.lastEvent?.kind === "pass" ? s.lastEvent.player : null}
        canRoll={myTurn && s.phase === "roll"}
        onRoll={() => {
          setRolling(true);
          send({ type: "roll" });
        }}
        hint={myTurn ? (ludoMovable.length > 1 || !autoMove ? t("ludo.pickToken") : t("ludo.moving")) : t("game.theirTurn", { name: nameOf(cur?.id ?? "") })}
      />
    );
  }
  if (state && game === "pool") {
    const s = state as PoolState;
    const d = poolBefore ?? s;
    const mySide = (s.players.indexOf(myId) === 1 ? 1 : 0) as 0 | 1;
    board = <PoolTable state={s} mySide={mySide} myTurn={myTurn} guide="short" names={[nameOf(s.players[0]), nameOf(s.players[1])]} oppLook={oppHandLook} onShoot={(i: PoolIntent) => send(i)} onReplayDone={() => setPoolBefore(null)} />;
    detailMe = <GroupBalls s={d} side={mySide} />;
    for (const o of opp) detailOpp[o.userId] = <GroupBalls s={d} side={(1 - mySide) as 0 | 1} />;
    footer = d.lastShot ? <p className="text-center text-xs text-on-glass-muted sm:text-sm">{d.lastShot.message}</p> : null;
  }

  const rules = { turnSeconds: init?.rules?.turnSeconds ?? TURN_S, reconnectSeconds: init?.rules?.reconnectSeconds ?? RECONNECT_WINDOW_S, maxTimeouts: init?.rules?.maxTimeouts ?? MAX_TIMEOUTS };
  const offSecs = offline ? Math.max(0, (offline.until - now) / 1000) : 0;
  const reSecs = reconnecting ? Math.max(0, (reconnecting.until - now) / 1000) : 0;
  const oppName = opp[0]?.name ?? "Your opponent";
  // the Leave confirmation states the consequence right now (before the first move: a free cancel)
  const leaveNote = !state || !started ? t("exit.beforeStart") : stake > 0 ? t("exit.forfeitStake", { name: oppName, pot: stake * 2, stake }) : t("exit.forfeitFriendly", { name: oppName });
  const status_ = (
    <div className="flex flex-wrap items-center justify-center gap-x-3 text-xs font-semibold">
      {!turn && !result && <span className="text-on-glass-muted">{t("game.starting")}</span>}
      {offline && !result && offline.userId !== myId && (
        <span className="flex items-center gap-1 text-danger-soft">
          <WifiOff size={14} /> {t("game.oppOffline", { name: nameOf(offline.userId), secs: Math.ceil(offSecs) })}
        </span>
      )}
      {paused && offline && !result && <span className="text-on-glass-muted">{tr("net.clockPaused", { name: nameOf(offline.userId) })}</span>}
      {error && <span className="text-danger-soft">{error}</span>}
    </div>
  );

  const panel = (p: PlayerInfo | undefined, mine: boolean): PanelPlayer => ({
    name: mine ? (p?.name ?? me?.username ?? "You") : (p?.name ?? "Opponent"),
    color: game === "ludo" && p ? seatCols[p.seat]! : (p?.color ?? "#3DA9FC"),
    level: mine ? levelForXp(me?.xp ?? 0) : 1,
    subtitle: mine ? undefined : `Rating ${p?.rating ?? 1500}`,
    // while a pool shot replays, the shooter still holds the turn on screen
    active: !!p && (game === "pool" && poolBefore ? poolBefore.players[poolBefore.turn] === p.userId : turn === p.userId) && !result,
    deadline: deadline || undefined,
    turnMs: rules.turnSeconds * 1000,
    offline: !!p && !result && offline?.userId === p.userId,
    detail: mine ? detailMe : p ? detailOpp[p.userId] : null,
  });

  return (
    <GameShell
      game={game}
      title={game === "ludo" ? t("ludo.title") : game === "pool" ? t("pool.title") : t("igisoro.title")}
      icon={game === "ludo" ? DieIcon : game === "pool" ? PoolBallIcon : SeedsIcon}
      color={game === "ludo" ? "#FF8A1F" : game === "pool" ? "#2F80ED" : "#27AE60"}
      pot={stake * 2}
      live
      mode={t("game.live")}
      leaveNote={`${leaveNote} ${t("exit.disconnectNote", { secs: rules.reconnectSeconds })}`}
      onLeave={() => {
        void room.current?.leave(true); // explicit resign
        joins.delete(roomId);
        dropToken(roomId);
        clearActive();
      }}
      menuExtras={(close) => (
        <>
          {players.length === 2 && !result && (
            <button
              type="button"
              disabled={drawOut || !state}
              onClick={() => {
                room.current?.send("draw-offer");
                setDrawOut(true);
                close();
                say(t("game.drawOffered"));
              }}
              className="btn-secondary flex min-h-12 items-center justify-center gap-2 rounded-control font-semibold disabled:opacity-40"
            >
              <Handshake size={18} /> {drawOut ? t("game.drawOffered") : t("game.offerDraw")}
            </button>
          )}
        </>
      )}
      fairness={init ? { commit: init.commit, reveal: result?.seedReveal } : null}
      you={panel(meInfo, true)}
      opponents={opp.map((o) => panel(o, false))}
      footer={
        <div className="flex flex-col gap-1">
          {footer}
          {status_}
        </div>
      }
    >
      {board}
      {banner && <TurnBanner key={banner.id} text={banner.text} tone={banner.tone} />}
      {lastCapture && <TurnBanner key={`c${lastCapture.id}`} text={t("igisoro.capture", { n: lastCapture.seeds })} tone="good" />}
      {reconnecting && !result && (
        <div role="status" aria-live="polite" data-testid="reconnecting" className="glass absolute inset-x-0 top-2 z-30 mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-warning-soft">
          <Loader2 size={16} className="shrink-0 animate-spin" /> {Number.isFinite(reSecs) && reSecs > 0 ? tr("net.reconnecting", { secs: Math.ceil(reSecs) }) : tr("net.reconnectingNoTime")}
        </div>
      )}
      {offline && offline.userId !== myId && !result && !reconnecting && waitOpen && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3" data-testid="opponent-waiting">
          <div role="status" aria-live="polite" className="pointer-events-auto w-full max-w-sm">
            <PaperCard title={tr("net.oppWaitTitle")} icon={WifiOff} size="sm">
              <p className="text-sm">
                {tr(started ? "net.oppWait" : "net.oppWaitBeforeStart", { name: nameOf(offline.userId), time: mmss(offSecs) })}
              </p>
              <p className="num mt-1 text-center font-display text-3xl font-bold" aria-hidden>
                {mmss(offSecs)}
              </p>
              {stake > 0 && <p className="mt-1 text-xs pmuted">{tr("net.stakedWait")}</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" className="pbtn pbtn-primary flex-1 min-h-11!" onClick={() => setWaitOpen(false)}>
                  {tr("net.keepWaiting")}
                </button>
                {stake === 0 && (
                  <button type="button" className="pbtn pbtn-leather flex-1 min-h-11!" title={tr("net.leaveFreeNote")} onClick={() => room.current?.send("leave-waiting")}>
                    {tr("net.leaveFree")}
                  </button>
                )}
              </div>
            </PaperCard>
          </div>
        </div>
      )}
      {drawIn && drawIn !== myId && !result && (
        <Modal label={t("game.drawIncoming", { name: nameOf(drawIn) })}>
          <p className="flex items-center gap-2 font-display text-lg font-bold">
            <Handshake size={20} /> {t("game.drawIncoming", { name: nameOf(drawIn) })}
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" data-autofocus onClick={() => (room.current?.send("draw-reply", { accept: false }), setDrawIn(null))} className="btn-secondary min-h-12 flex-1 rounded-control font-semibold">
              {t("game.drawDecline")}
            </button>
            <button type="button" onClick={() => (room.current?.send("draw-reply", { accept: true }), setDrawIn(null))} className="btn-primary min-h-12 flex-1 rounded-control font-bold">
              {t("game.drawAccept")}
            </button>
          </div>
        </Modal>
      )}
      {result && (
        <ResultModal
          won={won}
          draw={draw}
          starsDelta={starsDelta}
          xp={result.settlement?.xp?.[myId] ?? 0}
          summary={exitSummary(result, won, draw, rules)}
          onRematch={() => router.push(returnPath())}
        />
      )}
      {error && !state && (
        <Modal label={error}>
          <p className="font-display text-lg font-bold">{error}</p>
          <button type="button" data-autofocus onClick={() => router.push(returnPath())} className="btn-secondary mt-4 min-h-12 w-full rounded-control font-semibold">
            Go back
          </button>
        </Modal>
      )}
    </GameShell>
  );
}
