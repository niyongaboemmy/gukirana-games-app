"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Star, Swords, X, Zap } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { GAME_LABEL, STAKES, useMatch, type GameId } from "@/lib/match-store";
import { propose, quickMatchJoin, quickMatchLeave, respondProposal } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { DieIcon, SeedsIcon } from "@/ui/game-icons";

const GAMES: { id: GameId; icon: typeof DieIcon; color: string }[] = [
  { id: "igisoro", icon: SeedsIcon, color: "#27AE60" },
  { id: "ludo", icon: DieIcon, color: "#FF8A1F" },
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

const glass = "rounded-2xl border border-white/20 bg-[#151935]/85 text-white shadow-2xl backdrop-blur-xl";

function GameStakePicker({ onConfirm, confirmLabel, onCancel }: { onConfirm: (g: GameId, s: number) => void; confirmLabel: string; onCancel: () => void }) {
  const [game, setGame] = useState<GameId>("igisoro");
  const [stake, setStake] = useState(25);
  const stars = useSession((s) => s.me?.stars ?? 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {GAMES.map((g) => (
          <button key={g.id} type="button" onClick={() => setGame(g.id)} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 font-semibold transition ${game === g.id ? "border-white bg-white/10" : "border-white/10"}`}>
            <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={18} /></span>
            {GAME_LABEL[g.id]}
          </button>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">Stake each</p>
        <div className="flex flex-wrap gap-1.5">
          {STAKES.map((s) => (
            <button key={s} type="button" disabled={s > stars} onClick={() => setStake(s)} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold tabular-nums transition disabled:opacity-30 ${stake === s ? "bg-[#7CC4FF] text-[#0b0d1a]" : "bg-white/10"}`}>
              {s === 0 ? "Friendly" : <>{s} <Star size={12} className="fill-current" /></>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/60">{stake > 0 ? `Winner gets ${stake * 2} Stars. Stakes are held in escrow by the server.` : "No stake: just for fun and rating."}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-white/10 py-2.5 font-semibold">Cancel</button>
        <button type="button" onClick={() => onConfirm(game, stake)} className="flex-1 rounded-xl bg-gradient-to-r from-[#3DA9FC] to-[#2F80ED] py-2.5 font-extrabold">{confirmLabel}</button>
      </div>
    </div>
  );
}

function IncomingCard({ p }: { p: ReturnType<typeof useMatch.getState>["incoming"][number] }) {
  const left = useCountdown(p.expires);
  const g = GAMES.find((x) => x.id === p.game)!;
  return (
    <div className={`${glass} pointer-events-auto w-[min(360px,90vw)] p-3`}>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={22} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold"><span style={{ color: p.from.color }}>{p.from.name}</span> challenges you</p>
          <p className="flex items-center gap-1 text-sm text-white/70">{GAME_LABEL[p.game]} · {p.stake ? <>{p.stake} <Star size={12} className="fill-current" /> each</> : "Friendly"} · {left}s</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => respondProposal(p.id, false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/10 py-2 font-semibold"><X size={16} /> Decline</button>
        <button type="button" onClick={() => respondProposal(p.id, true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#22C55E] py-2 font-bold text-[#06210f]"><Check size={16} /> Accept</button>
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
  const allPlayers = useWorld((s) => s.players);
  // nearest first, then everyone else who is signed in (plaza instances hold ≤ 50 people)
  const challengeable = Object.values(allPlayers)
    .filter((p) => p.verified)
    .sort((a, b) => (a.id === nearPlayer ? -1 : b.id === nearPlayer ? 1 : a.name.localeCompare(b.name)))
    .slice(0, 20);

  useEffect(() => {
    if (ready) router.push(`/match/${ready.roomId}?game=${ready.game}&stake=${ready.stake}`);
  }, [ready, router]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useMatch.setState({ notice: null }), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      {/* Quick Match (under the profile chip) */}
      <div className="absolute left-[max(12px,env(safe-area-inset-left))] top-[84px]">
        {authed ? (
          quick.status === "waiting" ? (
            <button type="button" onClick={quickMatchLeave} className={`${glass} pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold`}>
              <Loader2 size={16} className="animate-spin" /> Finding a {GAME_LABEL[quick.game!]} opponent… <X size={14} className="text-white/60" />
            </button>
          ) : (
            <button type="button" onClick={() => setSheet("quick")} className={`${glass} pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold`}>
              <Zap size={16} className="text-[#FFC83D]" /> Quick Match
            </button>
          )
        ) : (
          <Link href="/gate" className={`${glass} pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold`}>
            <Zap size={16} className="text-[#FFC83D]" /> Sign in to play people
          </Link>
        )}
      </div>

      {/* Challenge the nearby player */}
      {authed && nearPlayer && target?.verified && !outgoing && !sheet && (
        <div className="absolute bottom-[calc(38%+64px)] left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={() => {
              setChallengeTarget({ id: target.id, name: target.name });
              setSheet("challenge");
            }}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#FFC83D]/50 bg-[#22266E]/90 px-5 py-2.5 font-bold text-white shadow-2xl backdrop-blur-md active:scale-95"
          >
            <Swords size={18} className="text-[#FFC83D]" /> Challenge {target.name}
          </button>
        </div>
      )}

      {/* Sheets */}
      {sheet && (
        <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setSheet(null)}>
          <div className={`${glass} w-[min(420px,94vw)] p-5`} onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 flex items-center gap-2 text-lg font-extrabold">
              {sheet === "quick" ? <><Zap size={20} className="text-[#FFC83D]" /> Quick Match</> : <><Swords size={20} className="text-[#FFC83D]" /> Challenge {challengeTarget?.name}</>}
            </p>
            {sheet === "challenge" && (
              <div className="mb-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">Player</p>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {challengeable.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setChallengeTarget({ id: p.id, name: p.name })}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${challengeTarget?.id === p.id ? "border-white bg-white/15" : "border-white/15"}`}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                      {p.name}
                      <span className="text-xs text-white/50">Lvl {p.level}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <GameStakePicker
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
      <div className="absolute left-1/2 top-16 flex -translate-x-1/2 flex-col items-center gap-2">
        {incoming.map((p) => (
          <IncomingCard key={p.id} p={p} />
        ))}
        {outgoing && (
          <div className={`${glass} flex items-center gap-2 px-4 py-2 text-sm font-semibold`}>
            <Loader2 size={16} className="animate-spin" /> Waiting for {outgoing.to} · {GAME_LABEL[outgoing.game]} · {outLeft}s
          </div>
        )}
        {notice && <div className={`${glass} px-4 py-2 text-sm font-semibold text-[#ffd27a]`}>{notice}</div>}
      </div>
    </div>
  );
}
