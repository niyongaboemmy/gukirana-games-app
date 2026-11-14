"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Footprints, Gift, LogOut, Mic, MicOff, Palette, Shirt, Sparkles, Star, Trophy, UserRound, Vibrate, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { PaperCard } from "@/ui/PaperCard";
import { setPaperTheme, usePaperTheme } from "@/ui/paper-theme";
import { useGamePrefs } from "@/games/feedback";
import { claimDailyStars, logout, useSession } from "@/lib/session";
import { totalXpForLevel, useProfile } from "@/lib/profile-store";
import { useWorld } from "@/lib/world-store";
import { disableVoice, enableVoice, useVoice } from "@/voice/voice";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";
import { useSocial } from "@/social/social-store";
import { unblockKey } from "@/lib/realtime";
import { signOut as walkOut } from "@/world/stage";

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
  const me = useSession((s) => s.me);
  const color = useProfile((s) => s.color);
  const speed = useWorld((s) => s.speed);
  const paperTheme = usePaperTheme();
  const voice = useVoice((s) => s.status);
  const gameSound = useGamePrefs((s) => s.sound);
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
    <div className={`pscrim z-50 grid place-items-center p-4 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Account and settings" onClick={(e) => e.stopPropagation()} className="w-[min(480px,94vw)]">
        <PaperCard title={me.username ?? "Your account"} icon={UserRound} onClose={onClose} className="max-h-[92dvh]">
          {/* who you are */}
          <div className="flex items-center gap-3">
            <div className="relative grid size-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#d9ab3c ${pct * 360}deg, rgb(70 50 25 / .15) 0)` }}>
              <div className="grid size-[54px] place-items-center rounded-full text-xl font-black text-white" style={{ background: color }}>
                {(me.username ?? "?").slice(0, 1).toUpperCase()}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 font-bold pgold">
                <Sparkles size={15} /> Level {level} · {me.xp - from}/{to - from} XP
              </p>
              <p className="pmuted truncate text-sm">{me.phone ?? me.email}</p>
            </div>
          </div>

          {/* Stars + ratings */}
          <div className="mt-4 grid grid-cols-[1.1fr_1fr] gap-2">
            <div className="plist p-3">
              <p className="plabel">Stars · practice</p>
              <p className="num flex items-center gap-1.5 text-2xl font-extrabold">
                <Star size={20} className="fill-[#d9ab3c] text-[#d9ab3c]" /> {me.stars}
              </p>
              <button
                type="button"
                onClick={() => void claimDailyStars().then((r) => setDaily(r.granted ? `+${r.granted} added` : "Claimed today")).catch(() => setDaily("Try again"))}
                className="pbtn pbtn-primary mt-2 min-h-10! w-full text-sm"
              >
                <Gift size={15} /> {daily ?? "Daily Stars"}
              </button>
            </div>
            <div className="plist p-3">
              <p className="plabel mb-1 flex items-center gap-1">
                <Trophy size={12} /> Ratings
              </p>
              {GAMES.map((g) => (
                <p key={g.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <g.icon size={14} style={{ color: g.color }} />
                  <span className="pmuted flex-1">{g.label}</span>
                  <span className="num font-bold">{me.ratings[g.id]?.rating ?? 1500}</span>
                </p>
              ))}
            </div>
          </div>

          {/* settings */}
          <p className="plabel mb-1.5 mt-4">Settings</p>
          <div className="plist">
            <div className="prow">
              <span className="prow-icon">
                <Footprints size={18} />
              </span>
              <span className="prow-title flex-1">Walking pace</span>
              <div className="pseg w-[200px]">
                {PACES.map((p) => (
                  <button key={p} type="button" aria-pressed={speed === p} onClick={() => setPace(p)} className="min-h-9! text-sm! capitalize">
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="prow">
              <span className="prow-icon">
                <Palette size={18} />
              </span>
              <span className="prow-title flex-1">Windows</span>
              <div className="pseg w-[220px]">
                {(["auto", "light", "dark"] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={paperTheme === t} onClick={() => setPaperTheme(t)} className="min-h-9! text-sm! capitalize">
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="prow">
              <span className={`prow-icon ${voice === "on" ? "is-plus" : ""}`}>{voice === "on" ? <Mic size={18} /> : <MicOff size={18} />}</span>
              <span className="flex-1">
                <span className="prow-title block">Voice chat</span>
                {voice === "denied" && <span className="prow-sub pminus">Microphone blocked in the browser</span>}
              </span>
              <button type="button" role="switch" aria-checked={voice === "on"} aria-label="Voice chat" onClick={() => (voice === "on" ? disableVoice() : void enableVoice())} className="pswitch" />
            </div>
            <GameSwitch k="sound" label="Game sounds" icon={gameSound ? Volume2 : VolumeX} />
            <GameSwitch k="haptics" label="Vibration in games" icon={Vibrate} />
          </div>

          {/* blocked people (block = invisible + silent to each other) */}
          {blocked.length > 0 && (
            <>
              <p className="plabel mb-1.5 mt-4 flex items-center gap-1">
                <Ban size={12} /> Blocked people
              </p>
              <div className="plist max-h-40 overflow-y-auto">
                {blocked.map((b) => (
                  <div key={b.key} className="prow min-h-12!">
                    <span className="prow-title flex-1 truncate">{b.name || "Player"}</span>
                    <button type="button" onClick={() => void unblockKey(b.key)} className="pbtn pbtn-secondary min-h-9! px-3! text-sm!">
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* actions */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={onEditAvatar} className="pbtn pbtn-secondary">
              <Shirt size={18} /> Edit avatar
            </button>
            {leaving ? (
              <button
                type="button"
                onClick={() => {
                  disableVoice();
                  // the person turns and walks out through the gate (world/stage.ts), then the session ends
                  onClose();
                  walkOut("menu", logout);
                }}
                className="pbtn pbtn-danger"
              >
                <LogOut size={18} /> Confirm sign out
              </button>
            ) : (
              <button type="button" onClick={() => setLeaving(true)} className="pbtn pbtn-leather">
                <LogOut size={18} /> Sign out
              </button>
            )}
          </div>
          <p className="pnote mt-3">You can also sign out at the gate exit. Stars are practice currency with no cash value.</p>
        </PaperCard>
      </section>
    </div>,
    document.body,
  );
}

/** Game-screen preference switch (shared with the in-game menu: games/feedback.ts). */
function GameSwitch({ k, label, icon: Icon }: { k: "sound" | "haptics"; label: string; icon: LucideIcon }) {
  const on = useGamePrefs((s) => s[k]);
  return (
    <div className="prow">
      <span className={`prow-icon ${on ? "is-plus" : ""}`}>
        <Icon size={18} />
      </span>
      <span className="prow-title flex-1">{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => useGamePrefs.getState().set({ [k]: !on })} className="pswitch" />
    </div>
  );
}
