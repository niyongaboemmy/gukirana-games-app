"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { NEARBY_CHAT_RANGE } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { useProfile } from "@/lib/profile-store";
import { nav } from "@/world/navigation";
import { headTop, tagHover } from "@/world/Avatar";
import { tracks } from "./motion";
import { SpeechBubble } from "./RemotePlayers";
import { useSocial } from "./social-store";
import { doAction, goToSpot, reactToOutcome, SPOTS } from "./people";
import { requestPair } from "@/lib/realtime";
import { sitNearest, sitOnBench, standFromBench } from "./bench";
import { useRoom } from "@/rooms/room-store";

/**
 * Social layer inside the 3D canvas (plaza + halls):
 * - tap / click a person (body or name tag, generous hit area on touch) → person menu; right-click too (desktop);
 *   hovering a person shows a pointer cursor;
 * - my own speech bubble;
 * - "N nearby" count for the HUD.
 * Picking is a ray vs. upright-capsule test against the rendered poses (cheap for 50 people, no meshes needed).
 */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const P = new THREE.Vector3();
const Q = new THREE.Vector3();

/** Closest distance between a ray and the vertical segment (x, y0..y1, z); returns [distance, along-ray t]. */
function rayToSegment(o: THREE.Vector3, d: THREE.Vector3, x: number, z: number, y0: number, y1: number): [number, number] {
  // segment direction is +y; solve the 2-line closest points
  const wx = o.x - x;
  const wy = o.y - y0;
  const wz = o.z - z;
  const b = d.y; // d·u (u = +y)
  const dd = d.dot(d);
  const dw = d.x * wx + d.y * wy + d.z * wz;
  const uw = wy;
  const L = y1 - y0;
  const den = dd - b * b;
  // unconstrained closest points, then clamp to the segment and re-project onto the ray
  let s = THREE.MathUtils.clamp(den > 1e-6 ? (dd * uw - b * dw) / den : uw, 0, L);
  const t = Math.max(0, (b * s - dw) / dd);
  s = THREE.MathUtils.clamp(b * t + uw, 0, L);
  P.copy(o).addScaledVector(d, t);
  Q.set(x, y0 + s, z);
  return [P.distanceTo(Q), t];
}

export function pickPerson(clientX: number, clientY: number, el: HTMLElement, camera: THREE.Camera, coarse: boolean): string | null {
  const r = el.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  const radius = coarse ? 0.62 : 0.42;
  let best: string | null = null;
  let bestT = Infinity;
  const players = useWorld.getState().players;
  for (const [id, t] of tracks) {
    if (!players[id] || t.dist > 40) continue;
    const x = t.x + t.ox;
    const z = t.z + t.oz;
    // body (seated people are lower) + name tag above the head
    const top = t.seated ? 1.5 : 2.25;
    const [dist, along] = rayToSegment(o, d, x, z, 0.15, top);
    // the hit area grows a little with distance so far people stay tappable on a phone
    if (dist < radius + along * 0.012 && along < bestT) {
      bestT = along;
      best = id;
    }
  }
  return best;
}

export function SocialLayer() {
  const { gl, camera } = useThree();
  const you = useWorld((s) => s.you);
  const bodyType = useProfile((s) => s.bodyType);
  const selfGroup = useRef<THREE.Group>(null);
  const tick = useRef(0);
  // just back from a match: react to the result among people (cheer / head shake)
  useEffect(() => {
    if (you) reactToOutcome();
  }, [you]);

  useEffect(() => {
    const el = gl.domElement;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    let down: { x: number; y: number; t: number } | null = null;
    const pd = (e: PointerEvent) => {
      if (e.target !== el) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    // capture phase on window: runs before the walk-to-point handler, so tapping a person never walks you there
    const pu = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.button > 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 450) return;
      const id = pickPerson(e.clientX, e.clientY, el, camera, coarse || e.pointerType === "touch");
      if (!id) return;
      useSocial.setState({ menu: id });
      // the menu opens under the finger: swallow the click that follows this pointerup (a "ghost click" would
      // otherwise press whichever menu button appeared at that spot)
      const until = performance.now() + 600;
      const swallow = (ev: MouseEvent) => {
        window.removeEventListener("click", swallow, true);
        if (performance.now() < until) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 650);
      // the ground handler still sees this tap; undo its walk target right after it ran
      const before = { target: nav.target, goal: nav.goal };
      setTimeout(() => {
        nav.target = before.target;
        nav.goal = before.goal;
      }, 0);
    };
    const ctx = (e: MouseEvent) => {
      const id = pickPerson(e.clientX, e.clientY, el, camera, false);
      if (!id) return;
      e.preventDefault();
      useSocial.setState({ menu: id });
    };
    let hoverAt = 0;
    const pm = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const now = performance.now();
      if (now - hoverAt < 80) return;
      hoverAt = now;
      const over = pickPerson(e.clientX, e.clientY, el, camera, false);
      tagHover.id = over ?? null; // hovering someone shows their name tag even up close
      el.style.cursor = over ? "pointer" : "";
    };
    // dev-only hook for automated multi-player QA (like __gkCam / __gkNav): where is a person on screen?
    if (process.env.NODE_ENV !== "production")
      Object.assign(window as unknown as Record<string, unknown>, {
        __gkProject: (id: string) => {
          const t = tracks.get(id);
          if (!t) return null;
          const v = new THREE.Vector3(t.x + t.ox, t.seated ? 1.0 : 1.2, t.z + t.oz).project(camera);
          const r = el.getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z };
        },
        __gkWorld: () => {
          const w = useWorld.getState();
          const so = useSocial.getState();
          return {
            you: w.you,
            players: Object.values(w.players).map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z })),
            seats: w.seats,
            self: { ...selfPose },
            social: { nearSeat: so.nearSeat, seated: so.seated, menu: so.menu, call: so.call.status, nearbyCount: so.nearbyCount, pairInvite: so.pairInvite, nearSpot: so.nearSpot },
            anims: Object.fromEntries([...tracks.entries()].map(([id, t]) => [id, { anim: t.anim, seated: t.seated, fade: t.fade, x: t.x, z: t.z, yaw: t.yaw }])),
          };
        },
        // people actions for QA scripts: play an action, ask for a contact action, use a context place
        __gkAct: { doAction, requestPair, goToSpot, sitNearest, standFromBench, sitOn: (id: string) => sitOnBench(id, selfPose), spots: SPOTS },
      });
    el.addEventListener("pointerdown", pd);
    window.addEventListener("pointerup", pu, true);
    el.addEventListener("contextmenu", ctx);
    el.addEventListener("pointermove", pm);
    return () => {
      el.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointerup", pu, true);
      el.removeEventListener("contextmenu", ctx);
      el.removeEventListener("pointermove", pm);
    };
  }, [gl, camera]);

  useFrame((_, dt) => {
    if (selfGroup.current) {
      const seated = !!(useSocial.getState().seated || useRoom.getState().seated);
      const g = selfGroup.current;
      g.position.set(selfPose.x, g.position.y + ((seated ? -0.72 : 0) - g.position.y) * 0.12, selfPose.z);
    }
    tick.current += dt;
    if (tick.current < 0.5) return;
    tick.current = 0;
    let n = 0;
    for (const t of tracks.values()) if (t.dist <= NEARBY_CHAT_RANGE) n++;
    if (n !== useSocial.getState().nearbyCount) useSocial.setState({ nearbyCount: n });
  });

  return <group ref={selfGroup}>{you && <SpeechBubble id={you} head={headTop(bodyType)} />}</group>;
}
