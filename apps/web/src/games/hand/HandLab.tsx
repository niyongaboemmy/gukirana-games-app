"use client";
import { useEffect, useRef, useState } from "react";
import { initLudo } from "@gukirana/ludo";
import { LudoBoard } from "../LudoBoard";
import { newFrame } from "./clips";
import { hands } from "./director";
import { HandOverlay } from "./HandOverlay";
import { POSES, type PoseName } from "./rig";
import type { HandLook } from "./look";

/**
 * Dev-only hand lab (/play/hand-lab, development builds): one pose held on a Ludo board, or a looping roll, for
 * tuning poses, skin and sleeves and for QA screenshots. Query: pose, u, v, h, side, pitch, roll, yaw, size, skin,
 * sleeve, color, anchor, anim=roll|sow.
 */
export default function HandLab() {
  const board = useRef<HTMLDivElement>(null);
  const [state] = useState(() => initLudo([{ id: "you", seat: 0 }, { id: "ai", seat: 2 }]));
  const [stats, setStats] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const num = (k: string, d: number) => (q.get(k) !== null ? Number(q.get(k)) : d);
    const el = board.current?.querySelector<HTMLElement>("[data-game-board]");
    if (!el) return;
    const look: HandLook = { skin: q.get("skin") ?? "#6E4530", sleeve: (q.get("sleeve") as HandLook["sleeve"]) ?? "rib", sleeveColor: q.get("color") ?? "#2F80ED" };
    const target = { board: el, side: (num("side", 0) * Math.PI) / 180, look, size: num("size", 0.27) };
    const anim = q.get("anim");
    let n = 0;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const roll = () => {
      n++;
      const key = n;
      hands.ludoGrab(target, { key, pickup: null, prevValue: ((n + 2) % 6) + 1 });
      timers.push(setTimeout(() => hands.ludoThrow(target, { key, value: (n % 6) + 1, rollId: n }), num("shake", 600)));
      timers.push(setTimeout(roll, num("every", 2600)));
    };
    if (anim === "roll") {
      roll();
      return () => timers.forEach(clearTimeout);
    }
    const f = newFrame();
    f.visible = true;
    f.u = num("u", 0.55);
    f.v = num("v", 0.62);
    f.h = num("h", 0.06);
    f.pitch = (num("pitch", 22) * Math.PI) / 180;
    f.roll = (num("roll", 0) * Math.PI) / 180;
    f.yaw = (num("yaw", 0) * Math.PI) / 180;
    f.anchor = q.get("anchor") === "pinch" ? "pinch" : "palm";
    f.seeds = num("seeds", 0);
    f.pose.set(POSES[(q.get("pose") as PoseName) ?? "relaxed"] ?? POSES.relaxed);
    if (q.get("die")) {
      f.die.visible = true;
      f.die.held = q.get("die") === "held";
      f.die.u = num("du", 0.5);
      f.die.v = num("dv", 0.5);
      f.die.h = 0.012;
    }
    const t = setTimeout(() => hands.still(target, f), 300);
    timers = [t];
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setStats(JSON.stringify((window as unknown as { __gkHandStats?: () => object }).__gkHandStats?.() ?? {})), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 flex flex-col bg-[radial-gradient(ellipse_at_top,#26282c_0%,#0b0b0c_70%)] p-4 text-white">
      <p data-hand-stats className="text-xs opacity-60">{stats}</p>
      <div ref={board} className="relative min-h-0 flex-1">
        <LudoBoard state={state} movable={[]} onMove={() => {}} myId="you" />
      </div>
      <div className="h-20" />
      <HandOverlay />
    </div>
  );
}
