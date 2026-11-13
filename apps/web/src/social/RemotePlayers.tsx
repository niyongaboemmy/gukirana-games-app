"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { SeatPose } from "@gukirana/contracts";
import { Avatar, headTop, tagScale, tagVisible, UprightBillboard } from "@/world/Avatar";
import { decodeLook, seededLook } from "@/world/outfits";
import type { Tier } from "@/world/materials";
import { selfPose, useWorld } from "@/lib/world-store";
import { useVoice } from "@/voice/voice";
import { renderPose, setHallSeats, stepMotion, tracks } from "./motion";
import { useSocial } from "./social-store";

/** Name tags + speaking bars are drawn up to this distance (DESIGN-SPEC §7.5: ≤ 12 m on screen; a bit more here). */
const TAG_RANGE = 16;
/** Speech bubbles (DESIGN-SPEC §12.2: max 2 lines, 6 s). */
const BUBBLE_MS = 6000;
const BUBBLE_RANGE = 22;
/** Crowd budget: only the nearest N people get the full-detail body; the rest use the light mesh. */
const FULL_DETAIL = 14;
const FONT = "/fonts/Baloo2.ttf";

/** id → use the light body (crowd budget), recomputed twice a second. */
const useCrowd = create<{ lite: Record<string, boolean> }>()(() => ({ lite: {} }));

const EMOTE_WORD: Record<number, string> = { 10: "waves", 11: "dances", 12: "claps" };

function bubbleText(text: string): string {
  const t = text.trim();
  return t.length > 64 ? `${t.slice(0, 62).trimEnd()}…` : t;
}

/** Rounded speech-bubble outline with a small tail pointing down at the speaker (origin = tail tip). */
function bubbleShape(w: number, h: number): THREE.ShapeGeometry {
  const r = Math.min(0.06, h / 2);
  const tail = 0.045;
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = tail;
  s.moveTo(x0 + r, y0);
  s.lineTo(-0.035, y0);
  s.lineTo(0, 0);
  s.lineTo(0.035, y0);
  s.lineTo(-x0 - r, y0);
  s.quadraticCurveTo(-x0, y0, -x0, y0 + r);
  s.lineTo(-x0, y0 + h - r);
  s.quadraticCurveTo(-x0, y0 + h, -x0 - r, y0 + h);
  s.lineTo(x0 + r, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return new THREE.ShapeGeometry(s, 6);
}

/**
 * Speech bubble (DESIGN-SPEC §12.2: max 2 lines, 6 s): white rounded card with a tail to the head, 0.25 m above the
 * head (or just above the name tag when that is showing), 150 ms scale-in, fades out at the end of its 6 s.
 * `head` = top of the head (m); `tag` = this person shows a name tag (remote people).
 */
export function SpeechBubble({ id, head, tag = false, emote = "" }: { id: string; head: number; tag?: boolean; emote?: string }) {
  const bubble = useSocial((s) => s.bubbles[id]);
  const g = useRef<THREE.Group>(null);
  const anchor = useRef<THREE.Group>(null);
  const bg = useRef<THREE.MeshBasicMaterial>(null);
  const txt = useRef<THREE.Mesh>(null);
  const emoteRef = useRef<THREE.Group>(null);
  const text = bubble ? bubbleText(bubble.text) : "";
  const lines = text.length > 30 ? 2 : 1;
  const width = Math.min(2.1, Math.max(0.6, Math.min(text.length, 32) * 0.064 + 0.3));
  const height = lines === 2 ? 0.33 : 0.2;
  const shape = useMemo(() => bubbleShape(width, height), [width, height]);
  useEffect(() => () => shape.dispose(), [shape]);
  useFrame(({ camera }) => {
    if (!g.current || !anchor.current) return;
    const d = camera.position.distanceTo(anchor.current.getWorldPosition(tmp));
    const far = d > BUBBLE_RANGE;
    // sits 0.25 m above the head, or clear of the name tag while that is visible (≥ 2.5 m, or hovered)
    anchor.current.position.y = tag && tagVisible(d, id, TAG_RANGE) ? head + 0.31 + 0.13 * tagScale(d) : head + 0.25;
    // keep bubbles readable: grow with distance (≈ constant on-screen size from 5 m on), anchored at the tail
    const k = THREE.MathUtils.clamp(d / 5, 1, 2.6);
    const age = bubble ? Date.now() - bubble.t : Infinity;
    const on = age < BUBBLE_MS && !far;
    g.current.visible = on;
    if (on) {
      const pop = Math.min(1, age / 150);
      g.current.scale.setScalar(k * (0.6 + 0.4 * (1 - (1 - pop) * (1 - pop))));
      const a = age > BUBBLE_MS - 700 ? (BUBBLE_MS - age) / 700 : pop;
      if (bg.current) bg.current.opacity = 0.92 * a;
      const m = txt.current?.material as (THREE.Material & { opacity?: number }) | undefined;
      if (m) m.opacity = a;
    }
    if (emoteRef.current) emoteRef.current.visible = !far && !on;
  });
  return (
    <group ref={anchor} position={[0, head + 0.25, 0]}>
      <UprightBillboard>
        <group ref={g} visible={false}>
          {text && (
            <>
              <mesh geometry={shape} renderOrder={5}>
                <meshBasicMaterial ref={bg} color="#ffffff" transparent opacity={0.92} depthWrite={false} toneMapped={false} />
              </mesh>
              <Text
                ref={txt}
                font={FONT}
                fontSize={0.1}
                maxWidth={width - 0.14}
                lineHeight={1.15}
                textAlign="center"
                color="#1d2030"
                anchorX="center"
                anchorY="middle"
                position={[0, 0.045 + height / 2, 0.002]}
                renderOrder={6}
              >
                {text}
              </Text>
            </>
          )}
        </group>
      </UprightBillboard>
      {emote && (
        <UprightBillboard position={[0, 0.06, 0]}>
          <group ref={emoteRef} visible={false}>
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[0.62, 0.2]} />
              <meshBasicMaterial color="#FFC83D" transparent opacity={0.9} depthWrite={false} />
            </mesh>
            <Text font={FONT} fontSize={0.11} color="#12142b" anchorX="center" anchorY="middle">
              {emote}
            </Text>
          </group>
        </UprightBillboard>
      )}
    </group>
  );
}
const tmp = new THREE.Vector3();

/** Soft pulsing ring on the floor around a person who is speaking (DESIGN-SPEC §12.1). */
function TalkRing({ id }: { id: string }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!m.current) return;
    const on = !!useVoice.getState().talking[id];
    m.current.visible = on;
    if (on) {
      const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.06;
      m.current.scale.set(s, s, 1);
    }
  });
  return (
    <mesh ref={m} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} visible={false} renderOrder={2}>
      <ringGeometry args={[0.42, 0.5, 40]} />
      <meshBasicMaterial color="#22C55E" transparent opacity={0.75} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function RemoteAvatar({ id, tier }: { id: string; tier: Tier }) {
  const meta = useWorld(
    useShallow((s) => {
      const p = s.players[id];
      return p ? { name: p.name, level: p.level, color: p.color, look: p.look, bodyType: p.bodyType, uid: p.uid } : null;
    }),
  );
  const lite = useCrowd((s) => !!s.lite[id]);
  const lookStr = meta?.look;
  const color = meta?.color ?? "#3DA9FC";
  const bodyType = meta?.bodyType;
  const uid = meta?.uid;
  // `look` is optional on the wire; without it the person gets their own deterministic default look (the same hash
  // of the account id as the API's sign-up look; guests hash their session id), never a shared default clone
  const look = useMemo(() => {
    const body = bodyType === "feminine" || bodyType === "masculine" ? bodyType : null;
    return lookStr ? decodeLook(lookStr, color) : seededLook(uid ?? id, color, body);
  }, [lookStr, color, bodyType, uid, id]);
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const lookAt = useRef<THREE.Vector3 | null>(null);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const seed = useMemo(() => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7), [id]);
  const glance = useRef({ next: 0, until: 0, at: "" });
  const bubbleLift = useRef<THREE.Group>(null);
  // seated people can't play the standing emote clips: show a short label instead ("waves")
  const [seatedEmote, setSeatedEmote] = useState("");

  useFrame(() => {
    const pose = renderPose(id);
    if (!pose || !group.current) return;
    group.current.position.set(pose.x, 0, pose.z);
    group.current.rotation.y = pose.yaw;
    anim.current = pose.anim;
    if (bubbleLift.current) bubbleLift.current.position.y += ((pose.seated ? -0.72 : 0) - bubbleLift.current.position.y) * 0.12;
    const t = tracks.get(id);
    const word = pose.seated && t?.emote && t.emote.until > Date.now() ? (EMOTE_WORD[t.emote.id] ?? "") : "";
    if (word !== seatedEmote) setSeatedEmote(word);

    // where to look: the nearest person speaking within 5 m (me or someone else) — otherwise an occasional
    // glance at a person standing close by (idle variety), otherwise straight ahead
    const v = useVoice.getState();
    let target: { x: number; z: number } | null = null;
    let best = 5;
    const dSelf = Math.hypot(selfPose.x - pose.x, selfPose.z - pose.z);
    if (v.selfTalking && dSelf < best) {
      best = dSelf;
      target = selfPose;
    }
    if (t && t.dist < 30) {
      const players = useWorld.getState().players;
      for (const sid in v.talking) {
        if (!v.talking[sid] || sid === id) continue;
        const o = players[sid];
        if (!o) continue;
        const d = Math.hypot(o.x / 100 - pose.x, o.z / 100 - pose.z);
        if (d < best) {
          best = d;
          target = { x: o.x / 100, z: o.z / 100 };
        }
      }
      if (!target) {
        const now = performance.now();
        const gl = glance.current;
        if (now > gl.next) {
          // deterministic per person: glance for ~2 s every 5–9 s at the nearest person within 3 m (or me)
          gl.next = now + 5000 + ((seed + Math.floor(now / 1000)) % 4) * 1000;
          gl.until = now + 2000;
          gl.at = "";
          let nd = 3;
          if (dSelf < nd) {
            nd = dSelf;
            gl.at = "self";
          }
          for (const [sid, o] of Object.entries(players)) {
            if (sid === id) continue;
            const d = Math.hypot(o.x / 100 - pose.x, o.z / 100 - pose.z);
            if (d < nd) {
              nd = d;
              gl.at = sid;
            }
          }
        }
        if (now < gl.until && gl.at) {
          const o = gl.at === "self" ? selfPose : players[gl.at] ? { x: players[gl.at]!.x / 100, z: players[gl.at]!.z / 100 } : null;
          if (o) target = o;
        }
      }
    }
    lookAt.current = target ? lookTarget.set(target.x, 1.55, target.z) : null;
  });

  if (!meta) return null;

  return (
    <group ref={group}>
      <Avatar
        look={look}
        name={meta.name}
        level={meta.level}
        animRef={anim}
        lod
        shadows={tier !== "lite"}
        quality={tier === "lite" || lite ? "lite" : "standard"}
        voiceId={id}
        lookAtRef={lookAt}
        tagRange={TAG_RANGE}
      />
      <TalkRing id={id} />
      <group ref={bubbleLift}>
        <SpeechBubble id={id} head={headTop(look.bodyType)} tag emote={seatedEmote} />
      </group>
    </group>
  );
}

/**
 * Everyone else in the room (plaza and halls). Pass `hallSeats` inside a hall so seated people render exactly on
 * their chair; plaza bench places come from @gukirana/contracts.
 */
export function RemotePlayers({ tier = "standard", hallSeats }: { tier?: Tier; hallSeats?: readonly SeatPose[] }) {
  const ids = useWorld((s) => Object.keys(s.players).join(","));
  useEffect(() => {
    setHallSeats(hallSeats ?? []);
    return () => setHallSeats([]);
  }, [hallSeats]);
  const budget = useRef(0);
  // runs before the avatars' own frame callbacks (priority −1): one motion step for everyone
  useFrame((_, dt) => {
    stepMotion(Math.min(dt, 0.1));
    budget.current += dt;
    if (budget.current < 0.5) return;
    budget.current = 0;
    const sorted = [...tracks.entries()].sort((a, b) => a[1].dist - b[1].dist);
    const lite: Record<string, boolean> = {};
    sorted.forEach(([id], i) => i >= FULL_DETAIL && (lite[id] = true));
    const prev = useCrowd.getState().lite;
    const changed = Object.keys(lite).length !== Object.keys(prev).length || Object.keys(lite).some((k) => !prev[k]);
    if (changed) useCrowd.setState({ lite });
  }, -1);
  return (
    <>
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <RemoteAvatar key={id} id={id} tier={tier} />
        ))}
    </>
  );
}
