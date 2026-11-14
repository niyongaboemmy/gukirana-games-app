"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { Tier } from "./materials";
import { Clouds } from "./Clouds";

/**
 * Morning in Musanze: low sun from the east-south-east, cool hazy sky, mist in the valleys.
 * Lighting = 1 shadow-casting directional sun + hemisphere fill + a LOCAL procedural environment map (drei
 * <Environment> rendering <Sky> + <Lightformer>s once into a cube map, no HDRI download) for PBR reflections.
 * Atmospheric perspective comes from exponential fog matched to the sky's horizon colour.
 */
const SUN_AZ = (104 * Math.PI) / 180;
const SUN_EL = (17 * Math.PI) / 180;
export const SUN_DIR = new THREE.Vector3(Math.cos(SUN_EL) * Math.sin(SUN_AZ), Math.sin(SUN_EL), -Math.cos(SUN_EL) * Math.cos(SUN_AZ));
export const FOG_COLOR = "#c4d2dc";
/** Clear-day fog density (the morning mist thickens it: world/PlazaActivities MorningMist). */
export const fogDensity = (tier: Tier) => (tier === "lite" ? 0.0012 : 0.00085);

function SkyDome() {
  const sun = useMemo(() => SUN_DIR.clone().multiplyScalar(400), []);
  // clearer, deeper highland blue (Musanze at ~1,850 m): less Rayleigh haze and turbidity than a lowland sky
  return <Sky distance={2400} sunPosition={sun} turbidity={2.4} rayleigh={2.0} mieCoefficient={0.004} mieDirectionalG={0.84} />;
}

/** Sun with a shadow frustum that follows the player (crisp shadows near you, texel-snapped to avoid shimmer). */
function Sun({ tier }: { tier: Tier }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { camera, scene } = useThree();
  const size = 46;
  const map = 2048;
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
    const texel = (size * 2) / map;
    const cx = Math.round(camera.position.x / texel) * texel;
    const cz = Math.round(camera.position.z / texel) * texel;
    l.target.position.set(cx, 0, cz);
    l.position.set(cx + SUN_DIR.x * 120, SUN_DIR.y * 120, cz + SUN_DIR.z * 120);
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
      <SkyDome />
      <fogExp2 attach="fog" args={[FOG_COLOR, fogDensity(tier)]} />
      <hemisphereLight args={["#c9def0", "#4a5236", 0.45]} />
      <Sun tier={tier} />
      <Environment frames={1} near={1} far={3000} resolution={tier === "lite" ? 32 : 128} environmentIntensity={0.55}>
        <SkyDome />
        {/* sun disc + warm bounce from the east, cool sky panels, dark-green ground */}
        <Lightformer form="circle" intensity={6} color="#ffe2b8" position={SUN_DIR.clone().multiplyScalar(50).toArray()} scale={10} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.2} color="#dbe8f5" position={[0, 40, -60]} scale={[120, 30, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.6} color="#ffd6a8" position={[-60, 10, 20]} scale={[60, 12, 1]} target={[0, 0, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
          <circleGeometry args={[400, 32]} />
          <meshBasicMaterial color="#3e4a33" />
        </mesh>
      </Environment>
      <Clouds tier={tier} />
    </>
  );
}

/** Standard tier only, never inside an XR session: one merged pass of mip-blur bloom (threshold 1 = LEDs only). */
export function Effects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom mipmapBlur levels={6} luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.55} radius={0.62} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
