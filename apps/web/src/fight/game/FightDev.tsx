"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Swords } from "lucide-react";
import { DEFAULT_FIGHT_RULES, type FightRules, type RingId } from "@gukirana/contracts";
import { PaperCard } from "@/ui/PaperCard";
import { useFightBridge } from "../bridge";
import { startPractice, stopPractice } from "./actions";
import { FightOverlay } from "./FightOverlay";
import { ft } from "./strings";

/** the dev 3D ring (?scene=1), loaded only when asked for */
const RingLab = dynamic(() => import("./RingLab").then((m) => m.RingLab), { ssr: false });

/**
 * Dev test bed for the boxing HUD + controls in practice (no hall needed): a plain backdrop stands in for the 3D ring.
 * Query: `?level=1..5` preselects the AI, `?auto=1` starts at once, `?ring=R7` picks the ring id.
 */
export function FightDev() {
  const mine = useFightBridge((s) => s.mine);
  const [level, setLevel] = useState(3);
  const [ring, setRing] = useState<RingId>("R7");
  const [scene, setScene] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setScene(q.get("scene") === "1");
    const l = Number(q.get("level"));
    if (l >= 1 && l <= 5) setLevel(l);
    const r = q.get("ring");
    if (r && /^R\d+$/.test(r)) setRing(r as RingId);
    // dev: short fights for QA (`&rounds=1&secs=30`)
    const rounds = Number(q.get("rounds"));
    const secs = Number(q.get("secs"));
    const rules: FightRules | undefined = rounds || secs ? { ...DEFAULT_FIGHT_RULES, rounds: rounds || DEFAULT_FIGHT_RULES.rounds, roundSeconds: secs || DEFAULT_FIGHT_RULES.roundSeconds, restSeconds: 10 } : undefined;
    if (q.get("auto") === "1") startPractice((r as RingId) ?? "R7", l >= 1 && l <= 5 ? l : 3, q.get("name") ?? "Aline", rules);
    return () => stopPractice(true);
  }, []);
  return (
    <main
      data-fight-surface="1"
      className="fixed inset-0 bg-[radial-gradient(ellipse_at_50%_60%,#3a2f27_0%,#1a1714_55%,#0d0c0b_100%)]"
    >
      {!mine && (
        <div className="grid h-full place-items-center p-4">
          <div className="w-full max-w-sm">
            <PaperCard title={ft("dev.title")} icon={Swords}>
              <div className="flex flex-col gap-3">
                <div role="group" className="pseg">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-pressed={level === n} onClick={() => setLevel(n)} className="!min-h-10 !px-1 !text-sm">
                      {ft("dev.level", { n })}
                    </button>
                  ))}
                </div>
                <button type="button" className="pbtn pbtn-primary" onClick={() => startPractice(ring, level, "Aline")}>
                  {ft("dev.start")}
                </button>
              </div>
            </PaperCard>
          </div>
        </div>
      )}
      {scene && mine && <RingLab ring={mine.ring} />}
      <FightOverlay />
    </main>
  );
}
