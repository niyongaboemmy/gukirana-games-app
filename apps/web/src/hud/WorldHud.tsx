"use client";
import { useDoorway } from "@/world/doorway";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Joystick } from "./Joystick";
import { DOOR_RING, PORTALS } from "@/world/layout";
import { nav } from "@/world/navigation";
import { saveDoorPose } from "@/lib/return-point";
import { useWorld } from "@/lib/world-store";
import { playEmote } from "@/lib/realtime";
import { levelForXp, totalXpForLevel, useProfile } from "@/lib/profile-store";
import { xrStore } from "@/world/WorldCanvas";
import { Armchair, DoorOpen, Ellipsis, Glasses, Hand, Loader2, MessageCircle, Music, PartyPopper, Settings, Shirt, Smile, Star, UserRound, Users, Zap, type LucideIcon } from "lucide-react";
import { AvatarCreator } from "@/components/AvatarCreator";
import { SettingsModal } from "@/components/SettingsModal";
import { ChatPanel } from "@/social/ChatPanel";
import { SocialOverlay } from "@/social/SocialOverlay";
import { totalUnread, useSocial } from "@/social/social-store";
import { sitNearest, standFromBench } from "@/social/bench";
import { useRoom } from "@/rooms/room-store";
import { useMatch } from "@/lib/match-store";
import { quickMatchLeave } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { KeyHint, PROMPT_BTN, promptWrap } from "./Prompt";
import { openQuickMatch, usePhoneHud } from "./usePhoneHud";

const EMOTES = [
  { id: 10, icon: Hand, label: "Wave" },
  { id: 11, icon: Music, label: "Dance" },
  { id: 12, icon: PartyPopper, label: "Clap" },
];

function RoundButton({ icon: Icon, label, onPress, onRelease, big, active, badge, hint, disabled, compact }: { icon: LucideIcon; label: string; onPress?: () => void; onRelease?: () => void; big?: boolean; active?: boolean; badge?: number; hint?: number; disabled?: boolean; compact?: boolean }) {
  // compact = phone landscape: 48 px buttons (52 px for the main action), smaller icons
  const size = compact ? (big ? "size-[52px]" : "size-12") : big ? "size-[72px]" : "size-16";
  return (
    <button
      type="button"
      aria-label={badge ? `${label} (${badge} unread)` : hint ? `${label} (${hint} nearby)` : label}
      disabled={disabled}
      onPointerDown={onPress}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      className={`pointer-events-auto relative grid disabled:opacity-50 ${size} touch-none select-none place-items-center rounded-full border shadow-lg backdrop-blur-xl transition active:scale-90 ${
        active ? "border-[#FFC83D] bg-[#22266E]/80 text-white ring-4 ring-[#FFC83D]/40" : "border-white/35 bg-white/15 text-white"
      }`}
    >
      <Icon size={compact ? (big ? 24 : 21) : big ? 30 : 26} strokeWidth={1.85} absoluteStrokeWidth />
      {badge ? (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[#EF4444] px-1 text-[11px] font-black leading-5">{badge}</span>
      ) : hint ? (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[#22C55E] px-1 text-[11px] font-black leading-5 text-[#06210f]">{hint}</span>
      ) : null}
    </button>
  );
}

export function WorldHud() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();
  const { name, color, xp, stars } = useProfile();
  const level = levelForXp(xp);
  const progress = (xp - totalXpForLevel(level)) / (totalXpForLevel(level + 1) - totalXpForLevel(level));
  const nearPortal = useWorld((s) => s.nearPortal);
  const online = useWorld((s) => Object.keys(s.players).length + 1);
  const connected = useWorld((s) => s.connected);
  const other = useWorld((s) => (s.nearPlayer ? s.players[s.nearPlayer] : undefined));
  const [emotesOpen, setEmotesOpen] = useState(false);
  const chatOpen = useSocial((s) => s.chatOpen);
  const unread = useSocial((s) => totalUnread(s.threads));
  const nearby = useSocial((s) => s.nearbyCount);
  const benchSeat = useSocial((s) => s.nearSeat);
  const seatedOnBench = useSocial((s) => s.seated);
  // inside a hall the room overlay owns the chair / exit prompts and its own people list
  const inHall = usePathname()?.startsWith("/room/") ?? false;
  const roomBusy = useRoom((s) => !!(s.nearSeat || s.seated || s.nearExit));
  const [vr, setVr] = useState(false);
  const [styling, setStyling] = useState(false);
  const phone = usePhoneHud();
  const [more, setMore] = useState(false);
  const authed = useSession((s) => s.status === "authenticated");
  const quickWaiting = useMatch((s) => s.quick.status === "waiting");
  const portal = PORTALS.find((p) => p.id === nearPortal);
  const setChatOpen = (v: boolean | ((o: boolean) => boolean)) => useSocial.setState((s) => ({ chatOpen: typeof v === "function" ? v(s.chatOpen) : v }));

  useEffect(() => {
    void navigator.xr?.isSessionSupported("immersive-vr").then(setVr).catch(() => setVr(false));
  }, []);

  const emote = (id: number) => {
    playEmote(id);
    setEmotesOpen(false);
  };
  // E / the big button: door → bench place (stand up when seated) → the person in front of you (person menu)
  const interact = () => {
    if (portal?.href) {
      const href = portal.href;
      // walk on in through the real door (the camera watches), then the frame freezes and the hall loads
      const a = (portal.angleDeg * Math.PI) / 180;
      nav.target = { x: Math.sin(a) * (DOOR_RING + 1.5), z: -Math.cos(a) * (DOOR_RING + 1.5) };
      // coming back out puts you a few steps outside this door, stepping out towards the plaza (same as walking in)
      saveDoorPose({ x: Math.sin(a) * (DOOR_RING - 4.5), z: -Math.cos(a) * (DOOR_RING - 4.5), yaw: -a });
      return useDoorway.getState().pass(portal.label, () => router.push(href));
    }
    if (seatedOnBench) return standFromBench();
    if (benchSeat && !portal) return sitNearest();
    if (other) useSocial.setState({ menu: other.id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || useSocial.getState().menu) return;
      // inside a hall the room overlay owns E for chairs and the exit door
      const r = useRoom.getState();
      if (e.code === "KeyE" && !(r.nearSeat || r.seated || r.nearExit)) interact();
      if (e.code === "KeyG") setEmotesOpen((v) => !v);
      if (e.code === "KeyT" || e.code === "Enter") {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setRun = (run: boolean) => {
    const w = useWorld.getState();
    w.set({ input: { ...w.input, run } });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-10 select-none p-[max(12px,env(safe-area-inset-top))_max(12px,env(safe-area-inset-right))_max(12px,env(safe-area-inset-bottom))_max(12px,env(safe-area-inset-left))] text-white">
      {/* top-left profile chip (phone: just the 40 px avatar with its level ring; tap = style your avatar) */}
      <div className="pointer-events-auto absolute left-[max(12px,env(safe-area-inset-left))] top-3 flex items-center gap-3 rounded-2xl border border-white/30 bg-[#22266E]/70 py-2 pl-2 pr-4 shadow-xl backdrop-blur-md phone:top-2 phone:rounded-full phone:p-0.5">
        <button
          type="button"
          tabIndex={phone ? 0 : -1}
          onClick={() => phone && setStyling(true)}
          aria-label={`${name}, level ${level}${phone ? ": style your avatar" : ""}`}
          className="relative grid size-12 place-items-center rounded-full phone:size-10"
          style={{ background: `conic-gradient(#FFC83D ${progress * 360}deg, rgba(255,255,255,.2) 0)` }}
        >
          <div className="grid size-10 place-items-center rounded-full phone:size-[34px]" style={{ background: color }}>
            <UserRound size={phone ? 18 : 22} strokeWidth={1.85} />
          </div>
          <span className="absolute -bottom-1 -right-1 hidden min-w-4 place-items-center rounded-full bg-[#FFC83D] px-1 text-[10px] font-black leading-4 text-[#22266E] phone:grid">{level}</span>
        </button>
        <div className="leading-tight phone:hidden">
          <p className="max-w-[9rem] truncate text-base font-extrabold">{name}</p>
          <p className="flex items-center gap-1 text-sm font-semibold text-[#FFC83D]">
            <Star size={13} strokeWidth={2} fill="currentColor" /> Level {level}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStyling(true)}
          aria-label="Style your avatar"
          title="Style your avatar"
          className="ml-1 grid size-10 place-items-center rounded-full border border-white/30 bg-white/15 backdrop-blur-xl transition hover:bg-white/25 phone:hidden"
        >
          <Shirt size={20} strokeWidth={1.85} />
        </button>
      </div>
      {styling && (
        <div className="pointer-events-auto">
          <AvatarCreator onClose={() => setStyling(false)} />
        </div>
      )}
      {settingsOpen && (
        <div className="pointer-events-auto">
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            onEditAvatar={() => {
              setSettingsOpen(false);
              setStyling(true);
            }}
          />
        </div>
      )}

      {/* top-center breadcrumb */}
      {/* (not inside a hall: the room overlay shows the hall name there, and this would peek between its pills) */}
      <div className={`absolute left-1/2 top-3 hidden -translate-x-1/2 rounded-full bg-[#22266E]/55 px-4 py-1.5 text-sm font-semibold backdrop-blur-md phone:hidden! ${inHall ? "" : "sm:block"}`}>
        Gukirana Plaza ·{" "}
        <span className={connected ? "text-[#22C55E]" : "text-white/60"}>
          <Users size={14} strokeWidth={2} className="mr-1 inline -translate-y-px" />
          {connected ? `${online} online` : "solo"}
        </span>
      </div>
      {/* people here (tap a name → person menu) */}
      {connected && !inHall && (
        <button
          type="button"
          onClick={() => useSocial.setState((s) => ({ peopleOpen: !s.peopleOpen }))}
          className="pointer-events-auto absolute left-[max(12px,env(safe-area-inset-left))] top-[134px] flex items-center gap-1.5 rounded-full border border-white/25 bg-[#22266E]/65 px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur-md [@media(max-height:430px)]:top-[128px] phone:hidden"
          aria-label={`People: ${nearby} nearby, ${online} here`}
        >
          <Users size={14} /> {nearby} nearby · {online - 1} here
        </button>
      )}

      {/* top-right currency + settings */}
      <div className="absolute right-[max(12px,env(safe-area-inset-right))] top-3 flex items-center gap-2 phone:top-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/30 bg-[#22266E]/70 px-4 py-2.5 text-lg font-extrabold tabular-nums shadow-xl backdrop-blur-md phone:gap-1.5 phone:rounded-full phone:py-1 phone:pl-1 phone:pr-3 phone:text-sm" title="Stars: practice currency, no cash value">
          <span className="grid size-7 place-items-center rounded-full bg-[#7CC4FF] text-[#12142b] phone:size-6">
            <Star size={15} strokeWidth={2} fill="currentColor" />
          </span>
          {stars.toLocaleString()}
        </div>
        {vr && (
          <button type="button" onClick={() => void xrStore.enterVR()} className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/30 bg-[#9B51E0]/80 px-3 py-2.5 text-sm font-bold shadow-xl backdrop-blur-md">
            <Glasses size={18} strokeWidth={1.85} /> Enter VR
          </button>
        )}
        <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Account and settings" className="pointer-events-auto grid size-12 place-items-center rounded-2xl border border-white/30 bg-[#22266E]/70 shadow-xl backdrop-blur-md phone:size-8 phone:rounded-full">
          <Settings size={phone ? 17 : 22} strokeWidth={1.85} />
        </button>
      </div>

      {/* chat (Nearby / Room / Private) */}
      <div className="absolute bottom-[150px] left-[max(12px,env(safe-area-inset-left))] w-[min(380px,46vw)] sm:bottom-40 [@media(max-height:430px)]:bottom-[118px] [@media(max-height:430px)]:w-[min(340px,44vw)] phone:bottom-[max(122px,calc(env(safe-area-inset-bottom)+110px))]! phone:w-[min(280px,34vw)]!">
        <ChatPanel />
      </div>

      {/* proximity prompt */}
      {(portal || other || benchSeat || seatedOnBench) && !roomBusy && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={interact} className={PROMPT_BTN}>
            <KeyHint />
            {portal ? (
              portal.href ? `Enter ${portal.label}` : `${portal.label} · ${portal.sub}`
            ) : seatedOnBench ? (
              "Stand up"
            ) : benchSeat ? (
              <>
                <Armchair size={20} /> Sit on the bench
              </>
            ) : (
              `Talk to ${other!.name}`
            )}
          </button>
        </div>
      )}

      {/* bottom-left joystick */}
      <div className="absolute bottom-[max(14px,env(safe-area-inset-bottom))] left-[max(14px,env(safe-area-inset-left))]">
        <Joystick />
      </div>

      {/* bottom-right actions (phone: chat, more, interact; run = push the joystick all the way) */}
      {phone ? (
        <div className="absolute bottom-[max(12px,env(safe-area-inset-bottom))] right-[max(12px,env(safe-area-inset-right))] flex items-end gap-2">
          <RoundButton compact icon={MessageCircle} label="Chat" badge={unread} hint={unread ? 0 : nearby} active={chatOpen} onPress={() => setChatOpen((v) => !v)} />
          <div className="relative">
            {more && (
              <div className="pointer-events-auto absolute bottom-14 right-0 flex w-max flex-col gap-1 rounded-2xl border border-white/20 bg-[#151935]/90 p-1.5 text-sm font-bold shadow-2xl backdrop-blur-xl">
                {authed &&
                  (quickWaiting ? (
                    <button type="button" onClick={() => (quickMatchLeave(), setMore(false))} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10">
                      <Loader2 size={16} className="animate-spin" /> Cancel matching
                    </button>
                  ) : (
                    <button type="button" onClick={() => (openQuickMatch(), setMore(false))} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10">
                      <Zap size={16} className="text-[#FFC83D]" /> Quick Match
                    </button>
                  ))}
                {connected && !inHall && (
                  <button type="button" onClick={() => (useSocial.setState({ peopleOpen: true }), setMore(false))} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/10">
                    <Users size={16} /> People · {nearby} nearby
                  </button>
                )}
                <div className="flex gap-1 border-t border-white/10 pt-1">
                  {EMOTES.map((e) => (
                    <button key={e.id} type="button" onClick={() => (emote(e.id), setMore(false))} className="grid size-10 place-items-center rounded-xl bg-white/10" aria-label={e.label} title={e.label}>
                      <e.icon size={20} strokeWidth={1.85} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <RoundButton compact icon={quickWaiting ? Loader2 : Ellipsis} label="More actions" active={more} onPress={() => setMore((v) => !v)} />
          </div>
          <RoundButton compact icon={portal ? DoorOpen : benchSeat || seatedOnBench ? Armchair : Hand} label="Interact" big active={!!(portal || other || benchSeat || seatedOnBench)} onPress={interact} />
        </div>
      ) : (
      <div className="absolute bottom-[max(14px,env(safe-area-inset-bottom))] right-[max(14px,env(safe-area-inset-right))] flex items-end gap-3">
        <div className="flex flex-col gap-3">
          <RoundButton icon={MessageCircle} label="Chat" badge={unread} active={chatOpen} onPress={() => setChatOpen((v) => !v)} />
        </div>
        <RoundButton icon={Zap} label="Run" onPress={() => setRun(true)} onRelease={() => setRun(false)} />
        <div className="relative">
          {emotesOpen && (
            <div className="pointer-events-auto absolute bottom-20 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl bg-[#22266E]/85 p-2 backdrop-blur-md">
              {EMOTES.map((e) => (
                <button key={e.id} type="button" onClick={() => emote(e.id)} className="grid size-12 place-items-center rounded-xl bg-white/10" aria-label={e.label} title={e.label}>
                  <e.icon size={24} strokeWidth={1.85} />
                </button>
              ))}
            </div>
          )}
          <RoundButton icon={Smile} label="Emote" onPress={() => setEmotesOpen((v) => !v)} />
        </div>
        <RoundButton icon={portal ? DoorOpen : benchSeat || seatedOnBench ? Armchair : Hand} label="Interact" big active={!!(portal || other || benchSeat || seatedOnBench)} onPress={interact} />
      </div>
      )}

      {/* desktop hint */}
      <p className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 text-xs text-white/70 [@media(pointer:fine)]:block">
        W/S walk · A/D turn · click the ground to walk there · click a person for options · drag to look · Shift run · E interact · T chat · hold V to talk
      </p>
      <SocialOverlay />
    </div>
  );
}
