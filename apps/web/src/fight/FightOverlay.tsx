"use client";
import { useEffect, useState } from "react";
import { DoorOpen, Users } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import type { HallLayout } from "@/rooms/layouts";
import { useFightBridge } from "./bridge";
import { RingPrompt } from "./RingPrompt";
import { F } from "./strings";

const glass = "glass rounded-card";

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
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
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
      </div>
      {mock && <div className={`${glass} absolute right-3 top-3 px-3 py-1.5 text-xs text-on-glass-muted phone:hidden`}>{F.mockNote}</div>}
      {hint && (
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
    </div>
  );
}
