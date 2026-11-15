"use client";
import { useEffect, useState } from "react";
import { useFightBridge } from "../bridge";
import { crowdStart, crowdStop, hushVoices } from "./audio";
import { useFightControls } from "./controls";
import { FightHud } from "./FightHud";
import { useFightPrefs } from "./prefs";
import { TouchPads } from "./TouchPads";
import { Tutorial } from "./Tutorial";

/**
 * The fight overlay W mounts over the fight camera (FIGHT-GAMES-PLAN D1): the HUD plus the controls of every device,
 * shown while I am in a fight (practice or live). Touch pads appear on touch devices (or after the first touch); the
 * first fight shows the tutorial; the crowd murmurs while the fight is on.
 */
export function FightOverlay() {
  const mine = useFightBridge((s) => s.mine);
  const fighting = !!mine?.snap && mine.snap.phase !== "over";
  const inFight = !!mine?.snap;
  const [touch, setTouch] = useState(false);
  const crowdOn = useFightPrefs((s) => s.crowd && s.sound);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(pointer: coarse)").matches) setTouch(true);
    const on = () => setTouch(true);
    window.addEventListener("touchstart", on, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", on);
  }, []);
  useEffect(() => {
    if (!inFight || !crowdOn) return;
    crowdStart();
    return () => crowdStop();
  }, [inFight, crowdOn]);
  useEffect(() => () => hushVoices(), []);
  useFightControls(fighting);
  if (!mine?.snap) return null;
  return (
    <div className="gk-fight-overlay pointer-events-none fixed inset-0 z-30 select-none" data-fight-surface-overlay="1">
      <FightHud />
      {touch && fighting && <TouchPads />}
      {fighting && mine.snap.phase !== "knockdown" && <Tutorial touch={touch} />}
    </div>
  );
}
