"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Bot, DoorOpen, Loader2, Mic, Star, Swords, Users, X, Zap } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { useMatch, STAKES } from "@/lib/match-store";
import { propose, quickMatchJoin, quickMatchLeave } from "@/lib/realtime";
import { useVoice } from "@/voice/voice";
import { rememberBeforeGame } from "@/lib/return-point";
import { useSession } from "@/lib/session";
import { useRoom } from "./room-store";
import { useSocial } from "@/social/social-store";
import { getUp, sitDown } from "./RoomPlayer";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { isGameHall, type HallLayout } from "./layouts";
import { TablePicker } from "./TablePicker";
import { PaperCard } from "@/ui/PaperCard";
import { R } from "./strings";

const glass = "glass rounded-card";

/** Hall HUD: room title, sit prompt, seat panel (practice / find opponent here / stand). */
export function RoomOverlay({ layout }: { layout: HallLayout }) {
  const router = useRouter();
  const { nearSeat, seated, nearExit, leaving } = useRoom();
  // arrival hint (orientation): where you are, what to do, where the exit is
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, []);
  const seats = useWorld((s) => s.seats);
  const you = useWorld((s) => s.you);
  const seatTaken = useWorld((s) => s.seatTaken);
  const others = useWorld((s) => Object.keys(s.players).length);
  const quick = useMatch((s) => s.quick);
  const authed = useSession((s) => s.status === "authenticated");
  const stars = useSession((s) => s.me?.stars ?? 0);
  const [stake, setStake] = useState(25);
  const players = useWorld((s) => s.players);
  const talking = useVoice((s) => s.talking);
  const phone = usePhoneHud();
  const chatOpen = useSocial((s) => s.chatOpen);
  // phone: the list starts collapsed (a one-line pill), so the hall is not hidden behind it
  const [peopleOpen, setPeopleOpen] = useState(true);
  useEffect(() => {
    if (phone) setPeopleOpen(false);
  }, [phone]);
  const [challenge, setChallenge] = useState<{ id: string; name: string } | null>(null);
  const seatOf = (id: string) => {
    const seatId = Object.entries(seats).find(([, sid]) => sid === id)?.[0];
    return seatId ? Number(seatId.slice(1, seatId.indexOf("s"))) + 1 : null;
  };
  const people = Object.values(players).sort((a, b) => a.name.localeCompare(b.name));
  const livePlay = true; // all three halls support live matches (Pool via the deterministic integer engine)

  // the server refused our chair (someone sat first) → stand back up
  useEffect(() => {
    if (seated && seats[seated] && seats[seated] !== you) getUp();
  }, [seatTaken, seats, seated, you]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      const r = useRoom.getState();
      if (r.seated) getUp();
      else if (r.nearExit && !r.nearSeat) r.set({ leaving: true });
      else if (r.nearSeat) sitDown(r.nearSeat);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const table = seated ? layout.seats.find((s) => s.id === seated)?.table : null;
  const tableNo = table ? Number(table.slice(1)) + 1 : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
      {/* room title + back */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap phone:top-2 phone:gap-1.5">
        <button
          type="button"
          onClick={() => useRoom.getState().set({ leaving: true })}
          disabled={leaving}
          className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold disabled:opacity-60 phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}
        >
          <DoorOpen size={phone ? 14 : 16} /> {leaving ? "Leaving…" : "Leave"}
        </button>
        <div className={`${glass} flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-bold phone:rounded-full phone:px-3 phone:py-1.5 phone:text-xs`}>
          <span className="size-2.5 rounded-full" style={{ background: layout.color }} />
          {layout.title}
          <span className="flex items-center gap-1 font-semibold text-on-glass-muted">
            <Users size={14} /> {others + 1}
          </span>
        </div>
      </div>

      {/* people in this room: decide who to play with */}
      <div className="absolute left-[max(12px,env(safe-area-inset-left))] top-[136px] w-[min(260px,40vw)] phone:top-[54px] phone:w-auto phone:max-w-[30vw]">
        <button type="button" onClick={() => setPeopleOpen((v) => !v)} className={`${glass} icon-button pointer-events-auto flex w-full items-center gap-2 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1 phone:text-xs`}>
          <Users size={phone ? 13 : 16} style={{ color: layout.color }} /> {phone ? people.length + 1 : `In this room · ${people.length + 1}`}
          <span className="ml-auto text-xs text-on-glass-muted phone:hidden">{peopleOpen ? "Hide" : "Show"}</span>
        </button>
        {peopleOpen && (!phone || people.length > 0) && (
          <div className={`menu pointer-events-auto mt-1.5 max-h-[38vh] overflow-y-auto p-1.5 phone:w-[min(240px,30vw)]`}>
            {people.length === 0 && <p className="px-2 py-3 text-xs text-on-glass-muted">{R.nobodyHere}</p>}
            {people.map((p) => {
              const table = seatOf(p.id);
              return (
                <div key={p.id} className="menu-item flex items-center gap-2 px-2 py-1.5">
                  <span className="relative grid size-8 shrink-0 place-items-center rounded-full text-xs font-black" style={{ background: p.color }}>
                    {p.name.slice(0, 1).toUpperCase()}
                    {talking[p.id] && <Mic size={11} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-success p-0.5 text-white" />}
                  </span>
                  <button type="button" onClick={() => useSocial.setState({ menu: p.id })} className="min-w-0 flex-1 text-left leading-tight" aria-label={`${p.name}: options`}>
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-[11px] text-on-glass-muted">Lvl {p.level} · {table ? `seated at table ${table}` : "walking"}</p>
                  </button>
                  {p.verified && authed && (
                    <button type="button" onClick={() => setChallenge({ id: p.id, name: p.name })} className="press flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold ring-1 ring-white/10" style={{ background: `${layout.color}33`, color: "#fff" }}>
                      <Swords size={12} /> Play
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* choosing a table: mini-map + "Find a free table" + the label of the table you stand by */}
      <TablePicker layout={layout} />

      {/* challenge someone in the room: choose the stake (game = this hall) */}
      {challenge && (
        <div className="pscrim pointer-events-auto grid place-items-center p-4" onClick={() => setChallenge(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-[min(400px,94vw)]">
            <PaperCard
              title={`Play ${challenge.name}`}
              icon={Swords}
              onClose={() => setChallenge(null)}
              footer={
                <div className="flex w-full gap-2">
                  <button type="button" onClick={() => setChallenge(null)} className="pbtn pbtn-secondary flex-1">{R.cancel}</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isGameHall(layout.game)) propose(challenge.id, layout.game, stake);
                      setChallenge(null);
                    }}
                    className="pbtn pbtn-primary flex-1"
                  >
                    <Swords size={16} /> Send challenge
                  </button>
                </div>
              }
            >
              <p className="pmuted mb-3 text-sm">{layout.title} · the server holds both stakes in escrow and pays the winner 2×.</p>
              <p className="plabel mb-1.5">{R.stake}</p>
              <div className="flex flex-wrap gap-1.5">
                {STAKES.map((s) => (
                  <button key={s} type="button" disabled={s > stars} aria-pressed={stake === s} onClick={() => setStake(s)} className={`ptab flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold disabled:opacity-30 ${stake === s ? "is-on" : ""}`}>
                    {s === 0 ? "Friendly" : <>{s} <Star size={12} className="fill-current" /></>}
                  </button>
                ))}
              </div>
            </PaperCard>
          </div>
        </div>
      )}

      {/* arrival hint */}
      {hint && !seated && (
        <div className={`${glass} absolute left-1/2 top-16 -translate-x-1/2 px-4 py-2.5 text-center text-sm phone:top-[46px] phone:whitespace-nowrap phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
          <p className="font-bold phone:hidden">You&apos;re in the {layout.title}</p>
          <p className="text-on-glass-muted">Pick a free table (green) to play<span className="phone:hidden"> · tap it or use Find a free table</span> · the exit is behind you</p>
        </div>
      )}

      {/* leave prompt near the exit (inside) */}
      {nearExit && !nearSeat && !seated && !leaving && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => useRoom.getState().set({ leaving: true })} className={PROMPT_BTN}>
            <KeyHint />
            <DoorOpen size={phone ? 16 : 20} /> Leave to the plaza
          </button>
        </div>
      )}

      {/* sit prompt */}
      {nearSeat && !seated && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => sitDown(nearSeat)} className={PROMPT_BTN}>
            <KeyHint />
            <Armchair size={phone ? 16 : 20} /> Sit down
          </button>
        </div>
      )}

      {/* seat panel */}
      {seated && (
        // phone: a slim bottom sheet (<= 38% of the height) between the joystick and the action bar; the table stays visible
        <div className="pointer-events-auto absolute bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 w-[min(520px,92vw)] -translate-x-1/2 phone:bottom-0 phone:w-[min(480px,54vw)]">
          <PaperCard
            size={phone ? "sm" : "md"}
            title={`Table ${tableNo} · ${layout.title}`}
            icon={Armchair}
            className="phone:max-h-[38vh] phone:rounded-b-none"
            bodyClassName="phone:!p-2.5 phone:pb-[max(10px,env(safe-area-inset-bottom))]"
            headExtra={
              <button type="button" onClick={getUp} className="pcard-hbtn !flex !w-auto items-center gap-1 px-2.5 text-sm font-semibold phone:text-xs">
                <X size={14} /> Stand up
              </button>
            }
          >
            {quick.status === "waiting" ? (
              <button type="button" onClick={quickMatchLeave} className="pbtn pbtn-secondary w-full phone:text-sm">
                <Loader2 size={18} className="animate-spin" /> Waiting for an opponent at your table… (cancel)
              </button>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 phone:grid-cols-2 phone:gap-1.5">
                <button type="button" onClick={() => {
                    rememberBeforeGame(seated);
                    router.push(`/play/${layout.game}`);
                  }} className="pbtn pbtn-secondary phone:text-sm">
                  <Bot size={18} /> Practice vs AI
                </button>
                {livePlay && authed ? (
                  <button type="button" onClick={() => isGameHall(layout.game) && quickMatchJoin(layout.game, stake)} className="pbtn pbtn-primary phone:text-sm">
                    <Zap size={18} /> Find an opponent
                  </button>
                ) : (
                  <div className="pnote grid place-items-center text-center text-xs">{livePlay ? "Sign in at the gate to play people" : "Live Pool matches arrive with the server physics engine. Practice now."}</div>
                )}
              </div>
            )}
            {livePlay && authed && quick.status !== "waiting" && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm phone:mt-2 phone:flex-nowrap phone:gap-1 phone:overflow-x-auto phone:text-xs">
                <span className="plabel mr-1 phone:text-[10px]">{R.stake}</span>
                {STAKES.map((s) => (
                  <button key={s} type="button" disabled={s > stars} aria-pressed={stake === s} onClick={() => setStake(s)} className={`ptab flex shrink-0 items-center gap-1 rounded-full px-3 py-1 font-bold disabled:opacity-30 phone:px-2.5 ${stake === s ? "is-on" : ""}`}>
                    {s === 0 ? "Friendly" : <>{s} <Star size={11} className="fill-current" /></>}
                  </button>
                ))}
              </div>
            )}
            <p className="pmuted mt-2 text-xs phone:hidden">Tip: stand near another player and use Challenge to play them directly.</p>
          </PaperCard>
        </div>
      )}
    </div>
  );
}
