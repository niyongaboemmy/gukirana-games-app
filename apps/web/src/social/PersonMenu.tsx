"use client";
import { useEffect, useState } from "react";
import { Ban, Flag, Hand, Loader2, MessageCircle, Mic, Phone, Star, Swords, Trophy, UserRound, Volume2, VolumeX, X, type LucideIcon } from "lucide-react";
import type { ReportReason } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { blockPerson, requestPair } from "@/lib/realtime";
import { ACT } from "@gukirana/contracts";
import { ACTIONS, PAIR_ACTIONS } from "./actions";
import { doAction } from "./people";
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
      className={`ptab min-h-[66px]! flex-col gap-1! px-1! py-2 text-[12px]! disabled:opacity-35 ${active ? "is-on" : danger ? "text-[var(--minus)]!" : ""}`}
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
  const meSeated = useWorld((s) => !!s.you && Object.values(s.seats).includes(s.you));
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
    <div className="pscrim pointer-events-auto z-40 flex items-end justify-center p-3 sm:items-center" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={`${p.name}: actions`} className="pcard max-h-[92vh] w-[min(460px,96vw)]" onClick={(e) => e.stopPropagation()}>
        <div className="pcard-head">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-full text-lg font-black text-white shadow" style={{ background: p.color }}>
            {p.name.slice(0, 1).toUpperCase()}
            {talking && <Mic size={14} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-success p-0.5" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-display text-xl font-extrabold">{p.name}</p>
            <p className="flex items-center gap-1 text-sm text-white/85">
              <Star size={12} className="fill-gold text-gold" /> Level {p.level}
              {dist != null && <> · {dist < 1.5 ? "right here" : `${Math.round(dist)} m away`}</>}
              {seated && <> · seated</>}
              {!verified && <> · guest</>}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="pcard-hbtn">
            <X size={20} />
          </button>
        </div>
        <div className="pcard-body">

        {/* greetings: gestures go straight away; contact (handshake, fist bump, hug) asks them first */}
        <div className="mb-2 grid grid-cols-4 gap-2">
          {PAIR_ACTIONS.map((a) => (
            <Action
              key={a.kind}
              icon={a.icon}
              label={a.label}
              disabled={!!signedInOnly || seated || meSeated || (dist != null && dist > 3)}
              hint={signedInOnly ?? (seated || meSeated ? "Stand up first" : dist != null && dist > 3 ? "Walk a little closer" : `Ask ${p.name} to ${a.verb}`)}
              onClick={() => {
                requestPair(p.id, a.kind);
                close();
              }}
            />
          ))}
          <Action
            icon={ACTIONS.thumbsUp!.icon}
            label="Thumbs up"
            onClick={() => {
              if (!doAction(ACT.thumbsUp, p.id)) notify("One moment…", undefined, 1200);
              close();
            }}
          />
        </div>

        <div className="grid grid-cols-4 gap-2">
          <Action
            icon={Hand}
            label="Wave"
            onClick={() => {
              if (!doAction(ACT.wave, p.id)) notify("One moment…", undefined, 1200);
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
          <div id="person-panel" className="plist mt-3 p-3 text-sm">
            {profile === "loading" && (
              <p className="flex items-center gap-2 pmuted">
                <Loader2 size={14} className="animate-spin" /> Loading profile…
              </p>
            )}
            {profile === "error" && <p className="pmuted">Profile not available{verified ? "" : " for guests"}.</p>}
            {profile && typeof profile === "object" && (
              <>
                <p className="mb-2 pmuted">
                  Level {profile.level} · member since {profile.memberSince}
                </p>
                {Object.keys(profile.ratings).length === 0 ? (
                  <p className="pmuted">No rated games yet.</p>
                ) : (
                  <div className="grid gap-1.5">
                    {Object.entries(profile.ratings).map(([g, r]) => (
                      <p key={g} className="flex items-center gap-2">
                        <Trophy size={14} className="pgold" />
                        <span className="flex-1 font-semibold">{GAME_LABEL[g as keyof typeof GAME_LABEL] ?? g}</span>
                        <span className="tabular-nums">{r.rating}</span>
                        <span className="text-xs pmuted">
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
          <div id="person-panel" className="plist mt-3 p-3 text-sm">
            {!voiceOn || !hasVoice ? (
              <p className="mb-2 pmuted">{!voiceOn ? "Turn on Voice to hear people nearby." : `${p.name} has voice off.`}</p>
            ) : (
              <label className="mb-2 flex items-center gap-3">
                <Volume2 size={16} />
                <span className="sr-only">Volume for {p.name}</span>
                <input type="range" min={0} max={150} step={5} value={Math.round(volume * 100)} onChange={(e) => setVolume(p.id, Number(e.target.value) / 100)} className="flex-1 accent-[#8c684a]" />
                <span className="w-10 text-right tabular-nums">{Math.round(volume * 100)}%</span>
              </label>
            )}
            <button type="button" onClick={() => setMuted(p.id, !muted)} className="pbtn pbtn-secondary w-full">
              {muted ? <Volume2 size={16} /> : <VolumeX size={16} />} {muted ? `Unmute ${p.name}` : `Mute ${p.name}`}
            </button>
          </div>
        )}

        {panel === "block" && (
          <div id="person-panel" className="pnote mt-3 flex-col! p-3 text-sm">
            <p className="mb-2 pmuted">
              Block {p.name}? You become invisible and silent to each other: no chat, private messages, calls or challenges. You can unblock in Settings.
            </p>
            <button
              type="button"
              onClick={() => {
                blockPerson(p.id);
                notify(`${p.name} is blocked.`);
                close();
              }}
              className="pbtn pbtn-danger w-full"
            >
              <Ban size={16} /> Block {p.name}
            </button>
          </div>
        )}

        {panel === "report" && (
          <div id="person-panel" className="plist mt-3 p-3 text-sm">
            <p className="mb-2 pmuted">What happened? Recent chat lines are attached for our safety team.</p>
            <div className="mb-2 grid gap-1">
              {REPORT_REASONS.map((r) => (
                <label key={r.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 ${reason === r.id ? "bg-[#8c684a]/15" : "hover:bg-[#8c684a]/8"}`}>
                  <input type="radio" name="report-reason" checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-danger" />
                  {r.label}
                </label>
              ))}
            </div>
            <button type="button" disabled={!reason || sending} onClick={() => void doReport()} className="pbtn pbtn-danger w-full">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />} Send report
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
