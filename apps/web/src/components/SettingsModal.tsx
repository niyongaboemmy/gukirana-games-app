"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Ban, Footprints, Gift, LogOut, Mic, MicOff, Shirt, Sparkles, Star, Trophy, X } from "lucide-react";
import { claimDailyStars, logout, useSession } from "@/lib/session";
import { totalXpForLevel, useProfile } from "@/lib/profile-store";
import { useWorld } from "@/lib/world-store";
import { disableVoice, enableVoice, useVoice } from "@/voice/voice";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";
import { useSocial } from "@/social/social-store";
import { unblockKey } from "@/lib/realtime";

const GAMES = [
  { id: "pool", label: "Pool", icon: PoolBallIcon, color: "#2F80ED" },
  { id: "ludo", label: "Ludo", icon: DieIcon, color: "#FF8A1F" },
  { id: "igisoro", label: "Igisoro", icon: SeedsIcon, color: "#27AE60" },
] as const;
const PACES = ["slow", "normal", "fast"] as const;

/**
 * Account & settings sheet (replaces the old 2D page): who you are, Stars + daily claim, ratings,
 * walking pace, voice, edit avatar, sign out. Opens over the 3D world; Esc / backdrop closes.
 */
export function SettingsModal({ onClose, onEditAvatar }: { onClose: () => void; onEditAvatar: () => void }) {
  const router = useRouter();
  const me = useSession((s) => s.me);
  const color = useProfile((s) => s.color);
  const speed = useWorld((s) => s.speed);
  const voice = useVoice((s) => s.status);
  const blocked = useSocial((s) => s.blocked);
  const [daily, setDaily] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  if (!me) return null;
  const level = me.level;
  const from = totalXpForLevel(level);
  const to = totalXpForLevel(level + 1);
  const pct = Math.max(0, Math.min(1, (me.xp - from) / (to - from)));

  const setPace = (p: (typeof PACES)[number]) => {
    useWorld.getState().set({ speed: p });
    try {
      localStorage.setItem("gk-speed", p);
    } catch {
      /* private mode */
    }
  };

  return createPortal(
    <div className={`fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Account and settings"
        onClick={(e) => e.stopPropagation()}
        className={`w-[min(440px,94vw)] max-h-[92dvh] overflow-y-auto rounded-[28px] border border-white/20 bg-[#12152b]/90 p-5 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)] backdrop-blur-2xl transition-all duration-300 ${shown ? "translate-y-0 scale-100" : "translate-y-4 scale-95"}`}
      >
        {/* header: who you are */}
        <div className="flex items-center gap-3">
          <div className="relative grid size-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#FFC83D ${pct * 360}deg, rgba(255,255,255,.15) 0)` }}>
            <div className="grid size-[54px] place-items-center rounded-full text-xl font-black" style={{ background: color }}>
              {(me.username ?? "?").slice(0, 1).toUpperCase()}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-extrabold">{me.username}</p>
            <p className="flex items-center gap-1 text-sm text-[#FFC83D]">
              <Sparkles size={14} /> Level {level} · {me.xp - from}/{to - from} XP
            </p>
            <p className="truncate text-xs text-white/45">{me.phone ?? me.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
            <X size={18} />
          </button>
        </div>

        {/* wallet + ratings */}
        <div className="mt-4 grid grid-cols-[1.1fr_1fr] gap-2">
          <div className="rounded-2xl bg-white/[.06] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Stars</p>
            <p className="flex items-center gap-1.5 text-2xl font-extrabold tabular-nums">
              <Star size={20} className="fill-[#7CC4FF] text-[#7CC4FF]" /> {me.stars}
            </p>
            <button
              type="button"
              onClick={() => void claimDailyStars().then((r) => setDaily(r.granted ? `+${r.granted} added` : "Claimed today")).catch(() => setDaily("Try again"))}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#7CC4FF]/15 py-1.5 text-sm font-bold text-[#cfe9ff]"
            >
              <Gift size={15} /> {daily ?? "Daily Stars"}
            </button>
          </div>
          <div className="rounded-2xl bg-white/[.06] p-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-white/50">
              <Trophy size={12} /> Ratings
            </p>
            {GAMES.map((g) => (
              <p key={g.id} className="flex items-center gap-2 py-0.5 text-sm">
                <g.icon size={14} style={{ color: g.color }} />
                <span className="flex-1 text-white/75">{g.label}</span>
                <span className="font-bold tabular-nums">{me.ratings[g.id]?.rating ?? 1500}</span>
              </p>
            ))}
          </div>
        </div>

        {/* quick settings */}
        <div className="mt-3 space-y-2 rounded-2xl bg-white/[.06] p-3">
          <div className="flex items-center gap-2">
            <Footprints size={16} className="text-white/60" />
            <span className="flex-1 text-sm font-semibold">Walking pace</span>
            <div className="flex overflow-hidden rounded-xl bg-white/10 text-xs font-bold">
              {PACES.map((p) => (
                <button key={p} type="button" onClick={() => setPace(p)} className={`px-3 py-1.5 capitalize ${speed === p ? "bg-white/25" : ""}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {voice === "on" ? <Mic size={16} className="text-[#22C55E]" /> : <MicOff size={16} className="text-white/60" />}
            <span className="flex-1 text-sm font-semibold">Voice chat {voice === "denied" && <span className="text-xs font-normal text-[#ff9b9b]">· microphone blocked</span>}</span>
            <button
              type="button"
              role="switch"
              aria-checked={voice === "on"}
              onClick={() => (voice === "on" ? disableVoice() : void enableVoice())}
              className={`relative h-7 w-12 rounded-full transition ${voice === "on" ? "bg-[#22C55E]" : "bg-white/20"}`}
            >
              <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${voice === "on" ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>

        {/* blocked people (block = invisible + silent to each other) */}
        {blocked.length > 0 && (
          <div className="mt-3 rounded-2xl bg-white/[.06] p-3">
            <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-white/50">
              <Ban size={12} /> Blocked people
            </p>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {blocked.map((b) => (
                <p key={b.key} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{b.name || "Player"}</span>
                  <button type="button" onClick={() => void unblockKey(b.key)} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20">
                    Unblock
                  </button>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* actions */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onEditAvatar} className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-3 font-bold hover:bg-white/15">
            <Shirt size={18} /> Edit avatar
          </button>
          {leaving ? (
            <button
              type="button"
              onClick={() => {
                disableVoice();
                void logout().then(() => router.push("/gate"));
              }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-[#EF4444] py-3 font-bold"
            >
              <LogOut size={18} /> Confirm sign out
            </button>
          ) : (
            <button type="button" onClick={() => setLeaving(true)} className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 py-3 font-bold text-white/85 hover:bg-white/5">
              <LogOut size={18} /> Sign out
            </button>
          )}
        </div>
        <p className="mt-3 text-center text-[11px] text-white/40">You can also sign out at the gate exit. Stars are practice currency with no cash value.</p>
      </section>
    </div>,
    document.body,
  );
}
