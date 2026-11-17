"use client";
import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ArmBones } from "../procedural";
import { BOXING_CLIPS, type BoxingClipName } from "../boxing/clips";
import { BoxingMotion } from "../boxing/motion";
import { BoxingRig } from "../boxing/rig";
import { driveHelpers, helperRig } from "./helpers";
import { loadTextureInto, registerKtx2Renderer } from "./v8/ktx2";

/**
 * P3-FGT-22, DEV ONLY: the boxer v9 Blender pipeline's TEST output in the boxer lab (`/play/boxing-lab?mode=boxer&v9=1`).
 * P3-FGT-23: `v9=scan` loads the real-scan test boxer from `_v9test/scan/` instead, with its baked skin colour.
 * Loads the git-ignored files `node apps/web/scripts/boxer-v9/run.mjs --publish-test` copies to
 * `public/assets/characters/_v9test/` (never committed, never in a production build: the lab page itself only exists
 * when NODE_ENV is "development"). Nothing in the game uses this file.
 *
 * Query: clip=<a clip of boxer-clips.glb> · at=<s> · corr=<pose>|0 (the cloth corrective blended in; default the
 * clip's own pose) · v9rig=1 (no clip: the runtime boxing rig, rig.ts + arm-fk.ts + helpers.ts, drives the v9
 * skeleton with the keyed clip of the same name, the compatibility check) · maps=0 (no baked normal maps).
 */
export const V9_LAB = process.env.NODE_ENV === "development";
const TEST_BASE = "/assets/characters/_v9test/";
/** (P3-FGT-23) v9=scan: the first real-scan boxer, `run.mjs --body scan --clips cmu --publish-test` (git-ignored) */
const v9Base = (q: URLSearchParams) => (q.get("v9") === "scan" ? `${TEST_BASE}scan/` : TEST_BASE);
/** the cloth corrective (05_cloth.py corr_<pose>) that belongs to each clip */
const CLIP_POSE: Record<string, string> = {
  guard: "guard",
  jab: "jab",
  cross: "cross",
  leadHook: "leadHook",
  rearHook: "rearHook",
  leadUppercut: "leadUppercut",
  rearBody: "rearBody",
  duck: "duck",
  blockHigh: "blockHigh",
};
const COLORS: Record<string, string> = {
  body: "#6b4630",
  singlet: "#b3202a",
  trunks: "#b3202a",
  glove: "#8e1119",
  hair: "#141010",
};

export interface V9Probe {
  bone: (n: string) => THREE.Object3D | null;
  root: THREE.Object3D;
  ready: boolean;
}

export function BoxerV9Lab({
  q,
  setInfo,
  probe,
}: {
  q: URLSearchParams;
  setInfo: (s: string) => void;
  probe: { current: V9Probe | null };
}) {
  const gl = useThree((s) => s.gl);
  registerKtx2Renderer(gl);
  const BASE = v9Base(q);
  const scan = q.get("v9") === "scan";
  const fighter = useGLTF(`${BASE}boxer-m.glb`, false);
  const lib = useGLTF(`${BASE}boxer-clips.glb`, false);
  const clipName = q.get("clip") ?? "guard";
  const at = Number(q.get("at") ?? 0.3);
  const useRig = q.get("v9rig") === "1";
  const corrQ = q.get("corr");
  const pose = corrQ === "0" ? null : (corrQ ?? CLIP_POSE[clipName] ?? null);
  const maps = q.get("maps") !== "0";
  const [mapIndex, setMapIndex] = useState<Record<string, Record<string, string>> | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${BASE}maps.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Record<string, Record<string, string>>) => live && setMapIndex(j))
      .catch(() => live && setMapIndex({}));
    return () => {
      live = false;
    };
  }, [BASE]);

  const inst = useMemo(() => {
    const root = cloneSkinned(fighter.scene);
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      meshes.push(m);
      const kind = Object.keys(COLORS).find((k) => m.name.startsWith(k)) ?? "body";
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS[kind],
        roughness: kind === "body" ? 0.55 : 0.75,
        metalness: 0,
      });
      m.material = mat;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      // the baked maps (07_bake.py, phone size) by object, from the index run.mjs --publish-test writes
      const files = mapIndex?.[m.name];
      if (maps && files) {
        const put = (file: string | undefined, srgb: boolean, set: (t: THREE.Texture) => void) => {
          if (!file) return;
          const slot = { value: null as THREE.Texture | null };
          loadTextureInto(slot, `${BASE}maps/${file}`, { srgb }, () => {
            set(slot.value!);
            mat.needsUpdate = true;
          });
        };
        put(files.normal, false, (t) => (mat.normalMap = t));
        put(files.ao, false, (t) => (mat.aoMap = t));
        // (P3-FGT-23) the scan's own skin: its baked colour and roughness (the colour carries the person)
        if (scan && kind === "body" && files.color) {
          mat.color.set("#ffffff");
          put(files.color, true, (t) => (mat.map = t));
        }
        if (scan && kind === "body" && files.roughness) {
          mat.roughness = 1;
          put(files.roughness, false, (t) => (mat.roughnessMap = t));
        }
      }
    });
    const bone = (n: string) => root.getObjectByName(n) ?? null;
    return { root, meshes, bone };
  }, [fighter, maps, mapIndex, BASE, scan]);

  const clip = lib.animations.find((a) => a.name === clipName) ?? null;
  // the clip sampled directly, track by track (a frozen frame: no mixer state between renders)
  const tracks = useMemo(() => {
    if (!clip) return [];
    return clip.tracks.flatMap((t) => {
      const [node, prop] = t.name.split(".");
      const o = node ? inst.bone(node) : null;
      if (!o || (prop !== "quaternion" && prop !== "position")) return [];
      return [
        { o, prop, it: (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() },
      ];
    });
  }, [clip, inst]);
  const helpers = useMemo(() => helperRig((n) => (inst.bone(n) as THREE.Bone | null) ?? null), [inst]);
  const rig = useMemo(() => {
    if (!useRig) return null;
    const arms: ArmBones[] = [];
    for (const [k, side] of [
      ["L", -1],
      ["R", 1],
    ] as const) {
      const b = (n: string) => (inst.bone(n) as THREE.Bone | null) ?? null;
      const upper = b(`Bip01_${k}_UpperArm`),
        fore = b(`Bip01_${k}_Forearm`),
        hand = b(`Bip01_${k}_Hand`);
      const fingers = [0, 1, 2, 3, 4].map((f) =>
        [`Bip01_${k}_Finger${f}`, `Bip01_${k}_Finger${f}1`, `Bip01_${k}_Finger${f}2`]
          .map(b)
          .filter((x): x is THREE.Bone => !!x),
      );
      if (upper && fore && hand) arms.push({ upper, fore, hand, side, fingers });
    }
    return new BoxingRig(inst.root, arms, { torso: null });
  }, [inst, useRig]);
  const motion = useMemo(() => {
    if (!useRig || !(clipName in BOXING_CLIPS)) return null;
    const m = new BoxingMotion();
    m.play({ clip: clipName as BoxingClipName, start: 0, blend: 0 });
    return m;
  }, [useRig, clipName]);
  const bind = useMemo(() => {
    const out: { b: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];
    inst.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) out.push({ b: o, q: o.quaternion.clone(), p: o.position.clone() });
    });
    return out;
  }, [inst]);

  useEffect(() => {
    for (const m of inst.meshes) {
      const dict = m.morphTargetDictionary;
      if (!dict || !m.morphTargetInfluences) continue;
      m.morphTargetInfluences.fill(0);
      const i = pose ? dict[`corr_${pose}`] : undefined;
      if (i !== undefined) m.morphTargetInfluences[i] = 1;
    }
    const morphs = inst.meshes
      .map((m) => `${m.name}:${Object.keys(m.morphTargetDictionary ?? {}).length}`)
      .join(" ");
    setInfo(
      `boxer v9 TEST · ${useRig ? "rig.ts" : "clip"} ${clipName} @ ${at.toFixed(2)} s · corr ${pose ?? "none"} · ${clip || rig ? "" : "NO SUCH CLIP · "}${morphs}`,
    );
    probe.current = { bone: inst.bone, root: inst.root, ready: true };
    (window as unknown as { __gkBoxer?: object }).__gkBoxer = {
      ready: true,
      v9: true,
      clips: lib.animations.map((a) => a.name),
      bones: bind.length,
    };
    return () => {
      probe.current = null;
    };
  }, [inst, clip, rig, pose, clipName, at, useRig, setInfo, probe, lib, bind]);

  useFrame(() => {
    for (const x of bind) {
      x.b.quaternion.copy(x.q);
      x.b.position.copy(x.p);
    }
    if (rig && motion) {
      rig.apply(motion.sample(at), 1, !!motion.current().mirrored, true);
    } else {
      for (const t of tracks) {
        const v = t.it.evaluate(at);
        if (t.prop === "quaternion") t.o.quaternion.fromArray(v as unknown as number[]).normalize();
        else t.o.position.fromArray(v as unknown as number[]);
      }
    }
    driveHelpers(helpers);
    inst.root.updateMatrixWorld(true);
  });
  return <primitive object={inst.root} />;
}
