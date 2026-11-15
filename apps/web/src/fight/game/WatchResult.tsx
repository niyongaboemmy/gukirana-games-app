"use client";
import { useEffect, useState } from "react";
import type { BoxingOutcome } from "@gukirana/contracts";
import { useFightBridge } from "../bridge";
import { ResultPanel } from "./ResultPanel";
import { ft } from "./strings";

/**
 * Spectators see the same result card (P3-FGT-09): when the watched ring's fight ends, the neutral version of the
 * result panel (winner, method, every judge's card) shows over the watch view until closed. Same outcome object the
 * fighters see (the room relays the engine's `over` event).
 */
export function WatchResult() {
  const ring = useFightBridge((s) => s.watched?.ring ?? null);
  const over = useFightBridge((s) => s.watched?.events.findLast((e) => e.k === "over") ?? null);
  const rs = useFightBridge((s) => (ring ? s.rings[ring] : undefined));
  const [closed, setClosed] = useState<BoxingOutcome | null>(null);
  useEffect(() => setClosed(null), [ring]);
  if (!over || over.k !== "over" || closed === over.result) return null;
  const names: [string, string] = [rs?.red?.name || ft("hud.redCorner"), rs?.blue?.name || ft("hud.blueCorner")];
  return (
    <div className="pointer-events-auto">
      <ResultPanel result={over.result} me={null} names={names} stats={null} record={null} actions={{ leave: () => setClosed(over.result), leaveKey: "watch.close" }} />
    </div>
  );
}
