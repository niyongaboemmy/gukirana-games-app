"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Detailed, Text } from "@react-three/drei";
import * as THREE from "three";
import { blobTexture, fabricTexture, type PrintId } from "./textures";
import { itemById, type AvatarLook, type BodyType, type OutfitItem } from "./outfits";

/**
 * Stylised semi-realistic human (DESIGN-SPEC §7.1): ~1:7 head-to-body, ~1.70 m, jointed limbs (shoulder/elbow,
 * hip/knee), face hint (eyes, brows, nose, lips, ears), 10 hair styles, outfit slots and LOD for remote players.
 * Built from shared unit primitives + cached materials so many avatars stay cheap (§7.3 budgets: LOD0 ≈ 4–6k tris).
 */

export interface AvatarProps {
  look: AvatarLook;
  name?: string;
  level?: number;
  /** 0 idle · 1 walk · 2 run · 10 wave · 11 dance · 12 clap */
  animRef: React.RefObject<number>;
  showTag?: boolean;
  /** Remote players: switch to a 6-mesh impostor-like LOD beyond 16 m. */
  lod?: boolean;
  shadows?: boolean;
}

const FONT = "/fonts/Baloo2.ttf";

/* ---------- shared geometry & materials ---------- */
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const SPHERE = () => geo("sphere", () => new THREE.SphereGeometry(1, 24, 16));
const SPHERE_LO = () => geo("sphere-lo", () => new THREE.SphereGeometry(1, 10, 8));
const CAP = (theta: number) => geo(`cap-${theta}`, () => new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, theta));
const BOX = () => geo("box", () => new THREE.BoxGeometry(1, 1, 1));
const CAPSULE = (r: number, l: number) => geo(`capsule-${r}-${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 12));
/** Tapered, slightly muscled limb from the joint (y = 0) down to y = −len, with rounded ends. */
const LIMB = (r0: number, r1: number, len: number, bulge = 0.08) =>
  geo(`limb-${r0.toFixed(4)}-${r1.toFixed(4)}-${len}-${bulge}`, () => {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0.0001, -len - r1 * 0.55), new THREE.Vector2(r1 * 0.75, -len - r1 * 0.35)];
    for (let i = 10; i >= 0; i--) {
      const t = i / 10;
      pts.push(new THREE.Vector2((r0 + (r1 - r0) * t) * (1 + bulge * Math.sin(Math.PI * Math.pow(t, 0.8))), -t * len));
    }
    pts.push(new THREE.Vector2(r0 * 0.75, r0 * 0.35), new THREE.Vector2(0.0001, r0 * 0.55));
    return new THREE.LatheGeometry(pts, 14);
  });
const TORUS = (r: number, t: number, arc = Math.PI * 2) => geo(`torus-${r}-${t}-${arc}`, () => new THREE.TorusGeometry(r, t, 8, 32, arc));
const CONE = (rt: number, rb: number, h: number) => geo(`cone-${rt}-${rb}-${h}`, () => new THREE.CylinderGeometry(rt, rb, h, 24, 1, true));
const CYL = (r: number, h: number) => geo(`cyl-${r}-${h}`, () => new THREE.CylinderGeometry(r, r, h, 16));

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts: { rough?: number; metal?: number; print?: PrintId; emissive?: string; side?: THREE.Side } = {}) {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.print ?? ""}|${opts.emissive ?? ""}|${opts.side ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: opts.print ? "#ffffff" : color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      map: opts.print ? fabricTexture(opts.print) : null,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color("#000000"),
      emissiveIntensity: opts.emissive ? 0.6 : 0,
      side: opts.side ?? THREE.FrontSide,
    });
    matCache.set(key, m);
  }
  return m;
}

/* ---------- body proportions (chosen body type, never inferred) ---------- */
interface Body {
  sh: number;
  chest: number;
  waist: number;
  hip: number;
  arm: number;
  thigh: number;
  scale: number;
  bust: boolean;
}
const BODIES: Record<BodyType, Body> = {
  masculine: { sh: 0.205, chest: 0.172, waist: 0.145, hip: 0.135, arm: 0.05, thigh: 0.076, scale: 1.0, bust: false },
  neutral: { sh: 0.19, chest: 0.162, waist: 0.135, hip: 0.142, arm: 0.046, thigh: 0.076, scale: 0.985, bust: false },
  feminine: { sh: 0.175, chest: 0.158, waist: 0.12, hip: 0.158, arm: 0.042, thigh: 0.078, scale: 0.965, bust: true },
};

function lathe(key: string, pts: [number, number][]) {
  return geo(key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28));
}

function resolve(item: OutfitItem | undefined, accent: string, which: "color" | "color2" = "color"): string {
  const c = item?.[which] ?? "#888888";
  return c === "accent" ? accent : c;
}

function darken(hex: string, k: number) {
  return `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
}

function useLookParts(look: AvatarLook) {
  return useMemo(() => {
    const b = BODIES[look.bodyType] ?? BODIES.neutral;
    const top = itemById(look.outfit.top);
    const bottom = itemById(look.outfit.bottom);
    const shoes = itemById(look.outfit.shoes);
    const acc = itemById(look.outfit.accessory);
    const hat = itemById(look.outfit.headwear);
    const skin = mat(look.skinTone, { rough: 0.58 });
    const skinDark = mat(darken(look.skinTone, 0.72), { rough: 0.5 });
    const lips = mat(darken(look.skinTone, 0.6), { rough: 0.45 });
    const hair = mat(look.hairColor, { rough: 0.9 });
    const topM = mat(resolve(top, look.accent), { rough: top?.kind === "jersey" ? 0.55 : 0.85, print: top?.print });
    const top2 = mat(resolve(top, look.accent, "color2"), { rough: 0.7, print: top?.kind === "sash" ? top.print : undefined, side: THREE.DoubleSide });
    const botM = mat(resolve(bottom, look.accent), { rough: 0.85, print: bottom?.print, side: THREE.DoubleSide });
    const shoeM = mat(resolve(shoes, look.accent), { rough: 0.6 });
    const shoe2 = mat(resolve(shoes, look.accent, "color2"), { rough: 0.5 });
    const sole = mat("#f1efe9", { rough: 0.7 });
    const sleeve: 0 | 1 | 2 = top?.kind === "sash" ? 0 : top?.kind === "tee" || top?.kind === "jersey" || top?.kind === "shirt" ? 1 : 2;
    const torso = lathe(`torso-${look.bodyType}`, [
      [0.001, 0.99],
      [b.waist, 1.0],
      [b.waist * 1.03, 1.08],
      [b.chest, 1.24],
      [b.sh * 0.97, 1.35],
      [b.sh * 0.86, 1.415],
      [0.1, 1.46],
      [0.05, 1.48],
      [0.001, 1.48],
    ]);
    const pelvis = lathe(`pelvis-${look.bodyType}`, [
      [0.001, 0.8],
      [b.hip * 0.86, 0.82],
      [b.hip, 0.9],
      [b.waist * 1.04, 1.02],
      [0.001, 1.02],
    ]);
    return { b, top, bottom, shoes, acc, hat, skin, skinDark, lips, hair, topM, top2, botM, shoeM, shoe2, sole, sleeve, torso, pelvis };
  }, [look]);
}

type Parts = ReturnType<typeof useLookParts>;

/* ---------- pieces ---------- */
function Hair({ look, p }: { look: AvatarLook; p: Parts }) {
  const h = p.hair;
  const cap = (
    <mesh geometry={CAP(Math.PI * 0.56)} material={h} position={[0, 0.012, -0.01]} scale={[0.122, 0.13, 0.127]} />
  );
  const strands = (n: number, r: number, len: number, from: number, to: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = from + ((to - from) * i) / (n - 1);
      return (
        <mesh
          key={i}
          geometry={CAPSULE(r, len)}
          material={h}
          position={[Math.sin(a) * 0.105, -0.06 - len / 2 + 0.06, Math.cos(a) * 0.1 - 0.01]}
          rotation={[Math.cos(a) * -0.18, 0, Math.sin(a) * 0.18]}
        />
      );
    });
  switch (look.hairStyle) {
    case "bald":
      return null;
    case "fade":
      return <mesh geometry={CAP(Math.PI * 0.5)} material={h} position={[0, 0.02, -0.005]} scale={[0.117, 0.12, 0.12]} />;
    case "afro":
      return (
        <group>
          {cap}
          <mesh geometry={SPHERE()} material={h} position={[0, 0.07, -0.03]} scale={[0.19, 0.17, 0.18]} />
        </group>
      );
    case "puffs":
      return (
        <group>
          {cap}
          {[-1, 1].map((s) => (
            <mesh key={s} geometry={SPHERE()} material={h} position={[s * 0.1, 0.12, -0.03]} scale={0.072} />
          ))}
        </group>
      );
    case "bun":
      return (
        <group>
          {cap}
          <mesh geometry={SPHERE()} material={h} position={[0, 0.13, -0.07]} scale={0.062} />
        </group>
      );
    case "braids":
      return (
        <group>
          {cap}
          {strands(15, 0.012, 0.3, Math.PI * 0.55, Math.PI * 1.45)}
        </group>
      );
    case "locs":
      return (
        <group>
          {cap}
          {strands(12, 0.019, 0.24, Math.PI * 0.5, Math.PI * 1.5)}
        </group>
      );
    case "cornrows":
      return (
        <group>
          <mesh geometry={CAP(Math.PI * 0.52)} material={h} position={[0, 0.015, -0.008]} scale={[0.119, 0.124, 0.124]} />
          {[-0.06, -0.03, 0, 0.03, 0.06].map((x) => (
            <mesh key={x} geometry={TORUS(0.118, 0.006, Math.PI * 0.9)} material={h} position={[x, 0.005, -0.01]} rotation={[0, Math.PI / 2, Math.PI * 0.05]} />
          ))}
          {strands(6, 0.011, 0.16, Math.PI * 0.8, Math.PI * 1.2)}
        </group>
      );
    case "headwrap": {
      const wrap = mat("#ffffff", { rough: 0.8, print: p.top?.print ?? "kitenge-sun" });
      return (
        <group>
          <mesh geometry={CAP(Math.PI * 0.6)} material={wrap} position={[0, 0.04, -0.025]} scale={[0.134, 0.17, 0.142]} />
          <mesh geometry={TORUS(0.035, 0.016)} material={wrap} position={[0, 0.16, 0.06]} rotation={[0.4, 0, 0]} />
          <mesh geometry={SPHERE()} material={wrap} position={[0.03, 0.17, 0.04]} scale={0.03} />
        </group>
      );
    }
    default:
      return cap;
  }
}

function Headwear({ p, look }: { p: Parts; look: AvatarLook }) {
  const kind = p.hat?.kind;
  if (!kind || kind === "none" || look.hairStyle === "headwrap") return null;
  const big = look.hairStyle === "afro" ? 1.35 : look.hairStyle === "puffs" || look.hairStyle === "bun" ? 1.1 : 1;
  const m = mat(resolve(p.hat, look.accent), { rough: 0.8 });
  if (kind === "cap")
    return (
      <group position={[0, 0.03 * big, 0]} scale={big}>
        <mesh geometry={CAP(Math.PI * 0.5)} material={m} scale={[0.127, 0.12, 0.13]} />
        <mesh geometry={BOX()} material={m} position={[0, 0.0, 0.14]} scale={[0.16, 0.012, 0.11]} rotation={[0.12, 0, 0]} />
      </group>
    );
  if (kind === "beanie")
    return (
      <group position={[0, 0.02 * big, 0]} scale={big}>
        <mesh geometry={CAP(Math.PI * 0.55)} material={m} scale={[0.13, 0.16, 0.135]} />
        <mesh geometry={TORUS(0.128, 0.018)} material={m} position={[0, 0.0, 0]} rotation={[Math.PI / 2, 0, 0]} />
      </group>
    );
  return (
    <group position={[0, 0.05 * big, 0]} scale={big}>
      <mesh geometry={CAP(Math.PI * 0.5)} material={m} scale={[0.13, 0.11, 0.13]} />
      <mesh geometry={CONE(0.13, 0.2, 0.05)} material={mat(resolve(p.hat, look.accent), { side: THREE.DoubleSide })} position={[0, -0.005, 0]} />
    </group>
  );
}

function Face({ p }: { p: Parts }) {
  const white = mat("#f4f1ea", { rough: 0.3 });
  const iris = mat("#24140c", { rough: 0.2 });
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh geometry={SPHERE()} material={white} position={[s * 0.038, 0.012, 0.093]} scale={[0.017, 0.013, 0.01]} />
          <mesh geometry={SPHERE()} material={iris} position={[s * 0.038, 0.012, 0.102]} scale={0.0085} />
          <mesh geometry={BOX()} material={p.hair} position={[s * 0.04, 0.038, 0.1]} scale={[0.036, 0.0075, 0.01]} rotation={[0, 0, s * -0.12]} />
          <mesh geometry={SPHERE()} material={p.skin} position={[s * 0.104, 0, -0.005]} scale={[0.012, 0.026, 0.02]} />
        </group>
      ))}
      <mesh geometry={SPHERE()} material={p.skinDark} position={[0, -0.012, 0.106]} scale={[0.018, 0.02, 0.016]} />
      <mesh geometry={SPHERE()} material={p.lips} position={[0, -0.048, 0.094]} scale={[0.024, 0.008, 0.01]} />
    </group>
  );
}

function Accessory({ p, look }: { p: Parts; look: AvatarLook }) {
  const kind = p.acc?.kind;
  if (kind === "headset") {
    const shell = mat(resolve(p.acc, look.accent), { rough: 0.3, metal: 0.1 });
    return (
      <group position={[0, 0.012, 0]}>
        <mesh geometry={TORUS(0.122, 0.012)} material={shell} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.04, 1]} />
        <mesh geometry={BOX()} material={shell} position={[0, 0, 0.115]} scale={[0.19, 0.075, 0.07]} />
        <mesh geometry={BOX()} material={mat("#1f2a44", { rough: 0.1, emissive: resolve(p.acc, look.accent, "color2") })} position={[0, 0, 0.151]} scale={[0.17, 0.05, 0.004]} />
      </group>
    );
  }
  if (kind === "glasses" || kind === "sunglasses") {
    const frame = mat(resolve(p.acc, look.accent), { rough: 0.3, metal: 0.4 });
    return (
      <group position={[0, 0.012, 0.108]}>
        {[-1, 1].map((s) =>
          kind === "glasses" ? (
            <mesh key={s} geometry={TORUS(0.019, 0.0032)} material={frame} position={[s * 0.038, 0, 0]} />
          ) : (
            <mesh key={s} geometry={BOX()} material={mat("#0c0c10", { rough: 0.05, metal: 0.6 })} position={[s * 0.038, 0, 0]} scale={[0.04, 0.024, 0.006]} />
          ),
        )}
        <mesh geometry={BOX()} material={frame} scale={[0.03, 0.004, 0.004]} />
        {[-1, 1].map((s) => (
          <mesh key={`a${s}`} geometry={BOX()} material={frame} position={[s * 0.1, 0, -0.05]} scale={[0.004, 0.004, 0.1]} />
        ))}
      </group>
    );
  }
  if (kind === "earrings") {
    const gold = mat("#FFC83D", { rough: 0.25, metal: 1 });
    return (
      <group>
        {[-1, 1].map((s) => (
          <mesh key={s} geometry={TORUS(0.012, 0.0028)} material={gold} position={[s * 0.106, -0.035, 0]} rotation={[0, Math.PI / 2, 0]} />
        ))}
      </group>
    );
  }
  return null;
}

function Shoe({ p }: { p: Parts }) {
  const kind = p.shoes?.kind ?? "sneakers";
  if (kind === "sandals")
    return (
      <group>
        <mesh geometry={BOX()} material={p.shoeM} position={[0, -0.035, 0.035]} scale={[0.095, 0.022, 0.24]} />
        <mesh geometry={BOX()} material={p.skin} position={[0, -0.0, 0.04]} scale={[0.08, 0.045, 0.2]} />
        <mesh geometry={BOX()} material={p.shoeM} position={[0, 0.0, 0.07]} scale={[0.088, 0.02, 0.03]} />
      </group>
    );
  if (kind === "boots")
    return (
      <group>
        <mesh geometry={BOX()} material={p.shoeM} position={[0, 0.02, 0.03]} scale={[0.1, 0.14, 0.25]} />
        <mesh geometry={BOX()} material={mat("#1b1b1b")} position={[0, -0.045, 0.03]} scale={[0.104, 0.025, 0.255]} />
      </group>
    );
  if (kind === "loafers")
    return (
      <group>
        <mesh geometry={SPHERE()} material={mat(resolve(p.shoes, "#000"), { rough: 0.35 })} position={[0, -0.01, 0.045]} scale={[0.05, 0.035, 0.125]} />
        <mesh geometry={BOX()} material={mat("#1b1b1b")} position={[0, -0.045, 0.04]} scale={[0.09, 0.018, 0.24]} />
      </group>
    );
  return (
    <group>
      <mesh geometry={SPHERE()} material={p.shoeM} position={[0, -0.005, 0.045]} scale={[0.054, 0.045, 0.13]} />
      <mesh geometry={BOX()} material={p.sole} position={[0, -0.042, 0.04]} scale={[0.1, 0.03, 0.25]} />
      <mesh geometry={BOX()} material={p.shoe2} position={[0, 0.0, 0.03]} scale={[0.106, 0.016, 0.08]} />
    </group>
  );
}

/* ---------- full avatar ---------- */
function FullAvatar({ look, animRef, shadows }: { look: AvatarLook; animRef: React.RefObject<number>; shadows: boolean }) {
  const p = useLookParts(look);
  const { b } = p;
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const skirt = useRef<THREE.Mesh>(null);
  const t = useRef(0);
  const bottomKind = p.bottom?.kind ?? "trousers";
  const longwrap = bottomKind === "longwrap";

  useFrame((_, dt) => {
    const anim = animRef.current ?? 0;
    const speed = anim === 2 ? 11 : anim === 1 ? 7.5 : 0;
    t.current += Math.min(dt, 0.05) * (speed || 2);
    const ph = t.current;
    const amp = (anim === 2 ? 0.8 : 0.5) * (longwrap ? 0.6 : 1);
    const swing = speed ? Math.sin(ph) * amp : 0;
    const lL = legL.current;
    const lR = legR.current;
    const kL = kneeL.current;
    const kR = kneeR.current;
    const aL = armL.current;
    const aR = armR.current;
    const eL = elbowL.current;
    const eR = elbowR.current;
    const bd = body.current;
    const hd = head.current;
    if (!lL || !lR || !kL || !kR || !aL || !aR || !eL || !eR || !bd || !hd) return;
    lL.rotation.x = swing;
    lR.rotation.x = -swing;
    kL.rotation.x = speed ? Math.max(0, -Math.sin(ph - 0.6)) * amp * 1.5 : 0;
    kR.rotation.x = speed ? Math.max(0, Math.sin(ph - 0.6)) * amp * 1.5 : 0;
    aL.rotation.set(-swing * 0.85, 0, -0.06);
    aR.rotation.set(swing * 0.85, 0, 0.06);
    eL.rotation.x = -(0.2 + (speed ? 0.4 + Math.max(0, swing) * 0.6 : 0));
    eR.rotation.x = -(0.2 + (speed ? 0.4 + Math.max(0, -swing) * 0.6 : 0));
    bd.position.y = speed ? Math.abs(Math.sin(ph)) * 0.04 : Math.sin(ph * 0.8) * 0.006;
    bd.rotation.set(speed ? (anim === 2 ? 0.12 : 0.04) : 0, 0, 0);
    hd.rotation.set(0, speed ? 0 : Math.sin(ph * 0.35) * 0.12, 0);
    if (anim === 10) {
      aR.rotation.set(0, 0, 2.5 + Math.sin(ph * 4) * 0.2);
      eR.rotation.x = 0;
      eR.rotation.z = Math.sin(ph * 6) * 0.35;
    } else eR.rotation.z = 0;
    if (anim === 11) {
      bd.rotation.y = Math.sin(ph * 3) * 0.5;
      bd.position.y = Math.abs(Math.sin(ph * 6)) * 0.1;
      aL.rotation.set(-2.4, 0, 0.5);
      aR.rotation.set(-2.4, 0, -0.5);
      kL.rotation.x = Math.abs(Math.sin(ph * 6)) * 0.4;
      kR.rotation.x = Math.abs(Math.sin(ph * 6 + 1)) * 0.4;
    }
    if (anim === 12) {
      const c = Math.sin(ph * 10) * 0.22;
      aL.rotation.set(-1.15, 0, 0.45 + c);
      aR.rotation.set(-1.15, 0, -0.45 - c);
      eL.rotation.x = -0.9;
      eR.rotation.x = -0.9;
    }
    if (skirt.current) skirt.current.rotation.z = swing * 0.04;
  });

  const shX = b.sh + 0.03;
  const hipX = b.hip * 0.55;
  const upperArmMat = p.sleeve >= 1 ? p.topM : p.skin;
  const foreArmMat = p.sleeve === 2 ? p.topM : p.skin;
  const thighMat = bottomKind === "skirt" || longwrap ? p.skin : p.botM;
  const shinMat = bottomKind === "trousers" || bottomKind === "joggers" ? p.botM : p.skin;
  const topKind = p.top?.kind;

  const arm = (side: -1 | 1, ref: React.RefObject<THREE.Group | null>, eRef: React.RefObject<THREE.Group | null>) => (
    <group ref={ref} position={[side * shX, 1.405, 0]}>
      <mesh geometry={SPHERE()} material={upperArmMat} position={[side * -0.022, -0.012, 0]} scale={[b.arm * 1.0, b.arm * 1.08, b.arm * 1.0]} castShadow={shadows} />
      <mesh geometry={LIMB(b.arm * 1.05, b.arm * 0.8, 0.29)} material={p.sleeve === 1 ? p.skin : upperArmMat} position={[0, 0.0, 0]} castShadow={shadows} />
      {p.sleeve === 1 && <mesh geometry={LIMB(b.arm * 1.25, b.arm * 1.12, 0.12, 0)} material={p.topM} position={[0, 0.0, 0]} />}
      <group ref={eRef} position={[0, -0.29, 0]}>
        <mesh geometry={LIMB(b.arm * 0.86, b.arm * 0.6, 0.26, 0.1)} material={foreArmMat} position={[0, 0.0, 0]} castShadow={shadows} />
        {side === -1 && p.acc?.kind === "watch" && (
          <mesh geometry={CYL(b.arm * 0.95, 0.03)} material={mat(resolve(p.acc, look.accent, "color2"), { rough: 0.3 })} position={[0, -0.2, 0]} />
        )}
        <group position={[0, -0.27, 0.005]}>
          <mesh geometry={SPHERE()} material={p.skin} scale={[0.03, 0.05, 0.018]} position={[0, -0.02, 0]} />
          <mesh geometry={CAPSULE(0.009, 0.03)} material={p.skin} position={[side * -0.022, -0.01, 0.014]} rotation={[0.3, 0, side * 0.5]} />
        </group>
      </group>
    </group>
  );

  const leg = (side: -1 | 1, ref: React.RefObject<THREE.Group | null>, kRef: React.RefObject<THREE.Group | null>) => (
    <group ref={ref} position={[side * hipX, 0.87, 0]}>
      <mesh geometry={LIMB(b.thigh * 1.1, b.thigh * 0.7, 0.43)} material={thighMat} position={[0, 0.0, 0]} castShadow={shadows} />
      {bottomKind === "shorts" && <mesh geometry={LIMB(b.thigh * 1.25, b.thigh * 1.05, 0.25, 0)} material={p.botM} position={[0, 0.0, 0]} />}
      <group ref={kRef} position={[0, -0.42, 0]}>
        <mesh geometry={LIMB(b.thigh * 0.74, b.thigh * 0.48, 0.38, 0.14)} material={shinMat} position={[0, 0.0, 0]} castShadow={shadows} />
        <group position={[0, -0.38, 0]}>
          <Shoe p={p} />
        </group>
      </group>
    </group>
  );

  return (
    <group scale={b.scale}>
      <group ref={body}>
        {leg(-1, legL, kneeL)}
        {leg(1, legR, kneeR)}
        {/* pelvis + torso (elliptical cross-section) */}
        <mesh geometry={p.pelvis} material={p.botM} scale={[1, 1, 0.68]} castShadow={shadows} />
        <mesh geometry={p.torso} material={p.topM} scale={[1, 1, 0.6]} castShadow={shadows} />
        {b.bust &&
          [-1, 1].map((s) => (
            <mesh key={s} geometry={SPHERE()} material={p.topM} position={[s * 0.062, 1.255, 0.062]} scale={[0.058, 0.055, 0.045]} />
          ))}
        {bottomKind === "skirt" && <mesh ref={skirt} geometry={CONE(b.waist * 1.05, b.hip * 1.55, 0.5)} material={p.botM} position={[0, 0.76, 0]} scale={[1, 1, 0.8]} />}
        {longwrap && <mesh ref={skirt} geometry={CONE(b.waist * 1.05, 0.2, 0.92)} material={p.botM} position={[0, 0.55, 0]} scale={[1, 1, 0.82]} />}
        {/* top details */}
        {topKind === "hoodie" && (
          <>
            <mesh geometry={SPHERE()} material={p.topM} position={[0, 1.44, -0.07]} scale={[0.15, 0.09, 0.08]} />
            <mesh geometry={BOX()} material={p.topM} position={[0, 1.08, b.waist * 0.62]} scale={[0.15, 0.065, 0.012]} />
          </>
        )}
        {topKind === "jersey" && <mesh geometry={TORUS(1, 0.035)} material={p.top2} position={[0, 1.25, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[b.chest + 0.004, b.chest * 0.6 + 0.004, 1]} />}
        {topKind === "blazer" &&
          [-1, 1].map((s) => (
            <mesh key={s} geometry={BOX()} material={p.top2} position={[s * 0.035, 1.3, b.chest * 0.58]} rotation={[0, 0, s * 0.35]} scale={[0.04, 0.2, 0.01]} />
          ))}
        {topKind === "sash" && (
          <mesh geometry={TORUS(1, 0.05)} material={p.top2} position={[0, 1.2, 0]} rotation={[Math.PI / 2, 0.62, 0]} scale={[b.chest + 0.02, b.chest * 0.62 + 0.02, 1]} />
        )}
        {arm(-1, armL, elbowL)}
        {arm(1, armR, elbowR)}
        {/* neck + head */}
        <mesh geometry={CYL(0.046, 0.12)} material={p.skin} position={[0, 1.51, 0]} />
        {topKind === "shirt" && <mesh geometry={TORUS(0.055, 0.016)} material={p.topM} position={[0, 1.48, 0.005]} rotation={[Math.PI / 2, 0, 0]} />}
        <group ref={head} position={[0, 1.625, 0.005]}>
          <mesh geometry={SPHERE()} material={p.skin} scale={[0.1, 0.118, 0.108]} castShadow={shadows} />
          <mesh geometry={SPHERE()} material={p.skin} position={[0, -0.05, 0.02]} scale={[0.078, 0.07, 0.08]} />
          <Face p={p} />
          <Hair look={look} p={p} />
          <Headwear p={p} look={look} />
          <Accessory p={p} look={look} />
        </group>
      </group>
    </group>
  );
}

/** Distant LOD: 6 meshes, low-poly spheres, same colours. */
function LowAvatar({ look }: { look: AvatarLook }) {
  const p = useLookParts(look);
  return (
    <group scale={p.b.scale}>
      <mesh geometry={BOX()} material={p.botM} position={[0, 0.46, 0]} scale={[p.b.hip * 2, 0.9, 0.18]} />
      <mesh geometry={SPHERE_LO()} material={p.topM} position={[0, 1.2, 0]} scale={[p.b.sh + 0.05, 0.3, 0.13]} />
      <mesh geometry={SPHERE_LO()} material={p.skin} position={[0, 1.62, 0]} scale={[0.1, 0.12, 0.11]} />
      {look.hairStyle !== "bald" && (
        <mesh geometry={SPHERE_LO()} material={p.hair} position={[0, 1.67, -0.02]} scale={look.hairStyle === "afro" ? 0.18 : 0.12} />
      )}
      <mesh geometry={BOX()} material={p.shoeM} position={[0, 0.04, 0.03]} scale={[p.b.hip * 2, 0.08, 0.26]} />
    </group>
  );
}

export function Avatar({ look, name, level = 1, animRef, showTag = true, lod = false, shadows = true }: AvatarProps) {
  const blob = useMemo(() => blobTexture(), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={1}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial map={blob} color="#000000" transparent opacity={0.38} depthWrite={false} />
      </mesh>
      {lod ? (
        <Detailed distances={[0, 16]}>
          <FullAvatar look={look} animRef={animRef} shadows={shadows} />
          <LowAvatar look={look} />
        </Detailed>
      ) : (
        <FullAvatar look={look} animRef={animRef} shadows={shadows} />
      )}
      {showTag && name && (
        <Billboard position={[0, 2.12, 0]}>
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[Math.max(0.9, name.length * 0.085 + 0.45), 0.26]} />
            <meshBasicMaterial color="#12142b" transparent opacity={0.72} />
          </mesh>
          <Text font={FONT} fontSize={0.14} color="#ffffff" anchorX="center" anchorY="middle">
            {`Lv ${level}  ${name}`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
