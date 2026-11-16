#!/usr/bin/env node
// P3-FGT-19B: the fighters' KTX2 / Basis Universal texture stage (docs/FIGHT-REALISM-V8.md §Textures). Encodes the
// v8 maps for apps/web/public/assets/characters/v8/ and prints the GPU memory before / after
// (texture-budget.mjs). The runtime side is world/human/boxer/v8/ktx2.ts (three's KTX2Loader + /basis/ transcoder).
//
//   node apps/web/scripts/boxer/ktx2.mjs <in.(webp|png|jpg)> <out.ktx2> [--codec etc1s|uastc] [--linear] [--normal]
//        [--size 1024] [--q 128]
//   node apps/web/scripts/boxer/ktx2.mjs --plan <plan.json>      // [{ "in", "out", "codec", "linear", "normal", "size" }]
//
// Colour maps (albedo) → ETC1S (BC1 / ETC2 RGB on the GPU: 0.5 byte per texel); normal / detail / cavity maps →
// UASTC with RDO (BC7 / ASTC 4×4: 1 byte per texel, no ETC1S block artefacts on normals). Mip chains are generated
// (kaiser; renormalised for normal maps). Needs `basisu` (Binomial's encoder, Apache-2.0; `brew install
// basis_universal`) and ImageMagick (`magick`, for WebP input and resizing).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { budget } from "./texture-budget.mjs";

/** the basisu arguments for one map (pure: tested) */
export function basisArgs({ input, output, codec = "etc1s", linear = false, normal = false, q = 128 }) {
  const a = ["-ktx2", "-mipmap", "-file", input, "-output_file", output];
  if (codec === "uastc") a.push("-uastc", "-uastc_level", "2", "-uastc_rdo_l", normal ? "0.5" : "1.0");
  else a.push("-etc1s", "-q", String(q));
  if (linear || normal) a.push("-linear", "-mip_linear");
  if (normal) a.push("-normal_map", "-mip_renorm");
  return a;
}

function size(file) {
  const out = execFileSync("magick", ["identify", "-format", "%w %h", file]).toString().trim().split(" ").map(Number);
  return { w: out[0], h: out[1] };
}

export function encode(job) {
  const tmp = mkdtempSync(join(tmpdir(), "gk-ktx2-"));
  try {
    const png = join(tmp, basename(job.in).replace(/\.\w+$/, ".png"));
    // (basisu reads PNG / TGA / JPG / QOI: WebP goes through ImageMagick; an optional resize on the way)
    execFileSync("magick", [job.in, ...(job.size ? ["-resize", `${job.size}x${job.size}`] : []), "-strip", png]);
    execFileSync("basisu", basisArgs({ input: png, output: job.out, codec: job.codec, linear: job.linear, normal: job.normal, q: job.q }), { stdio: ["ignore", "ignore", "inherit"] });
    const { w, h } = size(png);
    const before = budget([{ w, h, format: "rgba8" }]);
    const desk = budget([{ w, h, codec: job.codec ?? "etc1s" }], "desktop");
    const phone = budget([{ w, h, codec: job.codec ?? "etc1s" }], "phone");
    const r = { in: job.in, out: job.out, w, h, codec: job.codec ?? "etc1s", srcKB: Math.round(statSync(job.in).size / 1024), ktx2KB: Math.round(statSync(job.out).size / 1024), gpuMB: { rgba8: before.mb, desktop: desk.mb, phone: phone.mb } };
    console.log(JSON.stringify(r));
    return r;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = arg("plan");
  if (plan) {
    const jobs = JSON.parse(readFileSync(plan, "utf8"));
    const rs = jobs.map(encode);
    const tot = (k) => +rs.reduce((n, r) => n + r.gpuMB[k], 0).toFixed(2);
    console.log(`total GPU MB: RGBA8 ${tot("rgba8")} → desktop ${tot("desktop")} / phone ${tot("phone")}`);
  } else {
    const [input, output] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
    if (!input || !output) throw new Error("usage: ktx2.mjs <in> <out.ktx2> [--codec etc1s|uastc] [--linear] [--normal] [--size N] [--q N] | --plan plan.json");
    encode({ in: input, out: output, codec: arg("codec") ?? "etc1s", linear: process.argv.includes("--linear"), normal: process.argv.includes("--normal"), size: arg("size") ? Number(arg("size")) : undefined, q: arg("q") ? Number(arg("q")) : undefined });
  }
}
