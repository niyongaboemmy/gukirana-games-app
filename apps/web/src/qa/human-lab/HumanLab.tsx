"use client";
/**
 * Human realism lab (QA-HUM-01, dev only): one plaza person (world/Avatar) in a neutral yard under a fixed light rig,
 * framed by bone-anchored camera presets, for the repeatable realism assessment (qa/e2e/human-assess/assess.mjs).
 *
 * Query: `look=<look code>` · `body=feminine|masculine|neutral` · `skin=<0…10 index into SKIN_TONES>` ·
 * `age=young|adult|senior` · `light=day|sunset|night|studio` · `cam=<preset>` · `anim=0|1|2|10|11|12` ·
 * `walk=<m/s>` (walks a straight line, the camera tracks) · `lod=1` (the remote-player distance LOD) · `dpr`.
 *
 * window.__gkHuman (read / write from the QA script, no reloads):
 *   { ready, frames, scene, gl, camera, person, view: { az, el, dist, target, fov }, look: "<code>" | undefined,
 *     walk: { speed }, anchors()  — `look` may also be "?body=…&skin=…&age=…" (overrides on the page query)
 *    : { head, eyes, chest, handL, handR, feet, body } }
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { Avatar } from "@/world/Avatar";
import { decodeLook, SKIN_TONES, type AvatarLook, type BodyType } from "@/world/outfits";
import { AGE_GROUPS, type AgeGroup } from "@/world/age";

type Target = "body" | "head" | "eyes" | "chest" | "handL" | "handR" | "feet" | "hips";
/** [azimuth ° around the person (0 = in front), elevation °, distance m, target, fov °] */
const VIEWS: Record<string, [number, number, number, Target, number]> = {
  full: [0, 3, 4.6, "body", 30],
  full34: [35, 4, 4.6, "body", 30],
  side: [90, 3, 4.6, "body", 30],
  back: [180, 4, 4.6, "body", 30],
  face: [0, 2, 0.62, "head", 28],
  face34: [35, 3, 0.62, "head", 28],
  faceSide: [90, 2, 0.62, "head", 28],
  eyes: [0, 0, 0.3, "eyes", 24],
  torso: [0, 4, 1.35, "chest", 32],
  torso34: [40, 6, 1.35, "chest", 32],
  torsoBack: [180, 6, 1.35, "chest", 32],
  hips: [30, 2, 1.3, "hips", 32],
  handR: [-70, 10, 0.5, "handR", 30],
  handL: [70, 10, 0.5, "handL", 30],
  feet: [25, 14, 1.4, "feet", 30],
  walk: [90, 3, 4.8, "body", 30],
  walk34: [40, 4, 4.8, "body", 30],
};

const BONES: Record<Exclude<Target, "body" | "eyes" | "feet">, RegExp> = {
  head: /(^|_)head$/i,
  chest: /spine2$|spine1$|chest$|spine_?03$/i,
  handL: /(L_Hand|hand\.L|Hand_L|LeftHand)$/i,
  handR: /(R_Hand|hand\.R|Hand_R|RightHand)$/i,
  hips: /pelvis$|hips?$|root$/i,
};
const EYE = /(LEye|REye|eye\.[LR]|Eye_[LR]|(Left|Right)Eye)$/i;
const FOOT = /(L_Foot|R_Foot|foot\.[LR]|Foot_[LR]|(Left|Right)Foot)$/i;

type Rig = "day" | "sunset" | "night" | "studio";
const RIGS: Record<
  Rig,
  {
    bg: string;
    sun: [string, number, [number, number, number]];
    hemi: [string, string, number];
    lamp?: [string, number];
    env: number;
    ground: string;
  }
> = {
  // high, slightly warm sun (5500 K-ish), blue sky fill, warm earth bounce
  day: {
    bg: "#a9c2db",
    sun: ["#fff3e2", 3.0, [4, 8, 3]],
    hemi: ["#bcd3ee", "#6e5d4a", 0.9],
    env: 1,
    ground: "#8a8378",
  },
  // low golden sun from the side, violet-blue sky fill
  sunset: {
    bg: "#c4876a",
    sun: ["#ff9a52", 2.6, [-6, 1.3, 3]],
    hemi: ["#6f7cab", "#3b2b22", 0.5],
    env: 0.55,
    ground: "#6d5d52",
  },
  // weak cool moon, a warm street lamp to one side (the plaza at night)
  night: {
    bg: "#0b0e16",
    sun: ["#a9b8e0", 0.35, [-3, 7, -2]],
    hemi: ["#1c2338", "#0d0b0a", 0.25],
    lamp: ["#ffbe78", 22],
    env: 0.12,
    ground: "#3a3835",
  },
  // the avatar editor's studio (components/AvatarPreview)
  studio: {
    bg: "#1a1b1e",
    sun: ["#ffffff", 1.9, [2.5, 4, 3]],
    hemi: ["#f4efe8", "#2b2620", 0.7],
    env: 1,
    ground: "#2a2b30",
  },
};

interface LabState {
  ready: boolean;
  frames: number;
  scene: THREE.Scene | null;
  gl: THREE.WebGLRenderer | null;
  camera: THREE.Camera | null;
  person: THREE.Object3D | null;
  view: { az: number; el: number; dist: number; target: Target; fov: number };
  look?: string;
  walk: { speed: number };
  /** the look on show (skin tone, age, body) */
  current: AvatarLook | null;
  /** reference: hide the person, show a plain matte sphere in the skin's albedo where the face is (skin fidelity) */
  reference: boolean;
  /** the cheek point (world) the reference sphere's near surface is put on */
  referenceAt: [number, number, number] | null;
  anchors: () => Record<string, [number, number, number]>;
}

const params = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

function lookFrom(q: URLSearchParams, code?: string): AvatarLook {
  const l = decodeLook(code ?? q.get("look") ?? "", "#7a4a2a", q.get("seed") ?? "qa-human-lab");
  const body = q.get("body") as BodyType | null;
  const skin = q.get("skin");
  const age = q.get("age") as AgeGroup | null;
  return {
    ...l,
    ...(body && ["feminine", "masculine", "neutral"].includes(body) ? { bodyType: body } : {}),
    ...(skin !== null && SKIN_TONES[Number(skin)] ? { skinTone: SKIN_TONES[Number(skin)]! } : {}),
    ...(age && (AGE_GROUPS as readonly string[]).includes(age) ? { age } : {}),
  };
}

const lab: LabState = {
  ready: false,
  frames: 0,
  scene: null,
  gl: null,
  camera: null,
  person: null,
  view: { az: 0, el: 3, dist: 4.6, target: "body", fov: 30 },
  walk: { speed: 0 },
  current: null,
  reference: false,
  referenceAt: null,
  anchors: () => ({}),
};

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();

function findAnchors(person: THREE.Object3D): Record<Target, THREE.Vector3> {
  const out: Partial<Record<Target, THREE.Vector3>> = {};
  const eyes: THREE.Vector3[] = [];
  const feet: THREE.Vector3[] = [];
  person.updateMatrixWorld(true);
  person.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    for (const [k, re] of Object.entries(BONES))
      if (!out[k as Target] && re.test(o.name)) out[k as Target] = o.getWorldPosition(new THREE.Vector3());
    if (EYE.test(o.name)) eyes.push(o.getWorldPosition(new THREE.Vector3()));
    if (FOOT.test(o.name)) feet.push(o.getWorldPosition(new THREE.Vector3()));
  });
  const base = person.getWorldPosition(new THREE.Vector3());
  out.body = base.clone().setY(0.9);
  if (eyes.length) out.eyes = eyes.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(eyes.length);
  else if (out.head) out.eyes = out.head.clone().add(new THREE.Vector3(0, 0.08, 0.06));
  if (out.head) out.head = out.head.clone().add(new THREE.Vector3(0, 0.07, 0));
  // hands: aim at the palm / fingers, not the wrist joint
  for (const k of ["handL", "handR"] as const) out[k]?.add(new THREE.Vector3(0, -0.07, 0));
  out.feet = feet.length
    ? feet
        .reduce((a, b) => a.add(b), new THREE.Vector3())
        .divideScalar(feet.length)
        .setY(0.12)
    : base.clone().setY(0.12);
  for (const k of ["head", "chest", "handL", "handR", "hips"] as Target[]) out[k] ??= out.body.clone();
  return out as Record<Target, THREE.Vector3>;
}

function Director({
  person,
  yaw,
}: {
  person: React.RefObject<THREE.Group | null>;
  yaw: React.RefObject<number>;
}) {
  const { camera, scene, gl } = useThree();
  useFrame(() => {
    lab.frames++;
    lab.scene = scene;
    lab.gl = gl;
    lab.camera = camera;
    const p = person.current;
    if (!p) return;
    lab.person = p;
    // the skin reference shot: the camera holds still (the hidden person's bones are not posed)
    if (lab.reference) return;
    let skinned = false;
    p.traverse((o) => void ((o as THREE.SkinnedMesh).isSkinnedMesh && (skinned = true)));
    if (!skinned) return;
    const a = findAnchors(p);
    lab.anchors = () =>
      Object.fromEntries(Object.entries(findAnchors(p)).map(([k, v]) => [k, [v.x, v.y, v.z]]));
    const v = lab.view;
    const tgt = a[v.target] ?? a.body;
    const az = THREE.MathUtils.degToRad(v.az) + (yaw.current ?? 0);
    const el = THREE.MathUtils.degToRad(v.el);
    _v.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
      .multiplyScalar(v.dist)
      .add(_t.copy(tgt));
    camera.position.copy(_v);
    camera.lookAt(tgt);
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.fov !== v.fov) {
      pc.fov = v.fov;
      pc.updateProjectionMatrix();
    }
    if (lab.frames > 20) lab.ready = true;
  });
  return null;
}

/** Moves the person along a straight line at `lab.walk.speed` m/s (the avatar measures its own ground speed). */
function Walker({
  person,
  anim,
  yaw,
}: {
  person: React.RefObject<THREE.Group | null>;
  anim: React.RefObject<number>;
  yaw: React.RefObject<number>;
}) {
  useFrame((_, dt) => {
    const p = person.current;
    if (!p) return;
    const s = lab.walk.speed;
    if (s > 0) {
      p.rotation.y = Math.PI / 2;
      yaw.current = Math.PI / 2;
      p.position.x += s * Math.min(dt, 0.05);
      anim.current = s > 2.6 ? 2 : 1;
    } else if (anim.current === 1 || anim.current === 2) anim.current = 0;
  });
  return null;
}

/**
 * The skin reference: a plain physically based sphere in the look's skin colour (roughness 0.6), the size of a head, at
 * the face. The cheek of the real skin is compared with the same patch of this sphere under the same light, so the
 * skin's exposure / colour is judged against its own albedo, not against the rig's brightness.
 */
function Reference({ person, color }: { person: React.RefObject<THREE.Group | null>; color: string }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const p = person.current;
    if (!m.current || !p) return;
    m.current.visible = lab.reference;
    p.visible = !lab.reference;
    if (!lab.reference) return;
    // the sphere's near point sits on the cheek point (captured while the person was shown), facing the camera
    const at = lab.referenceAt;
    if (at && lab.camera) {
      _t.set(at[0], at[1], at[2]);
      _v.copy(_t).sub(lab.camera.position).normalize();
      m.current.position.copy(_t).addScaledVector(_v, 0.1);
    }
  });
  return (
    <mesh ref={m} visible={false} castShadow>
      <sphereGeometry args={[0.1, 48, 32]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}

function LookPoll({ onLook }: { onLook: (code: string) => void }) {
  const last = useRef<string | undefined>(undefined);
  useFrame(() => {
    if (lab.look === last.current || lab.look === undefined) return;
    last.current = lab.look;
    onLook(lab.look);
  });
  return null;
}

export default function HumanLab() {
  const q = useMemo(params, []);
  const [code, setCode] = useState<string | undefined>(undefined);
  // `lab.look` = a look code, or "?body=…&skin=…&age=…" overrides on top of the page query
  const look = useMemo(() => {
    if (code?.startsWith("?")) {
      const m = new URLSearchParams(q);
      for (const [k, v] of new URLSearchParams(code.slice(1))) m.set(k, v);
      return lookFrom(m);
    }
    return lookFrom(q, code);
  }, [q, code]);
  useEffect(() => void (lab.current = look), [look]);
  const rig = RIGS[(q.get("light") as Rig) ?? "day"] ?? RIGS.day;
  const person = useRef<THREE.Group>(null);
  const yaw = useRef(0);
  const anim = useRef(Number(q.get("anim") ?? 0));
  useEffect(() => {
    const v = VIEWS[q.get("cam") ?? "full"] ?? VIEWS.full!;
    lab.view = { az: v[0], el: v[1], dist: v[2], target: v[3], fov: v[4] };
    lab.walk.speed = Number(q.get("walk") ?? 0);
    (window as unknown as { __gkHuman?: LabState; __gkHumanViews?: typeof VIEWS }).__gkHuman = lab;
    (window as unknown as { __gkHumanViews?: typeof VIEWS }).__gkHumanViews = VIEWS;
  }, [q]);
  const dpr = Number(q.get("dpr") ?? 0) || undefined;
  return (
    <div className="fixed inset-0" style={{ background: rig.bg }}>
      <Canvas
        shadows="percentage"
        dpr={dpr ?? [1, 1.75]}
        camera={{ fov: 30, position: [0, 1.1, 4.6], near: 0.02, far: 200 }}
        // the world's tone mapping (world/SceneCanvas), so the lab reads like the plaza
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          preserveDrawingBuffer: true,
        }}
      >
        <color attach="background" args={[rig.bg]} />
        <hemisphereLight args={rig.hemi} />
        <directionalLight
          color={rig.sun[0]}
          intensity={rig.sun[1]}
          position={rig.sun[2]}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={4}
          shadow-camera-bottom={-4}
        />
        {rig.lamp && (
          <pointLight
            color={rig.lamp[0]}
            intensity={rig.lamp[1]}
            distance={14}
            decay={2}
            position={[1.8, 3.2, 1.8]}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
        )}
        <Environment frames={1} resolution={64} environmentIntensity={rig.env}>
          <Lightformer
            form="rect"
            intensity={2.5}
            color={rig.hemi[0]}
            position={[0, 6, 0]}
            scale={[10, 10, 1]}
            target={[0, 0, 0]}
          />
          <Lightformer
            form="rect"
            intensity={1.5}
            color={rig.sun[0]}
            position={rig.sun[2]}
            scale={[3, 3, 1]}
            target={[0, 1, 0]}
          />
          <Lightformer
            form="rect"
            intensity={0.6}
            color={rig.hemi[1]}
            position={[0, -3, 0]}
            scale={[10, 10, 1]}
            target={[0, 1, 0]}
          />
        </Environment>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color={rig.ground} roughness={0.92} />
        </mesh>
        <group ref={person}>
          <Suspense fallback={null}>
            <Avatar
              look={look}
              animRef={anim}
              showTag={false}
              shadows
              lod={q.get("lod") === "1"}
              seedId="qa-human-lab"
            />
          </Suspense>
        </group>
        <Reference person={person} color={look.skinTone} />
        <Walker person={person} anim={anim} yaw={yaw} />
        <Director person={person} yaw={yaw} />
        <LookPoll onLook={setCode} />
      </Canvas>
    </div>
  );
}
