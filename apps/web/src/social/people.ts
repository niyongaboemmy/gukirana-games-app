"use client";
import type * as THREE from "three";
import { ACT, PAIR_ACT, type PairKind } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { playEmote } from "@/lib/realtime";
import { ringPoint, SERVICE_ANGLE } from "@/world/layout";
import { LAMPS } from "@/world/obstacles";
import { seedOf } from "@/world/human/life";
import { actionById } from "./actions";
import { useSocial } from "./social-store";
import { selfContact } from "./motion";
import { stickyNearest } from "@/rooms/stability";
import { ACTIVITY_HOLD_MS, ACTIVITY_SPOTS, CAFE_FRONT_R, PLAZA_ACTIVITIES_ON } from "@/world/activities";

/**
 * The local person's actions (P1-WLD-02 / P1-COM-04): gestures that first turn towards the person they are for,
 * two-person contact actions (walk into place face to face, then the contact, both synced through the server),
 * context actions at places in the plaza (leaning on a lamp post or the café glass, a coffee at the café),
 * automatic social facing (turn to someone who stops next to you) and glances, plus the reaction after a game.
 * Called by the plaza controller (world/Player.tsx) after its own movement; halls use `hallLife` (no controller).
 */

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

interface MoveTo {
  from: { x: number; z: number; yaw: number };
  to: { x: number; z: number; yaw: number };
  t0: number;
  ms: number;
  /** what to do on arrival: an action code held for `holdMs` (0 = until you walk) */
  then: number;
  holdMs: number;
  pair?: { id: string; kind: PairKind; partner: string };
}

export const people = {
  /** turn to face (yaw) — gestures, social facing */
  face: null as null | { yaw: number; until: number },
  move: null as MoveTo | null,
  /** my contact partner while a pair action runs (no soft push between us) */
  partner: null as string | null,
  /** someone I look at (glance / speaker), world point */
  glance: { next: 0, until: 0, at: "" as string },
  lastStill: 0,
  faced: new Map<string, number>(),
  outcome: null as null | "win" | "loss" | "draw",
};

/** World position of another person (rendered pose, metres). */
function posOf(id: string): { x: number; z: number } | null {
  const p = useWorld.getState().players[id];
  return p ? { x: p.x / 100, z: p.z / 100 } : null;
}

function nearestPerson(x: number, z: number, max: number, skipSeated = true): string | null {
  const w = useWorld.getState();
  const seated = new Set(Object.values(w.seats));
  let best = max;
  let id: string | null = null;
  for (const p of Object.values(w.players)) {
    if (skipSeated && seated.has(p.id)) continue;
    const d = Math.hypot(p.x / 100 - x, p.z / 100 - z);
    if (d < best) {
      best = d;
      id = p.id;
    }
  }
  return id;
}

/** The volcanoes (Virunga chain) are north of the plaza: a photo turns that way. */
const VOLCANO_YAW = Math.PI;

/**
 * Play one of my actions: turn to the person it is for (or the nearest within 4 m), then play it; broadcast.
 * Returns false while the emote cooldown runs.
 */
export function doAction(id: number, to?: string): boolean {
  const def = actionById(id);
  const ms = def ? (def.ms || 10 * 60_000) : 2500;
  if (!playEmote(id, to, ms)) return false;
  const now = performance.now();
  if (id === ACT.photo) people.face = { yaw: VOLCANO_YAW, until: now + 900 };
  else if (def?.face) {
    const target = to ?? nearestPerson(selfPose.x, selfPose.z, 4);
    const p = target ? posOf(target) : null;
    if (p) people.face = { yaw: Math.atan2(p.x - selfPose.x, p.z - selfPose.z), until: now + 700 };
  }
  return true;
}

export function stopAction(): void {
  const e = useWorld.getState().emote;
  if (e) useWorld.getState().set({ emote: null });
}

// ------------------------------------------------------------------ contact actions (server-paired)

export function onPairStart(m: { id: string; kind: PairKind; a: { id: string; x: number; z: number; yaw: number }; b: { id: string; x: number; z: number; yaw: number }; alignMs: number; ms: number }) {
  const you = useWorld.getState().you;
  const me = m.a.id === you ? m.a : m.b.id === you ? m.b : null;
  if (!me) return;
  const partner = me === m.a ? m.b.id : m.a.id;
  stopAction();
  people.move = {
    from: { x: selfPose.x, z: selfPose.z, yaw: selfPose.yaw },
    to: { x: me.x, z: me.z, yaw: me.yaw },
    t0: performance.now(),
    ms: m.alignMs,
    then: PAIR_ACT[m.kind],
    holdMs: m.ms,
    pair: { id: m.id, kind: m.kind, partner },
  };
  people.partner = partner;
  useSocial.setState({ pairPending: null, pairInvite: null });
}

// ------------------------------------------------------------------ context places

export interface Spot {
  /** lean on a post / glass, a drink at the café, a drink of water, read the notice board, photo of the volcanoes */
  kind: "lean" | "coffee" | "water" | "board" | "photo";
  x: number;
  z: number;
  yaw: number;
}
/** Lamp posts: lean back against the post, facing the fountain. Café glass front: lean / take a coffee. */
export const SPOTS: Spot[] = (() => {
  const out: Spot[] = [];
  for (const l of LAMPS) {
    const r = Math.hypot(l.x, l.z);
    const ux = -l.x / r;
    const uz = -l.z / r;
    out.push({ kind: "lean", x: l.x + ux * 0.33, z: l.z + uz * 0.33, yaw: Math.atan2(ux, uz) });
  }
  const a = (SERVICE_ANGLE * Math.PI) / 180;
  const along = { x: Math.cos(a), z: Math.sin(a) };
  // coffee at the café front, then stand by it facing the plaza (people-watching, Whyte). (P2-WLD-09: the café
  // spots sat at r ≈ 27 m from the first, smaller plaza — 13 m out in the open in front of today's café; the two
  // "café glass" lean places there leaned on thin air and are gone: the lamp posts flanking the café remain.)
  const cafe = ringPoint(SERVICE_ANGLE, CAFE_FRONT_R);
  out.push({ kind: "coffee", x: cafe.x + along.x * 0.6, z: cafe.z + along.z * 0.6, yaw: -a });
  // plaza activities (P2-WLD-09): water point, notice board, volcano viewpoint
  if (PLAZA_ACTIVITIES_ON) {
    const A = ACTIVITY_SPOTS;
    out.push({ kind: "water", ...A.water }, { kind: "board", ...A.board }, { kind: "photo", ...A.photo });
  }
  return out;
})();

/**
 * Nearest context place within reach (for the HUD prompt), or null. Pass the place currently offered: it stays
 * offered until you are clearly out of reach (hysteresis, rooms/stability.ts), so the prompt never flashes on and off
 * while you stand at the edge of its range.
 */
export function nearSpot(x: number, z: number, current: Spot | null = null): Spot | null {
  const idx = stickyNearest(
    current ? String(SPOTS.indexOf(current)) : null,
    SPOTS.map((_, i) => String(i)),
    (i) => {
      const s = SPOTS[Number(i)]!;
      return Math.hypot(s.x - x, s.z - z);
    },
    SPOT_RANGE,
    0.35,
    0.25,
  );
  return idx == null ? null : SPOTS[Number(idx)]!;
}
const SPOT_RANGE = 1.8;

/** The action played on arrival at each kind of place, and for how long (0 = until you walk away). */
const SPOT_ACT: Record<Spot["kind"], { act: number; hold: number }> = {
  lean: { act: ACT.lean, hold: 0 },
  coffee: { act: ACT.coffee, hold: ACTIVITY_HOLD_MS.coffee },
  water: { act: ACT.coffee, hold: ACTIVITY_HOLD_MS.water }, // a cup filled at the tap, a few sips
  board: { act: ACT.watch, hold: ACTIVITY_HOLD_MS.board }, // standing reading the board
  photo: { act: ACT.photo, hold: ACTIVITY_HOLD_MS.photo },
};

/** Walk to a place and do its action there (lean: until you walk away; coffee: drink, facing the counter). */
export function goToSpot(s: Spot): void {
  const d = Math.hypot(s.x - selfPose.x, s.z - selfPose.z);
  stopAction();
  people.move = {
    from: { x: selfPose.x, z: selfPose.z, yaw: selfPose.yaw },
    to: { x: s.x, z: s.z, yaw: s.yaw },
    t0: performance.now(),
    ms: Math.max(450, (d / 1.15) * 1000 + 350),
    then: SPOT_ACT[s.kind].act,
    holdMs: SPOT_ACT[s.kind].hold,
  };
}

// ------------------------------------------------------------------ per-frame (plaza controller)

/**
 * Apply my person-level behaviour after movement + collisions. `manual` = the player is steering right now.
 * Overrides `pos` / `facing` / `anim` while walking into place or holding a contact action.
 */
export function applyPeople(pos: THREE.Vector3, facing: { current: number }, anim: { current: number }, dt: number, manual: boolean, still: boolean): void {
  const now = performance.now();
  selfContact.on = !!people.partner;
  const mv = people.move;
  if (mv && manual) {
    // walking away cancels whatever I was doing (and frees my partner's contact)
    people.move = null;
    people.partner = null;
    stopAction();
  } else if (mv) {
    const k = (now - mv.t0) / mv.ms;
    if (k < 1) {
      const e = ease(k);
      pos.x = mv.from.x + (mv.to.x - mv.from.x) * e;
      pos.z = mv.from.z + (mv.to.z - mv.from.z) * e;
      // face the way you walk, then turn into the final facing over the last third
      const walkYaw = Math.hypot(mv.to.x - mv.from.x, mv.to.z - mv.from.z) > 0.3 ? Math.atan2(mv.to.x - mv.from.x, mv.to.z - mv.from.z) : mv.to.yaw;
      const toYaw = k < 0.6 ? walkYaw : mv.to.yaw;
      facing.current += wrap(toYaw - facing.current) * Math.min(1, dt * 9);
      anim.current = 0;
    } else {
      pos.x = mv.to.x;
      pos.z = mv.to.z;
      facing.current += wrap(mv.to.yaw - facing.current) * Math.min(1, dt * 10);
      const hold = mv.holdMs || 10 * 60_000;
      if (now - mv.t0 - mv.ms < hold) {
        anim.current = mv.then;
        if (!mv.pair && !useWorld.getState().emote) useWorld.getState().set({ emote: { id: mv.then, until: Date.now() + hold } });
      } else {
        people.move = null;
        people.partner = null;
        if (mv.pair) anim.current = 0;
      }
    }
    return;
  }
  // a gesture turns me towards its target first (step-turn in place, ≤ 6 rad/s)
  const f = people.face;
  if (f) {
    if (now > f.until) people.face = null;
    else {
      const d = wrap(f.yaw - facing.current);
      facing.current += Math.sign(d) * Math.min(Math.abs(d), 6 * dt, Math.abs(d) * dt * 10);
    }
  }
  // social facing: someone stops right next to me while I stand idle → turn to them once (not seated, no action)
  if (still && !manual && !f && anim.current === 0) {
    if (!people.lastStill) people.lastStill = now;
    if (now - people.lastStill > 900) {
      const id = nearestPerson(pos.x, pos.z, 1.7);
      const p = id ? posOf(id) : null;
      if (id && p && now - (people.faced.get(id) ?? 0) > 12_000) {
        const yaw = Math.atan2(p.x - pos.x, p.z - pos.z);
        const tp = useWorld.getState().players[id];
        // only when they are still too (standing with me, not walking past)
        if (Math.abs(wrap(yaw - facing.current)) > 0.6 && tp && (tp.anim === 0 || tp.anim >= 10)) {
          people.face = { yaw, until: now + 900 };
          people.faced.set(id, now);
        }
      }
    }
  } else people.lastStill = 0;
}

/**
 * Where my head looks (local avatar): the nearest speaker within 6 m, else a glance at someone close by — for ~2 s
 * every 5–9 s at the nearest person within 3 m (seeded per person, same rule as everyone else's avatar).
 */
export function lookTarget(x: number, z: number, speaker: { x: number; z: number } | null, out: THREE.Vector3): THREE.Vector3 | null {
  if (speaker) return out.set(speaker.x, 1.6, speaker.z);
  if (people.partner) {
    const p = posOf(people.partner);
    if (p) return out.set(p.x, 1.6, p.z);
  }
  const now = performance.now();
  const g = people.glance;
  if (now > g.next) {
    const seed = seedOf(useWorld.getState().you ?? "me");
    g.next = now + 5000 + ((seed + Math.floor(now / 1000)) % 5) * 1000;
    g.until = now + 2000;
    g.at = nearestPerson(x, z, 3, false) ?? "";
  }
  if (now < g.until && g.at) {
    const p = posOf(g.at);
    if (p) return out.set(p.x, 1.55, p.z);
  }
  return null;
}

// ------------------------------------------------------------------ after a game

/** Called when a match ends (match/LiveMatch): the next time I'm back among people I react to it. */
export function rememberOutcome(o: "win" | "loss" | "draw"): void {
  people.outcome = o;
}
/** Back in a room after a match: celebrate a win, a disappointed head shake after a loss. */
export function reactToOutcome(): void {
  const o = people.outcome;
  if (!o) return;
  people.outcome = null;
  setTimeout(() => {
    if (o === "win") doAction(ACT.cheer);
    else if (o === "loss") doAction(ACT.disappointed);
    else doAction(ACT.shrug);
  }, 1800);
}

// ------------------------------------------------------------------ halls (the room controller owns movement)

const hall = { x: 0, z: 0, since: 0, watching: 0 as number, chalkAt: 0 };
/**
 * In a hall, standing still close to a table where people sit makes you a spectator: hands on hips, watching
 * (pool hall: now and then chalking a cue while you wait). Walking away ends it.
 */
export function hallLife(tables: { x: number; z: number; busy: boolean; pool: boolean }[]): void {
  const now = performance.now();
  const w = useWorld.getState();
  const moved = Math.hypot(selfPose.x - hall.x, selfPose.z - hall.z) > 0.25;
  if (moved) {
    hall.x = selfPose.x;
    hall.z = selfPose.z;
    hall.since = now;
    if (hall.watching && w.emote && (w.emote.id === ACT.watch || w.emote.id === ACT.chalk)) w.set({ emote: null });
    hall.watching = 0;
    return;
  }
  if (w.seats && Object.values(w.seats).includes(w.you ?? "")) return;
  if (w.emote && w.emote.until > Date.now() && w.emote.id !== ACT.watch && w.emote.id !== ACT.chalk) return;
  if (now - hall.since < 2000) return;
  let near: (typeof tables)[number] | null = null;
  for (const t of tables) if (t.busy && Math.hypot(t.x - selfPose.x, t.z - selfPose.z) < 2.6) near = t;
  if (!near) return;
  // only when roughly facing the table (you walked up to watch)
  const yaw = Math.atan2(near.x - selfPose.x, near.z - selfPose.z);
  if (Math.abs(wrap(yaw - selfPose.yaw)) > 1.1) return;
  if (!hall.watching) {
    hall.watching = now;
    hall.chalkAt = now + 9000 + (seedOf(w.you ?? "me") % 6000);
    w.set({ emote: { id: ACT.watch, until: Date.now() + 10 * 60_000 } });
  } else if (near.pool && now > hall.chalkAt) {
    hall.chalkAt = now + 16000;
    w.set({ emote: { id: ACT.chalk, until: Date.now() + 4200 } });
    setTimeout(() => {
      const e = useWorld.getState().emote;
      if (hall.watching && (!e || e.until <= Date.now())) useWorld.getState().set({ emote: { id: ACT.watch, until: Date.now() + 10 * 60_000 } });
    }, 4300);
  }
}
