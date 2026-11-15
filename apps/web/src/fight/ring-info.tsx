"use client";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { CORNER_COLORS, type RingId } from "@gukirana/contracts";
import { selfPose } from "@/lib/world-store";
import { isOnScreen, useArea } from "@/world/stage";
import { fightActions } from "./actions";
import { useFightBridge } from "./bridge";
import { stickyNearest } from "@/rooms/stability";
import { nearestRing, RING_BY_ID, ringPromptDist, RINGS } from "./plan";
import { F } from "./strings";
import { useFightUi } from "./ui-store";

const FONT = "/fonts/Baloo2.ttf";
/**
 * Prompt target (P3-FGT-04): `ringPromptDist` (the foot of a ring's steps, or its platform edge + 0.6 m) within
 * PROMPT_R; once shown it stays until PROMPT_R + PROMPT_MARGIN (no flashing at the edge), another ring takes over only
 * when nearer by PROMPT_GAIN, and a new target must hold for PROMPT_HOLD s (walking past rings in an aisle does not
 * flash a card for each). Spectators within WATCH_R facing a live ring for WATCH_S watch it.
 */
const PROMPT_R = 1.3;
const PROMPT_MARGIN = 0.6;
const PROMPT_GAIN = 0.3;
const PROMPT_HOLD = 0.3;
const RING_KEYS = RINGS.map((_, i) => String(i));
const WATCH_R = 6;
const WATCH_S = 1.5;

/**
 * Which ring you stand by (prompt target), automatic watching (standing within 6 m of a live ring and facing it
 * subscribes to its frames, plan §4.3; the Watch button does it at once) and, at close range, the fighters' names +
 * score on that ring's number box.
 */
export function RingCloseInfo() {
  const area = useArea();
  const facing = useRef({ ring: null as RingId | null, t: 0 });
  const last = useRef({ x: 0, z: 0 });
  const target = useRef<{ i: number | null; pending: number | null; t: number }>({ i: null, pending: null, t: 0 });
  useFrame((_, dt) => {
    if (!isOnScreen(area)) return;
    const n = nearestRing(selfPose.x, selfPose.z, WATCH_R);
    const ui = useFightUi.getState();
    const tg = target.current;
    const want = stickyNearest(tg.i == null ? null : String(tg.i), RING_KEYS, (k) => ringPromptDist(Number(k), selfPose.x, selfPose.z), PROMPT_R, PROMPT_MARGIN, PROMPT_GAIN);
    const wi = want == null ? null : Number(want);
    if (wi === tg.i) tg.pending = null;
    else if (wi == null) {
      tg.i = null;
      tg.pending = null;
    } else {
      if (tg.pending !== wi) {
        tg.pending = wi;
        tg.t = 0;
      }
      tg.t += dt;
      if (tg.t >= PROMPT_HOLD) {
        tg.i = wi;
        tg.pending = null;
      }
    }
    const near = tg.i == null ? null : RINGS[tg.i]!.id;
    if (near !== ui.near) ui.set({ near });
    // automatic watch: within 6 m, facing the ring, ring live
    const b = useFightBridge.getState();
    if (b.mine) return;
    const moved = Math.hypot(selfPose.x - last.current.x, selfPose.z - last.current.z) > 0.02;
    last.current = { x: selfPose.x, z: selfPose.z };
    if (n) {
      const st = b.rings[n.ring.id]?.status;
      const dx = n.ring.x - selfPose.x;
      const dz = n.ring.z - selfPose.z;
      const d = Math.hypot(dx, dz) || 1;
      const towards = (Math.sin(selfPose.yaw) * dx + Math.cos(selfPose.yaw) * dz) / d;
      if ((st === "fighting" || st === "practice" || st === "starting") && towards > 0.6 && !moved) {
        if (facing.current.ring !== n.ring.id) facing.current = { ring: n.ring.id, t: 0 };
        facing.current.t += dt;
        if (facing.current.t > WATCH_S && b.watched?.ring !== n.ring.id) fightActions.watch(n.ring.id);
      } else facing.current = { ring: null, t: 0 };
    }
    // walked well away from the ring you watch: stop
    const w = b.watched?.ring;
    if (w) {
      const r = RING_BY_ID[w]!;
      const dd = Math.hypot(Math.max(0, Math.abs(selfPose.x - r.x) - r.half), Math.max(0, Math.abs(selfPose.z - r.z) - r.half));
      if (dd > WATCH_R * 2 && !useFightUi.getState().watchCam) fightActions.watch(null);
    }
  });
  const near = useFightUi((s) => s.near);
  const entry = useFightBridge((s) => (near ? s.rings[near] : undefined));
  if (!near || !entry || (!entry.red && !entry.blue)) return null;
  const r = RING_BY_ID[near]!;
  const y = (r.feature ? r.canvasY + 2.9 : 4.3) + (r.feature ? 1.15 : 0.85);
  const line = `${entry.red?.name ?? "—"}  ${entry.score ? `${entry.score.red} – ${entry.score.blue}` : F.vs}  ${entry.blue?.name ?? (entry.status === "practice" ? F.ai : "—")}`;
  return (
    <group position={[r.x, y, r.z]}>
      {[0, 1, 2, 3].map((k) => (
        <group key={k} rotation-y={(k * Math.PI) / 2}>
          <Text font={FONT} fontSize={0.2} position={[0, 0, r.half * 0.2 + 0.02]} anchorX="center" anchorY="middle" color="#ffffff" outlineWidth={0.012} outlineColor="#000000">
            {line}
          </Text>
          <mesh position={[-0.9, -0.17, r.half * 0.2 + 0.02]}>
            <planeGeometry args={[0.5, 0.04]} />
            <meshBasicMaterial color={CORNER_COLORS.red} toneMapped={false} />
          </mesh>
          <mesh position={[0.9, -0.17, r.half * 0.2 + 0.02]}>
            <planeGeometry args={[0.5, 0.04]} />
            <meshBasicMaterial color={CORNER_COLORS.blue} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
