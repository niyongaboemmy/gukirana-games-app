import * as THREE from "three";
import { fabricTexture } from "../textures";
import { itemById, type AvatarLook } from "../outfits";

/**
 * Look attachments that the base bodies don't have: extra hair volumes (afro, puffs, bun, braids, locs, headwrap),
 * headwear (cap, beanie, bucket hat), accessories (glasses, sunglasses, earrings, watch) and skirt / long-wrap
 * garments. They are parented to the head / pelvis / forearm bones through a "neutral frame" helper whose axes
 * match the avatar's (x right, y up, z forward) in the bind pose, so all offsets below are in plain avatar metres.
 */

const cache = new Map<string, THREE.Texture>();

/** Fine strand texture (tileable) used as albedo detail on the hair volumes. */
function strandTexture(kind: "curl" | "straight"): THREE.Texture {
  const key = `strand-${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6a6a6a";
  g.fillRect(0, 0, 256, 256);
  let s = 1234;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (kind === "curl") {
    for (let i = 0; i < 2600; i++) {
      const x = r() * 256, y = r() * 256, rad = 1.5 + r() * 3.5, v = Math.floor(40 + r() * 150);
      g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      g.lineWidth = 0.8 + r();
      g.beginPath();
      g.arc(x, y, rad, r() * 6, r() * 6 + 3.5);
      g.stroke();
    }
  } else {
    for (let i = 0; i < 1400; i++) {
      const x = r() * 256, v = Math.floor(40 + r() * 170);
      g.strokeStyle = `rgba(${v},${v},${v},0.5)`;
      g.lineWidth = 0.6 + r() * 1.2;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 10, 85, x + (r() - 0.5) * 10, 170, x, 256);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

function hairMat(color: string, kind: "curl" | "straight", repeat = 4) {
  const map = strandTexture(kind).clone();
  map.repeat.set(repeat, repeat);
  map.needsUpdate = true;
  // the strand texture is mid-grey, so brighten the tint to land on the chosen colour on average
  const c = new THREE.Color(color);
  // very dark hair still needs visible strand detail and sheen
  const floor = 0.035;
  c.setRGB(Math.max(c.r, floor), Math.max(c.g, floor * 0.85), Math.max(c.b, floor * 0.75)).multiplyScalar(1.9);
  return new THREE.MeshStandardMaterial({ color: c, map, bumpMap: map, bumpScale: 2.5, roughness: 0.62, metalness: 0 });
}

/** Sphere with lumpy "curl cluster" displacement (afro / puffs / bun). */
function curlyBall(radius: number, seed: number, detail = 3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, 12 * detail, 8 * detail);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 23 + seed) * Math.sin(v.y * 21 + seed * 2) * Math.sin(v.z * 25 + seed * 3) + 0.5 * Math.sin(v.x * 47 + v.z * 41 + seed);
    v.multiplyScalar(1 + n * 0.03);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Tapered, gently curved strand tube (braid / loc). */
function strand(len: number, r0: number, r1: number, bend: THREE.Vector3, braided: boolean): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(bend.x * t * t, -len * t, bend.z * t * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, braided ? 24 : 12, (r0 + r1) / 2, 6, false);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  // taper + braid ripple
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = Math.min(1, Math.max(0, -y / len));
    const c = curve.getPoint(t);
    const dx = p.getX(i) - c.x, dz = p.getZ(i) - c.z;
    const k = ((r0 + (r1 - r0) * t) / ((r0 + r1) / 2)) * (braided ? 1 + 0.18 * Math.sin(t * len * 140) : 1);
    p.setXYZ(i, c.x + dx * k, y, c.z + dz * k);
  }
  g.computeVertexNormals();
  return g;
}

export interface Anchors {
  head: THREE.Object3D;
  pelvis: THREE.Object3D;
  wristL: THREE.Object3D;
}

/** Head-local reference (neutral frame at the head bone): skull centre and radii, tuned to the Rocketbox heads. */
const SKULL = { y: 0.125, z: 0.0, rx: 0.09, ry: 0.1, rz: 0.105 };

export function buildAttachments(look: AvatarLook, a: Anchors, shadows: boolean): THREE.Object3D[] {
  const made: THREE.Object3D[] = [];
  const add = (parent: THREE.Object3D, o: THREE.Object3D) => {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = shadows;
        c.frustumCulled = false; // follows animated bones; the avatar root is culled as a whole
      }
    });
    parent.add(o);
    made.push(o);
  };
  const hc = look.hairColor;
  const sy = SKULL.y, sz = SKULL.z;

  // ---------- hair volumes ----------
  switch (look.hairStyle) {
    case "afro": {
      const m = new THREE.Mesh(curlyBall(1, 3, 4), hairMat(hc, "curl", 5));
      m.scale.set(0.15, 0.135, 0.15);
      m.position.set(0, sy + 0.04, sz - 0.03);
      add(a.head, m);
      break;
    }
    case "puffs": {
      const mat = hairMat(hc, "curl", 3);
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(curlyBall(1, 5 + s, 3), mat);
        m.scale.setScalar(0.07);
        m.position.set(s * 0.085, sy + 0.1, sz - 0.04);
        add(a.head, m);
      }
      break;
    }
    case "bun": {
      const m = new THREE.Mesh(curlyBall(1, 9, 3), hairMat(hc, "straight", 2));
      m.scale.set(0.058, 0.052, 0.058);
      m.position.set(0, sy + 0.06, sz - 0.095);
      add(a.head, m);
      break;
    }
    case "braids":
    case "locs": {
      const braided = look.hairStyle === "braids";
      const mat = hairMat(hc, braided ? "straight" : "curl", 1);
      const n = braided ? 22 : 16;
      for (let i = 0; i < n; i++) {
        const ang = Math.PI * 0.42 + (Math.PI * 1.16 * i) / (n - 1); // around the back and sides
        const x = Math.sin(ang) * SKULL.rx * 0.98;
        const z = Math.cos(ang) * SKULL.rz * 0.98 + sz - 0.005;
        const len = braided ? 0.34 + (i % 3) * 0.02 : 0.27 + (i % 2) * 0.03;
        const g = strand(len, braided ? 0.007 : 0.011, braided ? 0.005 : 0.009, new THREE.Vector3(Math.sin(ang) * 0.04, 0, Math.cos(ang) * 0.06 - 0.02), braided);
        const m = new THREE.Mesh(g, mat);
        m.position.set(x, sy + 0.005, z);
        add(a.head, m);
      }
      break;
    }
    case "headwrap": {
      const top = itemById(look.outfit.top);
      const map = fabricTexture(top?.print ?? "kitenge-sun").clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(2, 1);
      map.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
      const wrap = new THREE.Mesh(curlyBall(1, 2, 3), mat);
      wrap.scale.set(SKULL.rx * 1.16, SKULL.ry * 1.15, SKULL.rz * 1.16);
      wrap.position.set(0, sy + 0.03, sz - 0.015);
      add(a.head, wrap);
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.03, 0.012, 48, 8), mat);
      knot.position.set(0, sy + 0.12, sz + 0.02);
      add(a.head, knot);
      break;
    }
    default:
      break;
  }

  // ---------- headwear ----------
  const hat = itemById(look.outfit.headwear);
  if (hat && hat.kind !== "none" && look.hairStyle !== "headwrap") {
    const color = hat.color === "accent" ? (look.topColor ?? look.accent) : hat.color;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.82 });
    const big = look.hairStyle === "afro" ? 1.32 : look.hairStyle === "puffs" || look.hairStyle === "bun" ? 1.1 : 1;
    const g = new THREE.Group();
    g.position.set(0, sy, sz + 0.01);
    g.scale.setScalar(big);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), mat);
    if (hat.kind === "cap") {
      // a little deeper at the back so the hair never pokes through as a dark notch
      crown.scale.set(SKULL.rx + 0.014, SKULL.ry * 0.97, SKULL.rz + 0.022);
      crown.position.z = -0.006;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.01, 24, 1, false, -Math.PI / 2, Math.PI), mat);
      brim.scale.set(1, 1, 1.15);
      brim.position.set(0, 0.0, SKULL.rz * 0.9);
      brim.rotation.x = 0.12;
      g.add(crown, brim);
    } else if (hat.kind === "beanie") {
      crown.scale.set(SKULL.rx + 0.016, SKULL.ry * 1.25, SKULL.rz + 0.016);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(SKULL.rx + 0.012, 0.018, 8, 32), mat);
      cuff.rotation.x = Math.PI / 2;
      cuff.scale.set(1, (SKULL.rz + 0.012) / (SKULL.rx + 0.012), 1);
      g.add(crown, cuff);
    } else {
      crown.scale.set(SKULL.rx + 0.014, SKULL.ry * 0.95, SKULL.rz + 0.014);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.155, 0.045, 32, 1, true), new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
      brim.position.y = -0.005;
      g.add(crown, brim);
    }
    add(a.head, g);
  }

  // ---------- accessories ----------
  const acc = itemById(look.outfit.accessory);
  const accColor = acc ? (acc.color === "accent" ? look.accent : acc.color) : "#111111";
  if (acc?.kind === "glasses" || acc?.kind === "sunglasses") {
    const frame = new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.3, metalness: 0.5 });
    const g = new THREE.Group();
    g.position.set(0, sy - 0.018, sz + SKULL.rz + 0.012);
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0022, 6, 24), frame);
      ring.position.x = s * 0.033;
      ring.scale.y = 0.8;
      g.add(ring);
      if (acc.kind === "sunglasses") {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 24), new THREE.MeshStandardMaterial({ color: "#0b0b0e", roughness: 0.05, metalness: 0.7 }));
        lens.position.x = s * 0.033;
        lens.scale.y = 0.8;
        g.add(lens);
      }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.1), frame);
      arm.position.set(s * 0.068, 0.004, -0.05);
      g.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.003, 0.003), frame);
    bridge.position.y = 0.006;
    g.add(bridge);
    add(a.head, g);
  } else if (acc?.kind === "earrings") {
    const gold = new THREE.MeshStandardMaterial({ color: "#e8b53a", roughness: 0.25, metalness: 1 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 20), gold);
      e.position.set(s * (SKULL.rx + 0.004), sy - 0.065, sz - 0.005);
      e.rotation.y = Math.PI / 2;
      add(a.head, e);
    }
  } else if (acc?.kind === "watch") {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 20), new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.4 }));
    band.rotation.y = Math.PI / 2;
    band.scale.set(1, 0.8, 1);
    add(a.wristL, band);
  }

  // ---------- skirt / long wrap ----------
  const bottom = itemById(look.outfit.bottom);
  if (bottom && (bottom.kind === "skirt" || bottom.kind === "longwrap")) {
    const long = bottom.kind === "longwrap";
    const color = bottom.color === "accent" ? look.accent : bottom.color;
    let map: THREE.Texture | null = null;
    if (bottom.print) {
      map = fabricTexture(bottom.print).clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(4, long ? 3 : 1.6);
      map.needsUpdate = true;
    }
    const h = long ? 0.86 : 0.5;
    const geo = new THREE.CylinderGeometry(0.17, long ? 0.24 : 0.3, h, 40, 6, true);
    // soft folds
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const ang = Math.atan2(z, x);
      const k = 1 + 0.035 * Math.sin(ang * 14) * (0.5 - y / h);
      p.setXYZ(i, x * k, y, z * k * 0.86);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: map ? "#ffffff" : color, map, roughness: 0.86, side: THREE.DoubleSide }));
    m.position.set(0, 0.06 - h / 2, -0.005);
    add(a.pelvis, m);
  }

  return made;
}

/**
 * Neutral frame helper: a child of `bone` whose world orientation equals the avatar root's in the current
 * (bind) pose, so children can be positioned in avatar axes.
 */
export function neutralFrame(bone: THREE.Object3D, root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const helper = new THREE.Object3D();
  helper.name = `${bone.name}-frame`;
  const qb = new THREE.Quaternion();
  const qr = new THREE.Quaternion();
  bone.getWorldQuaternion(qb);
  root.getWorldQuaternion(qr);
  helper.quaternion.copy(qb.invert().multiply(qr));
  // undo any bone scale so offsets stay metric
  const s = new THREE.Vector3();
  bone.getWorldScale(s);
  const rs = new THREE.Vector3();
  root.getWorldScale(rs);
  helper.scale.set(rs.x / s.x, rs.y / s.y, rs.z / s.z);
  bone.add(helper);
  return helper;
}
