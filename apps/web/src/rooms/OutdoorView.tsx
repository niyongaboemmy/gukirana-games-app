"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import * as THREE from "three";
import { Landscape } from "@/world/Landscape";
import { FOG_COLOR, SUN_DIR } from "@/world/Lighting";
import { DOOR_RING, PORTALS, ringPoint } from "@/world/layout";
import { LAWN_BEDS } from "@/world/beds";
import type { HallLayout } from "./layouts";

/**
 * The real outdoors behind the hall windows. The plaza's own procedural Northern-Rwanda landscape
 * (`@/world/Landscape`: Virunga cones, terraced hills, Twin Lakes, mist, woodlots) is mounted ONCE in an
 * offscreen scene, transformed into this hall's frame (the hall stands on the district's door ring, its door
 * facing the fountain, so the north window looks outward along the portal's bearing — Pool Hall towards
 * Bisoke / Sabyinyo, Ludo Lounge towards Gahinga / Muhabura, Igisoro Court towards Karisimbi), lit by the same
 * morning sun, and captured from the middle of the room into a cube map that becomes `scene.background`.
 * Everything visible through the glass is ≥ 50 m away, so parallax inside a 24 m room is negligible, and the
 * runtime cost is one textured cube (the landscape geometry is disposed after the capture).
 */
export function hallFrame(layout: HallLayout) {
  const portal = PORTALS.find((p) => p.id === layout.game);
  const deg = portal?.angleDeg ?? 0;
  // building centre: the door sits on the door ring; the room extends outward by its depth
  const centre = ringPoint(deg, DOOR_RING + layout.size.d / 2);
  const yaw = (deg * Math.PI) / 180; // world → room rotation about +y
  const sun = SUN_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { centre, yaw, sun };
}

/** captured window views per hall + tier, kept for the session (≈ 25 MB GPU per hall on Standard, 6 MB on Lite) */
const CAPTURED = new Map<string, THREE.WebGLCubeRenderTarget>();

export function OutdoorView({
  layout,
  lite,
  onReady,
}: {
  layout: HallLayout;
  lite: boolean;
  onReady?: () => void;
}) {
  const { gl, scene } = useThree();
  const frame = useMemo(() => hallFrame(layout), [layout]);
  const key = `${layout.game}:${lite ? "lite" : "std"}`;
  // the view out of this hall's windows never changes during a session: once captured it is kept (the next warm-up
  // of this hall, e.g. walking up to its door again, then costs nothing)
  const cached = CAPTURED.get(key) ?? null;
  const outdoor = useMemo(() => {
    const s = new THREE.Scene();
    s.fog = new THREE.FogExp2(FOG_COLOR, lite ? 0.0012 : 0.00085);
    return s;
  }, [lite]);
  const rt = useMemo(
    () =>
      cached ??
      new THREE.WebGLCubeRenderTarget(lite ? 512 : 1024, {
        type: THREE.UnsignedByteType, // widely supported (half-float cube targets render black on some GPUs/browsers)
        colorSpace: THREE.SRGBColorSpace,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [lite, cached],
  );
  const cam = useMemo(() => {
    const c = new THREE.CubeCamera(0.5, 3200, rt);
    c.position.set(0, 1.7, 0);
    outdoor.add(c);
    return c;
  }, [rt, outdoor]);
  const [captured, setCaptured] = useState(!!cached);
  const step = useRef<{ n: number; compiled: "no" | "running" | "done"; face: number }>({ n: 0, compiled: "no", face: 0 });

  useEffect(() => {
    if (CAPTURED.get(key) === rt) {
      scene.background = rt.texture;
      scene.backgroundIntensity = 1;
    } else scene.background = new THREE.Color("#c4d2dc");
    return () => {
      scene.background = null;
      if (CAPTURED.get(key) !== rt) rt.dispose();
    };
  }, [scene, rt, key]);

  /** the renderer state the capture draws with (programs are keyed on it, so the compile below must use it too) */
  const withCaptureState = <T,>(face: number, fn: () => T): T => {
    const shadows = gl.shadowMap.enabled;
    const tm = gl.toneMapping;
    const xr = gl.xr.enabled;
    const prev = gl.getRenderTarget();
    gl.shadowMap.enabled = false;
    gl.toneMapping = THREE.NoToneMapping;
    gl.xr.enabled = false;
    try {
      gl.setRenderTarget(rt, face);
      return fn();
    } finally {
      gl.setRenderTarget(prev);
      gl.xr.enabled = xr;
      gl.toneMapping = tm;
      gl.shadowMap.enabled = shadows;
    }
  };

  useFrame(() => {
    if (captured) return;
    const st = step.current;
    st.n++;
    // frames 1–2: landscape + environment map are built
    if (st.n < 3) return;
    if (st.compiled !== "done") {
      // compile the landscape's programs for this offscreen scene first, off the frame (parallel compile), so the
      // first face render never blocks on a synchronous shader link
      if (st.compiled === "no") {
        st.compiled = "running";
        cam.coordinateSystem = gl.coordinateSystem;
        cam.updateCoordinateSystem();
        cam.updateMatrixWorld(true);
        void withCaptureState(0, () => gl.compileAsync(outdoor, cam.children[0] as THREE.Camera))
          .catch(() => undefined)
          .finally(() => (st.compiled = "done"));
      }
      return;
    }
    // then one cube face per frame (six full renders of the landscape in a single frame stalled the walk up to the door)
    const face = st.face;
    if (face > 5) return;
    withCaptureState(face, () => gl.render(outdoor, cam.children[face] as THREE.Camera));
    st.face++;
    if (face < 5) return;
    CAPTURED.set(key, rt);
    scene.background = rt.texture;
    scene.backgroundIntensity = 1;
    setCaptured(true);
    onReady?.();
  });

  const sunPos = useMemo(() => frame.sun.clone().multiplyScalar(400), [frame]);
  if (captured) return null;
  return createPortal(
    <>
      <Sky
        distance={2400}
        sunPosition={sunPos}
        turbidity={7}
        rayleigh={1.6}
        mieCoefficient={0.006}
        mieDirectionalG={0.82}
      />
      <hemisphereLight args={["#c9def0", "#56643a", 0.55]} />
      <directionalLight position={frame.sun.clone().multiplyScalar(120)} intensity={2.9} color="#ffe4c4" />
      <Environment scene={outdoor} frames={1} resolution={lite ? 32 : 64} environmentIntensity={0.85}>
        <Sky
          distance={2400}
          sunPosition={sunPos}
          turbidity={7}
          rayleigh={1.6}
          mieCoefficient={0.006}
          mieDirectionalG={0.82}
        />
        <Lightformer
          form="circle"
          intensity={6}
          color="#ffe2b8"
          position={frame.sun.clone().multiplyScalar(50).toArray()}
          scale={10}
          target={[0, 0, 0]}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
          <circleGeometry args={[400, 32]} />
          <meshBasicMaterial color="#3e4a33" />
        </mesh>
      </Environment>
      <group rotation={[0, frame.yaw, 0]}>
        <group position={[-frame.centre.x, 0, -frame.centre.z]}>
          <Landscape tier={lite ? "lite" : "standard"} />
          {/* district ground inside the landscape's inner ring (the plaza itself is not needed through the window) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
            <circleGeometry args={[95, 48]} />
            <meshStandardMaterial color="#6f9a4f" roughness={1} />
          </mesh>
          {/* the lawn beds seen through the windows stand on a raked-gravel apron with a steel edge, not bare lawn */}
          {LAWN_BEDS.map((b, i) => (
            <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
                <planeGeometry args={[b.hw * 2 + 2.4, b.hd * 2 + 2.4]} />
                <meshStandardMaterial color="#5c5750" roughness={1} />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <planeGeometry args={[b.hw * 2 + 2.2, b.hd * 2 + 2.2]} />
                <meshStandardMaterial color="#b8b0a2" roughness={1} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </>,
    outdoor,
  );
}
