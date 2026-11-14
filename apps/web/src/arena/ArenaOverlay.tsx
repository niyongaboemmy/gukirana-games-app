"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Armchair,
  Camera,
  CalendarClock,
  Coffee,
  DoorOpen,
  Eye,
  EyeOff,
  Footprints,
  Hand,
  Info,
  Loader2,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Mic,
  MicOff,
  PartyPopper,
  ScanSearch,
  Sparkles,
  Ticket,
  Trophy,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { ACT } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { playEmote } from "@/lib/realtime";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import { nav } from "@/world/navigation";
import { walkQueue } from "@/rooms/hall-hooks";
import { voiceScope } from "@/voice/voice";
import { useStage } from "@/world/stage";
import type { HallLayout } from "@/rooms/layouts";
import { announce, bindArenaRealtime, claimPass, fetchArenaStatus, loadArenaRoles, noteReaction, returnPass, setMic, standFromSeat, useArena } from "./arena-client";
import { climbGantry, endPhoto, goToSeat, startPhoto, takeSeat, useVenue, visitRestroom, walkOnStage } from "./hooks";
import { BOWL_SEATS, CONCOURSE, FLOOR_R, LOBBY, LOWER_BACK, OUTER_R, polar, SECTIONS, sectionLabel, UPPER_BACK, type BowlSeat } from "./bowl";
import { boxAt, countdown, crowdLevel, PA, voiceRule, type SpotKind } from "./venue";
import { paChime, setCrowd, setFocusDuck } from "./sound";
import { useSpectate } from "./spectate";
import { A, denialText, scopeWords, V, whenWords } from "./strings";

const glass = "glass rounded-card";
type Tier = "lower" | "upper" | "vip";
const IDEAL_ROW: Record<Tier, number> = { lower: 3, upper: 2, vip: 1 };
const SPOT_ICON: Record<SpotKind, LucideIcon> = {
  kiosk: Ticket,
  board: CalendarClock,
  snack: Coffee,
  drink: Coffee,
  restroom: DoorOpen,
  photo: Camera,
  desk: Mic,
  tunnel: Footprints,
  gantry: Eye,
  totem: MapIcon,
};

/** the best free seat of a section: middle rows, middle of the row */
function bestFree(section: string, taken: Record<string, string>, you: string | null): BowlSeat | null {
  const s = SECTIONS.find((x) => x.id === section);
  if (!s) return null;
  const free = BOWL_SEATS.filter((x) => x.table === section && (!taken[x.id] || taken[x.id] === you));
  free.sort((a, b) => Math.abs(a.row - IDEAL_ROW[s.tier]) * 3 + Math.abs(a.n - (s.seats + 1) / 2) - (Math.abs(b.row - IDEAL_ROW[s.tier]) * 3 + Math.abs(b.n - (s.seats + 1) / 2)));
  return free[0] ?? null;
}

/** "You are here": the bowl from above (sections, concourse, lobby), your dot and your seat. */
function ArenaMap({ seat }: { seat: string | null }) {
  const [me, setMe] = useState({ x: selfPose.x, z: selfPose.z });
  useEffect(() => {
    const id = setInterval(() => setMe({ x: selfPose.x, z: selfPose.z }), 400);
    return () => clearInterval(id);
  }, []);
  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const p = (r: number, a: number) => polar(r, a);
    const [A0, A1, B1, B0] = [p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0)];
    const large = a1 - a0 > 180 ? 1 : 0;
    // SVG y = z; angles grow from +z towards +x (counter-clockwise on screen with y down → sweep 0)
    return `M${A0.x} ${A0.z} A${r0} ${r0} 0 ${large} 0 ${A1.x} ${A1.z} L${B1.x} ${B1.z} A${r1} ${r1} 0 ${large} 1 ${B0.x} ${B0.z}Z`;
  };
  const s = seat ? BOWL_SEATS.find((x) => x.id === seat) : null;
  return (
    <svg viewBox="-28 -28 56 64" className="mx-auto block h-[min(34vh,220px)] w-auto" role="img" aria-label={V.map}>
      <rect x={-LOBBY.hw} y={OUTER_R - 4} width={LOBBY.hw * 2} height={LOBBY.z1 - OUTER_R + 4} rx={1} className="fill-current opacity-10" />
      <circle r={OUTER_R} className="fill-current opacity-10" />
      <circle r={FLOOR_R} className="fill-current opacity-20" />
      <circle r={(CONCOURSE.r0 + CONCOURSE.r1) / 2} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={CONCOURSE.r1 - CONCOURSE.r0} />
      {SECTIONS.map((sec) => {
        const r0 = sec.tier === "lower" ? 12.2 : sec.tier === "upper" ? CONCOURSE.r1 : 21.3;
        const r1 = sec.tier === "lower" ? LOWER_BACK : sec.tier === "upper" ? UPPER_BACK : OUTER_R;
        const m = polar((r0 + r1) / 2, (sec.a0 + sec.a1) / 2);
        return (
          <g key={sec.id}>
            <path d={arc(r0, r1, sec.a0 + 0.8, sec.a1 - 0.8)} className={sec.tier === "vip" ? "fill-[var(--color-gold)] opacity-50" : "fill-current opacity-35"} />
            <text x={m.x} y={m.z} fontSize={sec.id.length > 1 ? 2 : 2.6} textAnchor="middle" dominantBaseline="central" className="fill-current font-bold">
              {sec.id}
            </text>
          </g>
        );
      })}
      <text x={0} y={LOBBY.z1 - 2} fontSize={2} textAnchor="middle" className="fill-current opacity-70">
        EXIT
      </text>
      {s && <circle cx={s.x} cy={s.z} r={1.1} className="fill-[var(--color-gold)]" />}
      <circle cx={me.x} cy={me.z} r={1.3} className="fill-current" stroke="white" strokeWidth={0.5} />
    </svg>
  );
}

/**
 * Tournament Arena HUD (P2-ARN-03 / P2-ARN-04): title + Leave, ONE prompt at a time (seat, interaction, exit), the
 * venue windows (tickets & info, the live board with the map, concessions, commentator desk, players' tunnel), seat
 * finder, reactions, photo mode, PA announcements. Popups use the shared paper card; HUD chips stay dark grey glass.
 */
export function ArenaOverlay({ layout }: { layout: HallLayout }) {
  const phone = usePhoneHud();
  const chatOpen = useSocial((s) => s.chatOpen);
  const { nearSeat, seated, nearExit, leaving } = useRoom();
  const others = useWorld((s) => Object.keys(s.players).length);
  const taken = useWorld((s) => s.seats);
  const you = useWorld((s) => s.you);
  const st = useArena();
  const status = st.status;
  const venue = useVenue();
  const [tier, setTier] = useState<Tier>("lower");
  const [hint, setHint] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [box, setBox] = useState<string | null>(null);
  const [lastSeat, setLastSeat] = useState<string | null>(null);

  useEffect(() => {
    bindArenaRealtime();
    void loadArenaRoles();
    void fetchArenaStatus().then((s) => {
      // an event is on and you have no pass yet: show what it is and how to get in
      if (s?.current && !s.pass && !s.current.rules.some((r) => r.kind === "public")) setTimeout(() => useArena.setState({ cardOpen: true }), 2400);
    });
    const poll = setInterval(() => void fetchArenaStatus(), 30_000);
    const t = setTimeout(() => setHint(false), 6000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      clearTimeout(t);
      useArena.setState({ cardOpen: false, walkingTo: null, pending: null, denied: null });
      useVenue.getState().set({ panel: null, photo: false, hideHud: false, restroom: null });
    };
  }, []);

  // PA: chime + toast for every announcement
  useEffect(() => {
    if (!st.announce || Date.now() - st.announce.at > 3000) return;
    paChime();
    setToast(st.announce.text);
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [st.announce]);

  // "starts in 5 minutes" (once per event), from the real start time
  const ev = status?.current ?? null;
  const cd = ev && (ev.status === "scheduled" || ev.status === "doors_open") ? countdown(ev.startsAt, now) : null;
  useEffect(() => {
    if (!ev || !cd || cd.ms > 5 * 60_000 || cd.ms < 4 * 60_000) return;
    const key = `gk-arena-soon-${ev.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
    announce(PA.soon(ev.title, 5));
  }, [ev, cd]);

  // crowd sound from the REAL number of people inside + real reactions; the VIP box voice scope and the PA mic
  useEffect(() => {
    const id = setInterval(() => {
      const a = useArena.getState();
      const people = a.status?.occupancy.concourse ?? Object.keys(useWorld.getState().players).length + 1;
      const lvl = crowdLevel(people, a.reactions, Date.now());
      // spectator focus: seated in the eye view → the crowd bed and the rest of the bowl's voices sit back
      const focused = !!useRoom.getState().seated && useSpectate.getState().eye;
      setFocusDuck(focused);
      setCrowd(lvl.bed, lvl.swell, useStage.getState().view === "hall:arena");
      setBox(boxAt(selfPose.x, selfPose.z));
    }, 500);
    const boxOf = (pid: string) => {
      const p = useWorld.getState().players[pid];
      return p ? boxAt(p.x / 100, p.z / 100) : null;
    };
    voiceScope.allow = (pid) => voiceRule({ box: boxAt(selfPose.x, selfPose.z) }, { id: pid, box: boxOf(pid) }, useArena.getState().onAir).allow;
    voiceScope.room = (pid) => voiceRule({ box: boxAt(selfPose.x, selfPose.z) }, { id: pid, box: boxOf(pid) }, useArena.getState().onAir).room;
    // spectator focus: the commentator, your VIP box and the people right next to you stay clear; the rest of the
    // bowl is softer (private calls are not affected: they bypass this)
    voiceScope.duck = (pid) => {
      if (!useRoom.getState().seated || !useSpectate.getState().eye) return 1;
      if (pid === useArena.getState().onAir) return 1;
      const p = useWorld.getState().players[pid];
      if (!p) return 1;
      const d = Math.hypot(p.x / 100 - selfPose.x, p.z / 100 - selfPose.z);
      return d < 2.2 ? 0.85 : 0.3;
    };
    return () => {
      clearInterval(id);
      setCrowd(0, 0, false);
      setFocusDuck(false);
      voiceScope.allow = null;
      voiceScope.room = null;
      voiceScope.duck = null;
    };
  }, []);

  useEffect(() => {
    if (seated) setLastSeat(seated);
  }, [seated]);

  const near = venue.near;
  const activateSpot = () => {
    const s = useVenue.getState().near;
    if (!s) return false;
    const set = useVenue.getState().set;
    if (s.kind === "kiosk") set({ panel: "kiosk" });
    else if (s.kind === "board" || s.kind === "totem") set({ panel: "board" });
    else if (s.kind === "snack" || s.kind === "drink") set({ panel: "concession", counter: s.kind });
    else if (s.kind === "restroom") visitRestroom(s.side ?? 1);
    else if (s.kind === "photo") startPhoto();
    else if (s.kind === "desk") set({ panel: "desk" });
    else if (s.kind === "tunnel") set({ panel: "tunnel" });
    else if (s.kind === "gantry") climbGantry();
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      const r = useRoom.getState();
      const a = useArena.getState();
      if (r.seated) return standFromSeat();
      // the seat in front of you always gets the request (whatever a walk to another seat was doing)
      if (r.nearSeat && !a.pending) return takeSeat(r.nearSeat);
      if (activateSpot()) return;
      if (r.nearExit) r.set({ leaving: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of BOWL_SEATS) if (!taken[s.id]) c[s.table] = (c[s.table] ?? 0) + 1;
    return c;
  }, [taken]);
  const cancelWalk = () => {
    nav.target = null;
    walkQueue.legs = [];
    useArena.setState({ walkingTo: null });
  };
  const react = (id: number) => {
    if (playEmote(id, undefined, 3200)) noteReaction();
    else noteReaction();
  };
  const standAndCheer = () => {
    standFromSeat();
    setTimeout(() => react(ACT.cheer), 900);
  };
  const close = () => useVenue.getState().set({ panel: null });
  const mySeat = seated ?? status?.pass?.seat ?? null;
  const inBowl = (() => {
    const r = Math.hypot(selfPose.x, selfPose.z);
    return !!seated || (r > FLOOR_R && r < OUTER_R && !(selfPose.z > 0 && r > OUTER_R - 0.2));
  })();
  const sectionOfSeat = seated?.split("-")[0] ?? null;
  // one prompt at a time: seat in front of you → the venue spot → the exit
  const prompt: "seat" | "spot" | "exit" | null = seated || st.pending || st.walkingTo || leaving || venue.photo || venue.restroom ? null : nearSeat ? "seat" : near ? "spot" : nearExit ? "exit" : null;
  const card = "pointer-events-auto absolute left-1/2 top-16 w-[min(380px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(340px,48vw)]";
  const modal = (children: React.ReactNode, onClose: () => void, wide = false) => (
    <div className="pscrim pointer-events-auto grid place-items-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={wide ? "w-[min(460px,94vw)] phone:w-[min(520px,70vw)]" : "w-[min(420px,94vw)] phone:w-[min(420px,60vw)]"}>
        {children}
      </div>
    </div>
  );
  // real counts: the server's occupancy, never fewer than the people you can see here (you + others in this room)
  const occ = { concourse: Math.max(status?.occupancy.concourse ?? 0, others + 1), seats: status?.occupancy.seats ?? 0 };

  // photo mode: only the photo bar (or nothing at all)
  if (venue.photo) {
    return (
      <div className="gk-arena-hud pointer-events-none fixed inset-0 z-30 text-white">
        {venue.hideHud ? (
          <>
            <style>{`.gk-hud-in > *:not(.gk-arena-hud){visibility:hidden}`}</style>
            <button type="button" onClick={() => useVenue.getState().set({ hideHud: false })} className="pointer-events-auto absolute bottom-3 right-3 rounded-full bg-black/25 p-2 text-white/70" aria-label={V.showHud}>
              <Eye size={16} />
            </button>
          </>
        ) : (
          <div className={`${glass} pointer-events-auto absolute bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-1.5 px-2 py-1.5 phone:bottom-2`}>
            <span className="flex items-center gap-1.5 px-2 text-sm font-bold phone:text-xs">
              <Camera size={16} className="text-gold" /> {V.photoTitle}
            </span>
            {[
              [ACT.wave, Hand, V.wave],
              [ACT.cheer, Sparkles, V.cheer],
              [ACT.thumbsUp, PartyPopper, "Thumbs up"],
            ].map(([id, Icon, label]) => {
              const I = Icon as LucideIcon;
              return (
                <button key={String(id)} type="button" onClick={() => react(id as number)} className="icon-button flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-semibold phone:text-xs" aria-label={label as string}>
                  <I size={15} /> <span className="phone:hidden">{label as string}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => useVenue.getState().set({ hideHud: true })} className="icon-button flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-semibold phone:text-xs">
              <EyeOff size={15} /> {V.hideHud}
            </button>
            <button type="button" onClick={endPhoto} className="pbtn pbtn-primary !min-h-0 !py-1.5 text-sm phone:text-xs">
              {V.done}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="gk-arena-hud pointer-events-none fixed inset-0 z-20 text-white">
      {/* title + Leave + event + seats */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap phone:top-2 phone:gap-1.5">
        <button
          type="button"
          onClick={() => useRoom.getState().set({ leaving: true })}
          disabled={leaving}
          className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold disabled:opacity-60 phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}
        >
          <DoorOpen size={phone ? 14 : 16} /> {leaving ? A.leaving : A.leave}
        </button>
        <div className={`${glass} flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-bold phone:rounded-full phone:px-3 phone:py-1.5 phone:text-xs`}>
          <span className="size-2.5 rounded-full" style={{ background: layout.color }} />
          <span className="phone:hidden">{layout.title}</span>
          <span className="flex items-center gap-1 font-semibold text-on-glass-muted" title={V.inside(occ.concourse)}>
            <Users size={14} /> {occ.concourse}
          </span>
          {st.onAir && (
            <span className="flex items-center gap-1 rounded-full bg-danger/80 px-2 text-[11px] font-black tracking-wide">
              <Mic size={11} /> {V.onAir}
            </span>
          )}
        </div>
        <button type="button" onClick={() => useVenue.getState().set({ panel: "board" })} className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`} aria-label={V.boardTitle}>
          <Ticket size={phone ? 14 : 16} /> <span className="phone:hidden">{ev ? (status?.pass ? A.havePass : A.event) : A.event}</span>
        </button>
        <button type="button" onClick={() => useVenue.getState().set({ panel: "finder" })} className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}>
          <Armchair size={phone ? 14 : 16} /> {A.findSeat}
        </button>
      </div>

      {hint && !seated && !st.cardOpen && !venue.panel && !toast && (
        <div className={`${glass} absolute left-1/2 top-16 -translate-x-1/2 px-4 py-2.5 text-center text-sm phone:top-[46px] phone:whitespace-nowrap phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
          <p className="font-bold phone:hidden">{A.welcome}</p>
          <p className="text-on-glass-muted">{A.welcomeSub}</p>
        </div>
      )}

      {/* PA announcement */}
      {toast && !venue.panel && (
        <div role="status" className={`${glass} absolute left-1/2 top-16 flex max-w-[min(560px,90vw)] -translate-x-1/2 items-center gap-2 px-4 py-2 text-sm phone:top-[46px] phone:rounded-full phone:py-1 phone:text-xs`}>
          <Megaphone size={15} className="shrink-0 text-gold" /> <span className="truncate">{toast}</span>
        </div>
      )}

      {/* status chips: walking to a seat / waiting for the server / VIP voice / a treat / restroom */}
      <div className="absolute left-1/2 top-[108px] flex -translate-x-1/2 flex-col items-center gap-1.5 phone:top-[78px]">
        {(st.walkingTo || st.pending) && !st.cardOpen && (
          <div className={`${glass} pointer-events-auto flex items-center gap-2 px-4 py-2 text-sm phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
            <Loader2 size={14} className="animate-spin" />
            {st.pending ? A.pending(st.pending) : A.walkingTo(st.walkingTo!)}
            {st.walkingTo && (
              <button type="button" onClick={cancelWalk} className="ml-1 rounded-full px-2 py-0.5 font-bold text-on-glass-muted ring-1 ring-white/15">
                {A.cancel}
              </button>
            )}
          </div>
        )}
        {box && <div className={`${glass} flex items-center gap-1.5 px-3 py-1 text-xs font-semibold phone:rounded-full`}><Mic size={12} className="text-gold" /> {V.vipVoice(box)}</div>}
        {venue.treat && <div className={`${glass} flex items-center gap-1.5 px-3 py-1 text-xs font-semibold phone:rounded-full`}><Coffee size={12} className="text-gold" /> {V.enjoying(venue.treat.item)}</div>}
        {venue.restroom && <div className={`${glass} flex items-center gap-1.5 px-3 py-1 text-xs font-semibold phone:rounded-full`}><DoorOpen size={12} className="text-gold" /> {V.restroomBusy}</div>}
      </div>

      {/* reactions (in the bowl): synced to everyone here through the emote system */}
      {inBowl && !venue.panel && !leaving && (
        <div className={`${glass} pointer-events-auto absolute right-[max(12px,env(safe-area-inset-right))] top-1/2 flex -translate-y-1/2 flex-col gap-1 p-1.5 phone:top-[46%]`}>
          {(
            [
              [ACT.cheer, Sparkles, V.cheer],
              [ACT.clap, PartyPopper, V.clap],
              [ACT.wave, Hand, V.wave],
            ] as [number, LucideIcon, string][]
          ).map(([id, I, label]) => (
            <button key={id} type="button" onClick={() => react(id)} className="icon-button grid size-10 place-items-center rounded-full phone:size-9" aria-label={label} title={label}>
              <I size={18} />
            </button>
          ))}
          {seated ? (
            <button type="button" onClick={standAndCheer} className="icon-button grid size-10 place-items-center rounded-full phone:size-9" aria-label={V.standCheer} title={V.standCheer}>
              <Trophy size={18} />
            </button>
          ) : (
            lastSeat &&
            !st.pending && (
              <button type="button" onClick={() => goToSeat(lastSeat)} className="icon-button grid size-10 place-items-center rounded-full phone:size-9" aria-label={V.sitBack} title={V.sitBack}>
                <Armchair size={18} />
              </button>
            )
          )}
        </div>
      )}

      {/* the event card (pass) */}
      {st.cardOpen &&
        modal(
          <PaperCard
            title={ev ? ev.title : A.eventCard}
            icon={Trophy}
            size={phone ? "sm" : "md"}
            onClose={() => useArena.setState({ cardOpen: false })}
            closeLabel={A.close}
            bodyClassName="max-h-[60vh] overflow-y-auto phone:max-h-[56vh]"
            footer={
              ev && !status?.pass ? (
                <button type="button" disabled={!status?.canClaim || st.claiming} onClick={() => void claimPass(ev.id)} className="pbtn pbtn-primary w-full">
                  {st.claiming ? <Loader2 size={18} className="animate-spin" /> : <Ticket size={18} />} {st.claiming ? A.gettingPass : A.getPass}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    useArena.setState({ cardOpen: false });
                    useVenue.getState().set({ panel: "finder" });
                  }}
                  className="pbtn pbtn-primary w-full"
                >
                  <Armchair size={18} /> {A.findSeat}
                </button>
              )
            }
          >
            <EventRows />
          </PaperCard>,
          () => useArena.setState({ cardOpen: false }),
        )}

      {/* tickets & info kiosk */}
      {venue.panel === "kiosk" &&
        modal(
          <PaperCard
            title={V.kioskTitle}
            icon={Ticket}
            size={phone ? "sm" : "md"}
            onClose={close}
            closeLabel={A.close}
            bodyClassName="max-h-[60vh] overflow-y-auto phone:max-h-[56vh]"
            footer={
              <div className="flex w-full gap-2">
                {ev && !status?.pass ? (
                  <button type="button" disabled={!status?.canClaim || st.claiming} onClick={() => void claimPass(ev.id)} className="pbtn pbtn-primary flex-1">
                    {st.claiming ? <Loader2 size={18} className="animate-spin" /> : <Ticket size={18} />} {A.getPass}
                  </button>
                ) : ev && status?.pass ? (
                  <button type="button" onClick={() => void returnPass(ev.id)} className="pbtn pbtn-secondary flex-1">
                    {V.returnPass}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    close();
                    if (mySeat) goToSeat(mySeat);
                    else useVenue.getState().set({ panel: "finder" });
                  }}
                  className="pbtn pbtn-primary flex-1"
                >
                  <MapPin size={18} /> {mySeat ? V.goToMySeat : A.findSeat}
                </button>
              </div>
            }
          >
            <EventRows />
            <p className="plabel mt-3">{V.yourSeat}</p>
            <p className="text-sm font-bold">{mySeat ? `${mySeat} · ${sectionLabel(mySeat.split("-")[0]!)}` : V.noSeatYet}</p>
          </PaperCard>,
          close,
        )}

      {/* the live board (event board / totems): countdown, real counts, announcement, map */}
      {venue.panel === "board" &&
        modal(
          <PaperCard title={V.boardTitle} icon={CalendarClock} size={phone ? "sm" : "md"} onClose={close} closeLabel={A.close} bodyClassName="max-h-[64vh] overflow-y-auto phone:max-h-[58vh]">
            <div className={phone ? "grid grid-cols-2 gap-3" : ""}>
              <div>
                <div className="plist">
                  <div className="prow">
                    <span className="prow-icon"><Trophy size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="prow-title block truncate">{ev ? ev.title : (status?.next?.title ?? A.noEvent)}</span>
                      <span className="prow-sub block truncate">
                        {ev ? A.status[ev.status] : status?.next ? `${A.nextEvent} · ${whenWords(status.next.startsAt)}` : A.freeSeating}
                        {cd ? ` · ${V.startsIn(cd.text)}` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="prow">
                    <span className="prow-icon"><Users size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="prow-title block">{V.inside(occ.concourse)}</span>
                      <span className="prow-sub block">{V.seatedCount(occ.seats)}</span>
                    </span>
                  </div>
                  <div className="prow">
                    <span className="prow-icon"><Info size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="prow-title block">{V.matchState}</span>
                      <span className="prow-sub block">{V.noMatch}</span>
                    </span>
                  </div>
                  <div className="prow">
                    <span className="prow-icon"><Megaphone size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="prow-title block">{V.announcements}</span>
                      <span className="prow-sub block">{st.announce?.text ?? V.noAnnouncements}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <p className="plabel mb-1 mt-3 text-center phone:mt-0">{V.youAreHere}</p>
                <ArenaMap seat={mySeat} />
                <p className="pmuted mt-1 text-center text-xs">{V.exits}</p>
              </div>
            </div>
          </PaperCard>,
          close,
          true,
        )}

      {/* concession counter: a free cosmetic treat (no money, no Stars) */}
      {venue.panel === "concession" &&
        modal(
          <PaperCard title={V.counterTitle[venue.counter]} icon={Coffee} size={phone ? "sm" : "md"} onClose={close} closeLabel={A.close}>
            <div className="grid grid-cols-2 gap-2">
              {V.menu[venue.counter].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    close();
                    playEmote(ACT.coffee, undefined, 14000);
                    useVenue.getState().set({ treat: { item, until: Date.now() + 14000 } });
                  }}
                  className="pbtn pbtn-secondary"
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="pnote mt-3 text-xs">{V.counterNote}</p>
          </PaperCard>,
          close,
        )}

      {/* commentator desk (staff) */}
      {venue.panel === "desk" &&
        modal(
          <PaperCard
            title={V.deskTitle}
            icon={Mic}
            size={phone ? "sm" : "md"}
            onClose={close}
            closeLabel={A.close}
            footer={
              st.onAir === you ? (
                <button type="button" onClick={() => setMic(false)} className="pbtn pbtn-danger w-full">
                  <MicOff size={18} /> {V.goOffAir}
                </button>
              ) : (
                <button type="button" disabled={!st.staff} onClick={() => setMic(true)} className="pbtn pbtn-primary w-full">
                  <Mic size={18} /> {V.goOnAir}
                </button>
              )
            }
          >
            {st.onAir && st.onAir !== you && <p className="pnote mb-2 text-sm">{V.someoneOnAir}</p>}
            <p className="pmuted text-sm">{V.deskNote}</p>
          </PaperCard>,
          close,
        )}

      {/* players' tunnel */}
      {venue.panel === "tunnel" &&
        modal(
          <PaperCard
            title={V.tunnelTitle}
            icon={Footprints}
            size="sm"
            onClose={close}
            closeLabel={A.close}
            footer={
              status?.pass?.zone === "floor" || st.staff ? (
                <button type="button" onClick={walkOnStage} className="pbtn pbtn-primary w-full">
                  <Footprints size={18} /> {V.walkOut}
                </button>
              ) : undefined
            }
          >
            <p className="pnote text-sm">{status?.pass?.zone === "floor" || st.staff ? V.tunnelYes : V.tunnelNo}</p>
          </PaperCard>,
          close,
        )}

      {/* the seat finder */}
      {venue.panel === "finder" &&
        modal(
          <PaperCard title={A.seatFinder} icon={Armchair} size={phone ? "sm" : "md"} onClose={close} closeLabel={A.close} bodyClassName="max-h-[60vh] overflow-y-auto phone:max-h-[54vh]">
            {mySeat && (
              <button
                type="button"
                onClick={() => {
                  close();
                  goToSeat(mySeat);
                }}
                className="pbtn pbtn-primary mb-3 w-full phone:mb-2"
              >
                <MapPin size={18} /> {V.goToMySeat} · {mySeat}
              </button>
            )}
            <div className="pseg mb-3 flex gap-1 phone:mb-2">
              {(["lower", "upper", "vip"] as Tier[]).map((t) => (
                <button key={t} type="button" aria-pressed={tier === t} onClick={() => setTier(t)} className={`ptab flex-1 rounded-full px-3 py-1.5 text-sm font-bold phone:text-xs ${tier === t ? "is-on" : ""}`}>
                  {t === "lower" ? A.tierLower : t === "upper" ? A.tierUpper : A.tierVip}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1.5 phone:grid-cols-6">
              {SECTIONS.filter((s) => s.tier === tier).map((s) => {
                const free = counts[s.id] ?? 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!free}
                    onClick={() => {
                      const seat = bestFree(s.id, taken, you);
                      if (!seat) return;
                      close();
                      goToSeat(seat.id);
                    }}
                    className="ptab flex flex-col items-center rounded-xl px-2 py-2 disabled:opacity-40"
                    aria-label={`${sectionLabel(s.id)}: ${free} free`}
                  >
                    <span className="text-lg font-black leading-none">{s.id}</span>
                    <span className="pmuted mt-0.5 text-[11px]">{free} free</span>
                  </button>
                );
              })}
            </div>
            <p className="pmuted mt-3 text-xs phone:mt-2">{ev ? (status?.pass ? A.passZone(status.pass.zone) : denialText("NO_PASS")) : A.freeSeating}</p>
          </PaperCard>,
          close,
        )}

      {/* a refusal in plain words */}
      {st.denied && !st.cardOpen && !venue.panel && (
        <div className={card}>
          <PaperCard title={A.seatFinder} icon={MapPin} size="sm" onClose={() => useArena.setState({ denied: null })} closeLabel={A.close}>
            <p className="pnote text-sm">{st.denied.reason === "NO_ANSWER" ? A.noAnswer : denialText(st.denied.reason)}</p>
          </PaperCard>
        </div>
      )}

      {/* ONE prompt at a time */}
      {prompt === "seat" && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => takeSeat(nearSeat!)} className={PROMPT_BTN}>
            <KeyHint />
            <Armchair size={phone ? 16 : 20} /> {A.takeSeat(nearSeat!)}
          </button>
        </div>
      )}
      {prompt === "spot" &&
        near &&
        (() => {
          const I = SPOT_ICON[near.kind];
          return (
            <div className={promptWrap(chatOpen)}>
              <button type="button" onClick={() => void activateSpot()} className={PROMPT_BTN}>
                <KeyHint />
                <I size={phone ? 16 : 20} /> {V.prompt[near.kind]}
              </button>
            </div>
          );
        })()}
      {prompt === "exit" && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => useRoom.getState().set({ leaving: true })} className={PROMPT_BTN}>
            <KeyHint />
            <DoorOpen size={phone ? 16 : 20} /> {A.leavePrompt}
          </button>
        </div>
      )}
      {seated && (
        <div className="pointer-events-auto absolute bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 w-[min(380px,90vw)] -translate-x-1/2 phone:bottom-0 phone:w-[min(340px,46vw)]">
          <PaperCard
            size="sm"
            title={A.seated(seated)}
            icon={Armchair}
            className="phone:rounded-b-none"
            headExtra={
              <button type="button" onClick={standFromSeat} className="pcard-hbtn !flex !w-auto items-center gap-1 px-2.5 text-sm font-semibold phone:text-xs">
                <X size={14} /> {A.standUp}
              </button>
            }
          >
            <p className="pmuted text-sm phone:text-xs">
              {sectionOfSeat ? sectionLabel(sectionOfSeat) : ""}
              {ev ? ` · ${ev.title}` : ""}
              {cd ? ` · ${V.startsIn(cd.text)}` : ""}
            </p>
            <SpectatorControls />
          </PaperCard>
        </div>
      )}
    </div>
  );
}

/** Seated: look from your own eyes at the podium (default), or the over-the-shoulder view; zoom onto the stage. */
function SpectatorControls() {
  const { eye, focus, set } = useSpectate();
  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="pseg flex-1" role="group" aria-label={A.eyeView}>
          <button type="button" aria-pressed={eye} onClick={() => set({ eye: true })} className="min-h-9! whitespace-nowrap text-sm! phone:min-h-8! phone:text-xs!">
            <Eye size={15} /> {A.eyeView}
          </button>
          <button type="button" aria-pressed={!eye} onClick={() => set({ eye: false, focus: false })} className="min-h-9! whitespace-nowrap text-sm! phone:min-h-8! phone:text-xs!">
            <UserRound size={15} /> {A.behindView}
          </button>
        </div>
        <button
          type="button"
          aria-pressed={focus}
          disabled={!eye}
          onClick={() => set({ focus: !focus })}
          className={`ptab !min-h-9 !flex-none whitespace-nowrap px-3 text-sm phone:!min-h-8 phone:text-xs ${focus ? "is-on" : ""} disabled:opacity-40`}
        >
          <ScanSearch size={15} /> {focus ? A.focusOn : A.focusStage}
        </button>
      </div>
      {eye && <p className="pmuted text-xs phone:hidden">{A.viewHint}</p>}
    </div>
  );
}

/** The current (or next) event in plain words: game, time, scope, passes left, your pass / why not. */
function EventRows() {
  const st = useArena();
  const status = st.status;
  const ev = status?.current ?? null;
  if (!ev)
    return (
      <>
        <p className="pnote text-sm">{A.freeSeating}</p>
        <p className="plabel mt-3">{A.nextEvent}</p>
        <p className="text-sm font-bold">{status?.next ? `${status.next.title} · ${whenWords(status.next.startsAt)}` : A.noEvent}</p>
        {status?.next && <p className="pmuted text-xs">{scopeWords(status.next.rules)}</p>}
      </>
    );
  return (
    <>
      <div className="plist">
        <div className="prow">
          <span className="prow-icon"><Trophy size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="prow-title block truncate">{ev.title}</span>
            <span className="prow-sub block truncate">
              {ev.game ? A.game[ev.game] : A.kind[ev.kind]} · {A.kind[ev.kind]} · {A.status[ev.status]}
            </span>
          </span>
        </div>
        <div className="prow">
          <span className="prow-icon"><CalendarClock size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="prow-title block truncate">{whenWords(ev.startsAt)}</span>
            <span className="prow-sub block truncate">Doors {whenWords(ev.doorsOpenAt)}</span>
          </span>
        </div>
        <div className="prow">
          <span className="prow-icon"><Users size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="prow-title block">{scopeWords(ev.rules)}</span>
            <span className="prow-sub block">
              {Math.max(0, ev.capacity - ev.passesIssued).toLocaleString()} of {ev.capacity.toLocaleString()} passes left
            </span>
          </span>
        </div>
      </div>
      {ev.description && <p className="pmuted mt-3 text-sm phone:text-xs">{ev.description}</p>}
      {status?.pass ? (
        <p className="pnote mt-3 text-sm">{A.passZone(status.pass.zone)}</p>
      ) : status?.claimDenial ? (
        <p className="pnote mt-3 text-sm">{denialText(status.claimDenial)}</p>
      ) : null}
      {st.denied && st.denied.action !== "sit" && <p className="pnote mt-2 text-sm">{st.denied.reason === "NO_ANSWER" ? A.noAnswer : denialText(st.denied.reason)}</p>}
      {st.mock && <p className="pmuted mt-3 text-xs">{A.mock}</p>}
    </>
  );
}
