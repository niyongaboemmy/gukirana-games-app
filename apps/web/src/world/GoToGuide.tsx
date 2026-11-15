"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { destination, destRoute, type Destination } from "./destinations";
import { tickGuide, useGoTo } from "./goto";
import { cameraState } from "./Player";
import type { P } from "./campus";

/** Most chevrons drawn along a route (≈ 400 m at the ground spacing; the aerial view spaces them out). */
const MAX = 260;
const SPACING = 1.6;
/** warm gold (no blue in the UI): the route on the ground, the beacon over the destination */
const GOLD = "#f2c25b";

/**
 * The Go To route guide (P2-WLD-13): gold chevrons on the ground along the campus walks from you to the destination,
 * drifting towards it, and a light beacon standing over it (seen from the ground and in the campus aerial view).
 * Drawn only while a destination is picked (one instanced mesh + the beacon: two draw calls, none otherwise).
 */
export function GoToGuide() {
  const dest = useGoTo((s) => s.dest);
  const d = destination(dest);
  if (!d) return null;
  return <Guide d={d} />;
}

function Guide({ d }: { d: Destination }) {
  const parts = useMemo(() => {
    const s = new THREE.Shape();
    // a flat chevron pointing +y (laid on the ground pointing +z below)
    s.moveTo(-0.34, -0.16);
    s.lineTo(0, 0.16);
    s.lineTo(0.34, -0.16);
    s.lineTo(0.34, -0.02);
    s.lineTo(0, 0.3);
    s.lineTo(-0.34, -0.02);
    s.closePath();
    const chev = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI);
    const chevMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const beam = new THREE.CylinderGeometry(0.55, 0.9, 30, 20, 1, true).translate(0, 15, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    return { chev, chevMat, beam, beamMat };
  }, []);
  useEffect(() => () => [parts.chev, parts.chevMat, parts.beam, parts.beamMat].forEach((x) => x.dispose()), [parts]);
  const inst = useRef<THREE.InstancedMesh>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const route = useRef<{ pts: P[]; cum: number[]; at: number }>({ pts: [], cum: [], at: -1 });
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const r = route.current;
    // the route from where you are now (a few times a second: the walks' graph is small)
    if (now - r.at > 0.35) {
      r.at = now;
      tickGuide();
      r.pts = destRoute({ x: selfPose.x, z: selfPose.z }, d);
      r.cum = [0];
      for (let i = 1; i < r.pts.length; i++) r.cum.push(r.cum[i - 1]! + Math.hypot(r.pts[i]!.x - r.pts[i - 1]!.x, r.pts[i]!.z - r.pts[i - 1]!.z));
    }
    const im = inst.current;
    if (im) {
      // bigger and further apart from up high (the campus aerial view)
      const k = THREE.MathUtils.clamp(cameraState.distance / 14, 1, 9);
      const gap = SPACING * k;
      const total = r.cum[r.cum.length - 1] ?? 0;
      let n = 0;
      let seg = 1;
      for (let s = 1.4 + ((now * 1.3) % gap); s < total - 0.6 && n < MAX; s += gap) {
        while (seg < r.pts.length - 1 && r.cum[seg]! < s) seg++;
        const a = r.pts[seg - 1]!;
        const b = r.pts[seg]!;
        const L = r.cum[seg]! - r.cum[seg - 1]! || 1;
        const t = (s - r.cum[seg - 1]!) / L;
        v.set(a.x + (b.x - a.x) * t, 0.07 + 0.02 * k, a.z + (b.z - a.z) * t);
        q.setFromAxisAngle(up, Math.atan2(b.x - a.x, b.z - a.z));
        // fade in near you, full strength along the way
        const f = Math.min(1, (s - 1.0) / 3);
        sc.setScalar(k * (0.55 + 0.45 * f));
        m.compose(v, q, sc);
        im.setMatrixAt(n++, m);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
    const bm = beacon.current;
    if (bm) {
      const k = THREE.MathUtils.clamp(cameraState.distance / 30, 1, 6);
      bm.scale.set(k, 1 + 0.03 * Math.sin(now * 2.4), k);
      parts.beamMat.opacity = 0.22 + 0.08 * Math.sin(now * 2.4);
    }
  });

  const f = d.stop;
  return (
    <group name="goto-guide" userData={{ noMerge: true }}>
      <instancedMesh ref={inst} args={[parts.chev, parts.chevMat, MAX]} frustumCulled={false} renderOrder={2} />
      <mesh ref={beacon} geometry={parts.beam} material={parts.beamMat} position={[f.x, 0, f.z]} renderOrder={3} />
    </group>
  );
}
