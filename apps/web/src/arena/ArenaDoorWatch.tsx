"use client";
import { useEffect, useState } from "react";
import { CalendarClock, DoorClosed } from "lucide-react";
import { PORTALS, portalTransform } from "@/world/layout";
import { selfPose, useWorld } from "@/lib/world-store";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import { fetchArenaStatus, useArena } from "./arena-client";
import { ARENA_ON } from "./flags";
import { useDoorNotice } from "@/world/door-access";
import { A, denialText, scopeWords, whenWords } from "./strings";

/**
 * Plaza side of the arena door (P2-ARN-03): keeps GET /arena/status fresh while you are near the arena (the doors
 * open only when it says `canEnter`, world/Plaza AutoDoors), and at a shut door explains why in a small window,
 * with the next event. After an admin walked you out (arena-removed) it shows the notice once.
 */
export function ArenaDoorWatch() {
  const phone = usePhoneHud();
  // at the arena door, whatever way you face or however you got there (walking, tap-to-walk, Interact): GAP-004
  const near = useWorld((s) => s.nearDoor === "arena");
  const status = useArena((s) => s.status);
  const removed = useArena((s) => s.removed);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ARENA_ON) return;
    void fetchArenaStatus();
    const p = PORTALS.find((x) => x.id === "arena")!;
    const t = portalTransform(p);
    // refresh while you are within ~30 m of the door (every 20 s), at once when you walk up to it
    let last = performance.now();
    const id = setInterval(() => {
      const d = Math.hypot(selfPose.x - t.entryX, selfPose.z - t.entryZ);
      if (d < 30 && performance.now() - last > 20_000) {
        last = performance.now();
        void fetchArenaStatus();
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (near) void fetchArenaStatus();
    else setDismissed(false);
  }, [near]);
  // E / Interact at the shut door shows the card again
  const noticeAt = useDoorNotice((s) => s.at);
  useEffect(() => setDismissed(false), [noticeAt]);
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => useArena.setState({ removed: null }), 7000);
    return () => clearTimeout(t);
  }, [removed]);

  if (!ARENA_ON) return null;
  const shut = near && !dismissed && status && !status.canEnter;
  return (
    <>
      {removed && (
        <div role="status" className="gk-toast pointer-events-none fixed left-1/2 top-16 z-30 -translate-x-1/2 toast px-4 py-2 text-sm font-bold">
          {A.removed[removed]}
        </div>
      )}
      {shut && (
        <div role="status" data-door-notice="arena" className="pointer-events-auto fixed left-1/2 top-16 z-30 w-[min(360px,90vw)] -translate-x-1/2 phone:top-[46px] phone:w-[min(320px,46vw)]">
          <PaperCard title={status.denial === "BARRED" ? A.barredTitle : A.closedTitle} icon={DoorClosed} size="sm" onClose={() => setDismissed(true)} closeLabel={A.close}>
            <p className="pnote text-sm">{denialText(status.denial ?? "ARENA_CLOSED")}</p>
            <div className="plist mt-2">
              <div className="prow">
                <span className="prow-icon">
                  <CalendarClock size={phone ? 16 : 18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="prow-title block truncate">{status.next ? status.next.title : A.noEvent}</span>
                  {status.next && (
                    <span className="prow-sub block truncate">
                      {whenWords(status.next.startsAt)} · {scopeWords(status.next.rules)}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </PaperCard>
        </div>
      )}
    </>
  );
}
