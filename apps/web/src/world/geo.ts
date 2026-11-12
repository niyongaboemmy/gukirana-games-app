import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Static geometry batcher. Architecture is authored as primitives, then merged into ONE geometry per material key,
 * so a whole building district costs ~one draw call per material (DESIGN-SPEC §16.1 draw-call budgets).
 *
 * UVs: `tile` re-projects UVs in world metres (box projection on the dominant normal axis), so textures keep a
 * constant texel density on walls of any size. `uv` scales the primitive's own UVs instead (good for cylinders).
 */
export interface AddOpts {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
  tile?: number;
  uv?: [number, number];
}

export class GeoBatch {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1]!;
  }

  /** Run `fn` inside a local frame (position + Y rotation), like a <group>. */
  frame(p: [number, number, number], rotY: number, fn: () => void): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.stack.push(this.top.clone().multiply(m));
    fn();
    this.stack.pop();
  }

  add(key: string, geo: THREE.BufferGeometry, o: AddOpts = {}): void {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    if (o.uv) {
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uv[0], uv.getY(i) * o.uv[1]);
    }
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...(o.p ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r ?? [0, 0, 0]))),
      new THREE.Vector3(...(o.s ?? [1, 1, 1])),
    );
    g.applyMatrix4(this.top.clone().multiply(local));
    if (o.tile) g = worldUV(g, o.tile);
    const list = this.parts.get(key) ?? [];
    list.push(g);
    this.parts.set(key, list);
  }

  box(key: string, w: number, h: number, d: number, o: AddOpts = {}): void {
    this.add(key, new THREE.BoxGeometry(w, h, d), o);
  }

  cyl(key: string, rTop: number, rBot: number, h: number, seg: number, o: AddOpts = {}, open = false): void {
    this.add(key, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), o);
  }

  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [k, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (merged) {
        merged.computeBoundingSphere();
        out.set(k, merged);
      }
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    return out;
  }
}

function worldUV(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x / tile, z / tile);
    else if (nx >= nz) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return g;
}
