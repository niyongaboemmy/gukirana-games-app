"use client";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { CalendarClock, Coffee, CupSoda, DoorClosed, DoorOpen, Leaf, Loader2, NotebookPen, Trophy } from "lucide-react";
import { ArenaEventSchema, type ArenaEvent } from "@gukirana/contracts";
import { api } from "@/lib/session";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import { fetchArenaStatus, useArena } from "@/arena/arena-client";
import { scopeWords, whenWords } from "@/arena/strings";
import { goToSpot, type Spot } from "@/social/people";
import { closedFor, useBuildings } from "./buildings";
import { DRINKS, type Drink } from "./activities";
import { PORTALS } from "./layout";
import { PA } from "./strings";

/**
 * Plaza activity windows (P2-WLD-09): the café counter (pick a free drink — cosmetic only, no Stars, no balance of
 * any kind changes) and the notice board (the real arena schedule and the hall status staff set). Opened from the
 * activity prompt / E at the place (social/ActionPrompts SpotPrompt → startSpot).
 */
interface PlazaUi {
  card: null | "cafe" | "board";
  /** the spot the card belongs to (walk there when you pick) */
  spot: Spot | null;
  /** the last drink picked (cosmetic, shown in the toast) */
  drink: Drink | null;
  toast: { text: string; at: number } | null;
}
export const usePlazaUi = create<PlazaUi>()(() => ({ card: null, spot: null, drink: null, toast: null }));

/** Use a plaza place: the café opens its counter card, the board walks you up and opens the board, others just go. */
export function startSpot(spot: Spot): void {
  if (spot.kind === "coffee") return void usePlazaUi.setState({ card: "cafe", spot });
  goToSpot(spot);
  if (spot.kind === "board") usePlazaUi.setState({ card: "board", spot });
  if (spot.kind === "photo") setTimeout(() => usePlazaUi.setState({ toast: { text: PA.photoTaken, at: Date.now() } }), 2600);
}

const DRINK_ICON = { coffee: Coffee, tea: Leaf, juice: CupSoda } as const;

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="pscrim pointer-events-auto z-40 grid place-items-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[min(420px,94vw)] phone:w-[min(440px,62vw)]">
        {children}
      </div>
    </div>
  );
}

function CafeCard({ onClose }: { onClose: () => void }) {
  const phone = usePhoneHud();
  const spot = usePlazaUi((s) => s.spot);
  return (
    <PaperCard title={PA.cafeTitle} icon={Coffee} size={phone ? "sm" : "md"} onClose={onClose} closeLabel={PA.close}>
      <div className="plist">
        {DRINKS.map((d) => {
          const Icon = DRINK_ICON[d];
          return (
            <button
              key={d}
              type="button"
              className="prow w-full text-left"
              onClick={() => {
                usePlazaUi.setState({ card: null, drink: d });
                if (spot) goToSpot(spot);
              }}
            >
              <span className="prow-icon">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="prow-title block truncate">{PA.drinks[d]}</span>
                <span className="prow-sub block truncate">{PA.drinkSub[d]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="pnote mt-3 text-xs">{PA.cafeNote}</p>
    </PaperCard>
  );
}

/** GET /arena/events?upcoming=1 (public): up to three upcoming / live events; null = not reachable. */
async function upcomingEvents(): Promise<ArenaEvent[] | null> {
  try {
    const raw = await api<unknown[]>("/arena/events?upcoming=1");
    return raw.flatMap((e) => {
      const p = ArenaEventSchema.safeParse(e);
      return p.success ? [p.data] : [];
    });
  } catch {
    return null;
  }
}

function BoardCard({ onClose }: { onClose: () => void }) {
  const phone = usePhoneHud();
  const status = useArena((s) => s.status);
  const mock = useArena((s) => s.mock);
  const buildings = useBuildings();
  const [events, setEvents] = useState<ArenaEvent[] | null | undefined>(undefined);
  useEffect(() => {
    void fetchArenaStatus();
    let live = true;
    void upcomingEvents().then((e) => live && setEvents(e));
    return () => {
      live = false;
    };
  }, []);
  // the schedule: the API's upcoming list, else the status' current / next (never the offline mock)
  const list = (events ?? (status && !mock ? [status.current, status.next].filter((e): e is ArenaEvent => !!e) : [])).slice(0, 3);
  const halls = PORTALS.filter((p) => p.kind !== "soon");
  const soon = PORTALS.filter((p) => p.kind === "soon").map((p) => p.sub);
  return (
    <PaperCard title={PA.boardTitle} icon={NotebookPen} size={phone ? "sm" : "md"} onClose={onClose} closeLabel={PA.close} bodyClassName="max-h-[64vh] overflow-y-auto phone:max-h-[60vh]">
      <div className={phone ? "grid grid-cols-2 gap-3" : ""}>
        <div>
          <p className="plabel mb-1">{PA.arenaHead}</p>
          {events === undefined ? (
            <p className="pmuted flex items-center gap-2 text-sm">
              <Loader2 size={14} className="animate-spin" /> {PA.loading}
            </p>
          ) : list.length ? (
            <div className="plist">
              {list.map((e) => (
                <div key={e.id} className="prow">
                  <span className="prow-icon">{e.status === "live" || e.status === "doors_open" ? <Trophy size={18} /> : <CalendarClock size={18} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="prow-title block truncate">{e.title}</span>
                    <span className="prow-sub block truncate">
                      {e.status === "live" || e.status === "doors_open" ? PA.live : `${PA.next} · ${whenWords(e.startsAt)}`} · {scopeWords(e.rules)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="pnote text-sm">{events === null && (!status || mock) ? PA.scheduleOffline : PA.noEvents}</p>
          )}
          {status && !mock && <p className="pmuted mt-1 text-xs">{status.open ? PA.arenaOpen : PA.arenaClosed}</p>}
        </div>
        <div>
          <p className={`plabel mb-1 ${phone ? "" : "mt-3"}`}>{PA.hallsHead}</p>
          <div className="plist">
            {halls.map((p) => {
              const msg = closedFor(p.id, buildings);
              const shut = msg !== null || !p.href;
              return (
                <div key={p.id} className="prow">
                  <span className="prow-icon">{shut ? <DoorClosed size={18} /> : <DoorOpen size={18} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="prow-title block truncate">{p.label}</span>
                    <span className="prow-sub block truncate">{shut ? `${PA.closed}${msg ? ` · ${msg}` : ""}` : PA.open}</span>
                  </span>
                </div>
              );
            })}
            {soon.length > 0 && (
              <div className="prow">
                <span className="prow-icon">
                  <CalendarClock size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="prow-title block truncate">{soon.join(", ")}</span>
                  <span className="prow-sub block truncate">{PA.comingSoon}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="pmuted mt-3 text-xs">{PA.sourceNote}</p>
    </PaperCard>
  );
}

/** The plaza activity windows and the small activity toast (mounted with the social overlay). */
export function PlazaActivityCards() {
  const card = usePlazaUi((s) => s.card);
  const toast = usePlazaUi((s) => s.toast);
  const close = () => usePlazaUi.setState({ card: null });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => usePlazaUi.setState({ toast: null }), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <>
      {toast && (
        <div role="status" className="toast pointer-events-none fixed left-1/2 top-16 z-30 -translate-x-1/2 px-4 py-2 text-sm font-bold phone:top-12">
          {toast.text}
        </div>
      )}
      {card === "cafe" && (
        <Modal onClose={close}>
          <CafeCard onClose={close} />
        </Modal>
      )}
      {card === "board" && (
        <Modal onClose={close}>
          <BoardCard onClose={close} />
        </Modal>
      )}
    </>
  );
}
