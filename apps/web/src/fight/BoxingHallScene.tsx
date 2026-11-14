"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RING_STATUSES, type RingStatus } from "@gukirana/contracts";
import { atlasPlane, labelAtlas, type LabelAtlas } from "@/world/label-atlas";
import { blobTexture, concreteTexture, woodTexture } from "@/world/textures";
import { isOnScreen, useArea } from "@/world/stage";
import type { HallLayout } from "@/rooms/layouts";
import { FeatureRingKit, STATUS_LAMP } from "./assets-shim";
import { TrainingRings } from "./training-rings";
import { FEATURE_RING } from "./plan";
import { BIG_SCREEN, BOXING_DOOR, BOXING_SIZE, FEATURE_STAGE, RINGS } from "./plan";
import { useRingKitRings, useRingStatuses } from "./rings";
import { drawBigScreen } from "./screen";
import { useFightBridge } from "./bridge";
import { F } from "./strings";
import { FightersLayer } from "./fighters";
import { FightCamera } from "./camera";
import { RingCloseInfo } from "./ring-info";
import "./hooks"; // registers the Boxing hall's hall hooks
import { startFightMock } from "./mock";
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
  const features = useMemo(
    () => rings.filter((r) => r.feature).map((r) => ({ ...r, number: Number(r.id.slice(1)), rest: restKey.includes(r.id + "") && restKey.length > 0 })),
    [rings, restKey],
  );
  return (
    <group>
      <HallLights lite={lite} />
      <Shell layout={layout} lite={lite} />
      <FeatureStage />
      <TrainingRings rings={rings.filter((r) => !r.feature)} lite={lite} />
      <FeatureRingKit rings={features} y={FEATURE_RING.stage} lite={lite} />
      <RingPanels />
      <PlatformShadows />
      <NumberBoxes />
      <BigScreen />
      <group userData={{ noMerge: true }}>
        <RingCloseInfo />
        <FightersLayer lite={lite} />
        <FightCamera />
      </group>
    </group>
  );
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

/* ------------------------------------------------------------ number boxes ------------------------------------------------------------ */

let numberAtlas: LabelAtlas | null = null;
let wordAtlas: LabelAtlas | null = null;
const boxY = (r: (typeof RINGS)[number]) => (r.feature ? r.canvasY + 2.9 : 4.3);

/**
 * A number box over every ring: the ring number on all four faces (static, one atlas → one batched draw), a status
 * lamp strip in the status colour and the status in words under it (one dynamic quad batch: re-written when a status
 * changes). Colour plus text, never colour alone.
 */
function NumberBoxes() {
  const statuses = useRingStatuses();
  const parts = useMemo(() => {
    numberAtlas ??= labelAtlas(RINGS.map((r) => ({ text: r.id.slice(1), px: 96 })), { cols: 10, cellW: 160, cellH: 128, ink: "#ffffff", paper: "#141416" });
    wordAtlas ??= labelAtlas(RING_STATUSES.map((s) => ({ text: F.status[s].toUpperCase(), px: 64 })), { cols: 1, cellW: 512, cellH: 112, ink: "#ffffff", paper: "#141416", letterSpacing: 0.08 });
    // the numbers: four faces per box, merged into one geometry
    const faces: THREE.BufferGeometry[] = [];
    const words: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    for (const r of RINGS) {
      const y = boxY(r);
      const S = r.feature ? 1.3 : 0.9;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const g = atlasPlane(S, S * 0.8, numberAtlas.uv(RINGS.indexOf(r)));
        g.translate(0, 0, S / 2 + 0.005);
        g.rotateY(a);
        g.translate(r.x, y, r.z);
        faces.push(g);
        const wg = atlasPlane(S, S * 0.22, wordAtlas.uv(0));
        wg.translate(0, -S * 0.56, S / 2 + 0.005);
        wg.rotateY(a);
        wg.translate(r.x, y, r.z);
        words.push(wg);
        const lg = new THREE.PlaneGeometry(S, 0.07);
        lg.translate(0, -S * 0.43, S / 2 + 0.007);
        lg.rotateY(a);
        lg.translate(r.x, y, r.z);
        lamps.push(lg);
      }
    }
    const word = mergeGeometries(words)!;
    const lamp = mergeGeometries(lamps)!;
    lamp.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(lamp.getAttribute("position").count * 3), 3));
    return {
      faces: mergeGeometries(faces)!,
      word,
      lamp,
      body: new THREE.BoxGeometry(1, 1, 1),
      faceMat: new THREE.MeshBasicMaterial({ map: numberAtlas.texture, toneMapped: false }),
      wordMat: new THREE.MeshBasicMaterial({ map: wordAtlas.texture, toneMapped: false }),
      lampMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      bodyMat: new THREE.MeshStandardMaterial({ color: "#101012", roughness: 0.6 }),
    };
  }, []);
  // status words + lamp strip colours follow the statuses
  useLayoutEffect(() => {
    const uv = parts.word.getAttribute("uv") as THREE.BufferAttribute;
    const col = parts.lamp.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color();
    const perRing = 4 * 4; // 4 faces × 4 vertices (plane 1×1 segments)
    RINGS.forEach((_, i) => {
      const st: RingStatus = statuses[i] ?? "free";
      const [u0, v0, u1, v1] = wordAtlas!.uv(RING_STATUSES.indexOf(st));
      for (let v = 0; v < perRing; v++) {
        const idx = i * perRing + v;
        // PlaneGeometry vertex order: (0,1) (1,1) (0,0) (1,0)
        const corner = v % 4;
        uv.setXY(idx, corner % 2 === 0 ? u0 : u1, corner < 2 ? v1 : v0);
      }
      c.set(STATUS_LAMP[st]).multiplyScalar(1.3);
      for (let v = 0; v < perRing; v++) col.setXYZ(i * perRing + v, c.r, c.g, c.b);
    });
    uv.needsUpdate = true;
    col.needsUpdate = true;
  }, [statuses, parts]);
  useEffect(
    () => () => {
      for (const v of Object.values(parts)) (v as { dispose?: () => void }).dispose?.();
    },
    [parts],
  );
  return (
    <group userData={{ noMerge: true }}>
      <mesh geometry={parts.faces} material={parts.faceMat} />
      <mesh geometry={parts.word} material={parts.wordMat} />
      <mesh geometry={parts.lamp} material={parts.lampMat} />
      <BoxBodies geo={parts.body} mat={parts.bodyMat} />
    </group>
  );
}

function BoxBodies({ geo, mat }: { geo: THREE.BufferGeometry; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    RINGS.forEach((r, i) => {
      const S = r.feature ? 1.3 : 0.9;
      m.compose(new THREE.Vector3(r.x, boxY(r) - S * 0.12, r.z), new THREE.Quaternion(), new THREE.Vector3(S - 0.004, S * 1.06, S - 0.004));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
  }, []);
  return <instancedMesh ref={ref} args={[geo, mat, RINGS.length]} />;
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
