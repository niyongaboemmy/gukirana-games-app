"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Client, type Room } from "colyseus.js";
import { Clock, WifiOff } from "lucide-react";
import { legalPits, type IgisoroState } from "@gukirana/igisoro";
import { movableTokens, type LudoState } from "@gukirana/ludo";
import { newSeed } from "@gukirana/fairness";
import { GameShell, Modal, ResultModal } from "@/games/GameShell";
import { IgisoroBoard, useSowAnimation } from "@/games/IgisoroBoard";
import { Die, LudoBoard, SeatLabel } from "@/games/LudoBoard";
import { SEAT_COLORS } from "@/games/ludo-board";
import type { PoolState } from "@gukirana/pool";
import { PoolLiveBoard } from "./PoolLiveBoard";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";
import { loadMe, refreshSession, useSession } from "@/lib/session";
import { levelForXp } from "@/lib/profile-store";
import { returnPath } from "@/lib/return-point";

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
}
interface Result {
  ranks: Record<string, number>;
  reason: string;
  seedReveal: string;
  settlement: { xp?: Record<string, number>; ratings?: Record<string, number> } | null;
}

/** One connection per room, shared across React re-mounts (StrictMode) and released with a short delay. */
const joins = new Map<string, Promise<Room>>();
const pendingLeave = new Map<string, ReturnType<typeof setTimeout>>();

function realtimeUrl() {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
}

/** Live, server-authoritative match (plan P0-GMK-04). The client renders state and sends intents only. */
export function LiveMatch({ roomId }: { roomId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const me = useSession((s) => s.me);
  const status = useSession((s) => s.status);
  const room = useRef<Room | null>(null);
  const [init, setInit] = useState<Init | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [state, setState] = useState<any>(null);
  const prev = useRef<IgisoroState | null>(null);
  const [turn, setTurn] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const { view, hl, animating, animate } = useSowAnimation(120);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "anonymous") return void router.replace("/gate");
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
          join = (async () => {
            await refreshSession(); // fresh access token for the join
            const token = useSession.getState().accessToken;
            return new Client(realtimeUrl()).joinById(roomId, { token, clientSeed: newSeed().slice(0, 32) });
          })();
          joins.set(roomId, join);
        }
        const r = await join;
        if (cancelled) return;
        r.removeAllListeners();
        room.current = r;
        r.onMessage("init", (m: Init) => setInit(m));
        r.onMessage("state", async (m: { state: unknown; turn: string | null; deadline: number }) => {
          setTurn(m.turn);
          setDeadline(m.deadline);
          setRolling(false);
          const s = m.state as IgisoroState & LudoState;
          if ("pits" in s && prev.current && s.lastEvents?.length) await animate(prev.current, s as IgisoroState);
          if ("pits" in s) prev.current = s as IgisoroState;
          setState(s);
        });
        r.onMessage("rejected", (m: { reason: string }) => setError(`Move rejected: ${m.reason}`));
        r.onMessage("presence", (m: { userId: string; connected: boolean }) => setOffline(m.connected ? null : m.userId));
        r.onMessage("timeout", () => undefined);
        r.onMessage("emote", () => undefined);
        r.onMessage("result", (m: Result) => {
          setResult(m);
          void loadMe();
        });
        r.send("sync");
      } catch {
        joins.delete(roomId);
        setError("This match is no longer available.");
      }
    })();
    return () => {
      cancelled = true;
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
  }, [animate, roomId, router, status]);

  const send = useCallback((intent: unknown) => {
    setError(null);
    room.current?.send("intent", intent);
  }, []);

  const game = (init?.game ?? params.get("game")) as "igisoro" | "ludo" | "pool";
  const stake = init?.stake ?? Number(params.get("stake") ?? 0);
  const myId = init?.you ?? me?.id ?? "";
  const myTurn = turn === myId && !result;
  const secs = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const players = init?.players ?? [];
  const opp = players.filter((p) => p.userId !== myId);
  const meInfo = players.find((p) => p.userId === myId);

  const won = result ? result.ranks[myId] === 1 && Object.values(result.ranks).filter((r) => r === 1).length === 1 : false;
  const draw = result ? Object.values(result.ranks).every((r) => r === 1) : false;
  const starsDelta = result ? (won ? stake : draw ? 0 : -stake) : 0;

  let board: React.ReactNode = <p className="text-white/70">Waiting for both players…</p>;
  let footer: React.ReactNode = null;
  let detailMe: React.ReactNode = null;
  const detailOpp: Record<string, React.ReactNode> = {};

  if (state && game === "igisoro") {
    const s = state as IgisoroState;
    const mySide = (s.players.indexOf(myId) === 1 ? 1 : 0) as 0 | 1;
    const pits = view ?? s.pits;
    const seeds = (side: 0 | 1) => pits[side].reduce((a, b) => a + b, 0);
    board = <IgisoroBoard pits={pits} me={mySide} legal={myTurn && !animating ? legalPits(s, mySide) : []} hl={hl} selected={null} onPick={(pit) => send({ pit })} />;
    detailMe = <p className="flex items-center gap-1 text-sm font-bold"><SeedsIcon size={14} /> {seeds(mySide)} seeds</p>;
    for (const o of opp) detailOpp[o.userId] = <p className="flex items-center gap-1 text-sm font-bold"><SeedsIcon size={14} /> {seeds((1 - mySide) as 0 | 1)} seeds</p>;
  }
  if (state && game === "ludo") {
    const s = state as LudoState;
    const mine = s.players.find((p) => p.id === myId);
    const movable = myTurn && s.phase === "move" && mine ? movableTokens(mine, s.dice!) : [];
    board = <LudoBoard state={s} movable={movable} onMove={(token) => send({ type: "move", token })} myId={myId} />;
    for (const p of s.players) {
      const label = <SeatLabel seat={p.seat} home={p.tokens.filter((t) => t === 56).length} />;
      if (p.id === myId) detailMe = label;
      else detailOpp[p.id] = label;
    }
    const cur = s.players[s.turn];
    footer = (
      <div className="flex items-center justify-center gap-4">
        <Die value={s.dice ?? (s.lastEvent?.kind === "roll" ? s.lastEvent.dice : null)} rolling={rolling} color={SEAT_COLORS[cur?.seat ?? 0]!} />
        {myTurn && s.phase === "roll" && (
          <button type="button" disabled={rolling} onClick={() => (setRolling(true), send({ type: "roll" }))} className="flex items-center gap-2 rounded-2xl bg-[#FF8A1F] px-8 py-3 text-lg font-extrabold shadow-lg active:scale-95">
            <DieIcon size={20} /> {rolling ? "Rolling…" : "Roll"}
          </button>
        )}
        {myTurn && s.phase === "move" && <p className="text-sm text-white/70">Tap a glowing token</p>}
      </div>
    );
  }

  if (state && game === "pool") {
    const s = state as PoolState;
    const mySide = s.players.indexOf(myId) === 1 ? 1 : 0;
    const label = (side: 0 | 1) => {
      const gr = s.groups[side];
      return <p className="text-xs font-semibold capitalize">{gr ? `${gr} · ${s.balls.filter((b) => !b.in && (gr === "solids" ? b.n >= 1 && b.n <= 7 : b.n >= 9)).length} left` : "Open table"}</p>;
    };
    board = <PoolLiveBoard state={s} myTurn={myTurn} onShoot={(i) => send(i)} />;
    detailMe = label(mySide as 0 | 1);
    for (const o of opp) detailOpp[o.userId] = label((1 - mySide) as 0 | 1);
    footer = s.lastShot ? <p className="text-center text-xs text-white/75">{s.lastShot.message}</p> : null;
  }

  const timer = (
    <p className={`flex items-center justify-center gap-1.5 text-xs font-semibold ${secs <= 10 ? "text-[#F59E0B]" : "text-white/70"}`}>
      <Clock size={14} /> {myTurn ? `Your turn · ${secs}s` : turn ? `Opponent's turn · ${secs}s` : "Starting…"}
      {offline && offline !== myId && <span className="ml-2 flex items-center gap-1 text-[#ff8a8a]"><WifiOff size={14} /> Opponent reconnecting (60s)</span>}
      {error && <span className="ml-2 text-[#ff8a8a]">{error}</span>}
    </p>
  );

  return (
    <GameShell
      title={game === "ludo" ? "Ludo" : game === "pool" ? "8-Ball Pool" : "Igisoro"}
      icon={game === "ludo" ? DieIcon : game === "pool" ? PoolBallIcon : SeedsIcon}
      color={game === "ludo" ? "#FF8A1F" : game === "pool" ? "#2F80ED" : "#27AE60"}
      pot={stake * 2}
      mode="Live match"
      onLeave={() => {
        void room.current?.leave(true); // explicit resign
        joins.delete(roomId);
      }}
      fairness={init ? { commit: init.commit, reveal: result?.seedReveal } : null}
      you={{ name: meInfo?.name ?? me?.username ?? "You", color: game === "ludo" && meInfo ? SEAT_COLORS[meInfo.seat]! : meInfo?.color ?? "#3DA9FC", level: levelForXp(me?.xp ?? 0), active: myTurn, detail: detailMe }}
      opponents={opp.map((o) => ({ name: o.name, color: game === "ludo" ? SEAT_COLORS[o.seat]! : o.color, level: 1, subtitle: `Rating ${o.rating}`, active: turn === o.userId && !result, detail: detailOpp[o.userId] }))}
      footer={<div className="flex flex-col gap-1">{footer}{timer}</div>}
    >
      {board}
      {result && (
        <ResultModal
          won={won}
          starsDelta={starsDelta}
          xp={result.settlement?.xp?.[myId] ?? 0}
          summary={result.reason === "forfeit" ? (won ? "Your opponent forfeited." : "You forfeited the match.") : result.reason === "void" ? "Match voided: stakes refunded." : won ? "Settled by the server: the pot is yours." : draw ? "Draw: stakes returned." : "Well played. Rematch?"}
          onRematch={() => router.push(returnPath())}
        />
      )}
      {error && !state && (
        <Modal>
          <p className="text-lg font-bold">{error}</p>
          <button type="button" onClick={() => router.push(returnPath())} className="mt-4 w-full rounded-xl bg-white/10 py-2 font-semibold">Go back</button>
        </Modal>
      )}
    </GameShell>
  );
}
