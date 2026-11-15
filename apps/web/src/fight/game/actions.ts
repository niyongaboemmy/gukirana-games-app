"use client";
import type { BoxingAction, CornerRefreshResponse, FightRules, RingId } from "@gukirana/contracts";
import { api } from "@/lib/session";
import { createFairRng, newSeed } from "@gukirana/fairness";
import type { BotLevel } from "@gukirana/boxing";
import { useFightBridge } from "../bridge";
import { ASSIST_MAX_LEVEL, PracticeRunner, PracticeSession } from "./practice";
import { practiceHz, useFightPrefs } from "./prefs";
import { useFightUi, type PressFx } from "./ui-store";
import { useFightRating } from "./rating";
import { requireRules, withRules } from "@/rules/rules-store";

/**
 * The boxing game side of the ring prompts (FIGHT-GAMES-PLAN §7.2, §12 Do 5). W's prompts call these (through the
 * `fightActions` interface in apps/web/src/fight/actions.ts); practice is implemented here, the live calls are
 * forwarded to the hall-room / fight-room client that G2 registers from fight/game/net/ (`registerLiveFight`).
 */
export interface GameFightActions {
  /** wait for an opponent in a free ring (stake 0 = friendly) */
  claim(ring: RingId, stake: number): void;
  /** take the blue corner of a waiting ring */
  join(ring: RingId): void;
  /** step out of the ring I hold (waiting / practice / after the result); a live fight goes through the Leave dialog */
  leave(): void;
  quick(stake: number): void;
  quickCancel(): void;
  /** practice vs the AI in a free ring (local engine, no stake, never counted) */
  practice(ring: RingId, level: number): void;
  watch(ring: RingId | null): void;
}

/** what the live client (G2, fight/game/net/) plugs in. Every member is optional until it lands. */
export interface LiveFight {
  claim?(ring: RingId, stake: number): void;
  join?(ring: RingId): void;
  /** leave the ring / forfeit-or-void the live fight per exit rules (the server decides which) */
  leave?(): void;
  quick?(stake: number): void;
  quickCancel?(): void;
  watch?(ring: RingId | null): void;
  /** hall room: this ring is now my practice ring (status `practice`) */
  practiceStart?(ring: RingId): void;
  /** hall room: practice summary for spectators (`boxing-practice-score`) */
  practiceScore?(ring: RingId, round: number, score: [number, number]): void;
  /** live fight controls (`in` messages): one press (to the body?), guard held state, footwork held direction */
  press?(a: BoxingAction, body?: boolean): void;
  guard?(g: boolean): void;
  move?(mv: [number, number]): void;
}
let live: LiveFight = {};
/** G2: register the live client (call again with {} to unregister) */
export function registerLiveFight(impl: LiveFight): void {
  live = impl;
}

/* ------------------------------------------------------------ practice ------------------------------------------------------------ */

let session: PracticeSession | null = null;
let runner: PracticeRunner | null = null;
let unsubSpeed: (() => void) | null = null;

const clampLevel = (n: number): BotLevel => Math.min(5, Math.max(1, Math.round(n))) as BotLevel;

/** start (or restart) a practice fight in `ring` against the AI at `level` */
export function startPractice(ring: RingId, level: number, name = "", rules?: FightRules): PracticeSession {
  stopPractice(false);
  const seed = newSeed();
  // practice AI variety only; the fight itself has no randomness (plan §3.1)
  const rng = createFairRng(seed, [newSeed()], `practice-boxing-${ring}-${seed.slice(0, 8)}`);
  useFightUi.getState().clear();
  session = new PracticeSession({
    ring,
    level: clampLevel(level),
    rng,
    name,
    id: `practice-${ring}-${seed.slice(0, 12)}`,
    rules,
    onRoundEnd: (round, score) => live.practiceScore?.(ring, round, score),
  });
  runner = new PracticeRunner(session, practiceHz(useFightPrefs.getState().speed));
  // Easy mode: practice only (the live client has no assist path at all), and only against levels 1-2 (P3-FGT-10)
  session.assist = useFightPrefs.getState().assist && session.level <= ASSIST_MAX_LEVEL;
  runner.run();
  unsubSpeed = useFightPrefs.subscribe((p) => {
    runner?.setHz(practiceHz(p.speed));
    if (session) session.assist = p.assist && session.level <= ASSIST_MAX_LEVEL;
  });
  live.practiceStart?.(ring);
  return session;
}

/** end the practice fight; `clear` also removes it from the bridge (the player stepped out) */
export function stopPractice(clear = true): void {
  runner?.stop();
  unsubSpeed?.();
  unsubSpeed = null;
  runner = null;
  session = null;
  if (clear) {
    const mine = useFightBridge.getState().mine;
    if (mine?.mode === "practice") useFightBridge.setState({ mine: null, myEvents: [] });
    useFightUi.getState().clear();
  }
}
export const practiceSession = (): PracticeSession | null => session;
// dev QA handle: script practice states (knockdowns, endings) for screenshots
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") Object.assign(window as unknown as Record<string, unknown>, { __gkPractice: { session: () => session, input: () => fightInput, stores: { bridge: useFightBridge, ui: useFightUi, rating: useFightRating } } });

/* ------------------------------------------------------------ the corner refresh (P3-FGT-09) ------------------------------------------------------------ */

/** practice only and behind NEXT_PUBLIC_FF_FIGHT_BOOST (default off) */
export const BOOST_ON = process.env.NEXT_PUBLIC_FF_FIGHT_BOOST === "1";

/**
 * Buy a corner refresh for the current practice round: the API spends the Stars (ledger, idempotent per fight and
 * round); only once it confirms is the stamina added to the local practice engine. Never offered in a live fight.
 */
export async function buyCornerRefresh(): Promise<{ ok: true; stamina: number } | { ok: false }> {
  const mine = useFightBridge.getState().mine;
  const s = session;
  if (!BOOST_ON || !s || mine?.mode !== "practice" || !mine.snap) return { ok: false };
  const round = Math.max(1, mine.snap.round);
  try {
    const r = await api<CornerRefreshResponse>("/wallet/corner-refresh", { method: "POST", body: JSON.stringify({ mode: "practice", practiceId: s.id, round }) });
    if (session !== s) return { ok: false };
    s.cornerRefresh(r.stamina);
    return { ok: true, stamina: r.stamina };
  } catch {
    return { ok: false };
  }
}

/* ------------------------------------------------------------ controls → the fight ------------------------------------------------------------ */

/** every control (touch, keys, mouse, pad) ends here: the same presses for every device (plan §2.8) */
export const fightInput = {
  press(a: BoxingAction, via: PressFx["via"] = "key", body = false): void {
    const mine = useFightBridge.getState().mine;
    if (!mine) return;
    const ui = useFightUi.getState();
    ui.pressed(a, via);
    const snap = mine.snap;
    const me = snap?.fighters[mine.corner === "blue" ? 1 : 0];
    if (!snap || snap.phase !== "round") {
      // presses outside a round are dropped by the engine: say why instead of doing nothing
      ui.confirm("dropped");
      if (snap && (snap.phase === "countdown" || snap.phase === "intro" || snap.phase === "rest")) ui.hint("hud.waitBell");
    } else if (me && me.act !== "idle") ui.confirm("buffered");
    if (mine.mode === "practice") session?.pressAction(a, performance.now(), body);
    else live.press?.(a, body);
  },
  /** the held footwork direction [lateral +1 right, forward +1 towards the opponent] (every device) */
  move(mv: [number, number], _via: PressFx["via"] = "key"): void {
    void _via;
    const mine = useFightBridge.getState().mine;
    if (!mine) return;
    useFightUi.getState().setMove(mv);
    if (mine.mode === "practice") session?.setMove(mv);
    else live.move?.(mv);
  },
  guard(g: boolean, via: PressFx["via"] = "key"): void {
    const mine = useFightBridge.getState().mine;
    if (!mine) return;
    if (g) useFightUi.getState().pressed("guard", via);
    if (mine.mode === "practice") session?.setGuard(g);
    else live.guard?.(g);
  },
};

/* press feedback: confirmed once the engine shows the act, dropped when it never does (plan §3.3) */
if (typeof window !== "undefined") {
  useFightBridge.subscribe((b) => {
    const ui = useFightUi.getState();
    const p = ui.press;
    if (!p || p.a === "guard" || p.state === "confirmed" || p.state === "dropped" || !b.mine?.snap) return;
    const me = b.mine.snap.fighters[b.mine.corner === "blue" ? 1 : 0];
    if (me.act === p.a) ui.confirm("confirmed");
    else if (performance.now() - p.at > 650) ui.confirm("dropped");
  });
}

/* ------------------------------------------------------------ the prompts' actions ------------------------------------------------------------ */

export const gameFightActions: GameFightActions = {
  // P2-NET-05: a live fight needs the Boxing rules card accepted (the API refuses RULES_NOT_ACCEPTED otherwise)
  claim: (ring, stake) => withRules("boxing", () => live.claim?.(ring, stake)),
  join: (ring) => withRules("boxing", () => live.join?.(ring)),
  quick: (stake) => withRules("boxing", () => live.quick?.(stake)),
  quickCancel: () => live.quickCancel?.(),
  watch: (ring) => live.watch?.(ring),
  practice: (ring, level) => {
    startPractice(ring, level, useFightBridge.getState().mine?.names?.[0] ?? "");
    // P2-NET-05: the Boxing rules card once per rules version (informational for practice)
    void requireRules("boxing", "practice");
  },
  leave: () => {
    const mine = useFightBridge.getState().mine;
    if (mine?.mode === "practice") stopPractice(true);
    live.leave?.();
  },
};
