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
import { bagPress, stopBagWork, toggleBagAuto, useBagControls, useBagWork } from "./bag-work";
import type { BagPunch } from "./bag-plan";
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
  const training = useBagWork((s) => !!s.prop);
  useBagControls();
  const show = game === "boxing" && !nearExit && !ring && !inFight && !seated && !watching && !training;
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
  if (game === "boxing" && training) return <BagPanel phone={phone} />;
  if (!show || (!prop && !seat)) return null;
  const Icon = prop ? (prop.kind === "water" ? Droplets : Dumbbell) : Armchair;
  const label = prop
    ? prop.kind === "heavyBag"
      ? F.hitBag
      : prop.kind === "speedBag"
        ? F.hitSpeedBag
        : prop.kind === "mirror"
          ? F.shadowBox
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

const PUNCHES = ["jab", "cross", "hook", "uppercut"] as const satisfies readonly BagPunch[];
/** bag work controls (P3-FGT-08): four punch buttons (thumb-sized on phones), auto combo, stop; the keys in a hint */
function BagPanel({ phone }: { phone: boolean }) {
  const auto = useBagWork((s) => s.auto);
  const btn = `chip pointer-events-auto grid place-items-center font-semibold select-none touch-none ${phone ? "size-14 rounded-full text-xs" : "h-11 min-w-20 rounded-xl px-3 text-sm"}`;
  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
      <div className={`absolute flex items-end gap-2 ${phone ? "bottom-4 right-24 flex-wrap justify-end max-w-[46vw]" : "bottom-24 left-1/2 -translate-x-1/2"}`}>
        {PUNCHES.map((p) => (
          <button key={p} type="button" className={btn} onPointerDown={(e) => (e.preventDefault(), bagPress(p))}>
            {F.bag[p]}
          </button>
        ))}
        <button type="button" className={`${btn} ${auto ? "border-l-primary-400/90" : ""}`} onClick={toggleBagAuto}>
          {auto ? F.bag.autoOn : F.bag.auto}
        </button>
        <button type="button" className={btn} onClick={stopBagWork}>
          {F.bag.stop}
        </button>
      </div>
      {!phone && <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-xs text-white/70">{F.bag.hint}</div>}
    </div>
  );
}
