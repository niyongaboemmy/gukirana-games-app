"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import { GAME_COLORS } from "./materials";
import { NearOnly } from "./static-merge";
import { CAMPUS } from "./campus-strings";

const FONT = "/fonts/Baloo2.ttf";
/** the sign: 2.3 × 0.82 m, 8 cm deep — a real object, not a flat decal */
const W = 2.3;
const H = 0.82;
const D = 0.08;

/**
 * Player of the Day sign over the Agaseke (SRS §5.10), a compact floating 3D sign that turns to face you: a dark
 * smoked-glass slab in a thin bronze frame (rounded, with depth), a slim gold accent line, the title and one short
 * line with even margins, centred. It floats gently; a faint beam rises from the basket's tip. Real information only
 * (no invented winner while the feature has no data). Calm with reduced motion (no float).
 */
export function PlayerOfDayHolo({ y = 6.6 }: { y?: number }) {
  const card = useRef<THREE.Group>(null);
  const calm = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const gold = useMemo(() => new THREE.Color(GAME_COLORS.gold).multiplyScalar(1.5), []);
  useFrame(({ clock }) => {
    if (card.current && !calm) card.current.position.y = Math.sin(clock.elapsedTime * 0.8) * 0.08;
  });
  return (
    <group position={[0, y, 0]}>
      {/* faint beam from the basket's tip (4.85 m) up to the sign */}
      <mesh position={[0, -1.15, 0]}>
        <cylinderGeometry args={[0.03, 0.12, 1.7, 12, 1, true]} />
        <meshBasicMaterial color={gold} transparent opacity={0.1} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={card}>
        <Billboard lockX lockZ>
          {/* bronze frame */}
          <RoundedBox args={[W + 0.08, H + 0.08, D]} radius={0.06} smoothness={4}>
            <meshStandardMaterial color="#6b4a2e" metalness={0.75} roughness={0.35} />
          </RoundedBox>
          {/* smoked-glass face, a little proud of the frame */}
          <RoundedBox args={[W, H, D + 0.01]} radius={0.05} smoothness={4}>
            <meshStandardMaterial color="#17130f" metalness={0.2} roughness={0.25} emissive="#1d1610" emissiveIntensity={0.6} />
          </RoundedBox>
          {/* slim gold accent line under the title */}
          <mesh position={[0, -0.06, D / 2 + 0.012]}>
            <planeGeometry args={[0.7, 0.01]} />
            <meshBasicMaterial color={gold} toneMapped={false} />
          </mesh>
          {/* (readable to ~40 m; beyond that the sign reads as a dark plaque) */}
          <NearOnly max={40}>
            {[0, Math.PI].map((r) => (
              // both faces carry the text, each on its own side (no mirrored show-through: the slab is opaque)
              <group key={r} rotation-y={r}>
                <Text font={FONT} fontSize={0.21} color="#FFC83D" position={[0, 0.12, D / 2 + 0.014]} anchorX="center" anchorY="middle" textAlign="center" whiteSpace="nowrap" letterSpacing={0.01}>
                  {CAMPUS.potdTitle}
                </Text>
                <Text font={FONT} fontSize={0.12} color="#e9e1d4" position={[0, -0.2, D / 2 + 0.014]} anchorX="center" anchorY="middle" textAlign="center" whiteSpace="nowrap" letterSpacing={0.08}>
                  {CAMPUS.potdWhen}
                </Text>
                {r !== 0 && (
                  <mesh position={[0, -0.06, D / 2 + 0.012]}>
                    <planeGeometry args={[0.7, 0.01]} />
                    <meshBasicMaterial color={gold} toneMapped={false} />
                  </mesh>
                )}
              </group>
            ))}
          </NearOnly>
        </Billboard>
      </group>
    </group>
  );
}
