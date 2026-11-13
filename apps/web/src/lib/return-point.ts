"use client";
import { selfPose } from "./world-store";

/**
 * Where the player was before a game, so closing the game puts them back exactly there
 * (same room + chair, or same spot in the plaza) instead of respawning. Session-scoped.
 */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}
export interface ReturnPoint extends Pose {
  path: string; // "/world" or "/room/<game>"
  seat?: string | null;
  at: number;
}

const GAME_KEY = "gk-return";
const WORLD_KEY = "gk-world-pose";
const TTL = 3 * 3600_000;

function read<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const v = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as (T & { at?: number }) | null;
    return v && (!v.at || Date.now() - v.at < TTL) ? v : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

/** Call right before opening a game (practice or live). */
export function rememberBeforeGame(seat?: string | null) {
  const path = typeof location !== "undefined" ? location.pathname : "/world";
  write(GAME_KEY, { path: path.startsWith("/room/") || path === "/world" ? path : "/world", seat: seat ?? null, x: selfPose.x, z: selfPose.z, yaw: selfPose.yaw, at: Date.now() } satisfies ReturnPoint);
}

/** Where "close / back" should go after a game. */
export const returnPath = () => read<ReturnPoint>(GAME_KEY)?.path ?? "/world";
export const returnLabel = () => (returnPath().startsWith("/room/") ? "Back to your table" : "Back to the plaza");

/** A room reads (and consumes) its pending return point on load. */
export function takeReturnFor(path: string): ReturnPoint | null {
  const r = read<ReturnPoint>(GAME_KEY);
  if (!r || r.path !== path) return null;
  try {
    window.sessionStorage.removeItem(GAME_KEY);
  } catch {
    /* ignore */
  }
  return r;
}

/** Set when the player walks through an arena door: the spot just outside that door must not be overwritten. */
let doorPoseLocked = false;

/** The plaza always remembers the last position (e.g. outside the door you walked into). */
export const saveWorldPose = () => {
  if (doorPoseLocked) return;
  write(WORLD_KEY, { x: selfPose.x, z: selfPose.z, yaw: selfPose.yaw, at: Date.now() });
};

/** Walking into a hall: come back just outside this door, facing the plaza. */
export function saveDoorPose(p: Pose) {
  write(WORLD_KEY, { ...p, fromDoor: true, at: Date.now() });
  doorPoseLocked = true;
}

export function takeWorldPose(): (Pose & { fromDoor?: boolean }) | null {
  doorPoseLocked = false;
  const game = read<ReturnPoint>(GAME_KEY);
  if (game?.path === "/world") {
    try {
      window.sessionStorage.removeItem(GAME_KEY);
    } catch {
      /* ignore */
    }
    return game;
  }
  const p = read<Pose & { fromDoor?: boolean }>(WORLD_KEY);
  if (p?.fromDoor) write(WORLD_KEY, { ...p, fromDoor: false }); // the step-out plays once
  return p;
}
