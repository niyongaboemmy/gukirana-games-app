import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Node-side loader for the Rocketbox GLBs (dev / test helper, P3-FGT-02): strips the textures (no image decoding in
 * node) and parses the geometry + skeleton, so the kit fitting can be checked on the real bodies in tests.
 */
export async function loadBodyNode(path: string): Promise<THREE.Object3D> {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Record<string, unknown> & { materials?: Record<string, unknown>[] };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.emissiveTexture;
    delete m.occlusionTexture;
    delete m.extensions;
  }
  const exts = (json.extensionsUsed as string[] | undefined)?.filter((e) => !e.includes("texture")) ?? [];
  json.extensionsUsed = exts;
  if (json.extensionsRequired) json.extensionsRequired = (json.extensionsRequired as string[]).filter((e) => !e.includes("texture"));
  let js = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (js.length % 4)) % 4;
  js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const bin = buf.subarray(20 + jsonLen);
  const total = 12 + 8 + js.length + bin.length;
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([head, js, bin]);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const gltf = await loader.parseAsync(ab, "");
  return gltf.scene;
}
