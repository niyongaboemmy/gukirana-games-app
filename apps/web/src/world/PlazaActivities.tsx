"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { selfPose, useWorld } from "@/lib/world-store";
import { ACTIVITY_OBSTACLES, NOTICE_BOARD, birdHomes, birdState, flockSettled, fogFactor, kigaliHour, mistLevel, mistUniform, someoneNear } from "./activities";
import { circle, rect, setObstacles } from "./obstacles";
import { fogDensity } from "./Lighting";
import { noticeBoardTexture } from "./textures";
import { birdFlutter } from "./Ambience";
import { isOnScreen, useArea } from "./stage";
import type { Tier } from "./materials";

/**
 * Plaza activities that live in the 3D scene (P2-WLD-09): the props' collision footprints, the pigeons on the
 * fountain court (one instanced draw call, wings flapped in the vertex shader) and the Musanze morning mist.
 * The props themselves are merged into the district (activity-props.ts); the windows are PlazaCards.tsx.
 */

/** Collision footprints of the notice board, water point and viewpoint lectern. */
function useActivityObstacles() {
  useEffect(() => {
    const o = ACTIVITY_OBSTACLES;
    setObstacles("plaza-activities", [rect(o.board.x, o.board.z, o.board.hw, o.board.hd, o.board.rot, 2.6), circle(o.water.x, o.water.z, o.water.r, 1.05), circle(o.viewpoint.x, o.viewpoint.z, o.viewpoint.r, 1.2)]);
    return () => setObstacles("plaza-activities", []);
  }, []);
}

// ------------------------------------------------------------------ pigeons

/**
 * A rock pigeon (Columba livia), ~32 cm, facing +z, feet at y = 0: a smooth plump body (lathe), neck, round head,
 * beak with the pale cere, orange eyes, fanned tail, pink legs and two wings. Plumage as vertex colours: blue-grey
 * body, darker head, a green-purple sheen on the neck, light grey wings with the two black wing bars, a dark band at
 * the tail tip. Attributes for the shader: `aWing` (±span 0…1 on wing vertices), `aHead` (head bob / peck weight),
 * `aLeg` (legs tuck in flight).
 */
function pigeonGeometry(): THREE.BufferGeometry {
  const C = (hex: string) => new THREE.Color(hex);
  const GREY = C("#6c7480"); // body blue-grey (reads mid-grey under the plaza sun)
  const BACK = C("#7d8692"); // mantle / wing coverts, a touch lighter
  const HEAD = C("#4a4f58");
  const NECK_G = C("#4a4f58").lerp(C("#3f7a63"), 0.45); // a green sheen over the dark neck, not a band
  const NECK_P = C("#4a4f58").lerp(C("#6a4e83"), 0.4); // purple sheen at the front
  const BAR = C("#23262b"); // wing bars
  const PRIM = C("#3d4249"); // primaries, darker
  const TAILB = C("#33363c"); // tail tip band
  const BEAK = C("#3a3a3d");
  const CERE = C("#e9e6df");
  const EYE = C("#d98a2b");
  const LEG = C("#b9545d");
  type Part = { g: THREE.BufferGeometry; color: (x: number, y: number, z: number, u: number) => THREE.Color; wing?: number; head?: number | ((y: number) => number); leg?: boolean };
  const parts: Part[] = [];

  // body: lathe profile (radius, length) from tail to chest, revolved, laid along +z
  const prof = [
    [0.004, -0.125], [0.03, -0.1], [0.052, -0.06], [0.068, -0.02], [0.075, 0.02], [0.073, 0.055], [0.062, 0.085], [0.042, 0.108], [0.018, 0.122], [0.003, 0.126],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 18).rotateX(Math.PI / 2).scale(0.92, 1.02, 1).translate(0, 0.128, -0.005);
  parts.push({
    g: body,
    color: (_x, y, z) => {
      const base = y > 0.15 ? GREY.clone().lerp(BACK, THREE.MathUtils.clamp((y - 0.15) / 0.04, 0, 1)) : GREY.clone();
      // the neck sheen fades down onto the upper chest (no hard collar)
      const sheen = THREE.MathUtils.clamp((z - 0.06) / 0.05, 0, 1) * THREE.MathUtils.clamp((y - 0.13) / 0.05, 0, 1);
      return base.lerp(NECK_G.clone().lerp(NECK_P, 0.5), sheen * 0.85);
    },
  });

  // neck: tapered, leaning forward; iridescent (green on the sides, purple at the front)
  // a closed, rounded neck that blends head into chest (an open tube read as a collar)
  const neck = new THREE.SphereGeometry(0.036, 16, 12).scale(1, 1.4, 1.05).rotateX(-0.45).translate(0, 0.188, 0.09);
  parts.push({
    g: neck,
    color: (x, y) => {
      const sheen = Math.abs(x) > 0.016 ? NECK_G : NECK_P;
      const up = THREE.MathUtils.clamp((y - 0.16) / 0.06, 0, 1);
      return GREY.clone().lerp(sheen, Math.min(1, up * 1.6)).lerp(HEAD, Math.max(0, up - 0.6) * 1.5);
    },
    head: (y) => THREE.MathUtils.clamp((y - 0.165) / 0.06, 0, 1) * 0.8,
  });

  // head + beak + cere + eyes (all move with the head)
  const head = new THREE.SphereGeometry(0.04, 16, 12).scale(0.92, 0.95, 1.08).translate(0, 0.232, 0.118);
  parts.push({ g: head, color: () => HEAD, head: 1 });
  const beak = new THREE.ConeGeometry(0.0085, 0.03, 10).rotateX(Math.PI / 2).translate(0, 0.226, 0.168);
  parts.push({ g: beak, color: () => BEAK, head: 1 });
  const cere = new THREE.SphereGeometry(0.0095, 8, 6).scale(1, 0.7, 1.2).translate(0, 0.233, 0.152);
  parts.push({ g: cere, color: () => CERE, head: 1 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.0072, 8, 6).translate(sx * 0.031, 0.24, 0.13);
    parts.push({ g: eye, color: () => EYE, head: 1 });
  }

  // tail: a fan, slightly drooped, darker band at the tip
  const tail = new THREE.PlaneGeometry(1, 1, 4, 4);
  {
    const P = tail.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      const u = P.getX(i) + 0.5; // across
      const v = P.getY(i) + 0.5; // 0 at the body … 1 at the tip
      const w = 0.045 + v * 0.045;
      P.setXYZ(i, (u - 0.5) * w, 0.125 - v * 0.035 + Math.sin(u * Math.PI) * 0.006, -0.1 - v * 0.115);
    }
  }
  parts.push({ g: tail, color: (_x, _y, z) => (z < -0.19 ? TAILB : PRIM.clone().lerp(GREY, 0.45)) });

  // legs + toes
  for (const sx of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.0045, 0.0055, 0.065, 6).translate(sx * 0.022, 0.033, 0.012);
    parts.push({ g: leg, color: () => LEG, leg: true });
    const toes = new THREE.BoxGeometry(0.014, 0.004, 0.03).translate(sx * 0.022, 0.002, 0.022);
    parts.push({ g: toes, color: () => LEG, leg: true });
  }

  // wings: a span × chord grid (span 0 at the shoulder … 1 at the tip); the shader folds / beats them
  for (const sgn of [-1, 1]) {
    const w = new THREE.PlaneGeometry(1, 1, 7, 3);
    const P = w.getAttribute("position") as THREE.BufferAttribute;
    const span: number[] = [];
    for (let i = 0; i < P.count; i++) {
      const u = P.getX(i) + 0.5; // span
      const v = P.getY(i) + 0.5; // chord: 0 leading edge … 1 trailing edge
      const front = THREE.MathUtils.lerp(0.055, -0.02, u ** 1.4);
      const back = THREE.MathUtils.lerp(-0.065, -0.085, u);
      const chordNarrow = 1 - 0.35 * u ** 2; // rounded tip
      const z = front + (back - front) * v * chordNarrow;
      P.setXYZ(i, sgn * (0.035 + u * 0.27), 0.168 + 0.01 * (1 - u), z);
      span.push(u);
    }
    w.userData.span = span;
    parts.push({
      g: w,
      wing: sgn,
      color: (_x, _y, _z, u) => {
        if (u > 0.78) return PRIM; // dark primaries at the tip
        if ((u > 0.3 && u < 0.38) || (u > 0.5 && u < 0.58)) return BAR; // the two black wing bars
        return BACK;
      },
    });
  }

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const wing: number[] = [];
  const headW: number[] = [];
  const legW: number[] = [];
  for (const part of parts) {
    const spanSrc = part.g.userData.span as number[] | undefined;
    const idx = part.g.index;
    // smooth shading: normals from the indexed (shared-vertex) geometry, then de-indexed with them
    if (idx) part.g.computeVertexNormals();
    const n = idx ? part.g.toNonIndexed() : part.g;
    if (!idx) n.computeVertexNormals();
    const P = n.getAttribute("position") as THREE.BufferAttribute;
    const N = n.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i);
      const y = P.getY(i);
      const z = P.getZ(i);
      const src = idx ? idx.getX(i) : i;
      const u = spanSrc ? spanSrc[src]! : 0;
      pos.push(x, y, z);
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      const c = part.color(x, y, z, u);
      col.push(c.r, c.g, c.b);
      wing.push(part.wing ? part.wing * Math.max(u, 0.001) : 0);
      headW.push(typeof part.head === "function" ? part.head(y) : (part.head ?? 0));
      legW.push(part.leg ? 1 : 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  out.setAttribute("aHead", new THREE.Float32BufferAttribute(headW, 1));
  out.setAttribute("aLeg", new THREE.Float32BufferAttribute(legW, 1));
  return out;
}

const ease = (k: number) => k * k * (3 - 2 * k);

function Pigeons() {
  const area = useArea();
  const homes = useMemo(() => birdHomes(), []);
  const N = homes.length;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const scaredAt = useRef(-Infinity);
  const scan = useRef(0);
  const { geo, mat, flap } = useMemo(() => {
    const g = pigeonGeometry();
    // per instance: x = flap amount (0 folded … 1 full beat), y = phase
    const flap = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    g.setAttribute("aFlap", flap);
    const uTime = { value: 0 };
    // matte feathers (no sheen / glare); colours come from the plumage vertex colours
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aWing;\nattribute float aHead;\nattribute float aLeg;\nattribute vec2 aFlap;").replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float flying = aFlap.x;
         if (aWing != 0.0) {
           float span = abs(aWing);
           float sgn = sign(aWing);
           float fold = 1.0 - flying;
           float beat = sin(uTime * 14.0 + aFlap.y) * 0.95 * flying;
           // spread (flying): out from the shoulder, beating, the outer feathers curving down
           vec3 ext = vec3(sgn * (0.035 + span * 0.27), transformed.y + span * 0.27 * sin(beat) - flying * span * span * 0.03, transformed.z);
           // folded (resting): wrapped on the upper flank along the body, the primaries sweeping back to cross over the
           // tail (r = the body's half-width at that point along it, from the same lathe profile)
           float zf = transformed.z - span * 0.12;
           float tz = clamp((zf - 0.012) / 0.125, -1.0, 1.0);
           float r = max(0.075 * sqrt(max(0.0, 1.0 - tz * tz)), 0.024);
           float th = mix(0.95, 0.55, span);
           vec3 folded = vec3(sgn * (r * 0.92 + 0.005) * cos(th), 0.128 + (r * 1.02 + 0.005) * sin(th), zf);
           transformed = mix(ext, folded, fold);
         }
         if (aHead > 0.0 && flying < 0.01) {
           // on the ground: the pigeon head-bob, and now and then a peck at the paving (the head, not the bird)
           float peck = pow(max(0.0, sin(uTime * 1.4 + aFlap.y)), 10.0);
           float bob = sin(uTime * 5.5 + aFlap.y * 3.0);
           transformed.z += aHead * (0.011 * bob + 0.028 * peck);
           transformed.y -= aHead * 0.12 * peck;
         }
         // legs tucked up under the body in flight
         transformed.y += aLeg * 0.035 * flying;
         transformed.z -= aLeg * 0.03 * flying;`,
      );
    };
    m.customProgramCacheKey = () => "gk-pigeon-3";
    m.userData.uTime = uTime;
    return { geo: g, mat: m, flap };
  }, [N]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m || !isOnScreen(area)) return;
    const t = clock.elapsedTime;
    (mat.userData.uTime as { value: number }).value = t;
    // someone walking close (you or anyone else here) startles the resting flock
    if (t - scan.current > 0.2) {
      scan.current = t;
      if (flockSettled(t - scaredAt.current, N)) {
        const people = [{ x: selfPose.x, z: selfPose.z }];
        for (const p of Object.values(useWorld.getState().players)) people.push({ x: p.x / 100, z: p.z / 100 });
        if (someoneNear(homes, people)) {
          scaredAt.current = t;
          birdFlutter(homes[0]!.x, homes[0]!.z);
        }
      }
    }
    const since = t - scaredAt.current;
    let shown = 0;
    homes.forEach((h, i) => {
      const s = birdState(since, i);
      const out = Math.hypot(h.x, h.z) || 1;
      const dx = h.x / out;
      const dz = h.z / out;
      let x = h.x;
      let y = 0;
      let z = h.z;
      let yaw = h.yaw;
      let pitch = 0;
      let f = 0;
      let scale = 1;
      if (s.phase === "ground") {
        // walk-about pecking: a little dip of the body now and then, a slow turn
        // the head pecks (shader); the bird shuffles a little and turns slowly
        x += 0.12 * Math.sin(t * 0.09 + h.phase);
        z += 0.12 * Math.cos(t * 0.07 + h.phase * 1.3);
        yaw = h.yaw + 0.5 * Math.sin(t * 0.13 + h.phase);
      } else if (s.phase === "takeoff") {
        const k = s.k;
        x += dx * k * k * 3;
        z += dz * k * k * 3;
        y = 2.4 * k * k + 0.4 * k;
        yaw = Math.atan2(dx, dz);
        pitch = -0.5;
        f = 1;
      } else if (s.phase === "away") {
        // up and out over the halls, gone from view for most of the time away
        const k = Math.min(1, s.k * 4);
        x = h.x + dx * (3 + 40 * ease(k));
        z = h.z + dz * (3 + 40 * ease(k));
        y = 2.8 + 22 * ease(k);
        yaw = Math.atan2(dx, dz);
        f = 1;
        if (s.k > 0.25) scale = 0;
      } else {
        // glide back in from the far side of the fountain and settle
        const k = ease(s.k);
        x = h.x - dx * 9 * (1 - k);
        z = h.z - dz * 9 * (1 - k);
        y = 5 * (1 - k) * (1 - k);
        yaw = Math.atan2(dx, dz);
        pitch = 0.15 * (1 - k);
        f = s.k < 0.85 ? 0.45 : 0.9 * (1 - s.k) * 6;
      }
      o.position.set(x, y, z);
      o.rotation.set(pitch, yaw, 0, "YXZ");
      o.scale.setScalar(scale);
      shown += scale;
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      flap.setXY(i, Math.min(1, f), h.phase);
    });
    m.instanceMatrix.needsUpdate = true;
    flap.needsUpdate = true;
    m.visible = shown > 0; // the whole flock away: nothing to draw
  });
  // (no shadow: 30 cm birds; one draw call, culled with the fountain court when it is out of view)
  const bounds = useMemo(() => new THREE.Sphere(new THREE.Vector3(0, 2.5, 7.5), 13), []);
  return <instancedMesh ref={(m) => {
        mesh.current = m;
        if (m) m.boundingSphere = bounds;
      }} args={[geo, mat, N]} userData={{ noMerge: true }} />;
}

// ------------------------------------------------------------------ morning mist

/** Musanze morning mist from the Kigali clock: the fog thickens at dawn and clears by ~10:00 (same for everyone). */
function MorningMist({ tier }: { tier: Tier }) {
  const scene = useThree((s) => s.scene);
  const area = useArea();
  const last = useRef(-10);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t - last.current < 2 || !isOnScreen(area)) return; // (a hall on screen owns the fog)
    last.current = t;
    // dev QA: window.__gkHour pins the hour (screenshots of the morning mist)
    const qa = process.env.NODE_ENV !== "production" ? (window as unknown as { __gkHour?: number }).__gkHour : undefined;
    const mist = mistLevel(qa ?? kigaliHour(Date.now()));
    mistUniform.value = mist;
    const fog = scene.fog;
    if (fog instanceof THREE.FogExp2) fog.density = fogDensity(tier) * fogFactor(mist);
  });
  return null;
}

/** The notice board's printed face: one small quad, frustum-culled, no shadow (drawn only while it is in view). */
function NoticeFace() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: noticeBoardTexture(), roughness: 0.92 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const nb = NOTICE_BOARD;
  return (
    <mesh position={[nb.x, 1.05 + nb.h / 2, nb.z + 0.004]} rotation={[0, nb.rotY, 0]} material={mat} receiveShadow userData={{ noMerge: true }}>
      <planeGeometry args={[nb.w, nb.h]} />
    </mesh>
  );
}

export function PlazaActivities({ tier }: { tier: Tier }) {
  useActivityObstacles();
  return (
    <group name="plaza-activities">
      <NoticeFace />
      <Pigeons />
      <MorningMist tier={tier} />
    </group>
  );
}
