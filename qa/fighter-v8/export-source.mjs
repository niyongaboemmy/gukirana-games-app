// P3-FGT-19A: export the reusable, licence-clean prototype sources for the implementer (P3-FGT-19B) into
// apps/web/scripts/boxer/source-v8/ — shape-target sets, sewing patterns, simulated garments (guard pose) and the
// prototype skin maps. Dev only.
//   MH_DIR=<makehuman>/makehuman/data node qa/fighter-v8/export-source.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { writeGlb } from "../../apps/web/scripts/boxer/glb.mjs";
import { buildBody, FACE, FIGHTERS, loadMH, SCULPT_LOG } from "./lib/body.mjs";
import { KIT } from "./lib/kit.mjs";
import { TONES } from "./lib/bake.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const DEST = join(HERE, "../../apps/web/scripts/boxer/source-v8");
mkdirSync(DEST, { recursive: true });

// shape targets (+ the sculpt volumes as built)
const mh = loadMH(process.env.MH_DIR);
const targets = { source: "MakeHuman 1.x CC0 targets (commit a8bc2d54ff0ac92e78ff71431b1023eda42bf482); values and sculpt volumes: Gukirana P3-FGT-19A", units: "sculpt volumes in MakeHuman decimetres before the stature scale; amplitude along the vertex normal", fighters: {} };
for (const [k, spec] of Object.entries(FIGHTERS)) {
  const b = buildBody(mh, spec);
  targets.fighters[k] = { label: spec.label, stature: spec.stature, macro: spec.macro, regional: spec.regional, face: FACE[spec.macro.gender > 0.5 ? "m" : "f"], sculptScale: spec.sculpt, sculptVolumes: SCULPT_LOG.map((v) => ({ ...v })), measure: b.measure };
}
targets.kit = KIT;
targets.tones = TONES;
writeFileSync(join(DEST, "shape-targets.json"), JSON.stringify(targets, null, 1));

// patterns + garments (guard)
const b64 = (s, T) => {
  const buf = Buffer.from(s, "base64");
  return new T(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
for (const f of ["mW", "fL", "mH", "fM"]) {
  const stand = join(OUT, "cloth", `${f}-stand.json`);
  if (existsSync(stand)) {
    const c = JSON.parse(readFileSync(stand, "utf8"));
    writeFileSync(join(DEST, `patterns-${f}.json`), JSON.stringify({ fighter: f, units: "metres; y up from the hem; singlet x across (centre 0); leg x from the front inner edge round the outside to the back inner edge", ...c.pattern }, null, 1));
  }
  const guard = join(OUT, "cloth", `${f}-guard.json`);
  if (existsSync(guard) && (f === "mW" || f === "fL")) {
    const c = JSON.parse(readFileSync(guard, "utf8"));
    const meshes = c.meshes.map((m) => {
      const P = b64(m.position, Float32Array), N = b64(m.normal, Float32Array), UV = b64(m.uv, Float32Array), I = b64(m.index, Uint32Array);
      const n = P.length / 3;
      return {
        name: m.name,
        attrs: {
          POSITION: { data: P, size: 3 },
          NORMAL: { data: N, size: 3 },
          TEXCOORD_0: { data: UV, size: 2 },
          JOINTS_0: { data: new Uint8Array(n * 4), size: 4 },
          WEIGHTS_0: { data: Float32Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), size: 4 },
        },
        index: I,
      };
    });
    writeGlb(join(DEST, `garments-${f}-guard.glb`), { bones: [{ name: "root", parent: -1, pos: [0, 0, 0] }], meshes, extras: { source: "P3-FGT-19A cloth simulation (pattern UVs in metres), guard pose; retopology / fold-bake source", fighter: f } });
  }
}

// skin maps (webp)
for (const sex of ["m", "f"]) {
  const dir = join(OUT, `skin-${sex}`);
  await sharp(join(dir, "normal.png")).webp({ quality: 90 }).toFile(join(DEST, `skin-${sex}-normal.webp`));
  await sharp(join(dir, "roughness.png")).webp({ quality: 88 }).toFile(join(DEST, `skin-${sex}-roughness.webp`));
  await sharp(join(dir, "sweat.png")).resize(1024).webp({ quality: 85 }).toFile(join(DEST, `skin-${sex}-sweat.webp`));
  for (const t of TONES) await sharp(join(dir, `albedo-${t.id}.jpg`)).webp({ quality: 88 }).toFile(join(DEST, `skin-${sex}-albedo-${t.id}.webp`));
}
let total = 0;
for (const f of (await import("node:fs")).readdirSync(DEST)) total += statSync(join(DEST, f)).size;
console.log(`source-v8: ${(total / 1e6).toFixed(1)} MB`);
