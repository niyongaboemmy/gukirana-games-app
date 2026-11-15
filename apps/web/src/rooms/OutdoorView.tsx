"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Landscape } from "@/world/Landscape";
import { FOG_COLOR, SUN_DIR } from "@/world/Lighting";
import { TOD_ON, tod, useTimeOfDay } from "@/world/time-of-day/store";
import { TodSky } from "@/world/time-of-day/TodSky";
import { TodEnvironment } from "@/world/time-of-day/TodEnvironment";
import { ringPoint } from "@/world/layout";
import { LAWN_BEDS } from "@/world/beds";
import type { HallLayout } from "./layouts";
import { hallDoor, impostorBlocks, type ImpostorMat } from "./plaza-impostor";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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
  // building centre: the door sits on its ring (the plaza's door ring, or the expansion ring for the Administrative
  // Block since P2-WLD-14); the room extends outward by its depth
  const { deg, ring } = hallDoor(layout.game);
  const centre = ringPoint(deg, ring + layout.size.d / 2);
  const yaw = (deg * Math.PI) / 180; // world → room rotation about +y
  const sun = SUN_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { centre, yaw, sun };
}

/** captured window views per hall + tier, kept for the session (≈ 25 MB GPU per hall on Standard, 6 MB on Lite) */
const CAPTURED = new Map<string, THREE.WebGLCubeRenderTarget>();
/** halls mounted right now (their view must stay) */
const MOUNTED = new Set<string>();
/**
 * At most KEEP window views are kept for halls that are not mounted (P2-WLD-18: the glass captures warm halls you only
 * walk past; their 25 MB window views must not pile up for the session): the oldest is released.
 */
const KEEP = 2;
function keep(key: string, rt: THREE.WebGLCubeRenderTarget) {
  CAPTURED.delete(key);
  CAPTURED.set(key, rt);
  for (const k of [...CAPTURED.keys()]) {
    if (CAPTURED.size <= KEEP) break;
    if (MOUNTED.has(k) || k === key) continue;
    CAPTURED.get(k)?.dispose();
    CAPTURED.delete(k);
  }
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
  // P2-WLD-19: the view follows the time of day — one capture per settled phase (cached like before), re-taken lazily
  // when the phase changes while the hall is mounted; the previous view stays up until the new one is ready
  const phase = useTimeOfDay((s) => (TOD_ON ? s.settledPhase : "classic"));
  const key = `${layout.game}:${lite ? "lite" : "std"}:${phase}`;
  const frame = useMemo(() => hallFrame(layout), [layout, key]);
  // the view out of this hall's windows never changes during a session: once captured it is kept (the next warm-up
  // of this hall, e.g. walking up to its door again, then costs nothing)
  const cached = CAPTURED.get(key) ?? null;
  const outdoor = useMemo(() => {
    const s = new THREE.Scene();
    s.fog = new THREE.FogExp2(FOG_COLOR, lite ? 0.0012 : 0.00085);
    s.fog.color.setRGB(...tod.look.fog); // (P2-WLD-19: the shown time of day's horizon colour)
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
  // (P2-WLD-19) a new phase without a cached view: capture again (the outdoor fog takes the phase's colour)
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    (outdoor.fog as THREE.FogExp2).color.setRGB(...tod.look.fog);
    step.current = { n: 0, compiled: "no", face: 0 };
    setCaptured(!!CAPTURED.get(key));
  }, [key, outdoor]);

  useEffect(() => {
    MOUNTED.add(key);
    return () => void MOUNTED.delete(key);
  }, [key]);
  useEffect(() => {
    if (CAPTURED.get(key) === rt) {
      scene.background = rt.texture;
      scene.backgroundIntensity = 1;
    } else if (!(scene.background instanceof THREE.CubeTexture)) scene.background = new THREE.Color("#c4d2dc");
    // (P2-WLD-19: a phase change keeps the previous view up until the new capture replaces it)
    return () => {
      if (CAPTURED.get(key) !== rt && scene.background !== rt.texture) rt.dispose();
    };
  }, [scene, rt, key]);
  useEffect(
    () => () => {
      scene.background = null;
    },
    [scene],
  );

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
    keep(key, rt);
    scene.background = rt.texture;
    scene.backgroundIntensity = 1;
    setCaptured(true);
    onReady?.();
  });

  // the sky, sun / moon light and image lighting of the shown time of day, turned into the hall's frame (P2-WLD-19)
  const L = tod.look;
  const keyPos = useMemo(() => frame.sun.clone().multiplyScalar(120), [frame]);
  if (captured) return null;
  return createPortal(
    <>
      <TodSky lite={lite} yaw={frame.yaw} />
      <hemisphereLight args={[new THREE.Color().setRGB(...L.hemiSky), new THREE.Color().setRGB(...L.hemiGround), L.hemiI * 1.2]} />
      <directionalLight position={keyPos} intensity={L.keyI * 1.1} color={new THREE.Color().setRGB(...L.keyCol)} />
      <TodEnvironment scene={outdoor} resolution={lite ? 32 : 64} intensity={0.85 / 0.55} yaw={frame.yaw} once />
      <group rotation={[0, frame.yaw, 0]}>
        <group position={[-frame.centre.x, 0, -frame.centre.z]}>
          <Landscape tier={lite ? "lite" : "standard"} />
          {/* district ground inside the landscape's inner ring (the plaza itself is not needed through the window) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
            <circleGeometry args={[95, 48]} />
            <meshStandardMaterial color="#6f9a4f" roughness={1} />
          </mesh>
          {/* the neighbouring buildings seen through the side windows (P2-WLD-15), at their real places */}
          <CampusBlocks layout={layout} centre={frame.centre} />
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

const BLOCK_COLOR: Record<ImpostorMat, string> = {
  concreteDark: "#6f6c68",
  brick: "#9a5a42",
  limestone: "#d8d0bf",
  white: "#eeebe4",
  charcoal: "#5c5c62",
  wood: "#a07a52",
  hoarding: "#262b38",
};

/**
 * The other campus buildings as plain lit volumes (their real footprints, heights and facade colours) for the window
 * capture: through a hall's side windows you see its neighbours where they really stand, not open countryside.
 * Blocks that would reach into this room's own volume (the halls are larger inside than outside) are left out.
 */
function CampusBlocks({ layout, centre }: { layout: HallLayout; centre: { x: number; z: number } }) {
  const geos = useMemo(() => {
    const clear = Math.hypot(layout.size.w, layout.size.d) / 2 + 1;
    const by = new Map<ImpostorMat, THREE.BufferGeometry[]>();
    for (const k of impostorBlocks(layout.game)) {
      if (Math.hypot(k.x - centre.x, k.z - centre.z) - Math.hypot(k.w, k.d) / 2 < clear) continue;
      const g = new THREE.BoxGeometry(k.w, k.h, k.d).toNonIndexed();
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(k.x, k.h / 2, k.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k.rotY), new THREE.Vector3(1, 1, 1)));
      const list = by.get(k.mat) ?? [];
      list.push(g);
      by.set(k.mat, list);
    }
    const out: [ImpostorMat, THREE.BufferGeometry][] = [];
    for (const [m, list] of by) {
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      if (merged) out.push([m, merged]);
    }
    return out;
  }, [layout, centre]);
  useEffect(() => () => geos.forEach(([, g]) => g.dispose()), [geos]);
  return (
    <>
      {geos.map(([m, g]) => (
        <mesh key={m} geometry={g}>
          <meshStandardMaterial color={BLOCK_COLOR[m]} roughness={0.9} />
        </mesh>
      ))}
    </>
  );
}
