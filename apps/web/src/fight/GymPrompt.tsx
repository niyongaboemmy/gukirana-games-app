"use client";
import { useEffect } from "react";
import { Armchair, Droplets, Dumbbell } from "lucide-react";
import { playEmote } from "@/lib/realtime";
import { ACT } from "@gukirana/contracts";
import { KeyHint, PROMPT_BTN, promptWrap } from "@/hud/Prompt";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { useRoom } from "@/rooms/room-store";
import { sitDown } from "@/rooms/RoomPlayer";
import { useSocial } from "@/social/social-store";
import { useFightBridge } from "./bridge";
import { actOnProp, useGymUi } from "./gym-life";
import { F } from "./strings";
import { useFightUi } from "./ui-store";

/**
 * The gym's own prompt (P3-FGT-04), over the Fight halls: at a heavy bag, the speed bag or the water station a short
 * cosmetic action ("just for fun: no Stars, no score"), at a spectator bench "Sit down". It stands aside for the ring
 * prompt, the door prompt and your own fight. E (or a tap) runs it.
 */
export function GymPrompt({ game }: { game: string }) {
  const prop = useGymUi((s) => s.prop);
  const nearSeat = useRoom((s) => s.nearSeat);
  const seated = useRoom((s) => s.seated);
  const nearExit = useRoom((s) => s.nearExit);
  const ring = useFightUi((s) => s.near);
  const inFight = useFightBridge((s) => !!s.mine);
  const chatOpen = useSocial((s) => s.chatOpen);
  const phone = usePhoneHud();
  // the watch bar has priority: no gym prompt while you watch a ring
  const watching = useFightBridge((s) => !!s.watched);
  const show = game === "boxing" && !nearExit && !ring && !inFight && !seated && !watching;
  const seat = show && !prop ? nearSeat : null;
  const act = () => {
    if (prop) {
      actOnProp(prop);
      if (prop.kind === "water") playEmote(ACT.coffee, undefined, 2200);
    } else if (seat) sitDown(seat);
  };
  useEffect(() => {
    if (!show || (!prop && !seat)) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!show || (!prop && !seat)) return null;
  const Icon = prop ? (prop.kind === "water" ? Droplets : Dumbbell) : Armchair;
  const label = prop
    ? prop.kind === "heavyBag"
      ? F.hitBag
      : prop.kind === "speedBag"
        ? F.hitSpeedBag
        : F.drink
    : F.sitDown;
  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
      <div className={promptWrap(chatOpen)}>
        <button type="button" onClick={act} className={PROMPT_BTN} title={prop ? F.gymNote : undefined}>
          <KeyHint />
          <Icon size={phone ? 16 : 20} /> {label}
        </button>
      </div>
    </div>
  );
}
