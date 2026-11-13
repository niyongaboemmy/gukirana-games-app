"use client";
import { useEffect, useState } from "react";
import { Ban, Flag, Hand, Loader2, MessageCircle, Mic, Phone, Star, Swords, Trophy, UserRound, Volume2, VolumeX, X, type LucideIcon } from "lucide-react";
import type { ReportReason } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { blockPerson, waveAt } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { GAME_LABEL } from "@/lib/match-store";
import { setMuted, setVolume, useVoice } from "@/voice/voice";
import { requestCall } from "@/voice/call";
import { fetchProfile, sendReport, type PublicProfile } from "./api";
import { tracks } from "./motion";
import { notify, openThread, useSocial } from "./social-store";

/**
 * Person menu (core usability): tap / click anyone (avatar, name tag, chat name, people list) → Wave, Chat,
 * Voice call, Challenge, Profile, Mute + volume, Block, Report. Works in the plaza and in the halls.
 * UI strings to move to @gukirana/i18n keys `person.*`.
 */
const glass = "rounded-2xl border border-white/20 bg-[#151935]/92 text-white shadow-2xl backdrop-blur-xl";
const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: "harassment", label: "Harassment or bullying" },
  { id: "scam", label: "Scam or payment outside Gukirana" },
  { id: "hate", label: "Hate speech" },
  { id: "inappropriate", label: "Inappropriate name or behaviour" },
  { id: "cheating", label: "Cheating" },
  { id: "other", label: "Something else" },
];

function Action({ icon: Icon, label, onClick, disabled, active, danger, hint }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={hint ?? label}
      className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[12px] font-bold transition active:scale-95 disabled:opacity-35 ${
        active ? "bg-white/20 ring-2 ring-white/40" : danger ? "bg-[#EF4444]/15 text-[#ffb4b4] hover:bg-[#EF4444]/25" : "bg-white/10 hover:bg-white/15"
      }`}
    >
      <Icon size={20} strokeWidth={1.85} />
      {label}
    </button>
  );
}

export function PersonMenu() {
  const id = useSocial((s) => s.menu);
  const p = useWorld((s) => (id ? s.players[id] : undefined));
  const authed = useSession((s) => s.status === "authenticated");
  const voiceOn = useVoice((s) => s.status === "on");
  const muted = useVoice((s) => (id ? !!s.muted[id] : false));
  const volume = useVoice((s) => (id ? (s.volume[id] ?? 1) : 1));
  const talking = useVoice((s) => (id ? !!s.talking[id] : false));
  const hasVoice = useVoice((s) => (id ? !!s.available[id] : false));
  const callStatus = useSocial((s) => s.call.status);
  const seated = useWorld((s) => (id ? Object.values(s.seats).includes(id) : false));
  const [panel, setPanel] = useState<null | "profile" | "volume" | "block" | "report">(null);
  const [profile, setProfile] = useState<PublicProfile | "loading" | "error" | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sending, setSending] = useState(false);
  const [dist, setDist] = useState<number | null>(null);

  useEffect(() => {
    setPanel(null);
    setProfile(null);
    setReason(null);
  }, [id]);
  // an expanded section (profile, volume, block, report) scrolls into view on short screens
  useEffect(() => {
    if (panel) document.getElementById("person-panel")?.scrollIntoView({ block: "nearest" });
  }, [panel]);
  useEffect(() => {
    if (!id) return;
    const tick = () => setDist(tracks.get(id)?.dist ?? null);
    tick();
    const t = setInterval(tick, 500);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && useSocial.setState({ menu: null });
    window.addEventListener("keydown", esc);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", esc);
    };
  }, [id]);

  if (!id || !p) return null;
  const close = () => useSocial.setState({ menu: null });
  const card = { id: p.id, name: p.name, color: p.color, level: p.level, uid: p.uid };
  const verified = p.verified !== false;
  const signedInOnly = !authed ? "Sign in at the gate first" : !verified ? `${p.name} is a guest` : undefined;

  const showProfile = () => {
    setPanel(panel === "profile" ? null : "profile");
    if (profile && profile !== "error") return;
    if (!p.uid) return setProfile("error");
    setProfile("loading");
    fetchProfile(p.uid).then(setProfile, () => setProfile("error"));
  };
  const doReport = async () => {
    if (!reason || !p.uid) return;
    setSending(true);
    // evidence: the last lines they wrote in this room + our private thread (no audio in this version)
    const room = useWorld.getState().chat.filter((c) => c.id === p.id).slice(-15).map((c) => ({ name: c.name, text: c.text, t: c.t }));
    const dm = (useSocial.getState().threads[p.id]?.lines ?? []).slice(-15).map((l) => ({ name: l.mine ? "me" : p.name, text: l.text, t: l.t }));
    try {
      await sendReport({ targetId: p.uid, reason, context: { place: location.pathname.slice(0, 32), chat: [...room, ...dm].slice(-30) } });
      notify("Thanks, our team will review this report.");
      setPanel("block");
    } catch {
      notify("Could not send the report. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-end justify-center bg-black/25 p-3 sm:items-center" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={`${p.name}: actions`} className={`${glass} max-h-[92vh] w-[min(440px,96vw)] overflow-y-auto p-4`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <span className="relative grid size-12 shrink-0 place-items-center rounded-full text-lg font-black" style={{ background: p.color }}>
            {p.name.slice(0, 1).toUpperCase()}
            {talking && <Mic size={14} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[#22C55E] p-0.5" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-lg font-extrabold">{p.name}</p>
            <p className="flex items-center gap-1 text-sm text-white/65">
              <Star size={12} className="fill-[#FFC83D] text-[#FFC83D]" /> Level {p.level}
              {dist != null && <> · {dist < 1.5 ? "right here" : `${Math.round(dist)} m away`}</>}
              {seated && <> · seated</>}
              {!verified && <> · guest</>}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="grid size-9 place-items-center rounded-xl bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <Action
            icon={Hand}
            label="Wave"
            onClick={() => {
              if (!waveAt(p.id)) notify("One moment…", undefined, 1200);
              close();
            }}
          />
          <Action icon={MessageCircle} label="Chat" disabled={!!signedInOnly} hint={signedInOnly} onClick={() => openThread(card)} />
          <Action
            icon={Phone}
            label="Call"
            disabled={!!signedInOnly || callStatus !== "idle"}
            hint={signedInOnly ?? (callStatus !== "idle" ? "You are already in a call" : "Private voice call: you both hear each other anywhere here")}
            onClick={() => {
              void requestCall(card);
              close();
            }}
          />
          <Action
            icon={Swords}
            label="Challenge"
            disabled={!!signedInOnly}
            hint={signedInOnly}
            onClick={() => useSocial.setState({ challenge: { id: p.id, name: p.name }, menu: null })}
          />
          <Action icon={UserRound} label="Profile" active={panel === "profile"} onClick={showProfile} />
          <Action
            icon={muted ? VolumeX : Volume2}
            label={muted ? "Unmute" : "Mute"}
            active={panel === "volume"}
            hint="Mute or change their voice volume"
            onClick={() => {
              if (muted) setMuted(p.id, false);
              setPanel(panel === "volume" ? null : "volume");
            }}
          />
          <Action icon={Ban} label="Block" danger active={panel === "block"} onClick={() => setPanel(panel === "block" ? null : "block")} />
          <Action icon={Flag} label="Report" danger active={panel === "report"} disabled={!authed || !p.uid} hint={!authed ? "Sign in to report" : undefined} onClick={() => setPanel(panel === "report" ? null : "report")} />
        </div>

        {panel === "profile" && (
          <div id="person-panel" className="mt-3 rounded-xl bg-white/5 p-3 text-sm">
            {profile === "loading" && (
              <p className="flex items-center gap-2 text-white/60">
                <Loader2 size={14} className="animate-spin" /> Loading profile…
              </p>
            )}
            {profile === "error" && <p className="text-white/60">Profile not available{verified ? "" : " for guests"}.</p>}
            {profile && typeof profile === "object" && (
              <>
                <p className="mb-2 text-white/70">
                  Level {profile.level} · member since {profile.memberSince}
                </p>
                {Object.keys(profile.ratings).length === 0 ? (
                  <p className="text-white/50">No rated games yet.</p>
                ) : (
                  <div className="grid gap-1.5">
                    {Object.entries(profile.ratings).map(([g, r]) => (
                      <p key={g} className="flex items-center gap-2">
                        <Trophy size={14} className="text-[#FFC83D]" />
                        <span className="flex-1 font-semibold">{GAME_LABEL[g as keyof typeof GAME_LABEL] ?? g}</span>
                        <span className="tabular-nums">{r.rating}</span>
                        <span className="text-xs text-white/50">
                          {r.wins}/{r.games} won
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {panel === "volume" && (
          <div id="person-panel" className="mt-3 rounded-xl bg-white/5 p-3 text-sm">
            {!voiceOn || !hasVoice ? (
              <p className="mb-2 text-white/60">{!voiceOn ? "Turn on Voice to hear people nearby." : `${p.name} has voice off.`}</p>
            ) : (
              <label className="mb-2 flex items-center gap-3">
                <Volume2 size={16} />
                <span className="sr-only">Volume for {p.name}</span>
                <input type="range" min={0} max={150} step={5} value={Math.round(volume * 100)} onChange={(e) => setVolume(p.id, Number(e.target.value) / 100)} className="flex-1 accent-[#7CC4FF]" />
                <span className="w-10 text-right tabular-nums">{Math.round(volume * 100)}%</span>
              </label>
            )}
            <button type="button" onClick={() => setMuted(p.id, !muted)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 py-2 font-semibold">
              {muted ? <Volume2 size={16} /> : <VolumeX size={16} />} {muted ? `Unmute ${p.name}` : `Mute ${p.name}`}
            </button>
          </div>
        )}

        {panel === "block" && (
          <div id="person-panel" className="mt-3 rounded-xl bg-[#EF4444]/10 p-3 text-sm">
            <p className="mb-2 text-white/80">
              Block {p.name}? You become invisible and silent to each other: no chat, private messages, calls or challenges. You can unblock in Settings.
            </p>
            <button
              type="button"
              onClick={() => {
                blockPerson(p.id);
                notify(`${p.name} is blocked.`);
                close();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#EF4444] py-2 font-extrabold"
            >
              <Ban size={16} /> Block {p.name}
            </button>
          </div>
        )}

        {panel === "report" && (
          <div id="person-panel" className="mt-3 rounded-xl bg-white/5 p-3 text-sm">
            <p className="mb-2 text-white/70">What happened? Recent chat lines are attached for our safety team.</p>
            <div className="mb-2 grid gap-1">
              {REPORT_REASONS.map((r) => (
                <label key={r.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 ${reason === r.id ? "bg-white/15" : "hover:bg-white/5"}`}>
                  <input type="radio" name="report-reason" checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-[#EF4444]" />
                  {r.label}
                </label>
              ))}
            </div>
            <button type="button" disabled={!reason || sending} onClick={() => void doReport()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#EF4444] py-2 font-extrabold disabled:opacity-40">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />} Send report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
