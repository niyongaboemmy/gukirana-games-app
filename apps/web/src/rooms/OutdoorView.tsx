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
  const outdoor = useMemo(() => {
    const s = new THREE.Scene();
    s.fog = new THREE.FogExp2(FOG_COLOR, lite ? 0.0012 : 0.00085);
    return s;
  }, [lite]);
  const rt = useMemo(
    () =>
      new THREE.WebGLCubeRenderTarget(lite ? 512 : 1024, {
        type: THREE.UnsignedByteType, // widely supported (half-float cube targets render black on some GPUs/browsers)
        colorSpace: THREE.SRGBColorSpace,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [lite],
  );
  const cam = useMemo(() => {
    const c = new THREE.CubeCamera(0.5, 3200, rt);
    c.position.set(0, 1.7, 0);
    outdoor.add(c);
    return c;
  }, [rt, outdoor]);
  const [captured, setCaptured] = useState(false);
  const frames = useRef(0);

  useEffect(() => {
    scene.background = new THREE.Color("#c4d2dc");
    return () => {
      scene.background = null;
      rt.dispose();
    };
  }, [scene, rt]);

  useFrame(() => {
    if (captured) return;
    frames.current++;
    // frame 1: landscape + environment map are built; frame 3: everything uploaded, capture once
    if (frames.current < 3) return;
    const shadows = gl.shadowMap.enabled;
    gl.shadowMap.enabled = false;
    cam.update(gl, outdoor);
    gl.shadowMap.enabled = shadows;
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
