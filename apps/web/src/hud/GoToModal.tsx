"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DoorClosed, DoorOpen, Footprints, Landmark, LocateFixed, Map as MapIcon, MapPin, Navigation, Search, Swords, X, type LucideIcon } from "lucide-react";
import { PaperCard } from "@/ui/PaperCard";
import { selfPose } from "@/lib/world-store";
import { useSession } from "@/lib/session";
import { useStage } from "@/world/stage";
import { useDoorRefusal } from "@/world/door-access";
import { DESTINATIONS, destDistance, destination, FEATURED, FIRST_VISIT_DEST, reachable, type Destination, type DestId } from "@/world/destinations";
import { backToMe, closeGoTo, destStatus, endGuide, firstVisitSeen, guideTo, markFirstVisitSeen, showOnMap, useGoTo, walkThere, type DestStatus } from "@/world/goto";
import { useMm } from "@/lib/mm-store";
import { GO } from "./goto-strings";

/**
 * Go To (P2-WLD-13): the HUD button, the window listing every hall and place (world/destinations.ts), the guide card
 * shown while a destination is picked (Walk there / Show on map / Back to me), and the first-visit guide.
 * House style: PaperCard (cream in light, near-black glass with white text in dark), chocolate buttons, no emojis.
 */

const nameOf = (d: Destination) => GO.dest[d.label] ?? d.label;
const iconOf = (d: Destination): LucideIcon => (d.id === "fight" ? Swords : d.portal ? DoorOpen : d.id === "gate" ? Landmark : MapPin);
const statusText = (s: DestStatus) => GO.status[s];

/** Re-renders while a destination's door status changes (buildings API, arena status). */
function useStatus(d: Destination | null): DestStatus {
  const refusal = useDoorRefusal(d?.portal ?? null);
  void refusal;
  return d ? destStatus(d) : "open";
}

/* ---------------------------------------------------------------- button ---------------------------------------------------------------- */

export function GoToButton({ className }: { className: string }) {
  const open = useGoTo((s) => s.open);
  return (
    <button
      type="button"
      data-goto-button
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={GO.buttonLabel}
      title={`${GO.buttonLabel} (M)`}
      onClick={() => useGoTo.setState({ open: !open })}
      className={`${className} flex! flex-col items-center justify-center gap-0.5`}
    >
      <Navigation size={18} strokeWidth={1.9} />
      <span className="label text-[9px] leading-none tracking-[0.14em] text-on-glass-muted phone:hidden">{GO.button}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- window ---------------------------------------------------------------- */

const FOCUSABLE = 'button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])';

export function GoToModal() {
  const open = useGoTo((s) => s.open);
  const view = useStage((s) => s.view);
  // M toggles the window (not while typing)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.repeat) return;
      if (e.code !== "KeyM" || e.metaKey || e.ctrlKey || e.altKey) return;
      // (no "m" typed into the search field that takes the focus)
      e.preventDefault();
      useGoTo.setState((s) => ({ open: !s.open }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!open) return null;
  return createPortal(<Window inHall={view !== "plaza"} />, document.body);
}

function Window({ inHall }: { inHall: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(false);
  // distances from where you stand when the window opens
  const from = useMemo(() => ({ x: selfPose.x, z: selfPose.z }), []);
  const dist = useMemo(() => new Map(DESTINATIONS.map((d) => [d.id, destDistance(from, d)])), [from]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => setShown(true));
    // focus the first control (the search field on a desktop; on a touch screen the first button: no keyboard pops up)
    const el = ref.current;
    const fine = window.matchMedia?.("(pointer: fine)").matches;
    (el?.querySelector<HTMLElement>(fine ? "input" : "[data-goto-first]") ?? el?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeGoTo();
      }
      // focus trap: Tab / Shift+Tab cycle inside the window
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!el.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", key, true);
      (document.querySelector<HTMLElement>("[data-goto-button]") ?? opener)?.focus?.();
    };
  }, []);

  const match = (d: Destination) => !q.trim() || `${nameOf(d)} ${GO.sub[d.label] ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());
  const featured = DESTINATIONS.filter((d) => FEATURED.includes(d.id) && match(d));
  const halls = DESTINATIONS.filter((d) => d.group === "halls" && !FEATURED.includes(d.id) && match(d));
  const places = DESTINATIONS.filter((d) => d.group === "places" && !FEATURED.includes(d.id) && match(d));

  return (
    <div className={`pscrim z-50 grid place-items-center p-4 transition-opacity duration-200 phone:p-2 ${shown ? "opacity-100" : "opacity-0"}`} onClick={closeGoTo}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="goto-title" onClick={(e) => e.stopPropagation()} className="w-[min(460px,94vw)] phone:w-[min(560px,70vw)]" data-goto-modal>
        <PaperCard title={<span id="goto-title">{GO.title}</span>} icon={Navigation} onClose={closeGoTo} closeLabel={GO.close} className="max-h-[88dvh] phone:max-h-[94dvh]" bodyClassName="overflow-y-auto">
          <div className="flex flex-col gap-3 phone:gap-2">
            {inHall && (
              <p className="pnote" role="note">
                <DoorClosed size={18} className="mt-0.5 shrink-0" /> {GO.inHall}
              </p>
            )}
            <label className="pfield phone:min-h-10">
              <Search size={17} aria-hidden className="shrink-0 opacity-70" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={GO.search} aria-label={GO.search} enterKeyHint="search" />
            </label>
            {featured.map((d) => (
              <Featured key={d.id} d={d} dist={dist.get(d.id)!} disabled={inHall} />
            ))}
            <Group title={GO.halls} list={halls} dist={dist} disabled={inHall} />
            <Group title={GO.places} list={places} dist={dist} disabled={inHall} />
            {!featured.length && !halls.length && !places.length && <p className="pnote">{GO.noResults}</p>}
          </div>
        </PaperCard>
      </section>
    </div>
  );
}

function Featured({ d, dist, disabled }: { d: Destination; dist: { m: number; s: number }; disabled: boolean }) {
  const status = useStatus(d);
  const off = disabled || !reachable(d);
  const Icon = iconOf(d);
  return (
    <div className="plist p-3 phone:p-2" data-goto-featured={d.id}>
      <p className="plabel mb-1.5 text-xs font-bold uppercase tracking-[0.14em] pmuted">{GO.featured}</p>
      <div className="flex items-center gap-3">
        <span className="prow-icon" aria-hidden>
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="prow-title text-lg leading-tight">{nameOf(d)}</p>
          <p className="prow-sub">
            {GO.sub[d.label] ? `${GO.sub[d.label]} · ` : ""}
            <Status s={status} /> {disabled ? "" : `· ${GO.distance(dist.m, dist.s)}`}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2 phone:mt-2">
        <button type="button" data-goto-first data-goto-walk={d.id} disabled={off} onClick={() => walkThere(d.id)} className="pbtn pbtn-primary flex-1 disabled:opacity-50 phone:min-h-10 phone:text-sm">
          <Footprints size={18} /> {GO.walk}
        </button>
        <button type="button" disabled={off} onClick={() => showOnMap(d.id)} className="pbtn pbtn-primary disabled:opacity-50 phone:min-h-10 phone:text-sm">
          <MapIcon size={18} /> {GO.map}
        </button>
      </div>
    </div>
  );
}

function Group({ title, list, dist, disabled }: { title: string; list: Destination[]; dist: Map<DestId, { m: number; s: number }>; disabled: boolean }) {
  if (!list.length) return null;
  return (
    <div role="group" aria-label={title}>
      <p className="plabel mb-1.5 px-1 text-xs font-bold uppercase tracking-[0.14em] pmuted">{title}</p>
      <div className="plist">
        {list.map((d) => (
          <Row key={d.id} d={d} dist={dist.get(d.id)!} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

function Row({ d, dist, disabled }: { d: Destination; dist: { m: number; s: number }; disabled: boolean }) {
  const status = useStatus(d);
  const off = disabled || !reachable(d);
  const Icon = iconOf(d);
  return (
    <button type="button" className="prow disabled:opacity-55 phone:min-h-12 phone:py-1.5" disabled={off} onClick={() => guideTo(d.id)} data-goto-dest={d.id} title={!disabled && !reachable(d) ? GO.notReady : undefined}>
      <span className="prow-icon" aria-hidden>
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="prow-title block truncate">{nameOf(d)}</span>
        <span className="prow-sub block truncate">
          {d.portal ? (
            <>
              <Status s={status} />
              {disabled ? "" : " · "}
            </>
          ) : null}
          {disabled ? "" : GO.distance(dist.m, dist.s)}
        </span>
      </span>
      <Navigation size={16} aria-hidden className="shrink-0 opacity-60" />
    </button>
  );
}

function Status({ s }: { s: DestStatus }) {
  return <span className={s === "open" ? "pplus font-bold" : s === "closed" ? "pminus font-bold" : "font-bold"}>{statusText(s)}</span>;
}

/* ---------------------------------------------------------------- guide card ---------------------------------------------------------------- */

/** While a destination is picked: its name, status and the live distance, Walk there / Show on map / Back to me. */
export function GoToCard() {
  const { dest, walking, map, firstVisit, arrivedAt } = useGoTo();
  const view = useStage((s) => s.view);
  const d = destination(dest);
  const status = useStatus(d);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!d) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [d]);
  // walked into a hall (or left the plaza another way): the guide is done
  useEffect(() => {
    if (dest && view && view !== "plaza") endGuide();
  }, [dest, view]);
  useFirstVisit();
  // a Quick Play / challenge sheet is a modal: the guide card (on <body>, above the HUD layer) must not cover it
  const sheetOpen = useMm((s) => !!s.quickPlay || !!s.challenge);
  if (!d || view !== "plaza" || sheetOpen) return null;
  const left = destDistance({ x: selfPose.x, z: selfPose.z }, d);
  const name = nameOf(d);
  let body: ReactNode;
  if (arrivedAt) body = <p className="font-bold pplus">{GO.arrived}</p>;
  else
    body = (
      <p className="text-sm">
        {firstVisit && <span className="mb-1 block">{GO.firstText}</span>}
        {d.portal && (
          <>
            <Status s={status} /> ·{" "}
          </>
        )}
        <span className="num">{walking ? `${GO.walking} · ${left.m} m` : GO.distance(left.m, left.s)}</span>
        {!walking && status !== "open" && <span className="pmuted mt-0.5 block text-xs">{status === "closed" ? GO.closedNote : GO.soonNote}</span>}
      </p>
    );
  const dismiss = () => endGuide();
  // (on <body>: the HUD columns are transformed, which would pin a fixed card to them)
  return createPortal(
    <div role="status" aria-live="polite" className="pointer-events-auto fixed left-1/2 top-16 z-30 w-[min(400px,92vw)] -translate-x-1/2 phone:top-auto phone:bottom-[max(10px,env(safe-area-inset-bottom))] phone:w-[min(340px,40vw)] phone:[&_.pcard-body]:p-2.5 phone:[&_p]:text-xs" data-goto-card={d.id}>
      <PaperCard title={firstVisit && !arrivedAt ? GO.firstTitle : name} icon={iconOf(d)} size="sm" onClose={dismiss} closeLabel={firstVisit ? GO.notNow : GO.endGuide}>
        <div className="flex flex-col gap-2">
          {body}
          {(!arrivedAt || map) && (
            <div className="flex gap-2">
              {arrivedAt ? null : walking ? (
                <button type="button" onClick={dismiss} className="pbtn pbtn-primary min-h-10 flex-1 text-sm" data-goto-stop>
                  <X size={16} /> {GO.stop}
                </button>
              ) : (
                <button type="button" onClick={() => walkThere(d.id)} className="pbtn pbtn-primary min-h-10 flex-1 text-sm" data-goto-card-walk>
                  <Footprints size={16} /> {GO.walk}
                </button>
              )}
              {map ? (
                <button type="button" onClick={backToMe} className="pbtn pbtn-primary min-h-10 text-sm" data-goto-back>
                  <LocateFixed size={16} /> {GO.backToMe}
                </button>
              ) : (
                <button type="button" onClick={() => showOnMap(d.id)} className="pbtn pbtn-primary min-h-10 text-sm" data-goto-map>
                  <MapIcon size={16} /> {GO.map}
                </button>
              )}
            </div>
          )}
        </div>
      </PaperCard>
    </div>,
    document.body,
  );
}

/**
 * First visit (per user, per device): a little after the plaza appears, the guide points to the featured destination
 * ("Fight Games is this way") with its route on the ground; dismissible, never shown again for that user.
 */
function useFirstVisit() {
  const user = useSession((s) => (s.status === "authenticated" ? s.me?.username ?? null : null));
  const ready = useStage((s) => s.view === "plaza" && s.hud);
  useEffect(() => {
    if (!user || !ready || firstVisitSeen(user)) return;
    const d = destination(FIRST_VISIT_DEST);
    if (!d || !reachable(d) || destStatus(d) === "soon") return;
    const t = window.setTimeout(() => {
      const s = useGoTo.getState();
      if (s.dest || s.open || useStage.getState().view !== "plaza") return;
      // the person is already choosing a game (Quick Play / challenge sheet): not now, next plaza visit
      const mm = useMm.getState();
      if (mm.quickPlay || mm.challenge) return;
      markFirstVisitSeen(user);
      guideTo(FIRST_VISIT_DEST, { firstVisit: true, turn: false });
    }, 2500);
    return () => window.clearTimeout(t);
  }, [user, ready]);
}
