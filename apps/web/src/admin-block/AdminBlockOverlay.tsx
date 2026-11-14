"use client";
import { useEffect, useState } from "react";
import { Building2, Calculator, DoorOpen, Hand, Headset, KeyRound, Loader2, Server, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { useSession } from "@/lib/session";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import type { HallLayout } from "@/rooms/layouts";
import { answerKnock, bindOffices, cancelKnock, canEnter, enterOffice, loadOffices, occupantsOf, useOffices } from "./office-client";
import { goToOffice, knockAt } from "./doors";
import { officePlan } from "./plan";
import { doorStatus, S, statusLabel } from "./strings";

const glass = "glass rounded-card";
const ICONS: Record<string, LucideIcon> = { "super-admin": ShieldCheck, "it-office": Server, accountant: Calculator, "customer-support": Headset };
const iconOf = (id: string) => ICONS[id] ?? Building2;

/**
 * Administrative Block HUD (P2-ADM-02): title + Leave, the office picker ("Choose the office while entering"), the
 * door prompt (Enter for role holders, Knock for visitors), the knocking / refused notices, the "Name is knocking ·
 * Let in / Decline" card for staff inside. Popups use the shared paper card (ui/PaperCard, app/paper.css); the HUD
 * chips stay dark grey glass. Strings: admin-block/strings.ts.
 */
export function AdminBlockOverlay({ layout }: { layout: HallLayout }) {
  const phone = usePhoneHud();
  const chatOpen = useSocial((s) => s.chatOpen);
  const authed = useSession((s) => s.status === "authenticated");
  const { nearExit, leaving } = useRoom();
  const others = useWorld((s) => Object.keys(s.players).length);
  const st = useOffices();
  const [picker, setPicker] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // listen to the office protocol on this hall's room connection, and load the directory + my roles
  useEffect(() => bindOffices(), []);
  useEffect(() => void loadOffices(), [authed]);
  // arriving in the lobby: offer the office picker once the walk-in has settled
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useOffices.getState();
      if (!s.inside && !s.goingTo) setPicker(true);
    }, 2200);
    return () => clearTimeout(t);
  }, []);
  // knock countdown on the local clock
  useEffect(() => {
    if (!st.knocking && !st.incoming.length) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [st.knocking, st.incoming.length]);

  const atDoor = st.atDoor ? officePlan(st.atDoor) : null;
  const doorAction = () => {
    const s = useOffices.getState();
    const id = s.atDoor;
    if (!id || s.inside || s.knocking || s.entering || s.admitted === id) return false;
    if (canEnter(id)) enterOffice(id);
    else knockAt(id);
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      if (doorAction()) return;
      const r = useRoom.getState();
      if (r.nearExit) r.set({ leaving: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: string) => {
    setPicker(false);
    goToOffice(id);
  };
  const insideName = st.inside ? officePlan(st.inside)?.name : null;
  const knockLeft = st.knocking ? Math.max(0, Math.ceil((st.knocking.expiresAt - now) / 1000)) : 0;
  const knockingAt = st.knocking ? officePlan(st.knocking.office)?.name : null;
  const refusedAt = st.refused ? officePlan(st.refused.office)?.name : null;
  const toast = st.incoming.find((k) => k.office === st.inside) ?? st.incoming[0];
  const showDoorPrompt = !!atDoor && !st.inside && !st.knocking && !st.entering && st.admitted !== atDoor.id && !leaving;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
      {/* title + Leave + Offices */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap phone:top-2 phone:gap-1.5">
        <button
          type="button"
          onClick={() => useRoom.getState().set({ leaving: true })}
          disabled={leaving}
          className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold disabled:opacity-60 phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}
        >
          <DoorOpen size={phone ? 14 : 16} /> {leaving ? S.leaving : S.leave}
        </button>
        <div className={`${glass} flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-bold phone:rounded-full phone:px-3 phone:py-1.5 phone:text-xs`}>
          <Building2 size={phone ? 14 : 16} className="text-primary-400" />
          {insideName ?? layout.title}
          <span className="flex items-center gap-1 font-semibold text-on-glass-muted">
            <Users size={14} /> {others + 1}
          </span>
        </div>
        <button type="button" onClick={() => setPicker(true)} className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}>
          <KeyRound size={phone ? 14 : 16} /> {S.open}
        </button>
      </div>

      {/* walking to an office */}
      {st.goingTo && !picker && (
        <div className={`${glass} absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-2 px-4 py-2 text-sm phone:top-[46px] phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
          <Loader2 size={14} className="animate-spin" /> {S.going} <span className="font-bold">{officePlan(st.goingTo)?.name}</span>
        </div>
      )}

      {/* the office picker (directory) */}
      {picker && (
        <div className="pscrim pointer-events-auto grid place-items-center p-4" onClick={() => setPicker(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-[min(460px,94vw)] phone:w-[min(440px,62vw)]">
            <PaperCard
              title={S.choose}
              icon={Building2}
              onClose={() => setPicker(false)}
              closeLabel={S.close}
              size={phone ? "sm" : "md"}
              bodyClassName="max-h-[56vh] overflow-y-auto phone:max-h-[52vh]"
              footer={
                <button type="button" disabled={!pick} onClick={() => pick && go(pick)} className="pbtn pbtn-primary w-full">
                  <DoorOpen size={18} /> {S.goTo}
                </button>
              }
            >
              <p className="pmuted mb-3 text-sm phone:mb-2 phone:text-xs">{S.welcomeSub}</p>
              <div className="plist">
                {st.offices.map((o) => {
                  const Icon = iconOf(o.id);
                  const n = occupantsOf(o.id, st);
                  const status = doorStatus(n);
                  const staff = canEnter(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`prow ${pick === o.id ? "ptab is-on" : ""}`}
                      aria-pressed={pick === o.id}
                      onClick={() => setPick(o.id)}
                      onDoubleClick={() => go(o.id)}
                    >
                      <span className={`prow-icon ${status === "staff" ? "is-plus" : ""}`}>
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="prow-title block truncate">{o.name}</span>
                        <span className="prow-sub block truncate">{o.description}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="prow-sub block">{statusLabel(n)}</span>
                        <span className="plabel block">{staff ? S.youCanEnter : S.visitorsKnock}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {st.source === "seed" && <p className="pnote mt-3 text-xs">{S.offline}</p>}
            </PaperCard>
          </div>
        </div>
      )}

      {/* at a door: Enter (role holders) or Knock (visitors) */}
      {showDoorPrompt && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={doorAction} className={PROMPT_BTN}>
            <KeyHint />
            {canEnter(atDoor.id) ? <DoorOpen size={phone ? 16 : 20} /> : <Hand size={phone ? 16 : 20} />}
            {canEnter(atDoor.id) ? S.enter(atDoor.name) : S.knockOn(atDoor.name)}
          </button>
        </div>
      )}
      {st.entering && (
        <div className={promptWrap(chatOpen)}>
          <div className={PROMPT_BTN}>
            <Loader2 size={phone ? 16 : 20} className="animate-spin" /> {S.opening}
          </div>
        </div>
      )}

      {/* leave prompt near the entrance */}
      {nearExit && !atDoor && !leaving && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => useRoom.getState().set({ leaving: true })} className={PROMPT_BTN}>
            <KeyHint />
            <DoorOpen size={phone ? 16 : 20} /> {S.exitSign}
          </button>
        </div>
      )}

      {/* visitor: knocking… / refused */}
      {st.knocking && (
        <div className="pointer-events-auto absolute left-1/2 top-16 w-[min(360px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(320px,46vw)]">
          <PaperCard
            title={S.knocking}
            icon={Hand}
            size="sm"
            footer={
              <button type="button" onClick={cancelKnock} className="pbtn pbtn-secondary w-full">
                {S.cancel}
              </button>
            }
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="pmuted truncate">{S.waiting} · {knockingAt}</span>
              <span className="num text-lg font-bold">{S.knockingSub(knockLeft)}</span>
            </div>
          </PaperCard>
        </div>
      )}
      {st.refused && !st.knocking && (
        <div className="pointer-events-auto absolute left-1/2 top-16 w-[min(360px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(320px,46vw)]">
          <PaperCard title={S.refusedTitle[st.refused.reason] ?? S.refusedTitle.EXPIRED} icon={DoorOpen} size="sm" onClose={() => useOffices.setState({ refused: null })} closeLabel={S.close}>
            <p className="pnote text-sm">{S.refused[st.refused.reason] ?? S.refused.EXPIRED}</p>
            {refusedAt && <p className="pmuted mt-1 text-xs">{refusedAt}</p>}
          </PaperCard>
        </div>
      )}

      {/* staff inside: someone is knocking */}
      {toast && (
        <div className="pointer-events-auto absolute left-1/2 top-16 w-[min(360px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(320px,46vw)]">
          <PaperCard
            title={S.isKnocking(toast.from.name)}
            icon={Hand}
            size="sm"
            footer={
              <div className="flex gap-2">
                <button type="button" onClick={() => answerKnock(toast.knockId, false)} className="pbtn pbtn-secondary flex-1">
                  {S.decline}
                </button>
                <button type="button" onClick={() => answerKnock(toast.knockId, true)} className="pbtn pbtn-success flex-1">
                  {S.letIn}
                </button>
              </div>
            }
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="pmuted truncate">{S.atYourDoor(officePlan(toast.office)?.name ?? "")}</span>
              <span className="num font-bold">{S.knockingSub(Math.max(0, Math.ceil((toast.expiresAt - now) / 1000)))}</span>
            </div>
          </PaperCard>
        </div>
      )}
    </div>
  );
}
