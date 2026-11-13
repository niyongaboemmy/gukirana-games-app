"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";

/**
 * The wallet IS the interface: an open leather bifold you operate by touching its parts.
 *   gold Star tokens (coin pouch) → claim daily Stars        balance card → cycles the display currency
 *   receipt slip                 → recent activity             banknotes   → add funds / cash out
 *   shield card                  → play safe (limits, breaks)
 * A touched card slides up out of its slot towards you; its controls live ON the card (DOM placed in 3D).
 * Matte materials only (no glare). Drag to turn the wallet.
 */
export type Panel = "activity" | "funds" | "safe" | null;
type Tx = { label: string; amount: number; when: string };

const FONT = "/fonts/Baloo2.ttf";
const leatherMat = new THREE.MeshStandardMaterial({ color: "#5a3b26", roughness: 0.92, metalness: 0 });
const innerMat = new THREE.MeshStandardMaterial({ color: "#3a2519", roughness: 0.95 });
const lipMat = new THREE.MeshStandardMaterial({ color: "#4a3020", roughness: 0.92 });
const goldMat = new THREE.MeshStandardMaterial({ color: "#d9ab3c", roughness: 0.5, metalness: 0.35 });
const cardMat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });

/** Hover lift + pointer cursor for touchable parts. */
function useTouch(onTap: () => void) {
  const [hover, setHover] = useState(false);
  return {
    hover,
    bind: {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      },
      onPointerOut: () => {
        setHover(false);
        document.body.style.cursor = "";
      },
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onTap();
      },
    },
  };
}

/** A card in a slot: rests tucked in; when active it slides up and towards the camera, larger. */
function SlotCard({ step, color, title, sub, active, onTap, children, face }: { step: number; color: string; title: string; sub?: string; active: boolean; onTap: () => void; children?: ReactNode; face?: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const t = useRef(0);
  const { hover, bind } = useTouch(onTap);
  const mat = useMemo(() => cardMat(color), [color]);
  useFrame((_, dt) => {
    t.current += ((active ? 1 : 0) - t.current) * Math.min(1, dt * 7);
    const e = t.current * t.current * (3 - 2 * t.current);
    if (!g.current) return;
    // resting: tucked in the slot, staggered so each title peeks out; active: slides up and towards you
    const restY = 0.2 - step * 0.075;
    // the right half sits at x = +0.5: an active card comes to the centre front of the wallet, held up to read
    g.current.position.set(-0.5 * e, restY + (hover && !active ? 0.035 : 0) + e * (0.02 - restY), 0.04 + step * 0.01 + e * 0.75);
    g.current.scale.setScalar(1 + e * 1.15);
    g.current.rotation.x = -0.08 * e;
  });
  return (
    <group ref={g}>
      <RoundedBox args={[0.8, 0.3, 0.006]} radius={0.02} smoothness={3} material={mat} {...bind} />
      <Text font={FONT} position={[-0.37, 0.13, 0.005]} fontSize={0.042} color="#16171a" anchorX="left" anchorY="top">
        {title}
      </Text>
      {sub && (
        <Text font={FONT} position={[0.37, 0.125, 0.005]} fontSize={0.028} color="#2b2d31" anchorX="right" anchorY="top" maxWidth={0.45}>
          {sub}
        </Text>
      )}
      {face}
      {active && children && (
        <Html transform distanceFactor={0.42} position={[0, -0.02, 0.006]} zIndexRange={[95, 94]} className="wallet-card-ui">
          <div style={{ width: 300 }} onPointerDown={(e) => e.stopPropagation()}>
            {children}
          </div>
        </Html>
      )}
    </group>
  );
}

/** The gold Star tokens in the coin pouch: tap to claim. A token drops in and "+N" floats up. */
function StarTokens({ count, onClaim, burst }: { count: number; onClaim: () => void; burst: string | null }) {
  const { hover, bind } = useTouch(onClaim);
  const drop = useRef<THREE.Mesh>(null);
  const float = useRef<THREE.Group>(null);
  const tb = useRef(0);
  const lastBurst = useRef<string | null>(null);
  useFrame((_, dt) => {
    if (burst !== lastBurst.current) {
      lastBurst.current = burst;
      tb.current = burst ? 1 : 0;
    }
    tb.current = Math.max(0, tb.current - dt * 0.7);
    const k = 1 - tb.current;
    if (drop.current) {
      drop.current.visible = tb.current > 0;
      drop.current.position.set(0.06, 0.32 - Math.min(1, k * 2.2) * 0.3, 0.05);
      drop.current.rotation.z = k * 6;
    }
    if (float.current) {
      float.current.visible = tb.current > 0;
      float.current.position.y = 0.2 + k * 0.25;
    }
  });
  const n = Math.max(2, Math.min(9, Math.ceil(count / 300)));
  return (
    <group position={[-0.5, -0.12, 0.03]}>
      <mesh material={innerMat}>
        <boxGeometry args={[0.8, 0.3, 0.012]} />
      </mesh>
      <group {...bind} scale={hover ? 1.06 : 1}>
        {Array.from({ length: n }, (_, i) => (
          <mesh key={i} position={[-0.26 + (i % 5) * 0.11, -0.04 + Math.floor(i / 5) * 0.1, 0.02]} rotation={[Math.PI / 2, 0, 0]} material={goldMat}>
            <cylinderGeometry args={[0.045, 0.045, 0.012, 24]} />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.03]} visible={false}>
          <planeGeometry args={[0.62, 0.26]} />
        </mesh>
      </group>
      <Text font={FONT} position={[0, -0.2, 0.02]} fontSize={0.038} color={hover ? "#fde68a" : "#d4c3a3"} anchorX="center">
        Tap the Stars to claim
      </Text>
      <mesh ref={drop} material={goldMat} visible={false}>
        <cylinderGeometry args={[0.045, 0.045, 0.012, 24]} />
      </mesh>
      <group ref={float} visible={false}>
        <Text font={FONT} fontSize={0.06} color="#facc15" anchorX="center" outlineWidth={0.003} outlineColor="#000">
          {burst ?? ""}
        </Text>
      </group>
    </group>
  );
}

function WalletBody({
  stars,
  coinsLine,
  currency,
  onCycleCurrency,
  onClaim,
  burst,
  streak,
  history,
  panel,
  setPanel,
  funds,
  safe,
}: {
  stars: number;
  coinsLine: string;
  currency: string;
  onCycleCurrency: () => void;
  onClaim: () => void;
  burst: string | null;
  streak: string | null;
  history: Tx[];
  panel: Panel;
  setPanel: (p: Panel) => void;
  funds: ReactNode;
  safe: ReactNode;
}) {
  const root = useRef<THREE.Group>(null);
  const balance = useTouch(onCycleCurrency);
  useFrame(({ clock }) => {
    if (root.current) root.current.position.y = Math.sin(clock.elapsedTime * 1.1) * 0.01; // held in the hand: a tiny float
  });
  const toggle = (p: Exclude<Panel, null>) => setPanel(panel === p ? null : p);
  return (
    <group ref={root} rotation={[-0.32, 0, 0]}>
      {/* the two open halves on their spine */}
      <RoundedBox args={[1.0, 0.82, 0.05]} radius={0.04} smoothness={4} material={leatherMat} position={[-0.5, 0, 0]} rotation={[0, 0.12, 0]} />
      <RoundedBox args={[1.0, 0.82, 0.05]} radius={0.04} smoothness={4} material={leatherMat} position={[0.5, 0, 0]} rotation={[0, -0.12, 0]} />
      <group rotation={[0, 0.12, 0]}>
        <StarTokens count={stars} onClaim={onClaim} burst={burst} />
        {/* the balance card, printed — tap to switch currency */}
        <group position={[-0.5, 0.2, 0.035]} {...balance.bind}>
          <RoundedBox args={[0.8, 0.3, 0.006]} radius={0.02} smoothness={3} material={cardMat(balance.hover ? "#f3eee2" : "#e9e3d4")} />
          <Text font={FONT} position={[-0.37, 0.12, 0.005]} fontSize={0.03} color="#5b5246" anchorX="left" anchorY="top">
            STARS · PRACTICE, NO CASH VALUE
          </Text>
          <Text font={FONT} position={[-0.37, 0.075, 0.005]} fontSize={0.1} color="#16171a" anchorX="left" anchorY="top">
            {`${stars.toLocaleString()} Stars`}
          </Text>
          <Text font={FONT} position={[-0.37, -0.055, 0.005]} fontSize={0.036} color="#2b2d31" anchorX="left" anchorY="top" maxWidth={0.74}>
            {`${coinsLine}  ·  tap to change ${currency}`}
          </Text>
          {streak && (
            <Text font={FONT} position={[0.37, 0.115, 0.005]} fontSize={0.026} color="#b45309" anchorX="right" anchorY="top">
              {streak}
            </Text>
          )}
        </group>
      </group>
      <group position={[0.5, 0, 0.03]} rotation={[0, -0.12, 0]}>
        <mesh material={innerMat}>
          <boxGeometry args={[0.94, 0.76, 0.006]} />
        </mesh>
        {/* slot lips the cards tuck behind */}
        <mesh position={[0, -0.02, 0.02]} material={lipMat}>
          <boxGeometry args={[0.9, 0.26, 0.012]} />
        </mesh>
        <SlotCard step={0} color="#e7e2d6" title="Activity" sub={history.length ? `${history.length} recent` : "No activity yet"} active={panel === "activity"} onTap={() => toggle("activity")}
          face={
            panel === "activity" ? (
              <group position={[-0.37, 0.07, 0.005]}>
                {history.slice(0, 5).map((tx, i) => (
                  <group key={i} position={[0, -i * 0.036, 0]}>
                    <Text font={FONT} fontSize={0.019} color="#2b2d31" anchorX="left" anchorY="top" maxWidth={0.24}>
                      {tx.label}
                    </Text>
                    <Text font={FONT} position={[0.74, 0, 0]} fontSize={0.019} color={tx.amount > 0 ? "#15803d" : "#b91c1c"} anchorX="right" anchorY="top">
                      {`${tx.amount > 0 ? "+" : "−"}${Math.abs(tx.amount).toLocaleString()}`}
                    </Text>
                  </group>
                ))}
              </group>
            ) : null
          }
        />
        <SlotCard step={1} color="#cfd9c6" title="Funds" sub="Add funds · cash out" active={panel === "funds"} onTap={() => toggle("funds")}>
          {funds}
        </SlotCard>
        <SlotCard step={2} color="#c9d3e3" title="Play safe" sub="Limits · reminders · breaks" active={panel === "safe"} onTap={() => toggle("safe")}>
          {safe}
        </SlotCard>
      </group>
    </group>
  );
}

export function WalletScene(props: Parameters<typeof WalletBody>[0]) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0.12, 2.45], fov: 40 }} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }}>
      {/* soft, even, glare-free light */}
      <hemisphereLight args={["#f2efe9", "#3a342e", 1.15]} />
      <directionalLight position={[1.2, 2, 3]} intensity={1.25} color="#fff4e6" />
      <WalletBody {...props} />
      <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 2 - 0.35} maxPolarAngle={Math.PI / 2 + 0.2} minAzimuthAngle={-0.5} maxAzimuthAngle={0.5} rotateSpeed={0.5} />
    </Canvas>
  );
}
