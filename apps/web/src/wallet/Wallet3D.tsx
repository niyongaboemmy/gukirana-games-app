"use client";
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/**
 * A real-looking leather bifold wallet that opens in your hands: Stars as a stack of gold tokens, money as stylised
 * notes + coins of the chosen currency (generic designs — never copies of real banknotes). Matte materials only
 * (no glare). Rendered in a small dedicated canvas while the wallet sheet is open.
 */
function noteTexture(code: string, tint: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, tint);
  grad.addColorStop(1, "#e9e4d6");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  // guilloche-like fine lines (generic security pattern)
  g.strokeStyle = "rgba(0,0,0,0.08)";
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.ellipse(256, 128, 60 + i * 6, 30 + i * 3, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = "rgba(20,20,22,0.82)";
  g.font = "700 64px sans-serif";
  g.fillText(code, 28, 92);
  g.font = "600 26px sans-serif";
  g.fillText("GUKIRANA PLAYGROUND", 28, 222);
  g.beginPath();
  g.arc(400, 128, 62, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const NOTE_TINT: Record<string, string> = { RWF: "#c9d9c3", USD: "#cfd8c8", EUR: "#d6cfe3" };

function WalletModel({ open, currency, stars, hasMoney }: { open: boolean; currency: string; stars: number; hasMoney: boolean }) {
  const lid = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const t = useRef(0);
  const leather = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5a3b26", roughness: 0.92, metalness: 0 }), []);
  const inner = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3b2619", roughness: 0.95, metalness: 0 }), []);
  const stitch = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9a26b", roughness: 0.8 }), []);
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d7a93a", roughness: 0.55, metalness: 0.35 }), []);
  const silver = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b9bcc2", roughness: 0.55, metalness: 0.35 }), []);
  const note = useMemo(() => new THREE.MeshStandardMaterial({ map: noteTexture(currency, NOTE_TINT[currency] ?? "#d3d3cc"), roughness: 0.9 }), [currency]);
  const tokens = Math.max(1, Math.min(12, Math.ceil(stars / 400)));
  useFrame((_, dt) => {
    t.current += ((open ? 1 : 0) - t.current) * Math.min(1, dt * 4);
    const e = t.current * t.current * (3 - 2 * t.current);
    if (lid.current) lid.current.rotation.y = -Math.PI * 0.92 * e; // the cover swings open on its spine
    if (root.current) {
      root.current.rotation.x = -0.55 + 0.25 * e;
      root.current.position.x = 0.5 * e; // keep the opened wallet centred
      root.current.rotation.z = Math.sin(performance.now() / 1400) * 0.015; // held in a hand: a tiny natural sway
    }
  });
  return (
    <group ref={root}>
      {/* back half (inside: card slots + notes) */}
      <RoundedBox args={[1.0, 0.82, 0.05]} radius={0.04} smoothness={4} material={leather} position={[0, 0, 0]} />
      <mesh position={[0, 0, 0.027]} material={inner}>
        <boxGeometry args={[0.94, 0.76, 0.004]} />
      </mesh>
      {/* card slot lips */}
      {[0.18, 0.06, -0.06].map((y) => (
        <mesh key={y} position={[0.02, y, 0.032]} material={leather}>
          <boxGeometry args={[0.86, 0.012, 0.006]} />
        </mesh>
      ))}
      {/* banknotes peeking out of the bill compartment */}
      {hasMoney &&
        [0, 1, 2].map((i) => (
          <mesh key={i} position={[0.02 + i * 0.012, 0.3 - i * 0.012, 0.034 + i * 0.002]} rotation={[0, 0, (i - 1) * 0.03]} material={note}>
            <planeGeometry args={[0.84, 0.42]} />
          </mesh>
        ))}
      {/* front cover, hinged on the left spine */}
      <group ref={lid} position={[-0.5, 0, 0]}>
        <group position={[0.5, 0, 0.002]}>
          <RoundedBox args={[1.0, 0.82, 0.05]} radius={0.04} smoothness={4} material={leather} />
          {/* stitched border on the outside */}
          {[
            [0, 0.38, 0.86, 0.008],
            [0, -0.38, 0.86, 0.008],
          ].map(([x, y, w, h], i) => (
            <mesh key={i} position={[x!, y!, 0.027]} material={stitch}>
              <boxGeometry args={[w!, h!, 0.002]} />
            </mesh>
          ))}
          {/* inside of the cover: a coin pouch with the Stars tokens */}
          <group position={[0, -0.08, -0.03]} rotation={[0, Math.PI, 0]}>
            <mesh material={inner}>
              <boxGeometry args={[0.8, 0.36, 0.012]} />
            </mesh>
            {Array.from({ length: tokens }, (_, i) => (
              <mesh key={i} position={[-0.25 + (i % 6) * 0.1, -0.05 + Math.floor(i / 6) * 0.11, 0.02]} rotation={[Math.PI / 2, 0, 0]} material={gold}>
                <cylinderGeometry args={[0.045, 0.045, 0.012, 24]} />
              </mesh>
            ))}
            {hasMoney &&
              [0, 1, 2].map((i) => (
                <mesh key={`c${i}`} position={[0.28, -0.1 + i * 0.012, 0.02]} rotation={[Math.PI / 2, 0, 0]} material={silver}>
                  <cylinderGeometry args={[0.05, 0.05, 0.01, 24]} />
                </mesh>
              ))}
          </group>
        </group>
      </group>
    </group>
  );
}

export function Wallet3D({ open, currency, stars, hasMoney }: { open: boolean; currency: string; stars: number; hasMoney: boolean }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0.05, 3.9], fov: 36 }} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }}>
      {/* soft, even, glare-free light: a sky/ground fill and one diffuse key */}
      <hemisphereLight args={["#f2efe9", "#3a342e", 1.1]} />
      <directionalLight position={[1.5, 2, 3]} intensity={1.3} color="#fff4e6" />
      <WalletModel open={open} currency={currency} stars={stars} hasMoney={hasMoney} />
    </Canvas>
  );
}
