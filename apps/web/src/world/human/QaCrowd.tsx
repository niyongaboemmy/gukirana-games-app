"use client";
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { Avatar } from "../Avatar";
import { DEFAULT_LOOK, type AvatarLook } from "../outfits";
import { useVoice } from "@/voice/voice";

/**
 * DEV-ONLY visual QA for the realistic humans (`?qa=humans` on a development build): a line-up of looks and
 * animation states with a fixed camera (`&cam=close|group|walk|sit`). Never rendered in production and never part
 * of any player list.
 */
const LOOKS: { look: Omit<Partial<AvatarLook>, "outfit"> & { outfit?: Partial<AvatarLook["outfit"]> }; anim: number; move?: number }[] = [
  { look: { bodyType: "feminine", skinTone: "#5C3A26", hairStyle: "short", outfit: { top: "kitenge-sun", bottom: "jeans" } }, anim: 0 },
  { look: { bodyType: "masculine", skinTone: "#3B2219", hairStyle: "fade", outfit: { top: "tee-white", bottom: "chinos", shoes: "loafers" } }, anim: 0 },
  { look: { bodyType: "neutral", skinTone: "#8D5524", hairStyle: "locs", outfit: { top: "hoodie", bottom: "joggers" } }, anim: 10 },
  { look: { bodyType: "feminine", skinTone: "#4A2C21", hairStyle: "braids", outfit: { top: "blazer-cream", bottom: "skirt", accessory: "earrings" } }, anim: 12 },
  { look: { bodyType: "masculine", skinTone: "#6E4530", hairStyle: "afro", outfit: { top: "jersey", bottom: "shorts", headwear: "no-hat", accessory: "watch" } }, anim: 11 },
  { look: { bodyType: "feminine", skinTone: "#A0662F", hairStyle: "headwrap", outfit: { top: "mushanana", bottom: "wrap-mushanana", accessory: "sunglasses" } }, anim: 0 },
  { look: { bodyType: "masculine", skinTone: "#4A2C21", hairStyle: "short", outfit: { top: "track", bottom: "jeans", headwear: "cap" } }, anim: 1, move: 1.4 },
  { look: { bodyType: "feminine", skinTone: "#3B2219", hairStyle: "bun", outfit: { top: "tee", bottom: "joggers" } }, anim: 1, move: 2.2 },
  { look: { bodyType: "neutral", skinTone: "#5C3A26", hairStyle: "puffs", outfit: { top: "kitenge-leaf", bottom: "chinos" } }, anim: 2, move: 4.0 },
  { look: { bodyType: "masculine", skinTone: "#5C3A26", hairStyle: "cornrows", outfit: { top: "blazer", bottom: "chinos", accessory: "glasses" } }, anim: 13 },
];

function QaPerson({ i, x, z, accent }: { i: number; x: number; z: number; accent: string }) {
  const def = LOOKS[i]!;
  const look = useMemo<AvatarLook>(() => ({ ...DEFAULT_LOOK, ...def.look, accent, outfit: { ...DEFAULT_LOOK.outfit, ...def.look.outfit } }), [def, accent]);
  const anim = useRef(def.anim);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current || !def.move) return;
    // walk/run laps on a 6 m line at the given ground speed, turning at the ends
    const L = 6;
    const t = (clock.elapsedTime * def.move) % (2 * L);
    const fwd = t < L;
    g.current.position.z = z + (fwd ? t : 2 * L - t) - L / 2;
    g.current.rotation.y = fwd ? 0 : Math.PI;
  });
  return (
    <group ref={g} position={[x, 0, z]} rotation={[0, def.move ? 0 : Math.PI * 0.08, 0]}>
      <Avatar look={look} name={`QA ${i + 1}`} animRef={anim} self={i === 1} lod />
    </group>
  );
}

export function QaCrowd({ at }: { at: THREE.Vector3 }) {
  const params = useMemo(() => new URLSearchParams(typeof location !== "undefined" ? location.search : ""), []);
  const on = process.env.NODE_ENV !== "production" && params.get("qa") === "humans";
  const cam = params.get("cam") ?? "group";
  const { camera } = useThree();
  useFrame(({ clock }) => {
    if (!on) return;
    useVoice.setState({ selfTalking: Math.sin(clock.elapsedTime * 0.7) > -0.2 });
    const c = at;
    if (cam === "close") {
      const k = Number(params.get("who") ?? 0);
      camera.position.set(c.x + (k - 4.5) * 1.3, 1.62, c.z + 1.25);
      camera.lookAt(c.x + (k - 4.5) * 1.3, 1.5, c.z);
    } else if (cam === "body") {
      const k = Number(params.get("who") ?? 0);
      camera.position.set(c.x + (k - 4.5) * 1.3 + 0.4, 1.3, c.z + 3.0);
      camera.lookAt(c.x + (k - 4.5) * 1.3, 0.95, c.z);
    } else if (cam === "walk") {
      camera.position.set(c.x + 6.5, 1.5, c.z + 2);
      camera.lookAt(c.x + 2.5, 0.9, c.z + 1.5);
    } else {
      camera.position.set(c.x + 0.5, 2.4, c.z + 9.5);
      camera.lookAt(c.x, 1.0, c.z);
    }
  });
  if (!on) return null;
  return (
    <group>
      {LOOKS.map((_, i) => (
        <QaPerson key={i} i={i} x={at.x + (i - 4.5) * 1.3} z={i >= 6 && i <= 8 ? at.z + 1.5 : at.z} accent={["#2F80ED", "#E85D1C", "#27AE60", "#9B51E0"][i % 4]!} />
      ))}
    </group>
  );
}
