"use client";
import { useEffect, useState } from "react";
import { DoorOpen, Navigation, Users } from "lucide-react";
import { selfPose, useWorld } from "@/lib/world-store";
import { walkQueue } from "@/rooms/hall-hooks";
import { nav } from "@/world/navigation";
import { STATUS_LAMP } from "./assets-shim";
import { boxingRoute } from "./hooks";
import { RINGS, ringSteps, type RingPlace } from "./plan";
import { useRingCounts } from "./rings";
import { useFightUi } from "./ui-store";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import type { HallLayout } from "@/rooms/layouts";
import { useFightBridge } from "./bridge";
import { RingPrompt } from "./RingPrompt";
import { FightOverlay as GameFightOverlay } from "./game/FightOverlay";
import { F } from "./strings";
import { useFightFocus } from "./focus";

const glass = "glass rounded-card";

/** the free standard ring whose red steps are the shortest walk from where you stand (null: none free) */
function nearestFreeRing(): RingPlace | null {
  const rings = useFightBridge.getState().rings;
  let best: RingPlace | null = null;
  let bd = Infinity;
  for (const r of RINGS) {
    if (r.feature || (rings[r.id]?.status ?? "free") !== "free") continue;
    const f = ringSteps(r, "red");
    const d = Math.hypot(f.x - selfPose.x, f.z - selfPose.z);
    if (d < bd) [best, bd] = [r, d];
  }
  return best;
}

/**
 * Wayfinding (P3-FGT-04): how many rings are free, and one tap walks you along the aisles to the steps of the nearest
 * free ring, where its prompt (wait for an opponent / practice) appears. Shown in the Boxing hall's top bar.
 */
function FindRing({ phone }: { phone: boolean }) {
  const { free } = useRingCounts();
  const [going, setGoing] = useState<string | null>(null);
  const near = useFightUi((s) => s.near);
  useEffect(() => {
    if (!going) return;
    if (near === going) return void setGoing(null);
    // stopped or steered away (manual input clears the walk): drop the "walking to" label after a while
    const t = setTimeout(() => setGoing(null), 15000);
    return () => clearTimeout(t);
  }, [going, near]);
  const go = () => {
    const r = nearestFreeRing();
    if (!r) return;
    const legs = boxingRoute({ x: selfPose.x, z: selfPose.z }, ringSteps(r, "red"));
    walkQueue.legs = legs.slice(1);
    nav.goal = null;
    nav.target = legs[0] ?? null;
    setGoing(r.id);
  };
  return (
    <button
      type="button"
      onClick={go}
      disabled={free === 0}
      className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold disabled:opacity-60 phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}
      aria-label={F.findRing}
    >
      <span className="size-2.5 rounded-full" style={{ background: STATUS_LAMP.free }} />
      {going ? F.walkingTo(going) : phone ? F.ringsFree(free) : `${F.ringsFree(free)} · ${F.findRing}`}
      <Navigation size={phone ? 13 : 15} />
    </button>
  );
}

/**
 * Fight Games HUD over the lobby / the Boxing hall (P3-FGT-01): Leave + title + people, the arrival hint, the leave
 * prompt at the door and (Boxing hall) the ring prompt. Agent G's fight HUD + controls (fight/game) mount over this
 * while a fight is on.
 */
export function FightOverlay({ layout }: { layout: HallLayout }) {
  const { nearExit, leaving } = useRoom();
  const others = useWorld((s) => Object.keys(s.players).length);
  const chatOpen = useSocial((s) => s.chatOpen);
  const phone = usePhoneHud();
  const mock = useFightBridge((s) => s.mock);
  const fighting = useFightBridge((s) => !!s.mine?.snap && s.mine.snap.phase !== "over");
  const inRing = useFightBridge((s) => !!s.mine);
  // focus mode: the hall HUD (profile, joystick, chat, emotes, quick match) gives the screen to the fight
  const focused = useFightFocus((s) => s.dim && s.mode === "fighter") || inRing;
  useEffect(() => {
    if (!focused) return;
    // a focused text field (chat) would swallow the fight keys
    const a = document.activeElement as HTMLElement | null;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur();
    if (useSocial.getState().chatOpen) useSocial.setState({ chatOpen: false });
  }, [focused]);
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, []);
  const boxing = layout.game === "boxing";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      const r = useRoom.getState();
      if (r.nearExit) r.set({ leaving: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="gk-fight-root pointer-events-none fixed inset-0 z-20 text-white" data-focus={focused ? "1" : undefined}>
      {focused && (
        <style>{`.gk-hud-in > :not(.gk-fight-root){opacity:0!important;pointer-events:none!important;transition:opacity .35s ease}`}</style>
      )}
      {!focused && (
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap phone:top-2 phone:gap-1.5">
        {!fighting && (
          <button
            type="button"
            onClick={() => useRoom.getState().set({ leaving: true })}
            disabled={leaving}
            className={`${glass} icon-button pointer-events-auto flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold disabled:opacity-60 phone:rounded-full phone:px-2.5 phone:py-1.5 phone:text-xs`}
          >
            <DoorOpen size={phone ? 14 : 16} /> {leaving ? F.leaving : F.leave}
          </button>
        )}
        <div className={`${glass} flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-bold phone:rounded-full phone:px-3 phone:py-1.5 phone:text-xs`}>
          <span className="size-2.5 rounded-full" style={{ background: layout.color }} />
          {layout.title}
          <span className="flex items-center gap-1 font-semibold text-on-glass-muted">
            <Users size={14} /> {F.people(others + 1)}
          </span>
        </div>
        {boxing && !inRing && <FindRing phone={phone} />}
      </div>
)}
      {mock && !focused && <div className={`${glass} absolute right-3 top-3 px-3 py-1.5 text-xs text-on-glass-muted phone:hidden`}>{F.mockNote}</div>}
      {hint && !focused && (
        <div className={`${glass} absolute left-1/2 top-16 -translate-x-1/2 px-4 py-2.5 text-center text-sm phone:top-[46px] phone:whitespace-nowrap phone:rounded-full phone:px-3 phone:py-1 phone:text-xs`}>
          <p className="font-bold phone:hidden">{boxing ? F.hallWelcome : F.lobbyWelcome}</p>
          <p className="text-on-glass-muted">{boxing ? F.hallSub : F.lobbySub}</p>
        </div>
      )}
      {nearExit && !leaving && !fighting && (
        <div className={promptWrap(chatOpen)}>
          <button type="button" onClick={() => useRoom.getState().set({ leaving: true })} className={PROMPT_BTN}>
            <KeyHint />
            <DoorOpen size={phone ? 16 : 20} /> {boxing ? F.toLobby : F.toPlaza}
          </button>
        </div>
      )}
      {boxing && !nearExit && <RingPrompt />}
      {boxing && inRing && <GameFightOverlay />}
    </div>
  );
}
