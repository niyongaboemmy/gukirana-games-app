import {
  DEFAULT_FIGHT_RULES,
  isPunch,
  type BoxingAction,
  type FightEvent,
  type FightInput,
  type FightRules,
  type RingId,
} from "@gukirana/contracts";
import {
  beginFight,
  boxingBotInput,
  createFight,
  fightStatsOf,
  hashFight,
  reachOf,
  isBusy,
  isTooTired,
  snapshotOf,
  stepFight,
  type BotLevel,
  type FightState,
} from "@gukirana/boxing";
import { useFightBridge } from "../bridge";
import { useFightUi } from "./ui-store";

/**
 * The practice fight record (P3-FGT-09): the SHA-256 of the final engine state (the same canonical state the live
 * room commits to in its signed stateHash), so the result card can show a checkable line for practice too.
 */
export async function practiceHash(state: FightState): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(`boxing:practice:v1:${hashFight(state)}`);
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
async function recordPractice(id: string, state: FightState): Promise<void> {
  // the skill report vs the AI (practice is never rated: no rating line)
  const [mine, theirs] = fightStatsOf(state);
  useFightUi.getState().setSkill({ mine, theirs });
  const hash = await practiceHash(state);
  useFightUi.getState().setRecord({ id, hash, kind: "practice" });
}

/**
 * Easy mode (P3-FGT-09), PRACTICE ONLY: client-side input help so the first fights work on the first try. It never
 * touches a live fight (the live client has no such path) and never changes the engine's rules — it only decides
 * which ordinary inputs to send, the same ones a player could press:
 *  - auto-guard: while I stand idle and the opponent's punch is on its way, the guard goes up (unless I am punching);
 *  - forgiving timing: a punch pressed while I am still busy waits (up to ASSIST_HOLD ticks) instead of being lost;
 *  - auto-close: a punch pressed out of range first steps in, then throws.
 */
export const ASSIST_HOLD = 15;
/** Easy mode is offered only against the first practice levels: it must never flatten the skill ladder (P3-FGT-10) */
export const ASSIST_MAX_LEVEL = 2;
export interface AssistPending {
  a: BoxingAction;
  age: number;
}
export function assistStep(s: FightState, i: 0 | 1, guardHeld: boolean, pending: AssistPending | null): { guard: boolean; send: BoxingAction | null; pending: AssistPending | null } {
  const me = s.fighters[i];
  const opp = s.fighters[1 - i]!;
  const idle = me.act === "idle";
  const incoming = isPunch(opp.act) && !opp.resolved;
  let send: BoxingAction | null = null;
  let next: AssistPending | null = pending;
  if (pending) {
    if (pending.age >= ASSIST_HOLD) next = null;
    else if (idle) {
      const reach = isPunch(pending.a) ? reachOf(pending.a, false) / 10 : Infinity;
      if (isPunch(pending.a) && s.dist > reach) {
        send = "stepIn";
        next = { a: pending.a, age: pending.age + 1 };
      } else {
        send = pending.a;
        next = null;
      }
    } else next = { a: pending.a, age: pending.age + 1 };
  }
  const guard = guardHeld || (idle && incoming && !send && !next);
  return { guard, send, pending: next };
}

/** the integer rng the practice bot needs (practice seeds it from @gukirana/fairness, tests with a fixed one) */
export interface PracticeRng {
  int(min: number, max: number): number;
}

/** gloving-up beat on the stool before the countdown (ticks at 30 Hz) */
export const GLOVE_UP_TICKS = 45;
/** at most this many of my fight's events wait in the bridge for the renderer */
const MAX_PENDING_EVENTS = 64;

/**
 * Practice vs the AI, run locally in the browser (FIGHT-GAMES-PLAN D10): the same engine and rules as a live fight,
 * no stake, never counted. The player is always fighter 0 (red corner). `tick()` is one 30 Hz engine step; the
 * wall-time pace (training speed) is the runner's business (`PracticeRunner`).
 */
export class PracticeSession {
  state: FightState;
  readonly ring: RingId;
  readonly level: BotLevel;
  private readonly rng: PracticeRng;
  private seq = 0;
  /** hold-to-guard: the guard starts down (the engine's default stance is guard up, so it is sent once) */
  private guard = false;
  private guardSent = false;
  private press: BoxingAction | null = null;
  private body = false;
  /** the held footwork direction; sent whenever it changes */
  private mv: [number, number] = [0, 0];
  private mvSent: [number, number] = [0, 0];
  /** Easy mode (practice only, P3-FGT-09): see assistStep */
  assist = false;
  private pending: AssistPending | null = null;
  private introLeft = GLOVE_UP_TICKS;
  private onRoundEnd?: (round: number, score: [number, number]) => void;
  /** the practice fight's id (fight record) */
  readonly id: string;
  private recorded = false;

  constructor(opts: {
    ring: RingId;
    level: BotLevel;
    rng: PracticeRng;
    name: string;
    rules?: FightRules;
    id?: string;
    onRoundEnd?: (round: number, score: [number, number]) => void;
  }) {
    this.ring = opts.ring;
    this.level = opts.level;
    this.rng = opts.rng;
    this.onRoundEnd = opts.onRoundEnd;
    this.id = opts.id ?? `practice-${opts.ring}`;
    const rules = opts.rules ?? DEFAULT_FIGHT_RULES;
    const fresh = createFight(["me", "ai"], rules);
    this.state = { ...fresh, fighters: [{ ...fresh.fighters[0], guard: false }, fresh.fighters[1]] };
    useFightBridge.setState({
      mine: {
        ring: opts.ring,
        corner: "red",
        mode: "practice",
        stake: 0,
        rules,
        snap: snapshotOf(this.state, opts.ring),
        predicted: null,
        names: [opts.name, ""],
        level: opts.level,
        begun: false,
        settled: null,
      },
      myEvents: [],
    });
  }

  get over(): boolean {
    return this.state.phase === "over";
  }

  /** a press from any control (keys, touch, pad). Starts my pose at once (prediction); the engine decides. */
  pressAction(a: BoxingAction, now = performance.now(), body = false): void {
    if (this.over) return;
    const me = this.state.fighters[0];
    if (isTooTired(me, a)) {
      useFightUi.getState().hint("hud.tooTired");
      return;
    }
    this.press = a;
    this.body = body;
    if (this.state.phase === "round" && !isBusy(me)) {
      const mine = useFightBridge.getState().mine;
      if (mine) useFightBridge.setState({ mine: { ...mine, predicted: { act: a, at: now } } });
    }
  }

  /**
   * The corner refresh (P3-FGT-09): adds stamina to MY fighter in this local practice engine. Called only after the
   * API confirmed the Stars spend (actions.ts buyCornerRefresh); practice only — a live fight has no such call.
   */
  cornerRefresh(stamina: number): void {
    if (this.over) return;
    const [me, ai] = this.state.fighters;
    this.state = { ...this.state, fighters: [{ ...me, stamina: Math.min(1000, me.stamina + Math.max(0, Math.trunc(stamina))) }, ai] };
    this.publish([]);
  }

  setMove(mv: [number, number]): void {
    this.mv = mv;
  }

  setGuard(g: boolean): void {
    this.guard = g;
  }
  get guardHeld(): boolean {
    return this.guard;
  }

  /** one engine tick: my input + the bot's, step, then write the bridge */
  tick(): void {
    if (this.over) return;
    if (this.state.phase === "intro") {
      if (--this.introLeft <= 0) this.state = beginFight(this.state);
      return;
    }
    let mine: FightInput | null = null;
    let press = this.press;
    let guard = this.guard;
    if (this.assist && this.state.phase === "round") {
      if (press) this.pending = { a: press, age: 0 };
      const st = assistStep(this.state, 0, this.guard, this.pending);
      press = st.send;
      guard = st.guard;
      this.pending = st.pending;
    }
    const mvChanged = this.mv[0] !== this.mvSent[0] || this.mv[1] !== this.mvSent[1];
    if (press || guard !== this.guardSent || mvChanged) {
      mine = { seq: this.seq++, g: guard, ...(mvChanged ? { mv: this.mv } : {}), ...(press ? { a: press } : {}), ...(press && this.body ? { b: true } : {}) };
      this.press = null;
      this.body = false;
      this.guardSent = guard;
      this.mvSent = this.mv;
    }
    const bot = boxingBotInput(this.state, 1, this.level, this.rng);
    this.state = stepFight(this.state, [mine, bot]);
    this.publish(this.state.events);
  }

  private publish(events: FightEvent[]): void {
    const b = useFightBridge.getState();
    if (!b.mine || b.mine.ring !== this.ring || b.mine.mode !== "practice") return;
    const snap = snapshotOf(this.state, this.ring);
    let predicted = b.mine.predicted;
    // prediction confirmed (the engine shows the act) or stale → drop it
    if (predicted && (snap.fighters[0].act === predicted.act || performance.now() - predicted.at > 300)) predicted = null;
    const begun = b.mine.begun || (this.state.round >= 1 && this.state.fighters.some((f) => f.acted));
    const myEvents = events.length ? [...b.myEvents, ...events].slice(-MAX_PENDING_EVENTS) : b.myEvents;
    useFightBridge.setState({ mine: { ...b.mine, snap, predicted, begun }, myEvents });
    if (events.length) useFightUi.getState().push(events);
    if (this.state.phase === "over" && !this.recorded) {
      this.recorded = true;
      void recordPractice(this.id, this.state);
    }
    for (const e of events) if (e.k === "roundEnd") this.onRoundEnd?.(e.round, e.points);
  }
}

/**
 * Wall-clock pace for a practice session: `hz` engine ticks per second (30 = normal, lower = training speed),
 * drift-corrected by tick count, at most 5 catch-up ticks per frame (a background tab doesn't fast-forward).
 */
export class PracticeRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private start = 0;
  private done = 0;
  constructor(
    readonly session: PracticeSession,
    private hz: number,
  ) {}

  run(): void {
    if (this.timer) return;
    this.start = performance.now();
    this.done = 0;
    this.timer = setInterval(() => this.frame(), Math.max(8, Math.floor(1000 / this.hz / 2)));
  }
  setHz(hz: number): void {
    if (hz === this.hz) return;
    this.hz = hz;
    if (this.timer) {
      this.stop();
      this.run();
    }
  }
  private frame(): void {
    const due = Math.floor(((performance.now() - this.start) * this.hz) / 1000) - this.done;
    const n = Math.min(5, due);
    for (let i = 0; i < n; i++) this.session.tick();
    this.done += due; // skipped ticks are dropped, not replayed later
    if (this.session.over) this.stop();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
