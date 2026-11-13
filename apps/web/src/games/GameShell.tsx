"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { returnLabel, returnPath } from "@/lib/return-point";
import { Bot, CircleHelp, Handshake, LogOut, Menu, Pause, Play, ShieldCheck, Star, Trophy, User, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { PaperCard } from "@/ui/PaperCard";
import { haptic, sfx, useGamePrefs } from "./feedback";
import { useGameInput } from "./input";
import { t, type GameKey } from "./i18n";
import "./games.css";

export type GameId = "pool" | "ludo" | "igisoro";

export interface PanelPlayer {
  name: string;
  color: string;
  level: number;
  active: boolean;
  isBot?: boolean;
  /** overrides the "Lvl" line, e.g. "Rating 1516" for live opponents */
  subtitle?: string;
  detail?: React.ReactNode;
  /** live turn clock (epoch ms) for the timer ring; omitted in practice (pulsing ring instead) */
  deadline?: number;
  turnMs?: number;
  offline?: boolean;
}

/**
 * Common game screen (DESIGN-SPEC §11.1): you + opponent panels with a turn timer ring, board centred, POT banner,
 * fairness badge, game menu (Esc / B / Back) with How to play, sound, vibration and leave. Landscape: side panels;
 * portrait (phones, the 2D games): opponents on top, you + controls at the bottom, near the thumbs.
 */
export function GameShell({
  game,
  title,
  icon: Icon,
  color,
  pot,
  you,
  opponents,
  fairness,
  children,
  footer,
  mode = t("game.practice"),
  onLeave,
  live = false,
  menuExtras,
}: {
  game: GameId;
  mode?: string;
  onLeave?: () => void;
  live?: boolean;
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
  pot: number;
  you: PanelPlayer;
  opponents: PanelPlayer[];
  fairness?: { commit: string; reveal?: string; rolls?: number } | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
  menuExtras?: (close: () => void) => React.ReactNode;
}) {
  useGameInput();
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  const seen = useGamePrefs((s) => s.seen[game]);
  const [help, setHelp] = useState(false);
  const sound = useGamePrefs((s) => s.sound);
  const setPrefs = useGamePrefs((s) => s.set);
  // first visit: the How to play card (dismissible, remembered per device); waits for the persisted prefs
  useEffect(() => {
    const t0 = setTimeout(() => {
      if (!useGamePrefs.getState().seen[game]) setHelp(true);
    }, 250);
    return () => clearTimeout(t0);
  }, [game, seen]);

  // Esc / Back / gamepad B opens the game menu (dialogs close themselves first)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack") {
        if (document.querySelector('[aria-modal="true"]')) return;
        e.preventDefault();
        setMenu(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // your turn: a soft chime + a short buzz on phones
  const wasActive = useRef(you.active);
  useEffect(() => {
    if (you.active && !wasActive.current) {
      sfx.yourTurn();
      haptic(30);
    }
    wasActive.current = you.active;
  }, [you.active]);

  return (
    <div className="gk-game fixed inset-0 flex flex-col bg-[radial-gradient(ellipse_at_top,#26282c_0%,var(--color-ink-950)_70%)] font-ui text-on-glass">
      <header className="flex items-center gap-2 px-[max(0.75rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 phone:py-1">
        <button type="button" onClick={() => setMenu(true)} className="btn-secondary flex min-h-11 items-center gap-1.5 rounded-control px-3 text-sm font-semibold" aria-label={t("game.menu")}>
          <Menu size={18} /> <span className="portrait:hidden">{t("game.menu")}</span>
        </button>
        <h1 className="ml-1 flex min-w-0 items-center gap-2 truncate font-display text-base font-bold sm:text-lg">
          <span className="grid size-8 shrink-0 place-items-center rounded-control" style={{ background: `${color}33`, color }}>
            <Icon size={18} />
          </span>
          <span className="truncate">{title}</span>
          <span className="truncate text-xs font-semibold text-on-glass-muted max-sm:hidden">· {mode}</span>
        </h1>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="num chip flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold tabular-nums">
            {pot > 0 ? (
              <>
                {t("game.pot")} {pot} <Star size={14} className="fill-star text-star" />
              </>
            ) : (
              <span className="max-sm:hidden">{t("game.noStake")}</span>
            )}
            {pot === 0 && <Star size={14} className="text-on-glass-muted sm:hidden" />}
          </span>
          {fairness && (
            <button type="button" onClick={() => setFairOpen(true)} className="press flex min-h-9 items-center gap-1.5 rounded-full bg-success/18 px-3 text-sm font-bold text-success-soft ring-1 ring-success/30" aria-label="Provably fair">
              <ShieldCheck size={16} /> <span className="max-sm:hidden">{t("game.fair")}</span>
            </button>
          )}
          <button type="button" onClick={() => setPrefs({ sound: !sound })} className="icon-button grid size-10 place-items-center rounded-full" aria-label={`${t("game.sound")}: ${sound ? t("game.on") : t("game.off")}`} aria-pressed={sound}>
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button type="button" onClick={() => setHelp(true)} className="icon-button grid size-10 place-items-center rounded-full" aria-label={t("game.howToPlay")}>
            <CircleHelp size={18} />
          </button>
        </div>
      </header>

      {/* landscape: you | board | opponents.  portrait: opponents / board / you (thumb zone) */}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(6rem,11rem)_1fr_minmax(6rem,11rem)] gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pb-2 phone:grid-cols-[minmax(4.75rem,7rem)_1fr_minmax(4.75rem,7rem)] phone:gap-1.5 phone:pb-1 portrait:flex portrait:flex-col portrait:gap-2">
        <div className="min-h-0 portrait:order-3">
          <PlayerPanel p={you} label="You" />
        </div>
        <section className="relative grid min-h-0 min-w-0 place-items-center portrait:order-2 portrait:flex-1">{children}</section>
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto portrait:order-1 portrait:flex-row portrait:overflow-x-auto portrait:overflow-y-visible">
          {opponents.map((o, i) => (
            <PlayerPanel key={i} p={o} label={o.isBot ? "AI" : "Opponent"} />
          ))}
        </div>
      </main>
      {footer && <footer className="px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">{footer}</footer>}

      {menu && !leaving && (
        <Modal onClose={() => setMenu(false)} label={t("game.paused")} title={t("game.paused")} icon={Pause}>
          <div className="flex flex-col gap-2">
            <button type="button" data-autofocus onClick={() => setMenu(false)} className="btn-primary flex min-h-12 items-center justify-center gap-2 rounded-control font-bold">
              <Play size={18} /> {t("game.resume")}
            </button>
            <button type="button" onClick={() => (setMenu(false), setHelp(true))} className="btn-secondary flex min-h-12 items-center justify-center gap-2 rounded-control font-semibold">
              <CircleHelp size={18} /> {t("game.howToPlay")}
            </button>
            <PrefToggle k="sound" label="game.sound" />
            <PrefToggle k="haptics" label="game.haptics" />
            {menuExtras?.(() => setMenu(false))}
            <button type="button" onClick={() => setLeaving(true)} className="btn-danger flex min-h-12 items-center justify-center gap-2 rounded-control font-semibold">
              <LogOut size={18} /> {t("game.leave")}
            </button>
          </div>
        </Modal>
      )}
      {leaving && (
        <Modal onClose={() => setLeaving(false)} label={t("game.leaveTitle")} title={t("game.leaveTitle")} icon={LogOut}>
          <p className="text-sm text-on-glass-muted">{pot > 0 ? t("game.leaveStake", { stake: pot / 2 }) : live ? t("game.leaveLive") : t("game.leavePractice")}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" data-autofocus onClick={() => (setLeaving(false), setMenu(false))} className="btn-secondary min-h-12 flex-1 rounded-control font-semibold">
              {t("game.stay")}
            </button>
            <Link href={returnPath()} onClick={onLeave} className="btn-danger grid min-h-12 flex-1 place-items-center rounded-control text-center font-semibold">
              {t("game.leave")}
            </Link>
          </div>
        </Modal>
      )}
      {help && (
        <HowToPlay
          game={game}
          onClose={() => {
            setHelp(false);
            useGamePrefs.getState().markSeen(game);
          }}
        />
      )}
      {fairOpen && fairness && (
        <Modal onClose={() => setFairOpen(false)} label="Provably fair" title="Provably fair" icon={ShieldCheck}>
          <p className="text-sm text-on-glass-muted">Every roll comes from HMAC-SHA256(server seed, client seed, match, roll #). The seed is revealed after the match so you can verify every roll.</p>
          <p className="mt-3 text-xs text-on-glass-muted">Commit (SHA-256 of the seed)</p>
          <code className="block break-all rounded-lg bg-black/40 p-2 text-xs">{fairness.commit}</code>
          <p className="mt-2 text-xs text-on-glass-muted">Seed {fairness.reveal ? "(revealed)" : "(revealed when the match ends)"}</p>
          <code className="block break-all rounded-lg bg-black/40 p-2 text-xs">{fairness.reveal ?? "••••••••"}</code>
          {fairness.rolls !== undefined && <p className="mt-2 text-xs text-on-glass-muted">Rolls so far: {fairness.rolls}</p>}
          <button type="button" data-autofocus onClick={() => setFairOpen(false)} className="btn-secondary mt-4 min-h-11 w-full rounded-control font-semibold">
            {t("game.gotIt")}
          </button>
        </Modal>
      )}
    </div>
  );
}

function PrefToggle({ k, label }: { k: "sound" | "haptics" | "autoMove" | "fullGuide"; label: GameKey }) {
  const on = useGamePrefs((s) => s[k]);
  const set = useGamePrefs((s) => s.set);
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set({ [k]: !on })} className="btn-secondary flex min-h-12 items-center justify-between gap-3 rounded-control px-4 font-semibold">
      <span>{t(label)}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-[color-mix(in_srgb,var(--ink,#000)_18%,transparent)]"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
export { PrefToggle };

/** Turn clock: a ring that drains towards the deadline (live) or pulses (practice, no clock). */
export function TurnRing({ color, deadline, turnMs = 30_000, size = "100%" }: { color: string; deadline?: number; turnMs?: number; size?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  const left = deadline ? Math.max(0, deadline - now) : turnMs;
  const frac = Math.max(0, Math.min(1, left / turnMs));
  const urgent = !!deadline && left < 10_000;
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className={`pointer-events-none absolute inset-0 -rotate-90 ${deadline ? "" : "gk-pulse"}`} style={{ width: size, height: size }} aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / .12)" strokeWidth="7" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={urgent ? "var(--color-warning)" : color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: "stroke-dashoffset .25s linear" }} />
    </svg>
  );
}

function PlayerPanel({ p, label }: { p: PanelPlayer; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!p.deadline || !p.active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [p.deadline, p.active]);
  const secs = p.deadline && p.active ? Math.max(0, Math.ceil((p.deadline - now) / 1000)) : null;
  return (
    <div
      className={`glass-solid flex flex-col gap-1 rounded-card border-2 p-2 transition sm:p-3 phone:gap-0.5 phone:rounded-control phone:p-1.5 portrait:min-w-[9.5rem] portrait:flex-1 portrait:flex-row portrait:items-center portrait:justify-between portrait:p-2 ${p.active ? "" : "opacity-80"}`}
      style={{ borderColor: p.active ? p.color : "rgb(255 255 255 / .1)", boxShadow: p.active ? `0 0 22px -6px ${p.color}` : undefined }}
      aria-live={p.active ? "polite" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2 phone:gap-1.5">
        <div className="relative grid size-11 shrink-0 place-items-center phone:size-8">
          <div className="grid size-[78%] place-items-center rounded-full text-white" style={{ background: p.color }}>
            {p.isBot ? <Bot size={16} /> : <User size={16} />}
          </div>
          {p.active && <TurnRing color={p.color} deadline={p.deadline} turnMs={p.turnMs} />}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold phone:text-xs">{p.name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-gold">
            <Star size={11} className="shrink-0 fill-current" /> {p.subtitle ?? `Lvl ${p.level}`} · {label}
          </p>
        </div>
      </div>
      {p.active && (
        <p className="num flex items-center gap-1.5 text-xs font-bold" style={{ color: p.color }}>
          <span className="size-2 rounded-full" style={{ background: p.color }} /> {label === "You" ? t("game.yourTurn") : t("game.turn")}
          {secs !== null && <span className={secs <= 10 ? "text-warning" : "text-on-glass-muted"}>· {secs}s</span>}
        </p>
      )}
      {p.offline && <p className="text-xs font-semibold text-danger-soft">offline</p>}
      <div className="portrait:text-right">{p.detail}</div>
    </div>
  );
}

/** Accessible dialog: focus moves in (first [data-autofocus]), Esc closes, focus returns to the opener. */
export function Modal({ children, onClose, label, title, icon }: { children: React.ReactNode; onClose?: () => void; label?: string; title?: React.ReactNode; icon?: LucideIcon }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>("button, a[href]");
    el?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!onClose || (e.key !== "Escape" && e.key !== "GoBack" && e.key !== "BrowserBack")) return;
      // only the top-most dialog closes
      const all = document.querySelectorAll('[aria-modal="true"]');
      if (all[all.length - 1] !== box.current) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);
  return (
    <div className="pscrim z-40 grid place-items-center p-4" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} className="max-h-[92dvh] w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {title ? (
          <PaperCard title={title} icon={icon} onClose={onClose} className="max-h-[92dvh]">
            {children}
          </PaperCard>
        ) : (
          <div className="pcard max-h-[92dvh]">
            <div className="pcard-body !p-5">{children}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const HELP: Record<GameId, { rules: GameKey[]; touch: GameKey; keys: GameKey; pad: GameKey; title: GameKey }> = {
  pool: { title: "pool.title", rules: ["help.pool.1", "help.pool.2", "help.pool.3"], touch: "help.pool.touch", keys: "help.pool.keys", pad: "help.pool.pad" },
  ludo: { title: "ludo.title", rules: ["help.ludo.1", "help.ludo.2", "help.ludo.3"], touch: "help.ludo.touch", keys: "help.ludo.keys", pad: "help.ludo.pad" },
  igisoro: { title: "igisoro.title", rules: ["help.igisoro.1", "help.igisoro.2", "help.igisoro.3"], touch: "help.igisoro.touch", keys: "help.igisoro.keys", pad: "help.igisoro.pad" },
};

export function HowToPlay({ game, onClose }: { game: GameId; onClose: () => void }) {
  const h = HELP[game];
  return (
    <Modal onClose={onClose} label={t("game.howToPlay")} title={t("game.howToPlay")} icon={CircleHelp}>
      <p className="font-display text-xl font-bold">{t(h.title)}</p>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        {h.rules.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      <p className="plabel mt-4">{t("game.controls")}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="font-semibold">{t("game.touch")}</dt>
        <dd className="text-on-glass-muted">{t(h.touch)}</dd>
        <dt className="font-semibold">{t("game.keyboard")}</dt>
        <dd className="text-on-glass-muted">{t(h.keys)}</dd>
        <dt className="font-semibold">{t("game.gamepad")}</dt>
        <dd className="text-on-glass-muted">{t(h.pad)}</dd>
      </dl>
      <button type="button" data-autofocus onClick={onClose} className="btn-primary mt-4 min-h-12 w-full rounded-control font-bold">
        {t("game.gotIt")}
      </button>
    </Modal>
  );
}

/** Big centred banner for turn changes and fouls; re-keyed by the caller to replay. */
export function TurnBanner({ text, tone = "info" }: { text: string; tone?: "info" | "good" | "bad" }) {
  const ring = tone === "bad" ? "ring-danger/60 text-danger-soft" : tone === "good" ? "ring-success/50 text-success-soft" : "ring-accent/50 text-on-glass";
  return (
    <div role="status" className={`gk-banner glass pointer-events-none absolute left-1/2 top-1/2 z-30 max-w-[90%] rounded-card px-6 py-3 text-center font-display text-xl font-bold ring-2 sm:text-2xl ${ring}`}>
      {text}
    </div>
  );
}

export function ResultModal({ won, draw = false, starsDelta, xp, summary, onRematch }: { won: boolean; draw?: boolean; starsDelta: number; xp: number; summary: string; onRematch: () => void }) {
  useEffect(() => {
    if (won) sfx.win();
    else sfx.lose();
    haptic(won ? [40, 60, 40, 60, 120] : 120);
  }, [won]);
  return (
    <Modal label={won ? "You won" : "Game over"}>
      <div className="text-center">
        <div className={`mx-auto grid size-20 place-items-center rounded-full ${won ? "bg-gold/25 text-gold" : "bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-white"}`}>{won ? <Trophy size={40} /> : <Handshake size={40} />}</div>
        <p className="mt-2 font-display text-2xl font-bold">{won ? "You won!" : draw ? "Draw" : "Good game"}</p>
        <p className="mt-1 text-sm text-on-glass-muted">{summary}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="ptile">
            <p className="text-on-glass-muted">Stars</p>
            <p className={`num text-xl font-bold ${starsDelta > 0 ? "text-success" : "text-white"}`}>
              {starsDelta >= 0 ? "+" : ""}
              {starsDelta} <Star size={16} className="inline fill-current align-[-2px]" />
            </p>
          </div>
          <div className="ptile">
            <p className="text-on-glass-muted">XP</p>
            <p className="num text-xl font-bold text-gold">+{xp}</p>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Link href={returnPath()} data-autofocus className="btn-secondary grid min-h-12 flex-1 place-items-center rounded-control font-semibold">
            {returnLabel()}
          </Link>
          <button type="button" onClick={onRematch} className="btn-primary min-h-12 flex-1 rounded-control font-bold">
            {t("game.rematch")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
