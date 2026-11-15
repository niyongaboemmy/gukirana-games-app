"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
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
import { ringCounts, shownStatus } from "./rings";
import { clock as holdClock, pfill } from "@/lib/place-strings";
import { F } from "./strings";
import { FIGHT_ON } from "./flags";
import { startFightMock } from "./mock";
import { LobbyVenue } from "./lobby-venue";
import { GymLife } from "./gym-life";
import { HallGlimpse } from "./hall-glimpse";
import { goToRingFromLobby } from "./ring-goto";
import { OutdoorView } from "@/rooms/OutdoorView";
import { DoorGlimpse } from "@/rooms/shell";

const FONT = "/fonts/Baloo2.ttf";

/**
 * Fight Games hall lobby (`hall:fight`, plan §4.2): a short matte foyer — concrete floor, charcoal walls with timber
 * slats — with four lit portals in the back wall: Boxing (open, live count, a sliding door into the passage to the
 * Boxing hall) and Kickboxing / Wrestling / Karate behind closed shutters ("Coming soon"). A live ring status board,
 * two benches and posters. Small and cheap: one static batch + the board texture.
 */
export function LobbyScene({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  useEffect(() => startFightMock(), []);
  return (
    <group>
      {/* the plaza through the open front door, as in every plaza hall: the real plaza at its true bearing plus the
          captured landscape as the backdrop (it used to be a flat dark colour behind the glass) */}
      <OutdoorView layout={layout} lite={lite} />
      <DoorGlimpse layout={layout} lite={lite} />
      <hemisphereLight args={["#fbf3e8", "#5a5650", lite ? 2.0 : 1.65]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[4, 12, 8]} intensity={1.15} color="#fff1df" />
      <LobbyShell layout={layout} />
      <CeilingLights />
      <Portals />
      <BoxingWay />
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

/**
 * The way to the Boxing hall (P2-WLD-13): a line of lit chevrons inlaid in the floor from the plaza door, past the
 * benches, to the Boxing doorway (one shared geometry + material: merged into the lobby's static batch).
 */
function BoxingWay() {
  const parts = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.3, -0.14);
    s.lineTo(0, 0.14);
    s.lineTo(0.3, -0.14);
    s.lineTo(0.3, -0.02);
    s.lineTo(0, 0.26);
    s.lineTo(-0.3, -0.02);
    s.closePath();
    return {
      geo: new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI),
      // inlaid in the floor: pulled towards the camera in depth (6 mm alone z-fought with the floor far down the foyer)
      mat: new THREE.MeshBasicMaterial({ color: "#e0453a", toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
  }, []);
  useEffect(() => () => (parts.geo.dispose(), parts.mat.dispose()), [parts]);
  const marks = useMemo(() => {
    const bx = SUBHALL_DOOR_X.boxing;
    // straight ahead from the door (in view as you walk in), left along the middle of the foyer, into the doorway
    const pts = [
      { x: 0, z: LOBBY_SIZE.d / 2 - 1.4 },
      { x: 0, z: 1.3 },
      { x: bx, z: 1.3 },
      { x: bx, z: LOBBY_BACK_Z + 0.5 },
    ];
    const out: { x: number; z: number; rot: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = i ? 0.6 : 0; s < L - 0.3; s += 0.85) out.push({ x: a.x + ((b.x - a.x) * s) / L, z: a.z + ((b.z - a.z) * s) / L, rot: Math.atan2(b.x - a.x, b.z - a.z) });
    }
    return out;
  }, []);
  return (
    <group name="boxing-way">
      {marks.map((m, i) => (
        <mesh key={i} geometry={parts.geo} material={parts.mat} position={[m.x, 0.006, m.z]} rotation={[0, m.rot, 0]} />
      ))}
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
      {/* south wall with the plaza door (gkSouth: left out of the glass captures, which look in through it) */}
      <group userData={{ noMerge: true, gkSouth: true }}>
        {[-1, 1].map((s) => (
          <mesh key={s} material={mats.wall} position={[s * (dw / 2 + sideW / 2), h / 2, front + 0.2]}>
            <boxGeometry args={[sideW, h, 0.4]} />
          </mesh>
        ))}
        <mesh material={mats.wall} position={[0, (h + 3.0) / 2, front + 0.2]}>
          <boxGeometry args={[dw, h - 3.0, 0.4]} />
        </mesh>
      </group>
      {/* side walls with timber slats */}
      {[-1, 1].map((s) => (
        <group key={`w${s}`}>
          <mesh material={mats.wall} position={[s * (w / 2 + 0.2), h / 2, cz]}>
            <boxGeometry args={[0.4, h, depth]} />
          </mesh>
          {/* 5 mm off the wall face (the live board's bezel is mounted on the wall itself) */}
          <mesh material={mats.slats} position={[s * (w / 2 - 0.0325), 1.5, cz]}>
            <boxGeometry args={[0.055, 3.0, depth]} />
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
      {/* dark gray threshold through the doorway (the wall's 40 cm had no floor: the backdrop showed through) */}
      <mesh rotation-x={-Math.PI / 2} position={[bx, 0.005, back - 0.2]}>
        <planeGeometry args={[pw + 0.2, 0.46]} />
        {/* over the floor and the passage floor (2 mm): its own depth offset, never coplanar with either */}
        <meshStandardMaterial color="#3a3a3c" roughness={0.85} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <HallGlimpse w={pw} h={3.0} position={[bx, 1.5, back - 0.4 - LOBBY_PASSAGE.d + 0.02]} />
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
  const shown = useRef(false);
  useFrame((_, dt) => {
    if (!FIGHT_ON) return;
    const on = isOnScreen(area);
    let near = on && Math.hypot(selfPose.x - x, selfPose.z - LOBBY_BACK_Z) < 3.4;
    for (const p of Object.values(useWorld.getState().players)) if (Math.hypot(p.x / 100 - x, p.z / 100 - LOBBY_BACK_Z) < 3) near = true;
    // coming back out of the Boxing hall you have just walked through it: it is open on the first frame (it used to
    // start shut and slide open behind you, as if you were about to walk in)
    if (on && !shown.current) open.current = near ? 1 : open.current;
    shown.current = on;
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

/**
 * The live ring status board on the east wall (P3-FGT-08 follow-up): a lit LED screen in a slim bezel with glare and
 * a soft spill on the wall. Every ring is a card (number, status, live score); tap / click a card and you are walked
 * there — through the passage into the Boxing hall and along the aisles to that ring's steps (fight/ring-goto).
 * Redrawn at 1 Hz, and at once when the hovered card changes.
 */
function StatusBoard() {
  const area = useArea();
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = BOARD_PX.w;
    c.height = BOARD_PX.h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  const glare = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 256, 128);
    gr.addColorStop(0, "rgba(255,255,255,0.10)");
    gr.addColorStop(0.35, "rgba(255,255,255,0.03)");
    gr.addColorStop(0.36, "rgba(255,255,255,0)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 128);
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  }, []);
  useEffect(() => () => (tex.dispose(), mat.dispose(), glare.map?.dispose(), glare.dispose()), [tex, mat, glare]);
  const hover = useRef<number>(-1);
  const acc = useRef(2);
  const shown = useRef("");
  const redraw = () => {
    // P3-FGT-12: repaint (and re-upload the 1600 × 800 texture) only when what it shows changed — the statuses and
    // scores, the clock's minute, the hovered card. It used to repaint every second whatever happened (a texture upload
    // hitch a second, and the whole screen re-filtered).
    const key = boardKey(hover.current);
    if (key === shown.current) return;
    shown.current = key;
    drawBoard(tex.image as HTMLCanvasElement, hover.current);
    tex.needsUpdate = true;
  };
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 1 || (!isOnScreen(area) && acc.current < 10)) return;
    acc.current = 0;
    redraw();
  });
  const cellOf = (uv?: THREE.Vector2) => (uv ? boardCellAt(uv.x * BOARD_PX.w, (1 - uv.y) * BOARD_PX.h) : -1);
  const setHover = (i: number) => {
    if (i === hover.current) return;
    hover.current = i;
    document.body.style.cursor = i >= 0 ? "pointer" : "";
    redraw();
  };
  useEffect(() => () => void (document.body.style.cursor = ""), []);
  const b = LOBBY_BOARD;
  return (
    <group position={[b.x, b.y, b.z]} rotation-y={-Math.PI / 2} userData={{ noMerge: true }}>
      {/* the light the screen throws on the wall around it */}
      <mesh position={[0, 0, -0.07]}>
        <planeGeometry args={[b.w + 1.4, b.h + 1.0]} />
        <meshBasicMaterial color="#5fb47a" transparent opacity={0.07} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* slim aluminium bezel on a wall mount */}
      <mesh position={[0, 0, -0.045]}>
        <boxGeometry args={[b.w + 0.12, b.h + 0.12, 0.07]} />
        <meshStandardMaterial color="#1b1c1f" roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh position={[0, -b.h / 2 - 0.035, 0.0]}>
        <boxGeometry args={[0.5, 0.012, 0.012]} />
        <meshBasicMaterial color="#6fdc8c" toneMapped={false} />
      </mesh>
      {/* the screen: 8 mm proud of the bezel (coplanar faces z-fought) */}
      <mesh
        material={mat}
        position={[0, 0, 0.008]}
        onPointerMove={(e) => setHover(cellOf(e.uv))}
        onPointerOut={() => setHover(-1)}
        onClick={(e) => {
          const i = cellOf(e.uv);
          const r = RINGS[i];
          if (!r || (useFightBridge.getState().rings[r.id]?.status ?? "free") === "closed") return;
          e.stopPropagation();
          // the click fires after the floor-tap handler: this route replaces the tap's walk target
          goToRingFromLobby(r.id);
        }}
      >
        <planeGeometry args={[b.w, b.h]} />
      </mesh>
      <mesh material={glare} position={[0, 0, 0.012]} raycast={() => null}>
        <planeGeometry args={[b.w, b.h]} />
      </mesh>
    </group>
  );
}

/** everything the board shows, as a string: it is repainted only when this changes */
export function boardKey(hover: number, rings = useFightBridge.getState().rings, now = new Date()): string {
  let k = `${hover}|${now.getHours()}:${now.getMinutes()}|`;
  for (const r of RINGS) {
    const e = rings[r.id];
    k += `${e?.status ?? "free"}${e?.score ? `${e.score.red}-${e.score.blue}` : ""},`;
  }
  return k;
}

/** board canvas (px) and its card grid: 10 cards a row (ceil(RINGS / 10) rows: 4 for 32 rings) under a header, a legend row at the bottom */
const BOARD_PX = { w: 1600, h: 800 };
const GRID = { cols: 10, x0: 40, y0: 128, cw: 152, ch: 104, gap: 12 };
/** which card (index into RINGS) is under a canvas point, or -1 */
export function boardCellAt(px: number, py: number): number {
  const cx = Math.floor((px - GRID.x0) / GRID.cw);
  const cy = Math.floor((py - GRID.y0) / (GRID.ch + GRID.gap));
  if (cx < 0 || cx >= GRID.cols || cy < 0) return -1;
  if (py - GRID.y0 - cy * (GRID.ch + GRID.gap) > GRID.ch) return -1;
  const i = cy * GRID.cols + cx;
  return i < RINGS.length ? i : -1;
}

const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};

function drawBoard(c: HTMLCanvasElement, hover = -1) {
  const g = c.getContext("2d")!;
  const rings = useFightBridge.getState().rings;
  const W = c.width;
  const H = c.height;
  // LED panel: near-black with a faint vertical falloff
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#141518");
  bg.addColorStop(1, "#0b0b0d");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // header: live dot, title, counts, clock
  g.textBaseline = "middle";
  g.fillStyle = "#e5483c";
  g.beginPath();
  g.arc(58, 62, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f5efe6";
  g.textAlign = "left";
  g.font = "800 54px system-ui, sans-serif";
  g.fillText(`${F.boxingHall} · ${F.statusBoard}`, 86, 62);
  const n = ringCounts(rings);
  g.textAlign = "right";
  g.font = "600 34px system-ui, sans-serif";
  g.fillStyle = "#cfc8bd";
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  g.fillText(`${F.fightsOn(n.fights)} · ${F.ringsFree(n.free)}   ${clock}`, W - 40, 62);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(40, 104, W - 80, 2);
  // cards
  g.textAlign = "center";
  RINGS.forEach((r, i) => {
    const e = rings[r.id];
    const st = shownStatus(e); // P2-NET-06: a ring kept for a fighter who lost their connection reads "Held 0:42"
    const x = GRID.x0 + (i % GRID.cols) * GRID.cw + 6;
    const y = GRID.y0 + Math.floor(i / GRID.cols) * (GRID.ch + GRID.gap);
    const w = GRID.cw - 12;
    const h = GRID.ch;
    const col = STATUS_LAMP[st];
    g.globalAlpha = st === "closed" ? 0.45 : 1;
    const cg = g.createLinearGradient(0, y, 0, y + h);
    cg.addColorStop(0, shade(col, 1.12));
    cg.addColorStop(1, shade(col, 0.82));
    g.fillStyle = cg;
    rr(g, x, y, w, h, 12);
    g.fill();
    if (i === hover) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 5;
      rr(g, x - 2, y - 2, w + 4, h + 4, 14);
      g.stroke();
    }
    g.globalAlpha = 1;
    const dark = st === "practice" || st === "waiting" || st === "held";
    g.fillStyle = dark ? "#121212" : "#ffffff";
    g.font = "800 40px system-ui, sans-serif";
    g.fillText(r.id.slice(1), x + w / 2, y + h * 0.34);
    g.font = "600 20px system-ui, sans-serif";
    const live = e?.score && (st === "fighting" || st === "result") ? `${e.score.red} – ${e.score.blue}` : st === "held" && e?.held?.until ? pfill("place.heldShort", { t: holdClock(e.held.until - Date.now()) }) : F.status[st];
    g.fillText(live, x + w / 2, y + h * 0.7);
    if (r.feature) {
      g.font = "800 13px system-ui, sans-serif";
      g.fillText(F.boardMain, x + w / 2, y + 14);
    }
  });
  // legend + hint
  const ly = H - 40;
  g.textAlign = "left";
  g.font = "600 24px system-ui, sans-serif";
  let lx = 44;
  for (const st of ["free", "waiting", "fighting", "practice", "held"] as const) {
    g.fillStyle = STATUS_LAMP[st];
    rr(g, lx, ly - 12, 24, 24, 6);
    g.fill();
    g.fillStyle = "#cfc8bd";
    g.fillText(F.status[st], lx + 34, ly);
    lx += 34 + g.measureText(F.status[st]).width + 40;
  }
  g.textAlign = "right";
  g.fillStyle = "#f5efe6";
  g.font = "700 26px system-ui, sans-serif";
  g.fillText(F.boardHint, W - 44, ly);
}

/** a hex colour scaled in brightness (card gradients) */
function shade(hex: string, k: number) {
  const v = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * k)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
