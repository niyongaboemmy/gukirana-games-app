"use client";
import { useEffect, useMemo, useState } from "react";
import { Armchair, CalendarClock, DoorOpen, Loader2, MapPin, Ticket, Trophy, Users, X } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import { nav } from "@/world/navigation";
import { walkQueue } from "@/rooms/hall-hooks";
import type { HallLayout } from "@/rooms/layouts";
import { bindArenaRealtime, claimPass, fetchArenaStatus, requestSeat, standFromSeat, useArena } from "./arena-client";
import { goToSeat } from "./hooks";
import { BOWL_SEATS, SECTIONS, sectionLabel, type BowlSeat } from "./bowl";
import { A, denialText, scopeWords, whenWords } from "./strings";

const glass = "glass rounded-card";
type Tier = "lower" | "upper" | "vip";
const IDEAL_ROW: Record<Tier, number> = { lower: 3, upper: 2, vip: 1 };

/** the best free seat of a section: middle rows, middle of the row */
function bestFree(section: string, taken: Record<string, string>, you: string | null): BowlSeat | null {
  const s = SECTIONS.find((x) => x.id === section);
  if (!s) return null;
  const free = BOWL_SEATS.filter((x) => x.table === section && (!taken[x.id] || taken[x.id] === you));
  free.sort((a, b) => Math.abs(a.row - IDEAL_ROW[s.tier]) * 3 + Math.abs(a.n - (s.seats + 1) / 2) - (Math.abs(b.row - IDEAL_ROW[s.tier]) * 3 + Math.abs(b.n - (s.seats + 1) / 2)));
  return free[0] ?? null;
}

/**
 * Tournament Arena HUD (P2-ARN-03): title + Leave, the event card (scope in plain words, Get a pass, the reason
 * when not), the seat finder (tier → section → best free seat), seat prompts with the pending state until the
 * server confirms, plain-word refusals. Popups use the shared paper card; HUD chips stay dark grey glass.
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
  const [finder, setFinder] = useState(false);
  const [tier, setTier] = useState<Tier>("lower");
  const [hint, setHint] = useState(true);

  useEffect(() => {
    bindArenaRealtime();
    void fetchArenaStatus().then((s) => {
      // an event is on and you have no pass yet: show what it is and how to get in
      if (s?.current && !s.pass) setTimeout(() => useArena.setState({ cardOpen: true }), 2400);
    });
    const poll = setInterval(() => void fetchArenaStatus(), 30_000);
    const t = setTimeout(() => setHint(false), 6000);
    return () => {
      clearInterval(poll);
      clearTimeout(t);
      useArena.setState({ cardOpen: false, walkingTo: null, pending: null, denied: null });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      const r = useRoom.getState();
      const a = useArena.getState();
      if (r.seated) standFromSeat();
      else if (r.nearSeat && !a.pending) requestSeat(r.nearSeat);
      else if (r.nearExit) r.set({ leaving: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ev = status?.current ?? null;
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
  const sectionOfSeat = seated?.split("-")[0] ?? null;
  const showSeatPrompt = !!nearSeat && !seated && !st.pending && !st.walkingTo && !leaving;
  const card = "pointer-events-auto absolute left-1/2 top-16 w-[min(380px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(340px,48vw)]";

  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
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
          <span className="flex items-center gap-1 font-semibold text-on-glass-muted">
            <Users size={14} /> {others + 1}
          </span>
        </div>
        <button type="button" onClick={() => useArena.setState({ cardOpen: true })} className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}>
          <Ticket size={phone ? 14 : 16} /> {ev ? (status?.pass ? A.havePass : A.event) : A.event}
        </button>
        <button type="button" onClick={() => setFinder(true)} className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}>
          <Armchair size={phone ? 14 : 16} /> {A.findSeat}
        </button>
      </div>

      {hint && !seated && !st.cardOpen && (
        <div className={`${glass} absolute left-1/2 top-16 -translate-x-1/2 px-4 py-2.5 text-center text-sm phone:top-[46px] phone:whitespace-nowrap phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
          <p className="font-bold phone:hidden">{A.welcome}</p>
          <p className="text-on-glass-muted">{A.welcomeSub}</p>
        </div>
      )}

      {/* walking to a seat / waiting for the server */}
      {(st.walkingTo || st.pending) && !st.cardOpen && (
        <div className={`${glass} pointer-events-auto absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-2 px-4 py-2 text-sm phone:top-[46px] phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
          <Loader2 size={14} className="animate-spin" />
          {st.pending ? A.pending(st.pending) : A.walkingTo(st.walkingTo!)}
          {st.walkingTo && (
            <button type="button" onClick={cancelWalk} className="ml-1 rounded-full px-2 py-0.5 font-bold text-on-glass-muted ring-1 ring-white/15">
              {A.cancel}
            </button>
          )}
        </div>
      )}

      {/* the event card */}
      {st.cardOpen && (
        <div className="pscrim pointer-events-auto grid place-items-center p-4" onClick={() => useArena.setState({ cardOpen: false })}>
          <div onClick={(e) => e.stopPropagation()} className="w-[min(420px,94vw)] phone:w-[min(420px,60vw)]">
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
                  <button type="button" onClick={() => { useArena.setState({ cardOpen: false }); setFinder(true); }} className="pbtn pbtn-primary w-full">
                    <Armchair size={18} /> {A.findSeat}
                  </button>
                )
              }
            >
              {ev ? (
                <>
                  <div className="plist">
                    <div className="prow">
                      <span className="prow-icon"><Trophy size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="prow-title block truncate">{ev.game ? A.game[ev.game] : A.kind[ev.kind]} · {A.kind[ev.kind]}</span>
                        <span className="prow-sub block truncate">{A.status[ev.status]}</span>
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
                        <span className="prow-sub block">{Math.max(0, ev.capacity - ev.passesIssued).toLocaleString()} of {ev.capacity.toLocaleString()} passes left</span>
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
                  {st.denied?.reason === "NO_PASS" && <p className="pnote mt-2 text-sm">{denialText("NO_PASS")}</p>}
                </>
              ) : (
                <>
                  <p className="pnote text-sm">{A.freeSeating}</p>
                  <p className="plabel mt-3">{A.nextEvent}</p>
                  <p className="text-sm font-bold">{status?.next ? `${status.next.title} · ${whenWords(status.next.startsAt)}` : A.noEvent}</p>
                  {status?.next && <p className="pmuted text-xs">{scopeWords(status.next.rules)}</p>}
                </>
              )}
              {st.mock && <p className="pmuted mt-3 text-xs">{A.mock}</p>}
            </PaperCard>
          </div>
        </div>
      )}

      {/* the seat finder */}
      {finder && (
        <div className="pscrim pointer-events-auto grid place-items-center p-4" onClick={() => setFinder(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-[min(440px,94vw)] phone:w-[min(440px,62vw)]">
            <PaperCard title={A.seatFinder} icon={Armchair} size={phone ? "sm" : "md"} onClose={() => setFinder(false)} closeLabel={A.close} bodyClassName="max-h-[60vh] overflow-y-auto phone:max-h-[54vh]">
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
                        setFinder(false);
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
            </PaperCard>
          </div>
        </div>
      )}

      {/* a refusal in plain words */}
      {st.denied && st.denied.action === "sit" && !st.cardOpen && (
        <div className={card}>
          <PaperCard title={A.seatFinder} icon={MapPin} size="sm" onClose={() => useArena.setState({ denied: null })} closeLabel={A.close}>
            <p className="pnote text-sm">{st.denied.reason === "NO_ANSWER" ? A.noAnswer : denialText(st.denied.reason)}</p>
          </PaperCard>
        </div>
      )}

      {/* prompts */}
      {showSeatPrompt && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => requestSeat(nearSeat!)} className={PROMPT_BTN}>
            <KeyHint />
            <Armchair size={phone ? 16 : 20} /> {A.takeSeat(nearSeat!)}
          </button>
        </div>
      )}
      {nearExit && !nearSeat && !seated && !leaving && (
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
            </p>
          </PaperCard>
        </div>
      )}
    </div>
  );
}
