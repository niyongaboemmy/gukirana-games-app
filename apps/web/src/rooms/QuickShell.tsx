"use client";
import type { HallLayout } from "./layouts";

/** Instant stand-in while a hall's props/materials finish loading: lit floor + walls in the hall's tones (no assets). */
export function QuickShell({ layout }: { layout: HallLayout }) {
  const { w, d, h } = layout.size;
  const tone = layout.game === "pool" ? { floor: "#4a3426", wall: "#5a4438", light: 0.9 } : layout.game === "ludo" ? { floor: "#b3a493", wall: "#f1ebe1", light: 1.2 } : { floor: "#a5583a", wall: "#d8c3a0", light: 1.0 };
  return (
    <group>
      <ambientLight intensity={tone.light * 1.1} />
      <hemisphereLight args={["#fff4e0", "#5a4a3c", tone.light * 1.6]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={tone.floor} roughness={0.6} />
      </mesh>
      {[
        [0, -d / 2, 0],
        [-w / 2, 0, Math.PI / 2],
        [w / 2, 0, -Math.PI / 2],
        [0, d / 2, Math.PI],
      ].map(([x, z, ry], i) => (
        <mesh key={i} position={[x!, h / 2, z!]} rotation={[0, ry!, 0]}>
          <planeGeometry args={[i % 3 === 0 ? w : d, h]} />
          <meshStandardMaterial color={tone.wall} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
