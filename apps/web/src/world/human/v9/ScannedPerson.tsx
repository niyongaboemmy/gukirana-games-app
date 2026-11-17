"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { registerKtx2Renderer } from "../boxer/v8/ktx2";
import { FootLock } from "../foot-lock";
import { crowd } from "../crowd";
import { clipsFor, loadManifest, loadPerson, personMaterial, type PersonAsset } from "./assets";
import { animStride, breath, chooseClip, hash01, pickLod, pickPerson, type V9Clip, type V9Manifest, type V9Tier } from "./logic";

/**
 * P2-AVA-13: one v9 person: a real 3D-scanned, clothed adult (CC BY 4.0, see docs/design/human-v9/ASSET-SOURCES.md),
 * rigged on the Bip01 skeleton and moved by retargeted CMU motion capture. Drop-in for an ambient <Avatar>: the same
 * anim codes (packages/contracts ACT), `talkRef`, `fadeRef`, a seed that picks the person.
 *
 * Shared per scanned person: geometry (three LODs in one GLB), material (KTX2 maps) and clips; per instance: the
 * cloned skeleton, the mixer, the foot lock. The LOD follows the camera distance (logic.ts pickLod, with hysteresis),
 * a far person's animation is stepped every 2nd / 3rd frame, the foot lock runs up close only, and breathing is added
 * on the chest and shoulders after the clips. No face rig: a scan's eyes and mouth are part of its photo texture.
 */
export interface ScannedPersonProps {
  seedId: string;
  animRef: RefObject<number>;
  talkRef?: RefObject<boolean>;
  fadeRef?: RefObject<number>;
  /** sit on whatever is under the person (a bench at seat height) */
  seated?: boolean;
  /** pin a scanned person by id (the lab); otherwise the seed picks one */
  personId?: string;
  quality?: V9Tier;
  shadows?: boolean;
  /** a fixed level of detail (the lab's comparisons); otherwise by distance */
  lod?: 0 | 1 | 2;
  /** play this clip regardless of the action code (the lab) */
  clip?: V9Clip;
  /** clock offset (s) so a crowd is not in step */
  phase?: number;
}

/** Re-render once the manifest has loaded (null = no v9 people published). */
export function useV9Manifest(on: boolean): V9Manifest | null | undefined {
  const [m, setM] = useState<V9Manifest | null | undefined>(undefined);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void loadManifest().then((x) => live && setM(x));
    return () => void (live = false);
  }, [on]);
  return on ? m : null;
}

interface Inst {
  root: THREE.Object3D;
  lods: THREE.SkinnedMesh[];
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  foot: FootLock;
  chest: THREE.Object3D | null;
  clav: (THREE.Object3D | null)[];
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _x = new THREE.Vector3();

function rotLocalX(bone: THREE.Object3D | null, angle: number, side: THREE.Vector3) {
  if (!bone?.parent || Math.abs(angle) < 1e-5) return;
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q.setFromAxisAngle(side, angle));
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
}

export function ScannedPerson(props: ScannedPersonProps) {
  const { gl } = useThree();
  useEffect(() => registerKtx2Renderer(gl), [gl]);
  const manifest = useV9Manifest(true);
  const person = useMemo(() => {
    if (!manifest) return null;
    return (props.personId && manifest.people.find((p) => p.id === props.personId)) || pickPerson(props.seedId, manifest.people);
  }, [manifest, props.personId, props.seedId]);
  const [asset, setAsset] = useState<{ a: PersonAsset; clips: Map<string, THREE.AnimationClip> } | null>(null);
  useEffect(() => {
    if (!manifest || !person) return;
    let live = true;
    void loadPerson(person)
      .then(async (a) => ({ a, clips: await clipsFor(manifest, a) }))
      .then((x) => live && setAsset(x))
      .catch((e) => console.warn("v9 person: failed to load", person.id, e));
    return () => void (live = false);
  }, [manifest, person]);
  if (!asset) return null;
  return <ScannedBody {...props} asset={asset.a} clips={asset.clips} />;
}

function ScannedBody(props: ScannedPersonProps & { asset: PersonAsset; clips: Map<string, THREE.AnimationClip> }) {
  const { asset, clips, seedId } = props;
  const tier: V9Tier = props.quality ?? "standard";
  const inst = useMemo<Inst>(() => {
    const root = cloneSkinned(asset.gltf.scene);
    const mat = personMaterial(asset.person, tier);
    const lods: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.material = mat;
      m.frustumCulled = false;
      m.castShadow = !!props.shadows;
      m.receiveShadow = true;
      // the GLB's lod0 / lod1 / lod2 (the exporter may add a primitive suffix)
      const n = /lod(\d)/.exec(m.name) ?? /lod(\d)/.exec(m.parent?.name ?? "");
      lods[n ? Number(n[1]) : lods.length] = m;
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const [name, c] of clips) {
      const a = mixer.clipAction(c);
      if (name === "sitDown" || name === "standUp" || name === "jump") {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions.set(name, a);
    }
    const bone = (n: string) => root.getObjectByName(n) ?? null;
    return {
      root,
      lods: lods.filter(Boolean),
      mixer,
      actions,
      foot: new FootLock(root, bone),
      chest: bone("Bip01_Spine2"),
      clav: [bone("Bip01_L_Clavicle"), bone("Bip01_R_Clavicle")],
    };
    // (props.shadows changes are applied in the frame loop)
  }, [asset, clips, tier]);
  const st = useRef({ clip: "" as string, lod: -1 as number, frame: 0, acc: 0, last: new THREE.Vector3(NaN, 0, 0), speed: 0, moveW: 0, t0: hash01(seedId) * 30 });
  // (React's development double mount runs this cleanup once on a live instance: forget the playing clip too, so the
  // next frame starts it again instead of leaving a stopped mixer under the breathing layer)
  useEffect(() => {
    const s = st.current;
    return () => {
      inst.mixer.stopAllAction();
      s.clip = "";
    };
  }, [inst]);
  const key = useRef({});
  useEffect(() => {
    const k = key.current;
    return () => crowd.remove(k);
  }, []);

  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const g = inst.root.parent;
    if (!g) return;
    // measured ground speed (the parent group is moved by whoever owns the person)
    g.getWorldPosition(_p);
    if (Number.isFinite(s.last.x) && dt > 0) {
      const v = Math.hypot(_p.x - s.last.x, _p.z - s.last.z) / dt;
      s.speed += (Math.min(v, 6) - s.speed) * (1 - Math.exp(-dt * 6));
    }
    s.last.copy(_p);
    crowd.update(key.current, _p, _v.set(0, 0, 0), clock.elapsedTime);
    const dist = camera.position.distanceTo(_p);
    // level of detail
    const lod = props.lod ?? pickLod(dist, (s.lod < 0 ? 2 : s.lod) as 0 | 1 | 2, tier);
    if (lod !== s.lod) {
      inst.lods.forEach((m, i) => (m.visible = i === Math.min(lod, inst.lods.length - 1)));
      s.lod = lod;
    }
    // fade (ambient people going home at dusk): hide below a sliver, no transparency cost
    const fade = props.fadeRef?.current ?? 1;
    inst.root.visible = fade > 0.05;
    if (!inst.root.visible) return;
    for (const m of inst.lods) if (m.castShadow !== !!props.shadows) m.castShadow = !!props.shadows;

    // clip choice and cross-fade
    const t = (Date.now() / 1000) % 86400 + (props.phase ?? 0);
    const want = props.clip
      ? { clip: props.clip, rate: props.clip.startsWith("walk") ? Math.max(0.6, s.speed / 1.17) || 1 : 1 }
      : chooseClip({ anim: props.animRef.current ?? 0, speed: s.speed, talking: !!props.talkRef?.current, seated: !!props.seated, seed: seedId, t });
    const next = inst.actions.get(want.clip) ?? inst.actions.get("idle");
    if (next && want.clip !== s.clip) {
      const prev = inst.actions.get(s.clip);
      next.reset();
      next.time = s.clip === "" ? s.t0 % next.getClip().duration : 0;
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, want.clip.startsWith("walk") || s.clip.startsWith("walk") ? 0.25 : 0.45, false);
      s.clip = want.clip;
    }
    if (next) next.timeScale = want.rate;
    s.moveW += ((want.clip.startsWith("walk") ? 1 : 0) - s.moveW) * (1 - Math.exp(-dt * 8));

    // far people step their animation less often
    s.acc += dt;
    s.frame++;
    if (s.frame % animStride(dist) !== 0) return;
    const step = s.acc;
    s.acc = 0;
    inst.mixer.update(step);
    // breathing (after the clips, before the foot lock)
    if (dist < 20) {
      inst.root.updateMatrixWorld(true);
      inst.root.getWorldQuaternion(_qw);
      _x.set(1, 0, 0).applyQuaternion(_qw);
      const b = breath(t, seedId, s.moveW);
      rotLocalX(inst.chest, -b.chest, _x);
      for (const c of inst.clav) rotLocalX(c, -b.shoulders, _x);
    }
    if (dist < 18 && s.moveW > 0.05) inst.foot.apply(step, s.moveW);
  });

  return <primitive object={inst.root} />;
}
