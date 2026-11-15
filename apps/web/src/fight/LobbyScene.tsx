"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { FIGHT_SUBHALLS, CORNER_COLORS } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { atlasPlane, labelAtlas, type LabelAtlas } from "@/world/label-atlas";
import { concreteTexture, woodTexture } from "@/world/textures";
import { enterSubhall, getArea, isOnScreen, useArea, useStage } from "@/world/stage";
import type { HallLayout } from "@/rooms/layouts";
import { STATUS_LAMP } from "./assets-shim";
import { useFightBridge } from "./bridge";
import { BOXING_DOOR_LINE_Z, LOBBY_BACK_Z, LOBBY_BENCHES, LOBBY_BOARD, LOBBY_PASSAGE, LOBBY_SIZE, RINGS, SUBHALL_DOOR_W, SUBHALL_DOOR_X } from "./plan";
import { ringCounts } from "./rings";
import { F } from "./strings";
import { FIGHT_ON } from "./flags";
import { startFightMock } from "./mock";
import { LobbyVenue } from "./lobby-venue";
import { GymLife } from "./gym-life";

const FONT = "/fonts/Baloo2.ttf";

/**
 * Fight Games hall lobby (`hall:fight`, plan §4.2): a short matte foyer — concrete floor, charcoal walls with timber
 * slats — with four lit portals in the back wall: Boxing (open, live count, a sliding door into the passage to the
 * Boxing hall) and Kickboxing / Wrestling / Karate behind closed shutters ("Coming soon"). A live ring status board,
 * two benches and posters. Small and cheap: one static batch + the board texture.
 */
export function LobbyScene({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    scene.background = new THREE.Color("#2b2926");
  }, [scene]);
  useEffect(() => startFightMock(), []);
  return (
    <group>
      <hemisphereLight args={["#fbf3e8", "#5a5650", lite ? 2.0 : 1.65]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[4, 12, 8]} intensity={1.15} color="#fff1df" />
      <LobbyShell layout={layout} />
      <CeilingLights />
      <Portals />
      <StatusBoard />
      <group userData={{ noMerge: true }}>
        <PassageDoor />
        <LobbyVenue />
        <GymLife room="fight" lite={lite} />
        <LiveCount />
        <SubhallSensor />
      </group>
    </group>
  );
}

/** Three warm linear light strips across the ceiling (emissive, no real lights: the hemisphere + key light do the work). */
function CeilingLights() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff3df", toneMapped: false }), []);
  const { w, d, h } = LOBBY_SIZE;
  const zs = [LOBBY_BACK_Z + 1.6, (LOBBY_BACK_Z + d / 2) / 2, d / 2 - 1.6];
  return (
    <>
      {zs.map((z) => (
        <mesh key={z} material={mat} position={[0, h - 0.03, z]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w - 4, 0.28]} />
        </mesh>
      ))}
    </>
  );
}

function LobbyShell({ layout }: { layout: HallLayout }) {
  const { w, d, h } = LOBBY_SIZE;
  const front = d / 2;
  const back = LOBBY_BACK_Z;
  const mats = useMemo(() => {
    const fl = concreteTexture().clone();
    fl.wrapS = fl.wrapT = THREE.RepeatWrapping;
    fl.repeat.set(5, 2);
    fl.needsUpdate = true;
    const sl = woodTexture().clone();
    sl.wrapS = sl.wrapT = THREE.RepeatWrapping;
    sl.repeat.set(6, 1);
    sl.needsUpdate = true;
    return {
      floor: new THREE.MeshStandardMaterial({ map: fl, color: "#8f8b84", roughness: 0.7 }),
      wall: new THREE.MeshStandardMaterial({ map: concreteTexture(), color: "#8a847a", roughness: 0.9 }),
      slats: new THREE.MeshStandardMaterial({ map: sl, color: "#b07c50", roughness: 0.75 }),
      ceil: new THREE.MeshStandardMaterial({ color: "#4a4641", roughness: 0.95 }),
      panel: new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff4e6").multiplyScalar(1.1), toneMapped: false }),
      bench: new THREE.MeshStandardMaterial({ map: woodTexture(), color: "#c89a6a", roughness: 0.65 }),
      steel: new THREE.MeshStandardMaterial({ color: "#1a1a1d", roughness: 0.5, metalness: 0.6 }),
      red: new THREE.MeshBasicMaterial({ color: new THREE.Color(CORNER_COLORS.red).multiplyScalar(1.6), toneMapped: false }),
      blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(CORNER_COLORS.blue).multiplyScalar(1.6), toneMapped: false }),
      passage: new THREE.MeshStandardMaterial({ color: "#55514b", roughness: 0.85 }),
      glimpse: new THREE.MeshBasicMaterial({ color: "#d8d3c8", toneMapped: false }),
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const dw = layout.door.w + 0.3;
  const sideW = (w - dw) / 2;
  const bx = SUBHALL_DOOR_X.boxing;
  const pw = LOBBY_PASSAGE.w;
  const depth = front - back;
  const cz = (front + back) / 2;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, cz]} material={mats.floor} receiveShadow>
        <planeGeometry args={[w, depth]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, h, cz]} material={mats.ceil}>
        <planeGeometry args={[w, depth]} />
      </mesh>
      {/* south wall with the plaza door */}
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.wall} position={[s * (dw / 2 + sideW / 2), h / 2, front + 0.2]}>
          <boxGeometry args={[sideW, h, 0.4]} />
        </mesh>
      ))}
      <mesh material={mats.wall} position={[0, (h + 3.0) / 2, front + 0.2]}>
        <boxGeometry args={[dw, h - 3.0, 0.4]} />
      </mesh>
      {/* side walls with timber slats */}
      {[-1, 1].map((s) => (
        <group key={`w${s}`}>
          <mesh material={mats.wall} position={[s * (w / 2 + 0.2), h / 2, cz]}>
            <boxGeometry args={[0.4, h, depth]} />
          </mesh>
          <mesh material={mats.slats} position={[s * (w / 2 - 0.03), 1.5, cz]}>
            <boxGeometry args={[0.06, 3.0, depth]} />
          </mesh>
          <mesh material={s < 0 ? mats.red : mats.blue} position={[s * (w / 2 - 0.05), 3.15, cz]}>
            <boxGeometry args={[0.03, 0.05, depth]} />
          </mesh>
        </group>
      ))}
      {/* back wall either side of the Boxing doorway (the other doorways are shuttered recesses, see Portals) */}
      <mesh material={mats.wall} position={[(-w / 2 + bx - pw / 2) / 2, h / 2, back - 0.2]}>
        <boxGeometry args={[bx - pw / 2 + w / 2, h, 0.4]} />
      </mesh>
      <mesh material={mats.wall} position={[(bx + pw / 2 + w / 2) / 2, h / 2, back - 0.2]}>
        <boxGeometry args={[w / 2 - (bx + pw / 2), h, 0.4]} />
      </mesh>
      <mesh material={mats.wall} position={[bx, (h + 3.0) / 2, back - 0.2]}>
        <boxGeometry args={[pw, h - 3.0, 0.4]} />
      </mesh>
      {/* the passage to the Boxing hall: side walls, ceiling, and the hall's light seen at its end */}
      {[-1, 1].map((s) => (
        <mesh key={`p${s}`} material={mats.passage} position={[bx + s * (pw / 2 + 0.1), 1.5, back - 0.4 - LOBBY_PASSAGE.d / 2]}>
          <boxGeometry args={[0.2, 3.0, LOBBY_PASSAGE.d]} />
        </mesh>
      ))}
      <mesh material={mats.passage} position={[bx, 3.05, back - 0.4 - LOBBY_PASSAGE.d / 2]}>
        <boxGeometry args={[pw + 0.4, 0.1, LOBBY_PASSAGE.d]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[bx, 0.002, back - 0.4 - LOBBY_PASSAGE.d / 2]} material={mats.floor}>
        <planeGeometry args={[pw, LOBBY_PASSAGE.d]} />
      </mesh>
      <mesh material={mats.glimpse} position={[bx, 1.5, back - 0.4 - LOBBY_PASSAGE.d + 0.02]}>
        <planeGeometry args={[pw, 3.0]} />
      </mesh>
      {/* ceiling light panels */}
      {[-9, -3, 3, 9].map((x) => (
        <mesh key={`l${x}`} material={mats.panel} position={[x, h - 0.05, cz]}>
          <boxGeometry args={[3.2, 0.06, 1.2]} />
        </mesh>
      ))}
      {/* benches */}
      {LOBBY_BENCHES.map((b) => (
        <group key={b.x} position={[b.x, 0, b.z]}>
          <mesh material={mats.bench} position={[0, 0.44, 0]}>
            <boxGeometry args={[b.w, 0.08, b.d]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} material={mats.steel} position={[s * (b.w / 2 - 0.2), 0.2, 0]}>
              <boxGeometry args={[0.08, 0.4, b.d - 0.1]} />
            </mesh>
          ))}
        </group>
      ))}
      <Posters />
    </group>
  );
}

let posterAtlas: LabelAtlas | null = null;
/** two posters on the west wall (lettering from the strings, one atlas) */
function Posters() {
  const parts = useMemo(() => {
    posterAtlas ??= labelAtlas(
      [
        { text: F.posterTitle.toUpperCase(), px: 120 },
        { text: F.posterSub, px: 56 },
        { text: F.posterRules, px: 44 },
      ],
      { cols: 1, cellW: 1024, cellH: 192, ink: "#ffffff", paper: "#7d1d18", letterSpacing: 0.04 },
    );
    return { mat: new THREE.MeshBasicMaterial({ map: posterAtlas.texture, toneMapped: false }), a: posterAtlas };
  }, []);
  useEffect(() => () => parts.mat.dispose(), [parts]);
  const x = -LOBBY_SIZE.w / 2 + 0.07;
  return (
    <group position={[x, 0, 0]} rotation-y={Math.PI / 2}>
      {[-1.6, 2.6].map((z, i) => (
        <group key={z} position={[-z, 2.3, 0]}>
          <mesh geometry={atlasPlane(2.2, 0.42, parts.a.uv(0))} material={parts.mat} position={[0, 0.35, 0]} />
          <mesh geometry={atlasPlane(2.2, 0.2, parts.a.uv(i === 0 ? 1 : 2))} material={parts.mat} position={[0, -0.05, 0]} />
        </group>
      ))}
    </group>
  );
}

let portalAtlas: LabelAtlas | null = null;
/** the four sub-hall portals: lit name header, open Boxing doorway or a closed shutter with "Coming soon" */
function Portals() {
  const parts = useMemo(() => {
    portalAtlas ??= labelAtlas([...FIGHT_SUBHALLS.map((s) => ({ text: F.subhall[s.id].toUpperCase(), px: 84 })), { text: F.comingSoon.toUpperCase(), px: 60 }], {
      cols: 1,
      cellW: 768,
      cellH: 144,
      ink: "#ffffff",
      paper: "#161618",
      letterSpacing: 0.1,
    });
    return {
      label: new THREE.MeshBasicMaterial({ map: portalAtlas.texture, toneMapped: false }),
      frame: new THREE.MeshStandardMaterial({ color: "#111113", roughness: 0.45, metalness: 0.6 }),
      shutter: new THREE.MeshStandardMaterial({ color: "#5b5c60", roughness: 0.6, metalness: 0.5 }),
      lit: new THREE.MeshBasicMaterial({ color: new THREE.Color("#C8322A").multiplyScalar(1.5), toneMapped: false }),
      dim: new THREE.MeshBasicMaterial({ color: "#4a4a4e", toneMapped: false }),
      a: portalAtlas,
    };
  }, []);
  useEffect(() => () => [parts.label, parts.frame, parts.shutter, parts.lit, parts.dim].forEach((m) => m.dispose()), [parts]);
  const z = LOBBY_BACK_Z + 0.02;
  const W = SUBHALL_DOOR_W;
  return (
    <group>
      {FIGHT_SUBHALLS.map((s, i) => {
        const x = SUBHALL_DOOR_X[s.id];
        const open = s.open && FIGHT_ON;
        return (
          <group key={s.id} position={[x, 0, z]}>
            {/* frame */}
            {[-1, 1].map((sd) => (
              <mesh key={sd} material={parts.frame} position={[sd * (W / 2 + 0.12), 1.55, 0.06]}>
                <boxGeometry args={[0.2, 3.1, 0.14]} />
              </mesh>
            ))}
            <mesh material={parts.frame} position={[0, 3.62, 0.06]}>
              <boxGeometry args={[W + 0.44, 1.0, 0.14]} />
            </mesh>
            <mesh geometry={atlasPlane(W + 0.3, 0.56, parts.a.uv(i))} material={parts.label} position={[0, 3.62, 0.14]} />
            <mesh material={open ? parts.lit : parts.dim} position={[0, 3.08, 0.14]}>
              <boxGeometry args={[W + 0.3, 0.05, 0.02]} />
            </mesh>
            {!s.open || !FIGHT_ON ? (
              <>
                <mesh material={parts.shutter} position={[0, 1.5, -0.02]}>
                  <boxGeometry args={[W, 3.0, 0.06]} />
                </mesh>
                {Array.from({ length: 12 }, (_, k) => (
                  <mesh key={k} material={parts.frame} position={[0, 0.15 + k * 0.25, 0.02]}>
                    <boxGeometry args={[W, 0.02, 0.02]} />
                  </mesh>
                ))}
                <mesh geometry={atlasPlane(W - 0.2, 0.36, parts.a.uv(FIGHT_SUBHALLS.length))} material={parts.label} position={[0, 1.7, 0.05]} />
              </>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

/**
 * The Boxing portal's live count, from the ring registry, on a small glass plaque beside the doorway at eye level
 * (P3-FGT-04). It used to float over the portal header at 4.3 m, which in the default walk-up framing sat at the very
 * top of the screen, half hidden behind the HUD cards ("…nts on now" peeking out beside the profile card).
 */
const PLAQUE = { x: SUBHALL_DOOR_X.boxing + SUBHALL_DOOR_W / 2 + 1.15, y: 1.75, w: 1.5, h: 0.7 };
function LiveCount() {
  const counts = useFightBridge((s) => {
    const n = ringCounts(s.rings);
    return `${n.fights}:${n.free}`;
  });
  const [fights, free] = counts.split(":").map(Number) as [number, number];
  if (!FIGHT_ON) return null;
  const z = LOBBY_BACK_Z + 0.03;
  return (
    <group position={[PLAQUE.x, PLAQUE.y, z]}>
      <mesh>
        <boxGeometry args={[PLAQUE.w, PLAQUE.h, 0.04]} />
        <meshStandardMaterial color="#121214" roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh position={[-PLAQUE.w / 2 + 0.16, PLAQUE.h / 2 - 0.16, 0.022]}>
        <circleGeometry args={[0.045, 20]} />
        <meshBasicMaterial color={STATUS_LAMP.free} toneMapped={false} />
      </mesh>
      <Text font={FONT} fontSize={0.12} letterSpacing={0.12} color="#ffffff" position={[-PLAQUE.w / 2 + 0.26, PLAQUE.h / 2 - 0.16, 0.024]} anchorX="left" anchorY="middle">
        {F.open.toUpperCase()}
        <meshBasicMaterial color="#d8d4cc" toneMapped={false} />
      </Text>
      <Text font={FONT} fontSize={0.17} color="#ffffff" position={[-PLAQUE.w / 2 + 0.12, -0.02, 0.024]} anchorX="left" anchorY="middle" maxWidth={PLAQUE.w - 0.24}>
        {F.fightsOn(fights)}
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </Text>
      <Text font={FONT} fontSize={0.13} color="#ffffff" position={[-PLAQUE.w / 2 + 0.12, -PLAQUE.h / 2 + 0.14, 0.024]} anchorX="left" anchorY="middle" maxWidth={PLAQUE.w - 0.24}>
        {F.ringsFree(free)}
        <meshBasicMaterial color="#bfe6cc" toneMapped={false} />
      </Text>
    </group>
  );
}

/** sliding door of the Boxing doorway: opens as you walk up (or anyone stands at it) */
function PassageDoor() {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const area = useArea();
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#b9c4c9", transparent: true, opacity: 0.22, roughness: 0.08, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const x = SUBHALL_DOOR_X.boxing;
  useFrame((_, dt) => {
    if (!FIGHT_ON) return;
    let near = isOnScreen(area) && Math.hypot(selfPose.x - x, selfPose.z - LOBBY_BACK_Z) < 3.4;
    for (const p of Object.values(useWorld.getState().players)) if (Math.hypot(p.x / 100 - x, p.z / 100 - LOBBY_BACK_Z) < 3) near = true;
    open.current = THREE.MathUtils.clamp(open.current + (near ? dt / 0.6 : -dt / 0.9), 0, 1);
    const k = open.current * open.current * (3 - 2 * open.current);
    const hw = LOBBY_PASSAGE.w / 4;
    if (left.current) left.current.position.x = x - hw - k * (hw * 2 - 0.05);
    if (right.current) right.current.position.x = x + hw + k * (hw * 2 - 0.05);
  });
  if (!FIGHT_ON) return null;
  return (
    <>
      <mesh ref={left} material={mat} position={[x - LOBBY_PASSAGE.w / 4, 1.5, LOBBY_BACK_Z - 0.1]} renderOrder={3}>
        <boxGeometry args={[LOBBY_PASSAGE.w / 2, 3.0, 0.02]} />
      </mesh>
      <mesh ref={right} material={mat} position={[x + LOBBY_PASSAGE.w / 4, 1.5, LOBBY_BACK_Z - 0.13]} renderOrder={3}>
        <boxGeometry args={[LOBBY_PASSAGE.w / 2, 3.0, 0.02]} />
      </mesh>
    </>
  );
}

/**
 * Hall → hall crossing (lobby → Boxing hall): once you are in the passage and the lobby camera has followed you through
 * the door line, the Boxing hall takes over with the same pose (world/stage.ts enterSubhall). The Boxing hall is kept
 * warm while you are in the lobby, so the switch has no loading gap.
 */
function SubhallSensor() {
  const area = useArea();
  useEffect(() => {
    if (FIGHT_ON && isOnScreen(area)) useStage.getState().warmHall("boxing");
  });
  useFrame(() => {
    if (!FIGHT_ON || !isOnScreen(area)) return;
    if (useStage.getState().warm[0] !== "boxing") useStage.getState().warmHall("boxing");
    const x = SUBHALL_DOOR_X.boxing;
    if (Math.abs(selfPose.x - x) > LOBBY_PASSAGE.w / 2 || selfPose.z > BOXING_DOOR_LINE_Z - 0.6) return;
    const cam = getArea("hall:fight").camera;
    if (cam.position.z < BOXING_DOOR_LINE_Z - 0.45 || selfPose.z < BOXING_DOOR_LINE_Z - LOBBY_PASSAGE.d + 1.0) enterSubhall();
  });
  return null;
}

/** the live ring status board on the east wall: 50 cells in hall order, colour + ring number, redrawn at 1 Hz */
function StatusBoard() {
  const area = useArea();
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  useEffect(() => () => (tex.dispose(), mat.dispose()), [tex, mat]);
  const acc = useRef(2);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 1 || (!isOnScreen(area) && acc.current < 10)) return;
    acc.current = 0;
    drawBoard(tex.image as HTMLCanvasElement);
    tex.needsUpdate = true;
  });
  const b = LOBBY_BOARD;
  return (
    <group position={[b.x, b.y, b.z]} rotation-y={-Math.PI / 2} userData={{ noMerge: true }}>
      <mesh position={[0, 0, -0.03]}>
        <boxGeometry args={[b.w + 0.2, b.h + 0.2, 0.06]} />
        <meshStandardMaterial color="#0c0c0e" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* 8 mm proud of the frame: the face used to be coplanar with the frame front and z-fought in black blocks */}
      <mesh material={mat} position={[0, 0, 0.008]}>
        <planeGeometry args={[b.w, b.h]} />
      </mesh>
    </group>
  );
}

function drawBoard(c: HTMLCanvasElement) {
  const g = c.getContext("2d")!;
  const rings = useFightBridge.getState().rings;
  g.fillStyle = "#0e0e10";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffffff";
  g.font = "700 40px sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText(`${F.boxingHall} · ${F.statusBoard}`, 32, 44);
  const n = ringCounts(rings);
  g.textAlign = "right";
  g.font = "500 28px sans-serif";
  g.fillStyle = "#cfcfcf";
  g.fillText(`${F.fightsOn(n.fights)} · ${F.ringsFree(n.free)}`, c.width - 32, 44);
  // 10 × 5 grid of cells
  const cw = 92;
  const ch = 70;
  const x0 = (c.width - cw * 10) / 2;
  const y0 = 96;
  g.textAlign = "center";
  RINGS.forEach((r, i) => {
    const st = rings[r.id]?.status ?? "free";
    const x = x0 + (i % 10) * cw;
    const y = y0 + Math.floor(i / 10) * (ch + 10);
    g.fillStyle = STATUS_LAMP[st];
    g.globalAlpha = st === "closed" ? 0.4 : 1;
    g.fillRect(x + 4, y, cw - 8, ch);
    g.globalAlpha = 1;
    g.fillStyle = st === "practice" || st === "waiting" ? "#111111" : "#ffffff";
    g.font = "700 28px sans-serif";
    g.fillText(r.id.slice(1), x + cw / 2, y + ch * 0.38);
    g.font = "500 15px sans-serif";
    g.fillText(F.status[st], x + cw / 2, y + ch * 0.76);
  });
}
