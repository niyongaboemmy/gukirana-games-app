"use client";
import { useEffect, useRef, useState } from "react";
import {
  Armchair,
  Building2,
  Calculator,
  ConciergeBell,
  DoorOpen,
  Footprints,
  Hand,
  Headset,
  Hourglass,
  KeyRound,
  Loader2,
  MessagesSquare,
  Mic,
  MicOff,
  MonitorSmartphone,
  Send,
  Server,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { selfPose, useWorld } from "@/lib/world-store";
import { useSession } from "@/lib/session";
import { useRoom } from "@/rooms/room-store";
import { getUp, sitDown } from "@/rooms/RoomPlayer";
import { useSocial } from "@/social/social-store";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import { useConsole } from "@/console/console-store";
import { disableVoice, enableVoice, setOpenMic, useVoice } from "@/voice/voice";
import type { HallLayout } from "@/rooms/layouts";
import {
  answerKnock,
  bindOffices,
  cancelKnock,
  canEnter,
  enterOffice,
  loadOffices,
  occupantsOf,
  queueOf,
  sendOfficeChat,
  useOffices,
  visitorsOf,
  type IncomingKnock,
} from "./office-client";
import { askReception, closeReception, openReception, useReception } from "./reception-client";
import { goToOffice, knockAt } from "./doors";
import { openComputer } from "./computer";
import { adminSeat, atOfficerDesk, officePlan } from "./plan";
import { doorStatus, S, statusLabel } from "./strings";

const glass = "glass rounded-card";
const ICONS: Record<string, LucideIcon> = { "super-admin": ShieldCheck, "it-office": Server, accountant: Calculator, "customer-support": Headset };
const iconOf = (id: string) => ICONS[id] ?? Building2;
/** side windows (reception chat, office conversation, staff queue): right side, the scene stays visible */
const SIDE = "pointer-events-auto absolute right-3 top-16 w-[min(380px,92vw)] phone:right-2 phone:top-[46px] phone:w-[min(340px,46vw)]";

type PromptKind = "computer" | "door" | "reception" | "stand" | "seat" | "exit" | null;

/**
 * Administrative Block HUD (P2-ADM-02 / P2-ADM-04): title + Leave + Offices, the office picker, ONE action prompt at a
 * time (Use computer › Knock / Enter › Talk to reception › Stand up › Sit down › Exit; E or tap), the visitor's
 * knocking / "asked to wait" / "office full" card, the staff's queue of knocks (Let in / Please wait / Decline), the
 * reception chat, and the office conversation (text + office-scoped voice). Windows use the shared paper card
 * (ui/PaperCard, app/paper.css); HUD chips stay dark grey glass. Strings: admin-block/strings.ts.
 */
export function AdminBlockOverlay({ layout }: { layout: HallLayout }) {
  const phone = usePhoneHud();
  const chatOpen = useSocial((s) => s.chatOpen);
  const authed = useSession((s) => s.status === "authenticated");
  const { nearExit, leaving, nearSeat, seated } = useRoom();
  const others = useWorld((s) => Object.keys(s.players).length);
  const seatTaken = useWorld((s) => s.seatTaken);
  const consoleOpen = useConsole((s) => s.open);
  const st = useOffices();
  const reception = useReception();
  const [picker, setPicker] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [talk, setTalk] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [atDesk, setAtDesk] = useState(false);

  // listen to the office protocol on this hall's room connection, and load the directory + my roles
  useEffect(() => bindOffices(), []);
  useEffect(() => void loadOffices(), [authed]);
  // arriving in the lobby: offer the office picker once the walk-in has settled
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useOffices.getState();
      if (!s.inside && !s.goingTo && !useReception.getState().open) setPicker(true);
    }, 2200);
    return () => clearTimeout(t);
  }, []);
  // countdowns on the local clock
  useEffect(() => {
    if (!st.knocking && !st.incoming.length && !st.alone) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [st.knocking, st.incoming.length, st.alone]);
  // standing behind your own desk (the computer prompt without sitting down)
  useEffect(() => {
    if (!st.inside || st.via !== "role") return setAtDesk(false);
    const o = officePlan(st.inside);
    // the controller writes selfPose every frame; a light poll is enough for a prompt
    const id = setInterval(() => setAtDesk(!!o && atOfficerDesk(o, selfPose)), 300);
    return () => clearInterval(id);
  }, [st.inside, st.via]);
  // the server refused our chair (taken first, or an office chair we may not take): stand back up
  useEffect(() => {
    if (!seatTaken) return;
    const t = setTimeout(() => {
      const r = useRoom.getState();
      const w = useWorld.getState();
      if (r.seated && w.seats[r.seated] !== w.you) getUp();
    }, 250);
    return () => clearTimeout(t);
  }, [seatTaken]);
  // leaving the office ends its conversation window; walking off the counter closes the reception chat
  useEffect(() => {
    if (!st.inside) setTalk(false);
  }, [st.inside]);

  const atDoor = st.atDoor ? officePlan(st.atDoor) : null;
  const seat = seated ? adminSeat(seated) : null;
  const near = nearSeat ? adminSeat(nearSeat) : null;
  const mineInside = !!st.inside && st.via === "role" && canEnter(st.inside);
  // seated at your desk, or standing behind it (next to your own chair: sit down first, then the computer)
  const computerHere = mineInside && (seat?.kind === "officer" || (atDesk && !seated && near?.kind !== "officer"));
  const doorReady = !!atDoor && !st.inside && !st.knocking && !st.entering && st.admitted !== atDoor.id;

  const prompt: PromptKind = leaving || consoleOpen
    ? null
    : computerHere
      ? "computer"
      : doorReady
        ? "door"
        : st.atReception && !seated && !reception.open
          ? "reception"
          : seated
            ? "stand"
            : near
              ? "seat"
              : nearExit
                ? "exit"
                : null;

  const act = (kind: PromptKind) => {
    const s = useOffices.getState();
    const r = useRoom.getState();
    switch (kind) {
      case "computer":
        if (s.inside) openComputer(s.inside);
        return;
      case "door":
        if (!s.atDoor) return;
        if (canEnter(s.atDoor)) enterOffice(s.atDoor);
        else knockAt(s.atDoor);
        return;
      case "reception":
        setPicker(false);
        openReception();
        return;
      case "stand":
        getUp();
        return;
      case "seat":
        if (r.nearSeat) sitDown(r.nearSeat);
        return;
      case "exit":
        r.set({ leaving: true });
        return;
    }
  };
  const promptRef = useRef<PromptKind>(null);
  promptRef.current = prompt;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.code !== "KeyE" || useConsole.getState().open) return;
      act(promptRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: string) => {
    setPicker(false);
    closeReception();
    if (useRoom.getState().seated) getUp();
    goToOffice(id);
  };
  const insideName = st.inside ? officePlan(st.inside)?.name : null;
  const knockLeft = st.knocking ? Math.max(0, Math.ceil((st.knocking.expiresAt - now) / 1000)) : 0;
  const knockingAt = st.knocking ? (officePlan(st.knocking.office)?.name ?? "") : "";
  const refusedAt = st.refused ? officePlan(st.refused.office)?.name : null;
  const myQueue = st.inside && mineInside ? st.incoming.filter((k) => k.office === st.inside) : [];
  const inConversation = !!st.inside && st.members.length >= 2;
  const myTotalQueue = st.roles.offices.reduce((n, id) => n + queueOf(id, st), 0);

  const promptLabel: Record<Exclude<PromptKind, null>, { icon: LucideIcon; text: string }> = {
    computer: { icon: MonitorSmartphone, text: S.useComputer },
    door: { icon: atDoor && canEnter(atDoor.id) ? DoorOpen : Hand, text: atDoor ? (canEnter(atDoor.id) ? S.enter(atDoor.name) : S.knockOn(atDoor.name)) : "" },
    reception: { icon: ConciergeBell, text: S.talkReception },
    stand: { icon: Footprints, text: S.standUp },
    seat: { icon: Armchair, text: near?.kind === "officer" ? S.sitDesk : near?.kind === "visitor" ? S.takeSeat : S.sitDown },
    exit: { icon: DoorOpen, text: S.exitSign },
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
      {/* title + Leave + Offices (+ In conversation) */}
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
          <Building2 size={phone ? 14 : 16} className="text-gold" />
          {insideName ?? layout.title}
          <span className="flex items-center gap-1 font-semibold text-on-glass-muted">
            <Users size={14} /> {others + 1}
          </span>
        </div>
        {inConversation ? (
          <button type="button" onClick={() => setTalk((v) => !v)} className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`} aria-pressed={talk}>
            <MessagesSquare size={phone ? 14 : 16} className="text-gold" /> {S.inConversation}
            <span className="num font-semibold text-on-glass-muted">{st.members.length}</span>
          </button>
        ) : (
          <button type="button" onClick={() => setPicker(true)} className={`${glass} icon-button pointer-events-auto relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}>
            <KeyRound size={phone ? 14 : 16} /> {S.open}
            {myTotalQueue > 0 && <span className="num rounded-full bg-white/15 px-1.5 text-xs">{myTotalQueue}</span>}
          </button>
        )}
      </div>

      {/* the officer left the office you are visiting (GAP-013): wait in the lobby; shown out after the grace time */}
      {st.alone && st.inside === st.alone.office && (
        <div role="status" className={`${glass} absolute left-1/2 top-16 flex -translate-x-1/2 flex-col items-center gap-0.5 px-4 py-2 text-center text-sm phone:top-[46px] phone:px-3 phone:py-1 phone:text-xs`}>
          <span className="font-bold">{S.officerLeft}</span>
          <span className="text-on-glass-muted">{S.officerLeftSub(Math.max(0, Math.ceil((st.alone.until - now) / 1000)))}</span>
        </div>
      )}

      {/* walking to an office */}
      {st.goingTo && !picker && !st.knocking && (
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
                <div className="flex w-full gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPicker(false);
                      openReception();
                    }}
                    className="pbtn pbtn-secondary flex-1"
                  >
                    <ConciergeBell size={18} /> {S.receptionTitle}
                  </button>
                  <button type="button" disabled={!pick} onClick={() => pick && go(pick)} className="pbtn pbtn-primary flex-1">
                    <DoorOpen size={18} /> {S.goTo}
                  </button>
                </div>
              }
            >
              <p className="pmuted mb-3 text-sm phone:mb-2 phone:text-xs">{S.welcomeSub}</p>
              <div className="plist">
                {st.offices.map((o) => {
                  const Icon = iconOf(o.id);
                  const n = occupantsOf(o.id, st);
                  const v = visitorsOf(o.id, st);
                  const q = queueOf(o.id, st);
                  const status = doorStatus(n, v);
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
                        <span className="prow-sub block">
                          {statusLabel(n, v)}
                          {q > 0 ? ` · ${S.queued(q)}` : ""}
                        </span>
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

      {/* ONE action prompt at a time (E / tap) */}
      {prompt && !picker && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => act(prompt)} className={PROMPT_BTN}>
            <KeyHint />
            {(() => {
              const P = promptLabel[prompt];
              return (
                <>
                  <P.icon size={phone ? 16 : 20} /> {P.text}
                </>
              );
            })()}
          </button>
        </div>
      )}
      {st.entering && !prompt && (
        <div className={promptWrap(chatOpen)}>
          <div className={PROMPT_BTN}>
            <Loader2 size={phone ? 16 : 20} className="animate-spin" /> {S.opening}
          </div>
        </div>
      )}

      {/* visitor: knocking… / asked to wait / office full */}
      {st.knocking && (
        <div className="pointer-events-auto absolute left-1/2 top-16 w-[min(380px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(340px,46vw)]">
          <PaperCard
            title={st.knocking.wait === "FULL" ? S.officeFull : st.knocking.wait === "ASKED" ? S.askedToWait(knockingAt) : S.knocking}
            icon={st.knocking.wait ? Hourglass : Hand}
            size="sm"
            footer={
              <button type="button" onClick={cancelKnock} className="pbtn pbtn-secondary w-full">
                {S.cancel}
              </button>
            }
          >
            {st.knocking.wait ? (
              <>
                <p className="pnote text-sm phone:text-xs">{S.waitHint}</p>
                <p className="pmuted mt-1 text-xs">
                  {knockingAt} · {S.waitLeft(Math.ceil(knockLeft / 60))}
                </p>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="pmuted truncate">
                  {S.waiting} · {knockingAt}
                </span>
                <span className="num text-lg font-bold">{S.knockingSub(knockLeft)}</span>
              </div>
            )}
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

      {/* staff inside: the queue at the door */}
      {myQueue.length > 0 && !consoleOpen && <KnockQueue knocks={myQueue} now={now} phone={phone} left={talk && inConversation} />}

      {/* reception chat */}
      {reception.open && <ReceptionWindow phone={phone} onGo={go} />}

      {/* the office conversation */}
      {talk && inConversation && !reception.open && <ConversationWindow onClose={() => setTalk(false)} />}
    </div>
  );
}

/* ---------------- staff: the queue of knocks ---------------- */

function KnockQueue({ knocks, now, phone, left }: { knocks: IncomingKnock[]; now: number; phone: boolean; left: boolean }) {
  // the conversation window takes the right side: the queue moves to the left, under the profile chip
  return (
    <div className={left ? SIDE.replace("right-3", "left-3 top-28!").replace("phone:right-2", "phone:left-2") : SIDE}>
      <PaperCard title={S.queueTitle(knocks.length)} icon={Hand} size="sm" bodyClassName="max-h-[46vh] overflow-y-auto phone:max-h-[58vh] phone:p-2!">
        <div className="plist">
          {knocks.map((k) => (
            <div key={k.knockId} className="prow items-start! flex-col gap-2!">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="prow-title block truncate">{k.from.name}</span>
                  <span className="prow-sub block truncate">
                    {k.status === "waiting" ? S.asked : S.atYourDoor(officePlan(k.office)?.name ?? "")} · {S.waitingSince(Math.max(0, Math.round((now - k.since) / 1000)))}
                  </span>
                </span>
                {k.full && <span className="plabel shrink-0">{S.fullNote}</span>}
              </div>
              <div className="flex w-full gap-1.5">
                <button type="button" onClick={() => answerKnock(k.knockId, "decline")} className={`pbtn pbtn-danger flex-1 ${phone ? "min-h-9! px-2! text-xs!" : ""}`}>
                  {S.decline}
                </button>
                <button type="button" disabled={k.status === "waiting" && k.full} onClick={() => answerKnock(k.knockId, "wait")} className={`pbtn pbtn-secondary flex-1 ${phone ? "min-h-9! px-2! text-xs!" : ""}`}>
                  {S.pleaseWait}
                </button>
                <button type="button" disabled={k.full} onClick={() => answerKnock(k.knockId, "allow")} className={`pbtn pbtn-success flex-1 ${phone ? "min-h-9! px-2! text-xs!" : ""}`}>
                  {S.letIn}
                </button>
              </div>
            </div>
          ))}
        </div>
      </PaperCard>
    </div>
  );
}

/* ---------------- reception chat ---------------- */

function ReceptionWindow({ phone, onGo }: { phone: boolean; onGo: (office: string) => void }) {
  const r = useReception();
  const offices = useOffices((s) => s.offices);
  const [msg, setMsg] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [r.lines.length, r.pending]);
  const last = [...r.lines].reverse().find((l) => l.role === "reception");
  const hint = last?.officeHint ? offices.find((o) => o.id === last.officeHint) : undefined;
  const send = (text: string) => {
    // "Take me to the X" chips walk you there straight away (and still ask reception for the way)
    const t = text.trim();
    if (!t) return;
    setMsg("");
    void askReception(t);
  };
  return (
    <div className={SIDE}>
      <PaperCard
        title={S.receptionTitle}
        icon={ConciergeBell}
        size="sm"
        onClose={closeReception}
        closeLabel={S.close}
        bodyClassName="flex flex-col gap-2 phone:p-2!"
        footer={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(msg);
            }}
          >
            <label className="pfield flex-1 min-h-10!">
              <input value={msg} maxLength={300} onChange={(e) => setMsg(e.target.value)} placeholder={S.receptionPlaceholder} aria-label={S.receptionPlaceholder} />
            </label>
            <button type="submit" disabled={!msg.trim() || r.pending} className="pbtn pbtn-primary min-h-10! px-3!" aria-label={S.receptionSend}>
              <Send size={16} />
            </button>
          </form>
        }
      >
        <div className="flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto phone:max-h-[22vh]" aria-live="polite">
          {r.lines.map((l, i) => (
            <p key={i} className={`max-w-[88%] rounded-xl px-3 py-1.5 text-sm phone:text-xs ${l.role === "visitor" ? "self-end bg-[rgb(120_87_60/0.14)]" : "self-start bg-white/60"}`}>
              {l.text}
            </p>
          ))}
          {r.pending && (
            <p className="pmuted flex items-center gap-1.5 self-start text-xs">
              <Loader2 size={12} className="animate-spin" /> {S.receptionThinking}
            </p>
          )}
          <div ref={end} />
        </div>
        {hint && (
          <button type="button" onClick={() => onGo(hint.id)} className="pbtn pbtn-primary w-full min-h-10!">
            <Footprints size={16} /> {S.takeMeThere(hint.name)}
          </button>
        )}
        <div className="pseg flex-wrap gap-1.5!">
          {r.suggestions
            .filter((c) => !hint || c !== S.takeMeThere(hint.name))
            .slice(0, 3)
            .map((c) => (
            <button key={c} type="button" disabled={r.pending} onClick={() => send(c)} className="min-h-9! flex-none! px-3 text-xs">
              {c}
            </button>
          ))}
        </div>
        {!phone && <p className="pmuted text-[11px]">{S.receptionNote}</p>}
      </PaperCard>
    </div>
  );
}

/* ---------------- the office conversation: text + office-scoped voice ---------------- */

function ConversationWindow({ onClose }: { onClose: () => void }) {
  const st = useOffices();
  const you = useWorld((s) => s.you);
  const voice = useVoice();
  const [tab, setTab] = useState<"chat" | "people">("chat");
  const [msg, setMsg] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [st.chat.length, tab]);
  const name = st.inside ? (officePlan(st.inside)?.name ?? "") : "";
  const voiceOn = voice.status === "on";
  const toggleVoice = async () => {
    if (voiceOn) return disableVoice();
    if (await enableVoice()) setOpenMic(true);
  };
  return (
    <div className={SIDE}>
      <PaperCard
        title={S.conversation(name)}
        icon={MessagesSquare}
        size="sm"
        onClose={onClose}
        closeLabel={S.close}
        bodyClassName="flex flex-col gap-2 phone:p-2!"
        footer={
          tab === "chat" ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (sendOfficeChat(msg)) setMsg("");
              }}
            >
              <label className="pfield flex-1 min-h-10!">
                <input value={msg} maxLength={400} onChange={(e) => setMsg(e.target.value)} placeholder={S.chatPlaceholder} aria-label={S.chatPlaceholder} />
              </label>
              <button type="submit" disabled={!msg.trim()} className="pbtn pbtn-primary min-h-10! px-3!" aria-label={S.receptionSend}>
                <Send size={16} />
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => void toggleVoice()} className={`pbtn ${voiceOn ? "pbtn-secondary" : "pbtn-primary"} w-full`}>
              {voiceOn ? <MicOff size={16} /> : <Mic size={16} />} {voiceOn ? S.voiceOn : S.voiceOff}
            </button>
          )
        }
      >
        <div className="pseg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")} className="min-h-9! text-sm">
            {S.chatTab}
          </button>
          <button type="button" role="tab" aria-selected={tab === "people"} onClick={() => setTab("people")} className="min-h-9! text-sm">
            {S.peopleTab} · {st.members.length}
          </button>
        </div>
        {tab === "chat" ? (
          <div className="flex max-h-[32vh] flex-col gap-1 overflow-y-auto phone:max-h-[28vh]">
            {!st.chat.length && <p className="pnote text-xs">{S.chatEmpty}</p>}
            {st.chat.map((c, i) => (
              <p key={i} className="text-sm phone:text-xs">
                <b>{c.id === you ? S.you : c.name}:</b> {c.text}
              </p>
            ))}
            <div ref={end} />
          </div>
        ) : (
          <div className="plist max-h-[32vh] overflow-y-auto phone:max-h-[28vh]">
            {st.members.map((m) => (
              <div key={m.id} className="prow">
                <span className="prow-icon">{voice.talking[m.id] ? <Mic size={16} /> : <Users size={16} />}</span>
                <span className="prow-title min-w-0 flex-1 truncate">
                  {m.name}
                  {m.id === you ? ` (${S.you})` : ""}
                </span>
                <span className="plabel shrink-0">{m.staff ? S.staffLabel : S.visitorLabel}</span>
              </div>
            ))}
          </div>
        )}
      </PaperCard>
    </div>
  );
}
