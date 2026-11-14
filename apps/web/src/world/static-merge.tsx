"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Static batching (GAP-008, DESIGN-SPEC §16.1 draw-call budget): the plain meshes under a <StaticMerge> are merged,
 * once at mount, into one mesh per look (material values + shadow flags + attribute layout, optionally per spatial
 * cell), so a doorway built from forty little boxes costs a handful of draw calls instead of forty. The sources stay
 * in the scene graph (React keeps owning them) but move to no layer: never drawn, never shadow-cast, never ray-cast.
 *
 * Safe by default: skinned / instanced meshes, text, points, lines, multi-material meshes, custom shaders, anything
 * with pointer handlers (or under a group with handlers) and anything marked `userData.noMerge` are left alone. It
 * also watches its sources (twice a second): one that moves, changes its look, is hidden / shown or unmounted is
 * taken out of the batch for good and the batch is rebuilt — so a part animated after all never freezes for longer
 * than that, and nothing ever disappears.
 */

const NO_LAYER = 0;
/** late-mounted content joins the batch during the first seconds after mount (asset streaming) */
const LATE_S = 20;
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _c = new THREE.Vector3();

type R3FInstance = { handlers?: Record<string, unknown> };
const hasHandlers = (o: THREE.Object3D) => {
  const h = (o as unknown as { __r3f?: R3FInstance }).__r3f?.handlers;
  return !!h && Object.keys(h).length > 0;
};

const SIG_KEYS = [
  "type", "side", "transparent", "opacity", "alphaTest", "depthWrite", "depthTest", "toneMapped", "vertexColors", "fog",
  "flatShading", "roughness", "metalness", "envMapIntensity", "emissiveIntensity", "polygonOffset", "polygonOffsetFactor",
  "polygonOffsetUnits", "blending", "colorWrite", "wireframe", "alphaToCoverage", "alphaHash", "reflectivity", "clearcoat",
  "sheen", "transmission", "dithering", "premultipliedAlpha", "normalScale", "aoMapIntensity", "lightMapIntensity",
] as const;
const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "lightMap", "bumpMap", "envMap"] as const;

/** Value signature of a material: two materials with the same signature draw identically (one can stand for both). */
function signature(m: THREE.Material, withColor = true): string {
  const r = m as unknown as Record<string, unknown>;
  // a custom shader hook / program key makes the material unique (it may hold per-material uniforms)
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || (m as THREE.ShaderMaterial).isShaderMaterial) return `uuid:${m.uuid}`;
  const parts: string[] = [];
  for (const k of SIG_KEYS) {
    const v = r[k];
    if (v === undefined) continue;
    parts.push(v instanceof THREE.Vector2 ? `${v.x},${v.y}` : String(v));
  }
  for (const k of withColor ? ["color", "emissive", "specularColor", "sheenColor"] : ["emissive", "specularColor", "sheenColor"]) {
    const c = r[k] as THREE.Color | undefined;
    parts.push(c?.isColor ? c.getHexString() : "-");
  }
  for (const k of TEX_KEYS) parts.push((r[k] as THREE.Texture | null | undefined)?.uuid ?? "-");
  return parts.join("|");
}

function attrSignature(g: THREE.BufferGeometry): string {
  const names = Object.keys(g.attributes).sort();
  return `${g.index ? "i" : "n"}:${names.map((n) => `${n}${g.attributes[n]!.itemSize}${g.attributes[n]!.normalized ? "n" : ""}`).join(",")}`;
}

/** materials whose base colour can move into a vertex colour (one material, many colours, one draw call) */
const FOLDABLE = new Set(["MeshStandardMaterial", "MeshBasicMaterial", "MeshLambertMaterial", "MeshPhongMaterial", "MeshPhysicalMaterial"]);
const foldable = (mesh: THREE.Mesh) => {
  const m = mesh.material as THREE.MeshStandardMaterial;
  return FOLDABLE.has(m.type) && !m.vertexColors && !mesh.geometry.attributes.color && !!m.color;
};

/** effectively visible from `root` down to `o` (every ancestor visible) */
function shownUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let q: THREE.Object3D | null = o; q && q !== root; q = q.parent) if (!q.visible) return false;
  return true;
}
function attachedTo(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === root) return true;
  return false;
}

interface Source {
  mesh: THREE.Mesh;
  mask: number;
  rel: Float32Array;
  material: THREE.Material;
  sig: string;
  geometry: THREE.BufferGeometry;
  ver: number;
}

/** sum of the attribute versions: a geometry whose vertices are animated in place (a waving flag) bumps it */
const versionOf = (g: THREE.BufferGeometry) => Object.values(g.attributes).reduce((s, a) => s + ((a as THREE.BufferAttribute).version ?? 0), g.index?.version ?? 0);

function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name] as THREE.BufferAttribute;
    const s = at.itemSize;
    const arr = at.array;
    for (let v = 0; v + 2 < at.count; v += 3)
      for (let k = 0; k < s; k++) {
        const i1 = (v + 1) * s + k;
        const i2 = (v + 2) * s + k;
        const t = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = t;
      }
    at.needsUpdate = true;
  }
}

class Batch {
  sources: Source[] = [];
  merged: THREE.Mesh[] = [];
  private owned: THREE.Material[] = [];
  /** eligible meshes left unbatched after the build (one of a kind): more later = late-mounted content */
  loose = 0;
  constructor(
    private root: THREE.Object3D,
    private live: WeakSet<THREE.Object3D>,
    private cell: number,
    private shadowsOff: boolean,
  ) {}

  private eligible(o: THREE.Object3D): o is THREE.Mesh {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return false;
    if (this.live.has(m) || (m as unknown as { isTroikaText?: boolean }).isTroikaText || "text" in m) return false;
    if (Array.isArray(m.material) || !m.geometry?.isBufferGeometry || (m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return false;
    if (Object.keys(m.geometry.morphAttributes).length || !m.geometry.attributes.position) return false; // (geometry groups only matter for multi-material meshes)
    if (m.geometry.drawRange.count !== Infinity || m.geometry.drawRange.start !== 0) return false;
    if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
    if (m.layers.mask !== 1) return false; // already special (another batch, a warm-only proxy …)
    return true;
  }

  /** eligible meshes that are not in a batch (children that mounted after the build, e.g. behind a Suspense) */
  looseCount(): number {
    let n = 0;
    const visit = (o: THREE.Object3D) => {
      if (o !== this.root && (o.userData.noMerge || o.userData.gkMerged || hasHandlers(o) || !o.visible)) return;
      if (this.eligible(o)) n++;
      for (const c of o.children) visit(c);
    };
    visit(this.root);
    return n;
  }

  build() {
    const root = this.root;
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const groups = new Map<string, Source[]>();
    const visit = (o: THREE.Object3D) => {
      if (o !== root && (o.userData.noMerge || o.userData.gkMerged || hasHandlers(o) || !o.visible)) return;
      if (this.eligible(o)) {
        const mesh = o;
        _rel.multiplyMatrices(_inv, mesh.matrixWorld);
        const fold = foldable(mesh);
        let key = `${fold ? "fold:" : ""}${signature(mesh.material as THREE.Material, !fold)}#${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}#${mesh.renderOrder}#${mesh.frustumCulled ? 1 : 0}#${attrSignature(mesh.geometry)}`;
        if (this.cell > 0) {
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          _c.copy(mesh.geometry.boundingSphere!.center).applyMatrix4(_rel);
          key += `#${Math.floor(_c.x / this.cell)},${Math.floor(_c.z / this.cell)}`;
        }
        const src: Source = { mesh, mask: mesh.layers.mask, rel: new Float32Array(_rel.elements), material: mesh.material as THREE.Material, sig: signature(mesh.material as THREE.Material), geometry: mesh.geometry, ver: versionOf(mesh.geometry) };
        const list = groups.get(key);
        if (list) list.push(src);
        else groups.set(key, [src]);
      }
      for (const c of o.children) visit(c);
    };
    visit(root);
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      // colour folding: the same look in several colours → the colours go into a vertex colour attribute
      const c0 = (list[0]!.material as THREE.MeshStandardMaterial).color;
      const fold = key.startsWith("fold:") && list.some((s) => !(s.material as THREE.MeshStandardMaterial).color.equals(c0));
      const geos: THREE.BufferGeometry[] = [];
      for (const s of list) {
        const g = s.geometry.clone();
        if (fold) {
          const c = (s.material as THREE.MeshStandardMaterial).color; // linear working space, as vertex colours are
          const n = g.attributes.position!.count;
          const arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            arr[i * 3] = c.r;
            arr[i * 3 + 1] = c.g;
            arr[i * 3 + 2] = c.b;
          }
          g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
        }
        for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color", "uv1"].includes(k)) g.deleteAttribute(k);
        _rel.fromArray(s.rel);
        g.applyMatrix4(_rel);
        if (_rel.determinant() < 0) flipWinding(g);
        geos.push(g);
      }
      const geo = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!geo) continue;
      const first = list[0]!.mesh;
      let material = first.material as THREE.Material;
      if (fold) {
        const fm = (material as THREE.MeshStandardMaterial).clone();
        fm.vertexColors = true;
        fm.color.setRGB(1, 1, 1);
        this.owned.push(fm);
        material = fm;
      }
      const merged = new THREE.Mesh(geo, material);
      merged.name = "gk-merged";
      merged.userData.gkMerged = true;
      merged.castShadow = first.castShadow && !this.shadowsOff;
      merged.receiveShadow = first.receiveShadow;
      merged.renderOrder = first.renderOrder;
      merged.frustumCulled = first.frustumCulled;
      merged.matrixAutoUpdate = false;
      root.add(merged);
      merged.updateMatrixWorld(true);
      this.merged.push(merged);
      for (const s of list) {
        s.mesh.layers.mask = NO_LAYER;
        this.sources.push(s);
      }
    }
    this.loose = this.looseCount();
  }

  /** sources that changed since the batch was built (moved, restyled, hidden / shown, re-geometried, unmounted) */
  changed(): THREE.Mesh[] {
    const root = this.root;
    root.updateMatrixWorld();
    _inv.copy(root.matrixWorld).invert();
    const out: THREE.Mesh[] = [];
    for (const s of this.sources) {
      const m = s.mesh;
      if (!attachedTo(m, root) || m.material !== s.material || m.geometry !== s.geometry || versionOf(m.geometry) !== s.ver || !shownUnder(m, root) || m.layers.mask !== NO_LAYER) {
        out.push(m);
        continue;
      }
      _rel.multiplyMatrices(_inv, m.matrixWorld);
      const e = _rel.elements;
      let moved = false;
      for (let i = 0; i < 16; i++)
        if (Math.abs(e[i]! - s.rel[i]!) > 1e-4) {
          moved = true;
          break;
        }
      if (moved || signature(m.material as THREE.Material) !== s.sig) out.push(m);
    }
    return out;
  }

  dispose() {
    for (const s of this.sources) if (s.mesh.layers.mask === NO_LAYER) s.mesh.layers.mask = s.mask;
    for (const m of this.merged) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.owned.forEach((m) => m.dispose());
    this.owned = [];
    this.sources = [];
    this.merged = [];
  }
}

/**
 * Merge the static meshes below into one draw call per look. `cell` (m) splits batches on a horizontal grid so
 * large areas keep frustum culling; `deps` rebuilds the batch when the content is re-structured on purpose.
 */
export function StaticMerge({ children, cell = 0, deps = [], name }: { children: ReactNode; cell?: number; deps?: unknown[]; name?: string }) {
  const group = useRef<THREE.Group>(null);
  const batch = useRef<Batch | null>(null);
  const live = useRef(new WeakSet<THREE.Object3D>());
  const acc = useRef(0);
  const age = useRef(0);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    const b = new Batch(g, live.current, cell, false);
    b.build();
    batch.current = b;
    return () => {
      b.dispose();
      if (batch.current === b) batch.current = null;
    };
  }, [cell, ...deps]);
  useFrame((_, dt) => {
    acc.current += dt;
    age.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const b = batch.current;
    const g = group.current;
    if (!b || !g) return;
    const ch = b.changed();
    // content that mounted after the build (nested Suspense: textures, models) joins the batch — while the area is
    // still settling (later mounts, e.g. a marker that comes and goes, are simply drawn on their own)
    if (!ch.length && (age.current > LATE_S || b.looseCount() <= b.loose)) return;
    // a part that is animated after all: out of the batch for good, rebuild the rest
    for (const m of ch) live.current.add(m);
    b.dispose();
    const nb = new Batch(g, live.current, cell, false);
    nb.build();
    batch.current = nb;
  });
  return (
    <group ref={group} name={name}>
      {children}
    </group>
  );
}

const _w = new THREE.Vector3();
/**
 * Distance culling for small details (GAP-008): the children are drawn only while the camera is within `max` metres
 * of the group (checked a few times a second) — lettering too small to read from further away, door hardware …
 */
export function NearOnly({ max, children, position, rotation }: { max: number; children: ReactNode; position?: [number, number, number]; rotation?: [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const acc = useRef(1);
  useFrame(({ camera }, dt) => {
    acc.current += dt;
    const g = group.current;
    if (!g || acc.current < 0.25) return;
    acc.current = 0;
    g.getWorldPosition(_w);
    g.visible = _w.distanceTo(camera.position) < max;
  });
  return (
    <group ref={group} position={position} rotation={rotation} userData={{ noMerge: true }}>
      {children}
    </group>
  );
}
