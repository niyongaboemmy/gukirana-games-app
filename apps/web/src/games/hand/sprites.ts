"use client";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { dressRig, makeHandRig, poseRig } from "./build";
import { B, POSES, type PoseName } from "./rig";
import type { HandLook } from "./look";

/**
 * Pre-rendered hand sprites (P2-GAME-07): the same 3D hand, rendered once per look into a transparent canvas, seen
 * straight from above. The Pool table draws them along the cue every frame (no WebGL per frame), so the bridge and
 * grip hands are photo-real and always exactly on the cue. One shared offscreen renderer, disposed after use.
 */
export interface HandSprite {
  img: HTMLCanvasElement;
  /** pixels per metre of hand */
  pxPerM: number;
  /** the point the cue runs through (bridge: the V between thumb and index; grip: inside the fist), in pixels */
  ax: number;
  ay: number;
  /** direction of the cue through that point, image space (rad, 0 = +x right, y down) */
  cueAngle: number;
}

export type SpriteKind = "bridge" | "grip";

const PX_PER_M = 1400;
const cache = new Map<string, HandSprite>();
const pending = new Map<string, Promise<HandSprite | null>>();

let renderer: THREE.WebGLRenderer | null = null;
let disposeTimer: ReturnType<typeof setTimeout> | null = null;

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, canvas: document.createElement("canvas") });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

const SPECS: Record<SpriteKind, { pose: PoseName; pitch: number; roll: number; box: [number, number, number, number] }> = {
  // flat on the cloth, the forearm low behind the hand
  bridge: { pose: "bridge", pitch: 0.24, roll: 0.05, box: [-0.19, 0.12, -0.62, 0.17] },
  // the forearm hangs almost straight down to the cue (seen from above it is short), knuckles towards the viewer
  grip: { pose: "grip", pitch: 1.38, roll: -0.25, box: [-0.12, 0.14, -0.16, 0.13] },
};

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();

function renderSprite(kind: SpriteKind, look: HandLook): HandSprite | null {
  const r = getRenderer();
  if (!r) return null;
  const spec = SPECS[kind];
  const rig = makeHandRig(false);
  dressRig(rig, look);
  poseRig(rig, POSES[spec.pose]);
  rig.root.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -spec.pitch).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.roll));
  rig.root.updateMatrixWorld(true);
  // the cue's contact point and direction
  let ax: THREE.Vector3, dir: THREE.Vector3;
  if (kind === "bridge") {
    const thumb = rig.bones[B.thumb(2)]!.getWorldPosition(new THREE.Vector3());
    const knuckle = rig.bones[B.phal(0, 0)]!.getWorldPosition(new THREE.Vector3());
    ax = thumb.clone().lerp(knuckle, 0.5);
    // the cue runs along the fingers, over the V
    dir = rig.bones[B.phal(1, 0)]!.getWorldDirection(new THREE.Vector3());
    const hb = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.bones[B.hand]!.getWorldQuaternion(new THREE.Quaternion()));
    dir = hb;
  } else {
    ax = rig.anchors.hold.getWorldPosition(new THREE.Vector3());
    dir = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.bones[B.hand]!.getWorldQuaternion(new THREE.Quaternion()));
  }
  // lift the scene so the hand rests on z = 0 (shadow catcher)
  const box = new THREE.Box3().setFromObject(rig.mesh, true);
  rig.root.position.z = -box.min.z;
  rig.root.updateMatrixWorld(true);
  ax.z -= box.min.z;
  const [x0, x1, y0, y1] = spec.box;
  const w = Math.round((x1 - x0) * PX_PER_M), h = Math.round((y1 - y0) * PX_PER_M);
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.42;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const cam = new THREE.OrthographicCamera(x0 - cx, x1 - cx, y1 - cy, y0 - cy, 0.01, 5);
  cam.position.set(cx, cy, 2);
  cam.lookAt(cx, cy, 0);
  const key = new THREE.DirectionalLight(0xfff0e0, 2.6);
  key.position.set(cx - 0.6, cy + 0.8, 1.6);
  key.target.position.set(cx, cy, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -0.4, right: 0.4, top: 0.4, bottom: -0.4, near: 0.1, far: 4 });
  key.shadow.camera.updateProjectionMatrix();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowMaterial({ opacity: 0.32, color: 0x08130b }));
  ground.position.set(cx, cy, 0);
  ground.receiveShadow = true;
  scene.add(rig.root, key, key.target, new THREE.HemisphereLight(0xf6efe6, 0x2f4a33, 1.1), ground);
  r.render(scene, cam);
  const img = document.createElement("canvas");
  img.width = w;
  img.height = h;
  const g = img.getContext("2d")!;
  g.drawImage(r.domElement, 0, 0);
  // fade the sleeve out where the sprite ends (the arm continues off the table view)
  g.globalCompositeOperation = "destination-out";
  const fade = g.createLinearGradient(0, h * 0.72, 0, h);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
  // project the contact point and direction to image pixels
  v.copy(ax).project(cam);
  v2.copy(ax).add(dir.multiplyScalar(0.05)).project(cam);
  const px = (p: THREE.Vector3) => [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h] as const;
  const [axp, ayp] = px(v);
  const [bxp, byp] = px(v2);
  // free GPU memory of this one-off scene
  env.dispose();
  pm.dispose();
  rig.skin.dispose();
  rig.sleeveMat.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  r.shadowMap.enabled = false;
  if (disposeTimer) clearTimeout(disposeTimer);
  disposeTimer = setTimeout(() => {
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
  }, 4000);
  return { img, pxPerM: PX_PER_M, ax: axp, ay: ayp, cueAngle: Math.atan2(byp - ayp, bxp - axp) };
}

/** The sprite for a look (cached); null while rendering or when WebGL is unavailable. */
export function handSprite(kind: SpriteKind, look: HandLook): HandSprite | null {
  const key = `${kind}|${look.skin}|${look.sleeve}|${look.sleeveColor}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!pending.has(key)) {
    const p = new Promise<HandSprite | null>((resolve) => {
      const run = () => {
        let s: HandSprite | null = null;
        try {
          s = renderSprite(kind, look);
        } catch {
          s = null;
        }
        if (s) cache.set(key, s);
        resolve(s);
      };
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 600 });
      else setTimeout(run, 50);
    });
    pending.set(key, p);
  }
  return null;
}
