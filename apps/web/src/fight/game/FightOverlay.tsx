"use client";
import { useEffect, useState } from "react";
import { useFightBridge } from "../bridge";
import { useFightControls } from "./controls";
import { FightHud } from "./FightHud";
import { TouchPads } from "./TouchPads";

/**
 * The fight overlay W mounts over the fight camera (FIGHT-GAMES-PLAN D1): the HUD plus the controls of every device,
 * shown while I am in a fight (practice or live). Touch pads appear on touch devices (or after the first touch).
 */
export function FightOverlay() {
  const mine = useFightBridge((s) => s.mine);
  const fighting = !!mine?.snap && mine.snap.phase !== "over";
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(pointer: coarse)").matches) setTouch(true);
    const on = () => setTouch(true);
    window.addEventListener("touchstart", on, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", on);
  }, []);
  useFightControls(fighting);
  if (!mine?.snap) return null;
  return (
    <div className="gk-fight-overlay pointer-events-none fixed inset-0 z-30 select-none">
      <FightHud />
      {touch && fighting && <TouchPads />}
    </div>
  );
}
