"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Star, Swords, X, Zap } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { GAME_LABEL, STAKES, useMatch, type GameId } from "@/lib/match-store";
import { propose, quickMatchJoin, quickMatchLeave, respondProposal } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";
import { rememberBeforeGame } from "@/lib/return-point";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { promptWrap } from "@/hud/Prompt";
import { QUICK_MATCH_EVENT } from "@/hud/usePhoneHud";

const GAMES: { id: GameId; icon: typeof DieIcon; color: string }[] = [
  { id: "igisoro", icon: SeedsIcon, color: "#27AE60" },
  { id: "ludo", icon: DieIcon, color: "#FF8A1F" },
  { id: "pool", icon: PoolBallIcon, color: "#2F80ED" },
];

function useCountdown(until?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

const glass = "glass rounded-card";

function GameStakePicker({ onConfirm, confirmLabel, onCancel, initialGame = "igisoro" }: { onConfirm: (g: GameId, s: number) => void; confirmLabel: string; onCancel: () => void; initialGame?: GameId }) {
  const [game, setGame] = useState<GameId>(initialGame);
  const stars = useSession((s) => s.me?.stars ?? 0);
  // default to 25 Stars, or the biggest stake the player can afford (a disabled default could not be sent)
  const [stake, setStake] = useState(() => [...STAKES].reverse().find((s) => s <= Math.min(25, stars)) ?? 0);
  const affordable = stake <= stars;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {GAMES.map((g) => (
          <button key={g.id} type="button" onClick={() => setGame(g.id)} className={`press flex min-h-12 items-center gap-2 rounded-xl border-2 px-3 py-2.5 font-semibold ${game === g.id ? "border-accent bg-primary/25 shadow-[0_0_0_3px_rgb(96_165_250/.18)]" : "border-white/10 bg-white/4 hover:bg-white/8"}`}>
            <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={18} /></span>
            {GAME_LABEL[g.id]}
          </button>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-xs label text-on-glass-muted">Stake each</p>
        <div className="flex flex-wrap gap-1.5">
          {STAKES.map((s) => (
            <button key={s} type="button" disabled={s > stars} onClick={() => setStake(s)} className={`press flex min-h-10 items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-bold tabular-nums transition disabled:opacity-30 ${stake === s ? "bg-primary text-white shadow-[inset_0_1px_0_rgb(255_255_255/.28),var(--shadow-glow)]" : "btn-secondary"}`}>
              {s === 0 ? "Friendly" : <>{s} <Star size={12} className="fill-current" /></>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-on-glass-muted">{stake > 0 ? `Winner gets ${stake * 2} Stars. Stakes are held in escrow by the server.` : "No stake: just for fun and rating."}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary min-h-11 flex-1 rounded-xl py-2.5 font-semibold">Cancel</button>
        <button type="button" disabled={!affordable} onClick={() => onConfirm(game, stake)} className="btn-primary min-h-11 flex-1 rounded-xl py-2.5 font-extrabold disabled:opacity-40">{confirmLabel}</button>
      </div>
    </div>
  );
}

function IncomingCard({ p }: { p: ReturnType<typeof useMatch.getState>["incoming"][number] }) {
  const left = useCountdown(p.expires);
  const g = GAMES.find((x) => x.id === p.game)!;
  return (
    <div className="sheet pointer-events-auto w-[min(360px,90vw)] p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={22} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold"><span style={{ color: p.from.color }}>{p.from.name}</span> challenges you</p>
          <p className="flex items-center gap-1 text-sm text-on-glass-muted">{GAME_LABEL[p.game]} · {p.stake ? <>{p.stake} <Star size={12} className="fill-current" /> each</> : "Friendly"} · {left}s</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => respondProposal(p.id, false)} className="btn-secondary flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 font-semibold"><X size={16} /> Decline</button>
        <button type="button" onClick={() => respondProposal(p.id, true)} className="btn-success flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 font-bold"><Check size={16} /> Accept</button>
      </div>
    </div>
  );
}

/** Challenges, incoming proposals and Quick Match inside the 3D world (SRS §8.4.2, FR-MM-*). */
export function MatchmakingPanel() {
  const router = useRouter();
  const authed = useSession((s) => s.status === "authenticated");
  const { incoming, outgoing, quick, ready, notice } = useMatch();
  const nearPlayer = useWorld((s) => s.nearPlayer);
  const target = useWorld((s) => (s.nearPlayer ? s.players[s.nearPlayer] : undefined));
  const [sheet, setSheet] = useState<null | "challenge" | "quick">(null);
  const [challengeTarget, setChallengeTarget] = useState<{ id: string; name: string } | null>(null);
  const outLeft = useCountdown(outgoing?.expires);
  // safety net: if the server's "expired" message never arrives (a reconnect, a room switch), close a challenge
  // ourselves shortly after its time is up instead of waiting at "0s" forever
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      useMatch.setState((s) => {
        const outDone = s.outgoing && now > s.outgoing.expires + 2000;
        const inc = s.incoming.filter((x) => now <= x.expires + 2000);
        if (!outDone && inc.length === s.incoming.length) return s;
        return { ...s, outgoing: outDone ? null : s.outgoing, incoming: inc, notice: outDone ? `No answer from ${s.outgoing?.to ?? "them"} — the challenge expired` : s.notice };
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);
  // Quick Match: how long we've been waiting (feedback that the search is alive)
  const [waitStart, setWaitStart] = useState(0);
  useEffect(() => setWaitStart(quick.status === "waiting" ? Date.now() : 0), [quick.status]);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!waitStart) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitStart]);
  const waited = waitStart ? Math.max(0, Math.floor((nowMs - waitStart) / 1000)) : 0;
  const path = usePathname();
  const hallGame = GAMES.find((g) => path === `/room/${g.id}`)?.id;
  // "Challenge" from the person menu opens this sheet for that person
  const socialChallenge = useSocial((s) => s.challenge);
  useEffect(() => {
    if (!socialChallenge) return;
    setChallengeTarget(socialChallenge);
    setSheet("challenge");
    useSocial.setState({ challenge: null });
  }, [socialChallenge]);
  // phone: Quick Match is in the action bar's "more" menu
  useEffect(() => {
    const open = () => setSheet("quick");
    window.addEventListener(QUICK_MATCH_EVENT, open);
    return () => window.removeEventListener(QUICK_MATCH_EVENT, open);
  }, []);
  const chatOpen = useSocial((s) => s.chatOpen);
  const allPlayers = useWorld((s) => s.players);
  // nearest first, then everyone else who is signed in (plaza instances hold ≤ 50 people)
  const challengeable = Object.values(allPlayers)
    .filter((p) => p.verified)
    .sort((a, b) => (a.id === nearPlayer ? -1 : b.id === nearPlayer ? 1 : a.name.localeCompare(b.name)))
    .slice(0, 20);

  useEffect(() => {
    if (!ready) return;
    rememberBeforeGame(useRoom.getState().seated);
    router.push(`/match/${ready.roomId}?game=${ready.game}&stake=${ready.stake}`);
  }, [ready, router]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useMatch.setState({ notice: null }), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      {/* Quick Match (under the profile chip) */}
      <div className="absolute left-[max(12px,env(safe-area-inset-left))] top-[84px] phone:hidden">
        {authed ? (
          quick.status === "waiting" ? (
            <button type="button" onClick={quickMatchLeave} className={`${glass} icon-button pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold`}>
              <Loader2 size={16} className="animate-spin" /> Finding a {GAME_LABEL[quick.game!]} opponent… <span className="num tabular-nums text-on-glass-muted">{waited}s</span> <X size={14} className="text-on-glass-muted" />
            </button>
          ) : (
            <button type="button" onClick={() => setSheet("quick")} className={`${glass} icon-button pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold`}>
              <Zap size={16} className="text-gold" /> Quick Match
            </button>
          )
        ) : (
          <Link href="/gate" className={`${glass} icon-button pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold`}>
            <Zap size={16} className="text-gold" /> Sign in to play people
          </Link>
        )}
      </div>

      {/* Challenge the nearby player */}
      {authed && nearPlayer && target?.verified && !outgoing && !sheet && (
        <div className={promptWrap(chatOpen, 1)}>
          <button
            type="button"
            onClick={() => {
              setChallengeTarget({ id: target.id, name: target.name });
              setSheet("challenge");
            }}
            className="chip pointer-events-auto flex items-center gap-2 whitespace-nowrap border-gold/45! bg-ink-800/60! px-5 py-2.5 font-bold phone:max-w-[40vw] phone:overflow-hidden phone:px-3.5 phone:py-1.5 phone:text-sm"
          >
            <Swords size={18} className="text-gold" /> Challenge {target.name}
          </button>
        </div>
      )}

      {/* Sheets */}
      {sheet && (
        <div className="scrim pointer-events-auto absolute inset-0 grid place-items-center p-4" onClick={() => setSheet(null)}>
          <div className={`sheet w-[min(420px,94vw)] p-5 phone:max-h-[92vh] phone:overflow-y-auto phone:p-3.5`} onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 flex items-center gap-2 text-lg font-extrabold">
              {sheet === "quick" ? <><Zap size={20} className="text-gold" /> Quick Match</> : <><Swords size={20} className="text-gold" /> Challenge {challengeTarget?.name}</>}
            </p>
            {sheet === "challenge" && (
              <div className="mb-3">
                <p className="mb-1.5 text-xs label text-on-glass-muted">Player</p>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {challengeable.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setChallengeTarget({ id: p.id, name: p.name })}
                      className={`press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${challengeTarget?.id === p.id ? "border-accent bg-primary/25" : "border-white/15 hover:bg-white/8"}`}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                      {p.name}
                      <span className="text-xs text-on-glass-muted">Lvl {p.level}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <GameStakePicker
              initialGame={hallGame}
              confirmLabel={sheet === "quick" ? "Find opponent" : "Send challenge"}
              onCancel={() => setSheet(null)}
              onConfirm={(g, s) => {
                if (sheet === "quick") quickMatchJoin(g, s);
                else if (challengeTarget) propose(challengeTarget.id, g, s);
                setSheet(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Incoming + outgoing + notices (top-centre stack) */}
      <div className="absolute left-1/2 top-16 flex -translate-x-1/2 flex-col items-center gap-2 phone:top-[46px] phone:gap-1.5">
        {incoming.map((p) => (
          <IncomingCard key={p.id} p={p} />
        ))}
        {outgoing && (
          <div className={`${glass} flex items-center gap-2 px-4 py-2 text-sm font-semibold`}>
            <Loader2 size={16} className="animate-spin" /> Waiting for {outgoing.to} · {GAME_LABEL[outgoing.game]} · {outLeft}s
          </div>
        )}
        {notice && <div className="toast px-4 py-2 text-sm font-semibold text-warning-soft">{notice}</div>}
      </div>
    </div>
  );
}
