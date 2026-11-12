"use client";
import Link from "next/link";
import { useState } from "react";

export interface PanelPlayer {
  name: string;
  color: string;
  level: number;
  active: boolean;
  isBot?: boolean;
  detail?: React.ReactNode;
}

/**
 * Common game screen (DESIGN-SPEC §11.1): left = you, right = opponent, board centred,
 * POT banner, fairness badge, leave confirmation. Landscape-first.
 */
export function GameShell({
  title,
  emoji,
  color,
  pot,
  you,
  opponents,
  fairness,
  children,
  footer,
}: {
  title: string;
  emoji: string;
  color: string;
  pot: number;
  you: PanelPlayer;
  opponents: PanelPlayer[];
  fairness?: { commit: string; reveal?: string; rolls?: number } | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  return (
    <div className="fixed inset-0 flex flex-col bg-[radial-gradient(ellipse_at_top,#2a2f7a_0%,#0b0d1a_70%)] text-white">
      <header className="flex items-center gap-2 px-[max(12px,env(safe-area-inset-left))] py-2">
        <button type="button" onClick={() => setLeaving(true)} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15">
          ◀ Leave
        </button>
        <h1 className="ml-1 truncate text-base font-extrabold sm:text-lg">
          <span style={{ color }}>{emoji}</span> {title} <span className="text-xs font-semibold text-white/50">· Practice vs AI</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-[#7CC4FF]/20 px-3 py-1.5 text-sm font-extrabold tabular-nums">POT {pot} ⭐</span>
          {fairness && (
            <button type="button" onClick={() => setFairOpen(true)} className="rounded-full bg-[#22C55E]/20 px-3 py-1.5 text-sm font-bold text-[#7ef0a8]">
              🛡️ Fair
            </button>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(92px,180px)_1fr_minmax(92px,180px)] gap-2 px-[max(8px,env(safe-area-inset-left))] pb-2">
        <PlayerPanel p={you} label="You" />
        <section className="grid min-h-0 min-w-0 place-items-center">{children}</section>
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {opponents.map((o, i) => (
            <PlayerPanel key={i} p={o} label={o.isBot ? "AI" : "Opponent"} />
          ))}
        </div>
      </main>
      {footer && <footer className="px-3 pb-[max(8px,env(safe-area-inset-bottom))]">{footer}</footer>}

      {leaving && (
        <Modal onClose={() => setLeaving(false)}>
          <p className="text-lg font-bold">Leave the match?</p>
          <p className="mt-1 text-sm text-white/70">Leaving counts as a forfeit. In practice you lose the {pot / 2} ⭐ stake.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setLeaving(false)} className="flex-1 rounded-xl bg-white/10 py-2 font-semibold">
              Stay
            </button>
            <Link href="/world" className="flex-1 rounded-xl bg-[#EF4444] py-2 text-center font-semibold">
              Leave
            </Link>
          </div>
        </Modal>
      )}
      {fairOpen && fairness && (
        <Modal onClose={() => setFairOpen(false)}>
          <p className="text-lg font-bold">🛡️ Provably fair</p>
          <p className="mt-1 text-sm text-white/70">Every roll comes from HMAC-SHA256(server seed, client seed, match, roll #). The seed is revealed after the match so you can verify every roll.</p>
          <p className="mt-3 text-xs text-white/50">Commit (SHA-256 of the seed)</p>
          <code className="block break-all rounded-lg bg-black/40 p-2 text-xs">{fairness.commit}</code>
          <p className="mt-2 text-xs text-white/50">Seed {fairness.reveal ? "(revealed)" : "(revealed when the match ends)"}</p>
          <code className="block break-all rounded-lg bg-black/40 p-2 text-xs">{fairness.reveal ?? "••••••••"}</code>
          {fairness.rolls !== undefined && <p className="mt-2 text-xs text-white/60">Rolls so far: {fairness.rolls}</p>}
        </Modal>
      )}
    </div>
  );
}

function PlayerPanel({ p, label }: { p: PanelPlayer; label: string }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-2xl border-2 bg-white/5 p-2 transition sm:p-3 ${p.active ? "shadow-[0_0_24px_-4px] " : "opacity-80"}`}
      style={{ borderColor: p.active ? p.color : "rgba(255,255,255,.12)", color: "inherit", boxShadow: p.active ? `0 0 22px -6px ${p.color}` : undefined }}
    >
      <div className="flex items-center gap-2">
        <div className="grid size-9 shrink-0 place-items-center rounded-full text-lg sm:size-11" style={{ background: p.color }}>
          {p.isBot ? "🤖" : "🙂"}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold">{p.name}</p>
          <p className="text-xs text-[#FFC83D]">★ {p.level} · {label}</p>
        </div>
      </div>
      {p.active && <p className="text-xs font-bold" style={{ color: p.color }}>● Turn</p>}
      {p.detail}
    </div>
  );
}

export function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#151935] p-5 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ResultModal({ won, starsDelta, xp, summary, onRematch }: { won: boolean; starsDelta: number; xp: number; summary: string; onRematch: () => void }) {
  return (
    <Modal>
      <div className="text-center">
        <div className="text-6xl">{won ? "🏆" : "🤝"}</div>
        <p className="mt-2 text-2xl font-extrabold">{won ? "You won!" : "Good game"}</p>
        <p className="mt-1 text-sm text-white/70">{summary}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-white/60">Stars</p>
            <p className={`text-xl font-extrabold ${starsDelta >= 0 ? "text-[#22C55E]" : "text-white"}`}>
              {starsDelta >= 0 ? "+" : ""}
              {starsDelta} ⭐
            </p>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-white/60">XP</p>
            <p className="text-xl font-extrabold text-[#FFC83D]">+{xp}</p>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Link href="/world" className="flex-1 rounded-xl bg-white/10 py-2.5 font-semibold">
            Back to Plaza
          </Link>
          <button type="button" onClick={onRematch} className="flex-1 rounded-xl bg-[#3DA9FC] py-2.5 font-bold">
            Rematch
          </button>
        </div>
      </div>
    </Modal>
  );
}
