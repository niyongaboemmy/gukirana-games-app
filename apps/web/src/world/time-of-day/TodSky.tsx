"use client";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { followCamera, skyGeometry, skyMaterial, updateSky } from "./sky";

/**
 * The time-of-day sky as a component for offscreen scenes (the hall window captures, rooms/OutdoorView): `yaw` turns
 * it into the scene's frame; no twinkle (a capture is a still). The plaza mounts its own (world/Lighting SkyDome).
 */
export function TodSky({ lite, yaw = 0 }: { lite: boolean; yaw?: number }) {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(skyGeometry(), skyMaterial({ lite }));
    followCamera(m);
    updateSky(m.material as THREE.ShaderMaterial, { yaw });
    return m;
  }, [lite, yaw]);
  useEffect(() => () => (mesh.material as THREE.Material).dispose(), [mesh]);
  useFrame(() => updateSky(mesh.material as THREE.ShaderMaterial, { yaw }));
  return <primitive object={mesh} />;
}
