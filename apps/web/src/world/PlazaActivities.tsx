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

/** A rock pigeon, ~32 cm: body, head, tail and two wings (attribute `aWing` = ±1 on wing vertices, by span). */
function pigeonGeometry(): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; wing: number }[] = [];
  const body = new THREE.IcosahedronGeometry(0.5, 0).scale(0.13, 0.12, 0.2).translate(0, 0.16, 0);
  const head = new THREE.IcosahedronGeometry(0.5, 0).scale(0.075, 0.075, 0.08).translate(0, 0.27, 0.12);
  const beak = new THREE.ConeGeometry(0.012, 0.035, 4).rotateX(Math.PI / 2).translate(0, 0.265, 0.17);
  const tail = new THREE.PlaneGeometry(0.09, 0.12).rotateX(-Math.PI / 2 + 0.25).translate(0, 0.15, -0.15);
  parts.push({ g: body, wing: 0 }, { g: head, wing: 0 }, { g: beak, wing: 0 }, { g: tail, wing: 0 });
  for (const s of [-1, 1]) {
    // wing: a tapered quad from the shoulder out to the tip
    const w = new THREE.BufferGeometry();
    const p = [0.04 * s, 0.2, 0.06, 0.3 * s, 0.2, -0.02, 0.04 * s, 0.2, -0.08, 0.3 * s, 0.2, -0.1];
    w.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    w.setIndex(s > 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2]);
    w.computeVertexNormals();
    parts.push({ g: w, wing: s });
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const wing: number[] = [];
  for (const { g, wing: s } of parts) {
    const n = g.index ? g.toNonIndexed() : g;
    n.computeVertexNormals();
    const P = n.getAttribute("position") as THREE.BufferAttribute;
    const N = n.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      wing.push(s ? (s * Math.max(0, Math.abs(P.getX(i)) - 0.04)) / 0.26 : 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
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
    const m = new THREE.MeshStandardMaterial({ color: "#5f646d", roughness: 0.8, side: THREE.DoubleSide }); // rock-pigeon slate grey
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aWing;\nattribute vec2 aFlap;").replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         if (aWing != 0.0) {
           // folded: the wing lies along the body; flying: it beats about the shoulder
           float span = abs(aWing);
           float fold = 1.0 - aFlap.x;
           transformed.x = sign(aWing) * mix(0.04 + span * 0.26, 0.06 + span * 0.03, fold);
           float beat = sin(uTime * 15.0 + aFlap.y) * 0.95 * aFlap.x;
           transformed.y += span * 0.26 * sin(beat);
         }`,
      );
    };
    m.customProgramCacheKey = () => "gk-pigeon";
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
        const pk = Math.max(0, Math.sin(t * 1.4 + h.phase));
        pitch = 0.45 * pk ** 10;
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
