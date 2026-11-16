"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { Tier } from "./materials";
import { Clouds } from "./Clouds";
import { NightLights } from "./NightLights";
import { tod } from "./time-of-day/store";
import { followCamera, skyGeometry, skyMaterial, updateSky } from "./time-of-day/sky";
import { TodEnvironment } from "./time-of-day/TodEnvironment";
import { useFightFocus } from "@/fight/focus";
import { BOXER_V7 } from "./human/boxer/body-v6";

/**
 * Musanze daylight, twilight and night (P2-WLD-19, docs/TIME-OF-DAY.md): everything follows the time-of-day state
 * (`tod`, world/time-of-day/store.ts) — the real Kigali clock by default, or the player's preset.
 * Lighting = 1 shadow-casting directional KEY light (the sun by day, the moon by night: one light, so no shader
 * recompiles; its intensity passes through zero at dusk before it changes body) + hemisphere fill + a local
 * procedural environment map of the same sky (re-rendered only when the light changed) for PBR reflections.
 * Atmospheric perspective comes from exponential fog matched to the sky's horizon colour per phase.
 */

/** Direction towards the key light (live: follows the time of day; the classic morning when the flag is off). */
export const SUN_DIR = tod.keyDir;
/** Clear-day horizon / fog colour (kept for code that needs a static daytime value). */
export const FOG_COLOR = "#c4d2dc";
/** Clear-day fog density (the morning mist thickens it: world/PlazaActivities MorningMist; per phase: tod.look.fogK). */
export const fogDensity = (tier: Tier) => (tier === "lite" ? 0.0012 : 0.00085);

const reducedMotion = () => {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** The sky dome (world/time-of-day/sky.ts): one draw at the far plane. */
function SkyDome({ tier }: { tier: Tier }) {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(skyGeometry(), skyMaterial({ lite: tier === "lite" }));
    followCamera(m);
    m.name = "sky";
    return m;
  }, [tier]);
  useEffect(() => () => (mesh.material as THREE.Material).dispose(), [mesh]);
  const twinkle = useMemo(() => (tier === "lite" || reducedMotion() ? 0 : 1), [tier]);
  useFrame(({ clock }) => updateSky(mesh.material as THREE.ShaderMaterial, { twinkle, time: clock.elapsedTime }));
  return <primitive object={mesh} />;
}

/**
 * Scene fog (P2-WLD-21, docs/NIGHT-LIGHTING.md §6): exponential-squared haze on the area's scene. It used to be
 * declared as `<fogExp2 attach="fog">` inside the "lighting" group, which attached it to that group, never to the
 * scene: it was never active. Installed before the area's first frame (its programs compile once, with fog) and
 * removed with the area; colour per phase (FogTint), density from the morning mist × tod.look.fogK (MorningMist).
 */
function SceneFog({ tier }: { tier: Tier }) {
  const scene = useThree((s) => s.scene);
  const fog = useMemo(() => new THREE.FogExp2(FOG_COLOR, fogDensity(tier)), [tier]);
  useLayoutEffect(() => {
    const prev = scene.fog;
    fog.color.setRGB(...tod.look.fog);
    scene.fog = fog;
    return () => {
      if (scene.fog === fog) scene.fog = prev;
    };
  }, [scene, fog]);
  return null;
}

/** Fog colour per phase (the density is the morning mist's: PlazaActivities MorningMist × tod.look.fogK). */
function FogTint() {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const f = scene.fog;
    if (f) f.color.setRGB(...tod.look.fog);
  });
  return null;
}

function Hemisphere() {
  const ref = useRef<THREE.HemisphereLight>(null);
  useFrame(() => {
    const h = ref.current;
    if (!h) return;
    const L = tod.look;
    h.color.setRGB(...L.hemiSky);
    h.groundColor.setRGB(...L.hemiGround);
    h.intensity = L.hemiI;
  });
  return <hemisphereLight ref={ref} args={["#c9def0", "#4a5236", 0.45]} />;
}

/**
 * Key light with a shadow frustum that follows the player (crisp shadows near you, texel-snapped to avoid shimmer).
 * Its direction comes from the sun / moon position; in "Now" mode it is re-aimed only when it moved ≥ 0.1°
 * (≈ every 25 s: a 3 cm shift 20 m from a caster, under one shadow texel), so the shadow map never swims.
 */
const look = new THREE.Vector3();
function Sun({ tier }: { tier: Tier }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { camera, scene, gl } = useThree();
  const size = 46;
  const map = 2048;
  const frame = useRef(0);
  const keyVer = useRef(-1);
  const dir = useRef(new THREE.Vector3().copy(tod.keyDir));
  // (the aerial view's throttled shadow map, below, hands auto-updates back when the sun unmounts)
  useEffect(() => () => void (gl.shadowMap.autoUpdate = true), [gl]);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const L = tod.look;
    l.color.setRGB(...L.keyCol);
    l.intensity = L.keyI;
    l.shadow.intensity = L.shadow;
    const turned = keyVer.current !== tod.keyVersion;
    if (turned) {
      keyVer.current = tod.keyVersion;
      dir.current.copy(tod.keyDir);
    }
    // high up (campus aerial view): centre the shadows where the camera looks and widen them to cover the campus
    const h = camera.position.y;
    const half = h > 40 ? Math.min(220, Math.max(size, h * 0.55)) : size;
    const sc = l.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.far = h > 40 ? 300 + half * 2 : 300;
      sc.updateProjectionMatrix();
    }
    let fx = camera.position.x;
    let fz = camera.position.z;
    if (h > 40) {
      camera.getWorldDirection(look);
      if (look.y < -0.05) {
        fx += (look.x * h) / -look.y;
        fz += (look.z * h) / -look.y;
      }
    }
    const texel = (half * 2) / map;
    const cx = Math.round(fx / texel) * texel;
    const cz = Math.round(fz / texel) * texel;
    const reach = 120 + half;
    // high up, people and props are a few pixels: the campus shadow map (≈ 70 shadow-pass draws) is re-rendered
    // when the shadow frame or the light moves and otherwise every 6th frame, instead of every frame (P2-WLD-11);
    // with no shadow to see (night without a moon) it is not re-rendered at all
    const moved = l.target.position.x !== cx || l.target.position.z !== cz || turned;
    if (h > 60) {
      gl.shadowMap.autoUpdate = false;
      if (L.shadow > 0.01 && (moved || ++frame.current % 6 === 0)) gl.shadowMap.needsUpdate = true;
    } else if (!gl.shadowMap.autoUpdate) gl.shadowMap.autoUpdate = true;
    const d = dir.current;
    l.target.position.set(cx, 0, cz);
    l.position.set(cx + d.x * reach, d.y * reach, cz + d.z * reach);
  });
  return (
    <directionalLight
      ref={light}
      color="#fff0dc"
      intensity={2.6}
      castShadow={tier !== "lite"}
      shadow-mapSize={[map, map]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.04}
      shadow-radius={3}
      shadow-camera-left={-size}
      shadow-camera-right={size}
      shadow-camera-top={size}
      shadow-camera-bottom={-size}
      shadow-camera-near={1}
      shadow-camera-far={300}
    />
  );
}

export function Lighting({ tier }: { tier: Tier }) {
  return (
    <>
      <SkyDome tier={tier} />
      <SceneFog tier={tier} />
      <FogTint />
      <Hemisphere />
      <Sun tier={tier} />
      <TodEnvironment resolution={tier === "lite" ? 32 : 128} />
      <Clouds tier={tier} />
      <NightLights tier={tier} fogD={fogDensity(tier)} />
    </>
  );
}

/** Standard tier only, never inside an XR session: one merged pass of mip-blur bloom (threshold 1 = LEDs only). */
export function Effects() {
  // P3-FGT-18 (docs/FIGHT-REALISM-V7.md §6): screen-space ambient occlusion (N8AO, half resolution) while I am in a
  // ring as a fighter — contact shade where the arms close on the trunk, in the armpits, under the chin, between the
  // fighters and on the canvas round the feet. Always mounted (no composer rebuild), enabled only then.
  const ringAo = useFightFocus((s) => BOXER_V7 && !!s.ring && s.mode === "fighter");
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO enabled={ringAo} halfRes quality="performance" aoRadius={0.55} distanceFalloff={0.9} intensity={2.4} color="black" />
      <Bloom mipmapBlur levels={6} luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.55} radius={0.62} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
