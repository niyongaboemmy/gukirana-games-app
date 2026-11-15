"use client";
import { useEffect, useState } from "react";
import { Bot, Camera, Eye, EyeOff, Loader2, LogOut, Swords, Timer, Trophy, X } from "lucide-react";
import { STAKES } from "@/lib/match-store";
import { useSession } from "@/lib/session";
import { useWorld } from "@/lib/world-store";
import { usePhoneHud } from "@/hud/usePhoneHud";
import { PaperCard } from "@/ui/PaperCard";
import { fightActions } from "./actions";
import { useFightBridge } from "./bridge";
import { ringState } from "./rings";
import { F } from "./strings";
import { useFightUi } from "./ui-store";
import { WatchResult } from "./game/WatchResult";

/**
 * The ring prompt (plan §7.2): what you can do at the ring you stand by, per status —
 *   free → Wait for an opponent (Friendly / stake chips) · Practice vs AI (level 1–5)
 *   waiting (mine) → Waiting for an opponent… Cancel · waiting (other) → Fight {name} · {stake}
 *   starting → Gloving up… · fighting / practice → Watch · result → the result card · closed → Ring closed
 * Buttons call `fightActions` (G's client; the mock logs + scripts them). Chocolate buttons only (paper.css).
 */
export function RingPrompt() {
  const near = useFightUi((s) => s.near);
  const watchCam = useFightUi((s) => s.watchCam);
  const watched = useFightBridge((s) => s.watched?.ring ?? null);
  const mine = useFightBridge((s) => !!s.mine);
  const entry = useFightBridge((s) => (near ? s.rings[near] : undefined));
  const ring = near ? (entry ?? ringState(near, {})) : null;
  const you = useWorld((s) => s.you);
  const authed = useSession((s) => s.status === "authenticated");
  const phone = usePhoneHud();
  const [stake, setStake] = useState(0);
  const [level, setLevel] = useState(2);
  const [open, setOpen] = useState<"wait" | "practice" | null>(null);
  useEffect(() => setOpen(null), [near]);
  // a fight is on for me: the fight HUD (fight/game) takes the screen
  if (mine) return null;
  if (!ring)
    return watched ? (
      <>
        <WatchBar ring={watched} cam={watchCam} />
        <WatchResult />
      </>
    ) : null;
  const id = ring.id;
  const isMine = (ring.red && ring.red.sid === you) || (ring.blue && ring.blue.sid === you);
  const btn = "pbtn phone:text-sm";
  const body = (() => {
    switch (ring.status) {
      case "free":
        if (open === "wait")
          return (
            <>
              <p className="plabel mb-1.5">{F.chooseStake}</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {STAKES.map((s) => (
                  <button key={s} type="button" aria-pressed={stake === s} onClick={() => setStake(s)} className={`${btn} ${stake === s ? "pbtn-primary" : "pbtn-secondary"} min-h-11 !px-3.5 !py-1.5`}>
                    {s === 0 ? F.friendly : F.stars(s)}
                  </button>
                ))}
              </div>
              <button type="button" className={`${btn} pbtn-primary w-full`} onClick={() => fightActions.claim(id, stake)}>
                <Swords size={18} /> {F.waitForOpponent}
              </button>
            </>
          );
        if (open === "practice")
          return (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5].map((l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)} className={`${btn} ${level === l ? "pbtn-primary" : "pbtn-secondary"} min-h-11 !px-3.5 !py-1.5`}>
                    {F.level(l)}
                  </button>
                ))}
              </div>
              <button type="button" className={`${btn} pbtn-primary w-full`} onClick={() => fightActions.practice(id, level)}>
                <Bot size={18} /> {F.practice}
              </button>
            </>
          );
        return (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`${btn} pbtn-primary`} onClick={() => (authed ? setOpen("wait") : setOpen("practice"))} disabled={!authed} title={authed ? undefined : F.denied.SIGN_IN_REQUIRED}>
              <Swords size={18} /> {F.waitForOpponent}
            </button>
            <button type="button" className={`${btn} pbtn-secondary`} onClick={() => setOpen("practice")}>
              <Bot size={18} /> {F.practice}
            </button>
            {!authed && <p className="pmuted col-span-2 text-xs">{F.denied.SIGN_IN_REQUIRED}</p>}
          </div>
        );
      case "waiting":
        if (isMine)
          return (
            <button type="button" className={`${btn} pbtn-secondary w-full`} onClick={() => fightActions.leave()}>
              <Loader2 size={18} className="animate-spin" /> {F.waitingMine} · {F.cancel}
            </button>
          );
        return (
          <button type="button" className={`${btn} pbtn-primary w-full`} onClick={() => fightActions.join(id)} disabled={!authed} title={authed ? undefined : F.denied.SIGN_IN_REQUIRED}>
            <Swords size={18} /> {F.fightThem(ring.red?.name ?? "", ring.stake ?? 0)}
          </button>
        );
      case "starting":
        return (
          <p className="pnote flex items-center gap-2 text-sm">
            <Timer size={16} /> {F.glovingUp}
          </p>
        );
      case "fighting":
      case "practice":
        return <WatchButtons id={id} watching={watched === id} />;
      case "result":
        return (
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Trophy size={16} /> {resultLine(ring)}
            </p>
            {isMine && (
              <button type="button" className={`${btn} pbtn-secondary mt-2 w-full`} onClick={() => fightActions.leave()}>
                <LogOut size={18} /> {F.stepOut}
              </button>
            )}
          </div>
        );
      case "closed":
        return <p className="pnote text-sm">{F.ringClosed}</p>;
    }
  })();
  const sub = ring.status === "waiting" || ring.status === "fighting" || ring.status === "starting" ? ` · ${ring.stake ? F.stars(ring.stake) : F.friendly}` : "";
  return (
    <div className="pointer-events-auto absolute bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 w-[min(420px,92vw)] -translate-x-1/2 phone:bottom-0 phone:w-[min(400px,54vw)]">
      <PaperCard
        size={phone ? "sm" : "md"}
        title={`${F.ring(id)} · ${F.status[ring.status]}${sub}`}
        icon={Swords}
        onBack={open ? () => setOpen(null) : undefined}
        headExtra={
          open ? (
            <button type="button" onClick={() => setOpen(null)} className="pcard-hbtn" aria-label={F.close}>
              <X size={16} />
            </button>
          ) : undefined
        }
        className="phone:max-h-[40vh] phone:rounded-b-none"
      >
        {(ring.red || ring.blue) && ring.status !== "free" && (
          <p className="pmuted mb-2 text-sm">
            {ring.red?.name ?? "—"} {F.vs} {ring.blue?.name ?? (ring.status === "practice" ? F.ai : "—")}
            {ring.score && ` · ${ring.score.red} – ${ring.score.blue}`}
          </p>
        )}
        {body}
      </PaperCard>
    </div>
  );
}

function resultLine(r: ReturnType<typeof ringState>) {
  const s = r.score ?? { red: 0, blue: 0 };
  if (s.red === s.blue) return F.draw(s.red, s.blue);
  const w = s.red > s.blue ? r.red?.name : r.blue?.name;
  return F.winnerBy(w ?? "", F.how.points!, Math.max(s.red, s.blue), Math.min(s.red, s.blue));
}

function WatchButtons({ id, watching }: { id: Parameters<typeof fightActions.watch>[0] & string; watching: boolean }) {
  const cam = useFightUi((s) => s.watchCam);
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className={`pbtn ${watching ? "pbtn-secondary" : "pbtn-primary"} phone:text-sm`} onClick={() => fightActions.watch(watching ? null : id)}>
        {watching ? <EyeOff size={18} /> : <Eye size={18} />} {watching ? F.stopWatching : F.watch}
      </button>
      <button
        type="button"
        className="pbtn pbtn-secondary phone:text-sm"
        disabled={!watching}
        onClick={() => useFightUi.getState().set({ watchCam: cam === "rail" ? "overhead" : cam === "overhead" ? null : "rail" })}
      >
        <Camera size={18} /> {cam === "rail" ? F.camOverhead : cam === "overhead" ? F.camBehind : F.camRail}
      </button>
    </div>
  );
}

/** watching from further away: a slim bar with the ring, the camera choice and Stop */
function WatchBar({ ring, cam }: { ring: NonNullable<ReturnType<typeof useFightBridge.getState>["watched"]>["ring"]; cam: "rail" | "overhead" | null }) {
  return (
    <div className="glass rounded-card pointer-events-auto absolute bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-2 px-3 py-2 text-sm">
      <Eye size={16} /> {F.watching(ring)}
      <button type="button" className="pbtn pbtn-secondary min-h-11 !px-3 !py-1 text-xs" onClick={() => useFightUi.getState().set({ watchCam: cam === "rail" ? "overhead" : cam === "overhead" ? null : "rail" })}>
        <Camera size={14} /> {cam === "rail" ? F.camOverhead : cam === "overhead" ? F.camBehind : F.camRail}
      </button>
      <button type="button" className="pbtn pbtn-secondary min-h-11 !px-3 !py-1 text-xs" onClick={() => fightActions.watch(null)}>
        <EyeOff size={14} /> {F.stopWatching}
      </button>
    </div>
  );
}
