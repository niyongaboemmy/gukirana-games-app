"use client";
import Link from "next/link";
import { useState, type ComponentType } from "react";
import { returnLabel, returnPath } from "@/lib/return-point";
import { Bot, ChevronLeft, Handshake, ShieldCheck, Star, Trophy, User } from "lucide-react";

export interface PanelPlayer {
  name: string;
  color: string;
  level: number;
  active: boolean;
  isBot?: boolean;
  /** overrides the "Lvl" line, e.g. "Rating 1516" for live opponents */
  subtitle?: string;
  detail?: React.ReactNode;
}

/**
 * Common game screen (DESIGN-SPEC §11.1): left = you, right = opponent, board centred,
 * POT banner, fairness badge, leave confirmation. Landscape-first.
 */
export function GameShell({
  title,
  icon: Icon,
  color,
  pot,
  you,
  opponents,
  fairness,
  children,
  footer,
  mode = "Practice vs AI",
  onLeave,
}: {
  mode?: string;
  onLeave?: () => void;
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
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
    <div className="fixed inset-0 flex flex-col bg-[radial-gradient(ellipse_at_top,#262b35_0%,var(--color-ink-950)_70%)] text-white">
      <header className="flex items-center gap-2 px-[max(12px,env(safe-area-inset-left))] py-2 phone:py-1">
        <button type="button" onClick={() => setLeaving(true)} className="btn-secondary rounded-xl px-3 py-2 text-sm font-semibold">
          <span className="flex items-center gap-1"><ChevronLeft size={16} /> Leave</span>
        </button>
        <h1 className="ml-1 flex min-w-0 items-center gap-2 truncate text-base font-extrabold sm:text-lg">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: `${color}33`, color }}><Icon size={18} /></span>
          {title} <span className="text-xs font-semibold text-white/50">· {mode}</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1.5 text-sm font-extrabold tabular-nums ring-1 ring-primary-400/35">{pot > 0 ? <>POT {pot} <Star size={14} className="fill-star text-star" /></> : "Practice · no stake"}</span>
          {fairness && (
            <button type="button" onClick={() => setFairOpen(true)} className="press flex items-center gap-1.5 rounded-full bg-success/18 px-3 py-1.5 text-sm font-bold text-success-soft ring-1 ring-success/30 hover:bg-success/26">
              <ShieldCheck size={16} /> Fair
            </button>
          )}
        </div>
      </header>

      {/* phone (landscape): narrow side panels (~13% each) so the board gets the width */}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(92px,180px)_1fr_minmax(92px,180px)] gap-2 px-[max(8px,env(safe-area-inset-left))] pb-2 phone:grid-cols-[minmax(76px,112px)_1fr_minmax(76px,112px)] phone:gap-1.5 phone:pb-1">
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
          <p className="mt-1 text-sm text-white/70">{pot > 0 ? `Leaving counts as a forfeit: you lose your ${pot / 2} Stars stake.` : "Leaving ends this practice game."}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setLeaving(false)} className="btn-secondary flex-1 rounded-xl py-2 font-semibold">
              Stay
            </button>
            <Link href={returnPath()} onClick={onLeave} className="btn-danger flex-1 rounded-xl py-2 text-center font-semibold">
              Leave
            </Link>
          </div>
        </Modal>
      )}
      {fairOpen && fairness && (
        <Modal onClose={() => setFairOpen(false)}>
          <p className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} className="text-success" /> Provably fair</p>
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
      className={`flex flex-col gap-1 glass-solid rounded-2xl border-2 bg-white/5 p-2 transition sm:p-3 phone:gap-0.5 phone:rounded-xl phone:p-1.5 phone:text-[11px] ${p.active ? "shadow-[0_0_24px_-4px] " : "opacity-80"}`}
      style={{ borderColor: p.active ? p.color : "rgba(255,255,255,.12)", color: "inherit", boxShadow: p.active ? `0 0 22px -6px ${p.color}` : undefined }}
    >
      <div className="flex items-center gap-2 phone:gap-1.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-full text-white sm:size-11 phone:size-7" style={{ background: p.color }}>
          {p.isBot ? <Bot size={16} /> : <User size={16} />}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold phone:text-xs">{p.name}</p>
          <p className="flex items-center gap-1 text-xs text-gold phone:text-[10px]"><Star size={11} className="fill-current" /> {p.subtitle ?? `Lvl ${p.level}`} · {label}</p>
        </div>
      </div>
      {p.active && <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: p.color }}><span className="size-2 animate-pulse rounded-full" style={{ background: p.color }} /> Turn</p>}
      {p.detail}
    </div>
  );
}

export function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="scrim fixed inset-0 z-40 grid place-items-center bg-ink-950/60! p-4" onClick={onClose}>
      <div className="sheet w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ResultModal({ won, starsDelta, xp, summary, onRematch }: { won: boolean; starsDelta: number; xp: number; summary: string; onRematch: () => void }) {
  return (
    <Modal>
      <div className="text-center">
        <div className={`mx-auto grid size-20 place-items-center rounded-full ${won ? "bg-gold/20 text-gold" : "bg-white/10 text-white"}`}>{won ? <Trophy size={40} /> : <Handshake size={40} />}</div>
        <p className="mt-2 text-2xl font-extrabold">{won ? "You won!" : "Good game"}</p>
        <p className="mt-1 text-sm text-white/70">{summary}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-white/6 p-3 ring-1 ring-white/8">
            <p className="text-white/60">Stars</p>
            <p className={`text-xl font-extrabold ${starsDelta >= 0 ? "text-success" : "text-white"}`}>
              {starsDelta >= 0 ? "+" : ""}
              {starsDelta} <Star size={16} className="inline fill-current align-[-2px]" />
            </p>
          </div>
          <div className="rounded-xl bg-white/6 p-3 ring-1 ring-white/8">
            <p className="text-white/60">XP</p>
            <p className="text-xl font-extrabold text-gold">+{xp}</p>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Link href={returnPath()} className="btn-secondary flex-1 rounded-xl py-2.5 font-semibold">
            {returnLabel()}
          </Link>
          <button type="button" onClick={onRematch} className="btn-primary flex-1 rounded-xl py-2.5 font-bold">
            Rematch
          </button>
        </div>
      </div>
    </Modal>
  );
}
