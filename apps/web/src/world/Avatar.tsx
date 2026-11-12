"use client";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, RoundedBox, Text } from "@react-three/drei";
import type { Group } from "three";

export interface AvatarProps {
  color: string;
  name?: string;
  level?: number;
  /** 0 idle · 1 walk · 2 run · 10 wave · 11 dance · 12 clap */
  animRef: React.RefObject<number>;
  skin?: string;
  showTag?: boolean;
}

const FONT = "/fonts/Baloo2.ttf";

/** Stylised avatar with a VR headset (reference design). ~1.7 m tall. */
export function Avatar({ color, name, level = 1, animRef, skin = "#8D5524", showTag = true }: AvatarProps) {
  const body = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const t = useRef(0);

  useFrame((_, dt) => {
    const anim = animRef.current ?? 0;
    const speed = anim === 2 ? 13 : anim === 1 ? 8 : 0;
    t.current += dt * (speed || 2);
    const swing = speed ? Math.sin(t.current) * (anim === 2 ? 0.9 : 0.55) : 0;
    if (legL.current && legR.current) {
      legL.current.rotation.x = swing;
      legR.current.rotation.x = -swing;
    }
    if (armL.current && armR.current && body.current) {
      armL.current.rotation.set(-swing, 0, 0.08);
      armR.current.rotation.set(swing, 0, -0.08);
      body.current.position.y = speed ? Math.abs(Math.sin(t.current)) * 0.05 : Math.sin(t.current) * 0.01;
      body.current.rotation.y = 0;
      if (anim === 10) armR.current.rotation.set(Math.PI, 0, -0.3 + Math.sin(t.current * 4) * 0.4);
      if (anim === 11) {
        body.current.rotation.y = Math.sin(t.current * 3) * 0.6;
        body.current.position.y = Math.abs(Math.sin(t.current * 6)) * 0.12;
        armL.current.rotation.set(Math.PI * 0.8, 0, 0.6);
        armR.current.rotation.set(Math.PI * 0.8, 0, -0.6);
      }
      if (anim === 12) {
        const c = Math.sin(t.current * 10) * 0.25;
        armL.current.rotation.set(-1.3, 0, -0.5 - c);
        armR.current.rotation.set(-1.3, 0, 0.5 + c);
      }
    }
  });

  return (
    <group>
      <group ref={body}>
        {/* legs */}
        <group ref={legL} position={[-0.11, 0.82, 0]}>
          <mesh position={[0, -0.38, 0]} castShadow>
            <boxGeometry args={[0.17, 0.76, 0.2]} />
            <meshStandardMaterial color="#2b2f45" roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.78, 0.04]} castShadow>
            <boxGeometry args={[0.19, 0.08, 0.3]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
        </group>
        <group ref={legR} position={[0.11, 0.82, 0]}>
          <mesh position={[0, -0.38, 0]} castShadow>
            <boxGeometry args={[0.17, 0.76, 0.2]} />
            <meshStandardMaterial color="#2b2f45" roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.78, 0.04]} castShadow>
            <boxGeometry args={[0.19, 0.08, 0.3]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
        </group>
        {/* hoodie */}
        <RoundedBox args={[0.54, 0.66, 0.32]} radius={0.1} position={[0, 1.14, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.7} />
        </RoundedBox>
        <mesh position={[0, 1.44, -0.12]} castShadow>
          <sphereGeometry args={[0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
        {/* arms */}
        <group ref={armL} position={[-0.34, 1.4, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <capsuleGeometry args={[0.07, 0.42, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.56, 0]}>
            <sphereGeometry args={[0.065, 12, 8]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
        <group ref={armR} position={[0.34, 1.4, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <capsuleGeometry args={[0.07, 0.42, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.56, 0]}>
            <sphereGeometry args={[0.065, 12, 8]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
        {/* head + afro hair + VR headset */}
        <mesh position={[0, 1.66, 0]} castShadow>
          <sphereGeometry args={[0.19, 24, 18]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.76, -0.03]} castShadow>
          <sphereGeometry args={[0.215, 20, 14]} />
          <meshStandardMaterial color="#1a1412" roughness={1} />
        </mesh>
        <mesh position={[0, 1.68, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.025, 8, 24]} />
          <meshStandardMaterial color="#f2f4f8" />
        </mesh>
        <RoundedBox args={[0.3, 0.13, 0.12]} radius={0.04} position={[0, 1.68, 0.17]}>
          <meshStandardMaterial color="#f7f8fb" metalness={0.1} roughness={0.3} />
        </RoundedBox>
        <mesh position={[0, 1.68, 0.235]}>
          <boxGeometry args={[0.26, 0.08, 0.005]} />
          <meshStandardMaterial color="#1f2a44" emissive={color} emissiveIntensity={0.35} />
        </mesh>
      </group>
      {showTag && name && (
        <Billboard position={[0, 2.18, 0]}>
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[Math.max(0.9, name.length * 0.085 + 0.45), 0.26]} />
            <meshBasicMaterial color="#12142b" transparent opacity={0.72} />
          </mesh>
          <Text font={FONT} fontSize={0.14} color="#ffffff" anchorX="center" anchorY="middle">
            {`★${level}  ${name}`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
