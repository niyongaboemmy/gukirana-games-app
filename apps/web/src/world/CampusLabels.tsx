"use client";
import { useMemo, useRef } from "react";
import type * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import { cameraState } from "./Player";
import { aerialBlend } from "./aerial";
import { campusLabels } from "./campus-labels";

const FONT = "/fonts/Baloo2.ttf";
/** Camera distance (m) beyond which the inner building names give way to the campus name. */
const FAR_LABELS_M = 330;

/** Building names floating over the roofs in the campus aerial view (fade in as the camera rises; hidden up close). */
export function CampusLabels() {
  const group = useRef<THREE.Group>(null);
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  // every name over its own building's footprint (world/campus-labels.ts, P2-WLD-16)
  const labels = useMemo(() => campusLabels(), []);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const k = aerialBlend(cameraState.distance);
    g.visible = k > 0.05;
    if (!g.visible) return;
    // about constant size on screen up to mid height, then smaller (the campus shrinks too); very high up only the
    // campus name and the Fight hall stay (the inner buildings are too close together to label)
    const dist = camera.position.length();
    const s = Math.max(1, Math.min(dist / 70, 7));
    const high = dist > FAR_LABELS_M;
    g.children.forEach((c, i) => {
      c.scale.setScalar(s);
      const tier = labels[i]?.tier;
      c.visible = labels[i]?.key === "campus" ? high : tier === "far" || !high;
    });
    for (const m of mats.current) if (m) m.opacity = Math.min(1, (k - 0.05) * 1.6);
  });

  const mat = (i: number, color: string) => (
    <meshBasicMaterial
      ref={(m) => {
        if (m) mats.current[i] = m;
      }}
      color={color}
      transparent
      depthTest={false}
      toneMapped={false}
    />
  );

  return (
    <group ref={group} visible={false}>
      {labels.map((l, i) => (
        <Billboard key={l.key} position={[l.x, l.y, l.z]} renderOrder={20}>
          <Text font={FONT} fontSize={1.45} anchorX="center" anchorY="bottom" outlineWidth={0.12} outlineColor="#141414" renderOrder={20}>
            {l.text}
            {mat(i * 2, "#ffffff")}
          </Text>
          {l.sub && (
            <Text font={FONT} fontSize={0.9} anchorX="center" anchorY="top" position={[0, -0.1, 0]} outlineWidth={0.07} outlineColor="#141414" renderOrder={20}>
              {l.sub}
              {mat(i * 2 + 1, "#e8c3a0")}
            </Text>
          )}
        </Billboard>
      ))}
    </group>
  );
}
