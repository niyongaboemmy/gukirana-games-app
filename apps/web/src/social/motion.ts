"use client";
import { isContactAction, PLAZA_SEATS, type SeatPose } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";

/**
 * Remote people's motion (P1-WLD-02): snapshot interpolation with a small adaptive delay, short extrapolation,
 * shortest-arc turning, seated poses snapped to the real chair / bench, and soft separation so rendered people
 * never stand inside each other. Everything here is non-reactive (plain maps) and runs once per frame.
 */
interface Snap {
  t: number;
  x: number;
  z: number;
  yaw: number;
}
export interface Track {
  snaps: Snap[];
  anim: number;
  /** smoothed time between updates for this person (ms) — far people arrive less often (interest tiers) */
  interval: number;
  last: number;
  /** rendered pose */
  x: number;
  z: number;
  yaw: number;
  /** separation offset (m), eased */
  ox: number;
  oz: number;
  seated: boolean;
  /** seated blend 0..1 (walk up to the seat, then sit) */
  sit: number;
  emote: { id: number; until: number } | null;
  /** distance to the local player (m), refreshed every frame */
  dist: number;
  /** 0 … 1 visibility: fades in on arrival (no pop at doors) */
  fade: number;
  /** until this time (ms) the newest pose is used directly (standing up from a bench: no interpolation glide) */
  direct: number;
}

/** Someone who just left (through a door): keeps walking a few steps while fading out, then disappears. */
export interface Ghost {
  id: string;
  name: string;
  level: number;
  color: string;
  look?: string;
  bodyType?: string;
  uid?: string;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  t0: number;
  fade: number;
}
export const ghosts = new Map<string, Ghost>();
const GHOST_MS = 1300;
const FADE_IN_S = 0.4;

export const tracks = new Map<string, Track>();

const TELEPORT_M = 6;
const MIN_DELAY = 90;
const MAX_DELAY = 480;
const EXTRAPOLATE_MS = 220;
/** standing people keep a little more than shoulder-to-shoulder distance (soft, eased) */
const PERSONAL_SPACE = 0.8;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (y16: number) => (y16 / 65535) * Math.PI * 2;

export function trackOf(id: string): Track {
  let t = tracks.get(id);
  if (!t) {
    const p = useWorld.getState().players[id];
    const x = (p?.x ?? 0) / 100;
    const z = (p?.z ?? 0) / 100;
    const yaw = yawOf(p?.yaw ?? 0);
    t = { snaps: [], anim: p?.anim ?? 0, interval: 100, last: 0, x, z, yaw, ox: 0, oz: 0, seated: false, sit: 0, emote: null, dist: 99, fade: 0, direct: 0 };
    tracks.set(id, t);
  }
  return t;
}

/** A pose update from the server (x/z in cm, yaw 0–65535). */
export function pushPose(id: string, xcm: number, zcm: number, y16: number, anim: number, now = performance.now()): void {
  const t = trackOf(id);
  const x = xcm / 100;
  const z = zcm / 100;
  const prev = t.snaps[t.snaps.length - 1];
  if (prev && Math.hypot(x - prev.x, z - prev.z) > TELEPORT_M) {
    // a real jump (door, respawn): no sliding across the plaza
    t.snaps = [];
    t.x = x;
    t.z = z;
  }
  const gap = now - t.last;
  if (t.last && gap > 20 && gap < 2000) t.interval += (gap - t.interval) * 0.25;
  t.last = now;
  t.snaps.push({ t: now, x, z, yaw: yawOf(y16) });
  if (t.snaps.length > 12) t.snaps.splice(0, t.snaps.length - 12);
  t.anim = anim;
}

export function setEmote(id: string, emote: number, ms = 2500): void {
  trackOf(id).emote = { id: emote, until: Date.now() + ms };
}

export function dropTrack(id: string): void {
  tracks.delete(id);
}

/**
 * A person left: if they were walking (out through a door), keep them walking on for a moment while they fade,
 * instead of vanishing mid-step. Call before the player entry is removed.
 */
export function ghostOf(id: string, now = performance.now()): void {
  const t = tracks.get(id);
  const p = useWorld.getState().players[id];
  if (!t || !p || t.dist > 40) return;
  const s = t.snaps;
  let vx = 0;
  let vz = 0;
  if (s.length >= 2) {
    const a = s[s.length - 2]!;
    const b = s[s.length - 1]!;
    const dt = Math.max(1, b.t - a.t) / 1000;
    vx = (b.x - a.x) / dt;
    vz = (b.z - a.z) / dt;
    const v = Math.hypot(vx, vz);
    // keep a calm walking pace (1.35 m/s) in the direction they were going; standing people just fade
    if (v > 0.4) {
      vx = (vx / v) * 1.35;
      vz = (vz / v) * 1.35;
    } else vx = vz = 0;
  }
  ghosts.set(id, { id, name: p.name, level: p.level, color: p.color, look: p.look, bodyType: p.bodyType, uid: p.uid, x: t.x + t.ox, z: t.z + t.oz, yaw: t.yaw, vx, vz, t0: now, fade: t.fade });
}

/** Interpolated (or briefly extrapolated) raw pose at `now`. */
function sample(t: Track, now: number): { x: number; z: number; yaw: number } {
  const s = t.snaps;
  if (s.length === 0) return { x: t.x, z: t.z, yaw: t.yaw };
  const delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, t.interval * 1.6));
  const rt = now - delay;
  const first = s[0]!;
  if (rt <= first.t || s.length === 1) return first;
  for (let i = 1; i < s.length; i++) {
    const b = s[i]!;
    if (rt <= b.t) {
      const a = s[i - 1]!;
      const k = (rt - a.t) / Math.max(1, b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + wrap(b.yaw - a.yaw) * k };
    }
  }
  // past the newest snapshot: continue the last velocity for a moment, then hold
  const b = s[s.length - 1]!;
  const a = s[s.length - 2]!;
  const over = Math.min(EXTRAPOLATE_MS, rt - b.t);
  const dt = Math.max(1, b.t - a.t);
  return { x: b.x + ((b.x - a.x) / dt) * over, z: b.z + ((b.z - a.z) / dt) * over, yaw: b.yaw };
}

/** Seat transform for a seat id: plaza benches (shared list) or the current hall's chairs. */
let hallSeats: readonly SeatPose[] = [];
export function setHallSeats(seats: readonly SeatPose[]): void {
  hallSeats = seats;
}
const HALL_SEAT_BACK = 0.08; // same as the local controller: sit slightly back on the chair
export function seatPose(id: string): SeatPose | undefined {
  if (id.startsWith("b")) return PLAZA_SEATS.find((s) => s.id === id);
  const s = hallSeats.find((h) => h.id === id);
  return s && { id: s.id, x: s.x - Math.sin(s.yaw) * HALL_SEAT_BACK, z: s.z - Math.cos(s.yaw) * HALL_SEAT_BACK, yaw: s.yaw };
}

/**
 * Per-frame update of every remote person (call once per frame, before the avatars read their pose):
 * sample → seat snap → soft separation → write the rendered pose back into the world store (in place).
 */
export function stepMotion(dt: number, now = performance.now()): void {
  const w = useWorld.getState();
  const seatOf = new Map<string, string>();
  for (const [seat, sid] of Object.entries(w.seats)) seatOf.set(sid, seat);
  const list: [string, Track][] = [];
  for (const id of Object.keys(w.players)) {
    const t = trackOf(id);
    const raw = sample(t, now);
    const seatId = seatOf.get(id);
    const pose = seatId ? seatPose(seatId) : undefined;
    const bench = !!seatId && seatId.startsWith("b");
    // just stood up from a bench: follow their own staged stand-up exactly for a moment (no interpolation glide)
    if (t.seated && !pose && t.snaps.length) t.direct = now + 1600;
    t.seated = !!pose;
    t.sit += ((pose ? 1 : 0) - t.sit) * Math.min(1, dt * 6);
    t.fade = Math.min(1, t.fade + dt / FADE_IN_S);
    if (pose) {
      // plaza benches: they walked up, turned and stepped back to the bench themselves, so the origin goes straight
      // to the seat and the sit-down clip carries the body onto it; hall chairs: glide onto the chair
      const k = bench || t.sit > 0.98 ? 1 : Math.min(1, dt * 8);
      t.x += (pose.x - t.x) * k;
      t.z += (pose.z - t.z) * k;
      t.yaw += wrap(pose.yaw - t.yaw) * k;
    } else if (now < t.direct) {
      const n = t.snaps[t.snaps.length - 1]!;
      t.x = n.x;
      t.z = n.z;
      t.yaw += wrap(n.yaw - t.yaw) * Math.min(1, dt * 14);
    } else {
      t.x = raw.x;
      t.z = raw.z;
      t.yaw += wrap(raw.yaw - t.yaw) * Math.min(1, dt * 12);
    }
    list.push([id, t]);
  }
  // soft separation between standing people (and from me), eased so it never jitters
  for (let i = 0; i < list.length; i++) {
    const [, a] = list[i]!;
    let px = 0;
    let pz = 0;
    // people in a hug / handshake / fist bump stand close on purpose
    if (!a.seated && !isContactAction(a.anim)) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const b = list[j]![1];
        if (isContactAction(b.anim)) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < PERSONAL_SPACE && d > 1e-4) {
          const push = (PERSONAL_SPACE - d) * (b.seated ? 1 : 0.5);
          px += (dx / d) * push;
          pz += (dz / d) * push;
        }
      }
      const dx = a.x - selfPose.x;
      const dz = a.z - selfPose.z;
      const d = Math.hypot(dx, dz);
      if (d < PERSONAL_SPACE && d > 1e-4 && !selfContact.on) {
        px += (dx / d) * (PERSONAL_SPACE - d);
        pz += (dz / d) * (PERSONAL_SPACE - d);
      }
    }
    const k = Math.min(1, dt * 6);
    a.ox += (px - a.ox) * k;
    a.oz += (pz - a.oz) * k;
  }
  for (const [id, t] of list) {
    const p = w.players[id];
    const rx = t.x + t.ox;
    const rz = t.z + t.oz;
    t.dist = Math.hypot(rx - selfPose.x, rz - selfPose.z);
    if (p) {
      // in place on purpose: proximity / voice / collision code reads these via getState(), React never re-renders
      p.x = Math.round(rx * 100);
      p.z = Math.round(rz * 100);
    }
  }
}

/** The local player is in a contact action (set by the controller): no soft push from / towards me. */
export const selfContact = { on: false };

/** Ghosts: walk on and fade; returns true while any are left. */
export function stepGhosts(dt: number, now = performance.now()): void {
  for (const [id, g] of ghosts) {
    const age = now - g.t0;
    g.x += g.vx * dt;
    g.z += g.vz * dt;
    g.fade = Math.max(0, g.fade - dt / 0.45 * (age > 350 ? 1 : 0.3));
    if (age > GHOST_MS || g.fade <= 0 || useWorld.getState().players[id]) ghosts.delete(id);
  }
}

/** Rendered pose (with separation) for an avatar group. */
export function renderPose(id: string): { x: number; z: number; yaw: number; anim: number; seated: boolean } | null {
  const t = tracks.get(id);
  if (!t) return null;
  const emote = t.emote && t.emote.until > Date.now() ? t.emote.id : 0;
  // seated comes from the server's seat map (authoritative); emotes from the sender's pose or the emote event
  const anim = t.seated ? 13 : t.anim === 13 ? 0 : t.anim >= 10 ? t.anim : emote && t.anim === 0 ? emote : t.anim;
  return { x: t.x + t.ox, z: t.z + t.oz, yaw: t.yaw, anim, seated: t.seated };
}
