import { create } from "zustand";
import type { BoxingSnapshot, Corner, FightEvent, FightRules, RingId, RingState } from "@gukirana/contracts";

/**
 * The ONE seam between the Boxing world (Agent W: hall, rings, fighters' 3D motion, kit, fight camera) and the boxing
 * game client (Agent G: hall-room ring messages, fight room, controls, HUD, practice engine). P3-FGT-01,
 * docs/FIGHT-GAMES-PLAN.md §6.
 *
 *  - G WRITES it (from the hall room `boxing-*` messages, the fight room snapshots, the local practice engine);
 *  - W READS it every frame (status lights, kit, ring fighters' poses, fight camera) and writes only `mock`;
 *  - until G lands, W's mock (fight/mock.ts) fills it so the hall can be built and screenshotted on its own.
 * Changing this shape needs both agents (note it in the plan); add fields, never repurpose them.
 */

/** the fight the local player is in (live or practice), as the 3D side needs it */
export interface MyFight {
  ring: RingId;
  corner: Corner;
  mode: "live" | "practice";
  stake: number;
  rules: FightRules;
  /** latest authoritative (live) or local-engine (practice) snapshot */
  snap: BoxingSnapshot | null;
  /**
   * presentation-only prediction of my own press (starts the pose at once; the next snapshot corrects it).
   * `at` = performance.now() of the press.
   */
  predicted: { act: BoxingSnapshot["fighters"][number]["act"]; at: number } | null;
}

export interface FightBridge {
  /** ring registry of this Boxing hall instance (keyed by ring id) */
  rings: Partial<Record<RingId, RingState>>;
  /** spectator frame of the ring being watched (hall room relay), with its latest events */
  watched: { ring: RingId; snap: BoxingSnapshot | null; events: FightEvent[] } | null;
  mine: MyFight | null;
  /** events of my fight since the renderer last drained them (hit flashes, bell, count) */
  myEvents: FightEvent[];
  /** true while W's mock drives the bridge (dev / screenshots); G's client never runs at the same time */
  mock: boolean;
}

export const useFightBridge = create<FightBridge>()(() => ({
  rings: {},
  watched: null,
  mine: null,
  myEvents: [],
  mock: false,
}));

/** renderer side: take the pending events of my fight (each one is shown once) */
export function drainMyEvents(): FightEvent[] {
  const ev = useFightBridge.getState().myEvents;
  if (ev.length) useFightBridge.setState({ myEvents: [] });
  return ev;
}
