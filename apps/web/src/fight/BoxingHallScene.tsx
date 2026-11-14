"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { blobTexture, concreteTexture, woodTexture } from "@/world/textures";
import { isOnScreen, useArea } from "@/world/stage";
import type { HallLayout } from "@/rooms/layouts";
import { HallRingKit } from "./assets-shim";
import { RingSigns } from "./ring-signs";
import { FEATURE_RING } from "./plan";
import { BIG_SCREEN, BOXING_DOOR, BOXING_SIZE, FEATURE_STAGE, RINGS } from "./plan";
import { useRingKitRings } from "./rings";
import { drawBigScreen } from "./screen";
import { useFightBridge } from "./bridge";
import { FightersLayer } from "./fighters";
import { FightCamera } from "./camera";
import { RingCloseInfo } from "./ring-info";
import "./hooks"; // registers the Boxing hall's hall hooks
import { fightMockOn, startFightMock } from "./mock";
import { useBoxingNetClient } from "./game/net/client";
import { hiddenPeople } from "@/rooms/hall-hooks";
import { fightActions } from "./actions";

/**
 * The Boxing hall interior (P3-FGT-01, plan §4.3–4.5): a matte, floodlit sports hall — polished-but-matte concrete,
 * timber wall slats, black trusses — with the 50 rings (instanced ring kit), an emissive light panel over every ring,
 * contact shadows under the platforms, the raised feature stage (R1 / R2) under the four-sided screen, number boxes
 * with the status in colour AND words. Budget (Standard): shell ≈ 10 draw calls (static merge), rings ≈ 7, panels /
 * boxes / words ≈ 4, screen 1.
 */
export function BoxingHallScene({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    scene.background = new THREE.Color("#0f0f11");
  }, [scene]);
  useEffect(() => {
    startFightMock();
    // dev QA handle (like window.__gkNav); the mock replaces it with its own
    if (process.env.NODE_ENV !== "production" && !(window as unknown as { __gkFight?: unknown }).__gkFight)
      Object.assign(window as unknown as Record<string, unknown>, { __gkFight: { bridge: useFightBridge, actions: fightActions, log: [], hidden: hiddenPeople } });
  }, []);
  const rings = useRingKitRings();
  const restKey = useFightBridge((st) => (st.watched?.snap?.phase === "rest" ? st.watched.ring : "") + (st.mine?.snap?.phase === "rest" ? st.mine.ring : ""));
  const [features, training] = useMemo(() => {
    const all = rings.map((r) => ({ ...r, number: Number(r.id.slice(1)), rest: restKey.includes(r.id) }));
    return [all.filter((r) => r.feature), all.filter((r) => !r.feature)];
  }, [rings, restKey]);
  const [mock] = useState(fightMockOn);
  return (
    <group>
      {!mock && <LiveNet />}
      <HallLights lite={lite} />
      <Shell layout={layout} lite={lite} />
      <FeatureStage />
      <HallRingKit rings={training} size="training" lite={lite} />
      <HallRingKit rings={features} size="pro" y={FEATURE_RING.stage} lite={lite} />
      <RingPanels />
      <PlatformShadows />
      <RingSigns />
      <BigScreen />
      <group userData={{ noMerge: true }}>
        <RingCloseInfo />
        <FightersLayer lite={lite} />
        <FightCamera />
      </group>
    </group>
  );
}

/** G2's live boxing client (hall ring registry, claim / join / quick / watch); the mock replaces it behind ?fightmock=1 */
function LiveNet() {
  useBoxingNetClient();
  return null;
}

function HallLights({ lite }: { lite: boolean }) {
  const area = useArea();
  const spots = useRef<(THREE.SpotLight | null)[]>([]);
  useFrame(() => {
    for (const s of spots.current) if (s) s.visible = isOnScreen(area);
  });
  return (
    <group userData={{ noMerge: true }}>
      <hemisphereLight args={["#f3efe8", "#3b3a3d", lite ? 1.6 : 1.25]} />
      <ambientLight intensity={lite ? 0.25 : 0.14} />
      {/* one soft directional for shape (no shadow map over 93 m: the platforms get baked-style blobs) */}
      <directionalLight position={[14, 30, 10]} intensity={lite ? 0.9 : 1.0} color="#fff4e6" />
      {!lite &&
        RINGS.filter((r) => r.feature).map((r, i) => (
          <spotLight
            key={r.id}
            ref={(s) => void (spots.current[i] = s)}
            position={[r.x, 9.6, r.z + 1.5]}
            target-position={[r.x, r.canvasY, r.z]}
            angle={0.55}
            penumbra={0.9}
            decay={0}
            intensity={1.3}
            color="#fff6ea"
          />
        ))}
    </group>
  );
}

/* ------------------------------------------------------------ shell ------------------------------------------------------------ */

function Shell({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = BOXING_SIZE;
  const mats = useMemo(() => {
    const floorMap = concreteTexture().clone();
    floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
    floorMap.repeat.set(w / 6, d / 6);
    floorMap.needsUpdate = true;
    const slat = woodTexture().clone();
    slat.wrapS = slat.wrapT = THREE.RepeatWrapping;
    slat.repeat.set(w / 3, 1);
    slat.needsUpdate = true;
    return {
      floor: new THREE.MeshStandardMaterial({ map: floorMap, color: "#8a8780", roughness: 0.72, metalness: 0 }),
      wall: new THREE.MeshStandardMaterial({ map: concreteTexture(), color: "#4a4a4e", roughness: 0.9 }),
      slats: new THREE.MeshStandardMaterial({ map: slat, color: "#b07c50", roughness: 0.75 }),
      ceiling: new THREE.MeshStandardMaterial({ color: "#151517", roughness: 0.95 }),
      truss: new THREE.MeshStandardMaterial({ color: "#121214", roughness: 0.7, metalness: 0.4 }),
      locker: new THREE.MeshStandardMaterial({ color: "#2c2d31", roughness: 0.6, metalness: 0.3 }),
      sponsor: new THREE.MeshStandardMaterial({ color: "#1d1d20", roughness: 0.7 }),
      line: new THREE.MeshBasicMaterial({ color: new THREE.Color("#C8322A").multiplyScalar(1.4), toneMapped: false }),
    };
  }, [w, d]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const dx = layout.door.x;
  const dw = BOXING_DOOR.w + 0.3;
  const southL = dx - dw / 2 + w / 2;
  const southR = w / 2 - (dx + dw / 2);
  const trussX = useMemo(() => Array.from({ length: 16 }, (_, i) => -w / 2 + 3 + i * ((w - 6) / 15)), [w]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} material={mats.floor} receiveShadow>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, h, 0]} material={mats.ceiling}>
        <planeGeometry args={[w, d]} />
      </mesh>
      {/* walls: north / east / west full, south either side of the lobby door */}
      <mesh material={mats.wall} position={[0, h / 2, -d / 2 - 0.2]}>
        <boxGeometry args={[w + 0.8, h, 0.4]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.wall} position={[s * (w / 2 + 0.2), h / 2, 0]}>
          <boxGeometry args={[0.4, h, d]} />
        </mesh>
      ))}
      <mesh material={mats.wall} position={[-w / 2 + southL / 2, h / 2, d / 2 + 0.2]}>
        <boxGeometry args={[southL, h, 0.4]} />
      </mesh>
      <mesh material={mats.wall} position={[w / 2 - southR / 2, h / 2, d / 2 + 0.2]}>
        <boxGeometry args={[southR, h, 0.4]} />
      </mesh>
      <mesh material={mats.wall} position={[dx, (h + 3.0) / 2, d / 2 + 0.2]}>
        <boxGeometry args={[dw, h - 3.0, 0.4]} />
      </mesh>
      {/* timber slat band (lower walls) and a red light line above it */}
      <mesh material={mats.slats} position={[0, 1.6, -d / 2 + 0.03]}>
        <boxGeometry args={[w, 3.2, 0.06]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`s${s}`} material={mats.slats} position={[s * (w / 2 - 0.03), 1.6, 0]}>
          <boxGeometry args={[0.06, 3.2, d]} />
        </mesh>
      ))}
      <mesh material={mats.line} position={[0, 3.3, -d / 2 + 0.05]}>
        <boxGeometry args={[w, 0.05, 0.03]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`l${s}`} material={mats.line} position={[s * (w / 2 - 0.05), 3.3, 0]}>
          <boxGeometry args={[0.03, 0.05, d]} />
        </mesh>
      ))}
      {/* black trusses across the hall (bottom chord, top chord, verticals) */}
      {trussX.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh material={mats.truss} position={[0, h - 1.6, 0]}>
            <boxGeometry args={[0.22, 0.22, d]} />
          </mesh>
          <mesh material={mats.truss} position={[0, h - 0.3, 0]}>
            <boxGeometry args={[0.22, 0.22, d]} />
          </mesh>
          {!lite &&
            [-12, -6, 0, 6, 12].map((z) => (
              <mesh key={z} material={mats.truss} position={[0, h - 0.95, z]}>
                <boxGeometry args={[0.12, 1.3, 0.12]} />
              </mesh>
            ))}
        </group>
      ))}
      {/* back wall: lockers either side, sponsor wall in the middle */}
      {[-1, 1].map((s) => (
        <mesh key={`k${s}`} material={mats.locker} position={[s * 30, 1.1, -d / 2 + 0.33]}>
          <boxGeometry args={[22, 2.2, 0.6]} />
        </mesh>
      ))}
      <mesh material={mats.sponsor} position={[0, 5.0, -d / 2 + 0.05]}>
        <boxGeometry args={[16, 4, 0.08]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------ feature stage ------------------------------------------------------------ */

function FeatureStage() {
  const mats = useMemo(
    () => ({
      stage: new THREE.MeshStandardMaterial({ color: "#232326", roughness: 0.8 }),
      rail: new THREE.MeshStandardMaterial({ color: "#151517", roughness: 0.5, metalness: 0.6 }),
      edge: new THREE.MeshBasicMaterial({ color: new THREE.Color("#C8322A").multiplyScalar(1.3), toneMapped: false }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const s = FEATURE_STAGE;
  const depth = s.z0 - s.z1;
  const cz = (s.z0 + s.z1) / 2;
  const railR = s.hw + 0.9;
  return (
    <group>
      <mesh material={mats.stage} position={[0, 0.6, cz]} receiveShadow>
        <boxGeometry args={[s.hw * 2, 1.2, depth]} />
      </mesh>
      <mesh material={mats.edge} position={[0, 1.18, s.z0 + 0.01]}>
        <boxGeometry args={[s.hw * 2, 0.04, 0.02]} />
      </mesh>
      {/* the spectator rail round the stage (standing tier: the floor in front of R1 and the side aisles) */}
      {[-1, 1].map((sd) => (
        <mesh key={sd} material={mats.rail} position={[sd * railR, 1.0, cz]}>
          <boxGeometry args={[0.06, 0.06, depth + 1.8]} />
        </mesh>
      ))}
      <mesh material={mats.rail} position={[0, 1.0, s.z0 + 0.9]}>
        <boxGeometry args={[railR * 2, 0.06, 0.06]} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => -railR + (i * railR * 2) / 8).map((x) => (
        <mesh key={x} material={mats.rail} position={[x, 0.5, s.z0 + 0.9]}>
          <boxGeometry args={[0.05, 1.0, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------ light panels + contact shadows ------------------------------------------------------------ */

/** an emissive light panel over every ring (instanced; no real light per ring) */
function RingPanels() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 0.08, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff3e2").multiplyScalar(0.92), toneMapped: false }), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    RINGS.forEach((r, i) => {
      const s = r.feature ? 3.0 : 1.9;
      m.compose(new THREE.Vector3(r.x, r.feature ? 9.4 : 7.4, r.z), new THREE.Quaternion(), new THREE.Vector3(s, 1, s));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
  }, []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  return <instancedMesh ref={ref} args={[geo, mat, RINGS.length]} userData={{ noMerge: true }} />;
}

/** baked-style soft shadows under the platforms (one instanced decal) */
function PlatformShadows() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: blobTexture(), color: "#000000", transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    RINGS.forEach((r, i) => {
      const s = r.half * 2 + 2.2;
      m.compose(new THREE.Vector3(r.x, r.feature ? 1.21 : 0.01, r.z), new THREE.Quaternion(), new THREE.Vector3(s, 1, s));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
  }, []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  return <instancedMesh ref={ref} args={[geo, mat, RINGS.length]} renderOrder={1} userData={{ noMerge: true }} />;
}

/* ------------------------------------------------------------ big screen ------------------------------------------------------------ */

/** the four-sided screen over the feature zone: one CanvasTexture redrawn at 10 Hz while the hall is on screen */
function BigScreen() {
  const area = useArea();
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 288;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const mats = useMemo(() => ({ face: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), frame: new THREE.MeshStandardMaterial({ color: "#0c0c0e", roughness: 0.5, metalness: 0.5 }) }), [tex]);
  useEffect(() => () => (tex.dispose(), mats.face.dispose(), mats.frame.dispose()), [tex, mats]);
  const acc = useRef(1);
  useFrame((_, dt) => {
    if (!isOnScreen(area)) return;
    acc.current += dt;
    if (acc.current < 0.1) return;
    acc.current = 0;
    drawBigScreen(tex.image as HTMLCanvasElement);
    tex.needsUpdate = true;
  });
  const { x, z, y, w, h } = BIG_SCREEN;
  return (
    <group position={[x, y, z]} userData={{ noMerge: true }}>
      <mesh material={mats.frame}>
        <boxGeometry args={[w + 0.2, h + 0.2, w + 0.2]} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} material={mats.face} rotation-y={(k * Math.PI) / 2}>
          <group position={[0, 0, w / 2 + 0.11]}>
            <mesh material={mats.face}>
              <planeGeometry args={[w, h]} />
            </mesh>
          </group>
        </mesh>
      ))}
      {/* hanging cables to the trusses */}
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.frame} position={[s * (w / 2 - 0.3), h / 2 + (BOXING_SIZE.h - 1.6 - y - h / 2) / 2, 0]}>
          <boxGeometry args={[0.03, BOXING_SIZE.h - 1.6 - y - h / 2, 0.03]} />
        </mesh>
      ))}
    </group>
  );
}
