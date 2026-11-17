#!/usr/bin/env node
// P2-AVA-13: human v9 pipeline runner (docs/design/human-v9/PIPELINE.md). Real scanned people + real CMU motion,
// processed headless in Blender, for the campus ambient people. Modelled on apps/web/scripts/boxer-v9/run.mjs, and
// it REUSES the boxer steps read-only (02_decimate, 04_retarget_clips, 07_bake, 08_export --what clips, ktx2.mjs).
//
//   node apps/web/scripts/human-v9/run.mjs --check                  what is installed, which inputs are missing
//   node apps/web/scripts/human-v9/run.mjs --fetch                  download the CC BY scans + CMU takes (no login)
//   node apps/web/scripts/human-v9/run.mjs [--person <id>] [--only <step>] [--from <step>] [--fast] [--dry-run]
//                                          [--publish]
//
// Steps per person: import, decimate, rig, clips, bake (only for scans that were decimated), maps, export; once:
// windows (before the first clips), library (after the first person), ktx2, publish (--publish: copies the GLBs,
// KTX2 maps and a manifest into the git-ignored apps/web/public/assets/characters/_v9humans/ for the flagged runtime).
// Inputs and outputs live in the git-ignored work/ folder: third-party files are never committed.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOXER = resolve(HERE, "../boxer-v9");
const KTX2 = resolve(HERE, "../boxer/ktx2.mjs");
const PUBLIC = resolve(HERE, "../../public/assets/characters/_v9humans");
const CMU = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data";
export const STEPS = ["import", "decimate", "rig", "windows", "clips", "bake", "maps", "export", "library", "ktx2", "publish"];
const DECIMATE_TARGET = 19000;

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function which(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, name);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

function blender() {
  const c = [process.env.BLENDER, "/Applications/Blender.app/Contents/MacOS/Blender", which("blender")].filter(Boolean);
  const p = c.find((x) => existsSync(x));
  if (!p) return null;
  const v = /Blender (\d+)\.(\d+)/.exec(spawnSync(p, ["--version"], { encoding: "utf8" }).stdout ?? "");
  return { path: p, version: v ? [Number(v[1]), Number(v[2])] : null };
}

export const people = () => JSON.parse(readFileSync(join(HERE, "people.json"), "utf8"));
export const clipSpec = () => JSON.parse(readFileSync(join(HERE, "human-clips.json"), "utf8"));
/** the CMU takes the clip list needs (unique file names) */
export const cmuFiles = (spec = clipSpec()) => [...new Set(spec.map((c) => c.file))];
/** where one CMU take lives on the public BVH mirror (subject folder zero-padded to 3 digits) */
export const cmuUrl = (file) => `${CMU}/${file.split("_")[0].padStart(3, "0")}/${file}`;
export const objaverseUrl = (base, p) => `${base}glbs/${p.shard}/${p.uid}.glb`;

/** the command list for one person (pure). `first` adds the once-only windows / library steps. */
export function plan(p, { first = false, fast = false, decimated = true } = {}) {
  const o = (n) => `work/out/${p.id}/${n}`;
  const py = (s) => join(HERE, s);
  const bx = (s) => join(BOXER, s);
  const s = [];
  s.push({ name: "import", script: py("01_import_scan.py"), args: ["--input", `work/in/scans/${p.id}/source.glb`, "--out", o("01-scan.blend"), "--height", String(p.height), "--report", o("01-report.json"), ...(p.turn ? ["--turn", String(p.turn)] : []), ...(p.base ? ["--base", String(p.base)] : [])], needs: [`work/in/scans/${p.id}/source.glb`] });
  s.push({ name: "decimate", blend: o("01-scan.blend"), script: bx("02_decimate.py"), args: ["--out", o("02-body.blend"), "--target", String(DECIMATE_TARGET), "--face-tris", "5000", ...(decimated ? ["--unwrap"] : [])], needs: [o("01-scan.blend")] });
  s.push({ name: "rig", blend: o("02-body.blend"), script: py("03_autorig.py"), args: ["--out", o("03-rigged.blend"), "--report", o("03-report.json")], needs: [o("02-body.blend")] });
  if (first) s.push({ name: "windows", script: py("04a_clip_windows.py"), args: ["--spec", py("human-clips.json"), "--dir", "work/in/cmu", "--out", "work/out/clips/resolved-clips.json"], needs: ["work/in/cmu"] });
  s.push({ name: "clips", blend: o("03-rigged.blend"), script: py("04_retarget_clips.py"), args: ["--clips", resolve(HERE, "work/out/clips/resolved-clips.json"), "--dir", "work/in/cmu", "--map", "cmu", "--out", o("04-clips.blend"), "--report", o("clips-report.json")], needs: [o("03-rigged.blend"), "work/out/clips/resolved-clips.json"] });
  if (decimated) s.push({ name: "bake", blend: o("04-clips.blend"), script: bx("07_bake.py"), args: ["--out-dir", o("maps"), "--out", o("05-baked.blend"), "--plan", o("bake-plan.json"), "--pairs", "body_hi:body", "--maps", "normal,color", "--size", fast ? "1024" : "2048", "--samples", fast ? "4" : "16", "--rough-min", "0"], needs: [o("04-clips.blend")] });
  const last = decimated ? o("05-baked.blend") : o("04-clips.blend");
  s.push({ name: "maps", blend: last, script: py("05_maps.py"), args: ["--out-dir", o("maps"), "--plan", o("ktx2-plan.json"), "--id", p.id], needs: [last] });
  s.push({ name: "export", blend: o("04-clips.blend"), script: py("06_export.py"), args: ["--out", o(`${p.id}.glb`), "--report", o("export-report.json")], needs: [o("04-clips.blend")] });
  if (first) s.push({ name: "library", blend: o("04-clips.blend"), script: bx("08_export.py"), args: ["--what", "clips", "--out", "work/out/clips/human-clips.glb"], needs: [o("04-clips.blend")] });
  s.push({ name: "ktx2", node: [KTX2, "--plan", o("ktx2-plan.json")], needs: [o("ktx2-plan.json")] });
  return s;
}

/** the manifest the runtime reads (pure): one entry per built person, maps by variant */
export function manifest(list, built) {
  return {
    generated: "apps/web/scripts/human-v9/run.mjs --publish",
    clips: "human-clips.glb",
    people: list
      .filter((p) => built.includes(p.id))
      .map((p) => ({
        id: p.id,
        glb: `${p.id}.glb`,
        height: p.height,
        sex: p.sex,
        age: p.age,
        maps: {
          desktop: { color: `${p.id}-color.ktx2`, ...(p.normal ? { normal: `${p.id}-normal.ktx2` } : {}) },
          phone: { color: `${p.id}-color-1k.ktx2`, ...(p.normal ? { normal: `${p.id}-normal-1k.ktx2` } : {}) },
        },
        ...(p.mask ? { mask: `${p.id}-mask-1k.ktx2` } : {}),
        credit: `"${p.title}" by ${p.author} (${p.page}), ${p.licence}, modified (cleaned, re-rigged, re-animated, decimated)`,
      })),
  };
}

async function download(url, out) {
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(out));
}

async function fetchInputs() {
  const cfg = people();
  for (const p of cfg.people) {
    const out = join(HERE, "work/in/scans", p.id, "source.glb");
    if (existsSync(out)) continue;
    console.log(`scan ${p.id}: ${p.page} (${p.licence}) via the Objaverse mirror`);
    await download(objaverseUrl(cfg.objaverse, p), out);
  }
  for (const f of cmuFiles()) {
    const out = join(HERE, "work/in/cmu", f);
    if (existsSync(out)) continue;
    console.log(`CMU take ${f}`);
    await download(cmuUrl(f), out);
  }
  console.log("inputs in place (work/in/, git-ignored). They are data only: nothing in them is ever executed.");
}

function check() {
  const b = blender();
  console.log("human v9 pipeline: tool check\n");
  console.log(b ? `  Blender  ${b.path} (${b.version?.join(".")})` : "  Blender  MISSING: https://www.blender.org/download/ (verified on 5.2.4 LTS)");
  console.log(`  basisu   ${which("basisu") ?? "MISSING (ktx2 step only)"}`);
  console.log(`  magick   ${which("magick") ?? "MISSING (ktx2 step only)"}`);
  for (const p of people().people) console.log(`  scan     ${p.id.padEnd(16)} ${existsSync(join(HERE, "work/in/scans", p.id, "source.glb")) ? "ok" : "missing (run --fetch)"}`);
  const miss = cmuFiles().filter((f) => !existsSync(join(HERE, "work/in/cmu", f)));
  console.log(`  CMU      ${miss.length ? `missing ${miss.join(", ")} (run --fetch)` : "all takes present"}`);
  return b;
}

const fmt = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

function publish(list) {
  mkdirSync(PUBLIC, { recursive: true });
  const built = [];
  for (const p of list) {
    const d = join(HERE, "work/out", p.id);
    const glb = join(d, `${p.id}.glb`);
    if (!existsSync(glb)) continue;
    copyFileSync(glb, join(PUBLIC, `${p.id}.glb`));
    for (const v of ["", "-1k"])
      for (const k of ["color", "normal", "mask"]) {
        const f = join(d, "maps/ktx2", `${p.id}-${k}${v}.ktx2`);
        if (existsSync(f)) {
          copyFileSync(f, join(PUBLIC, `${p.id}-${k}${v}.ktx2`));
          if (k === "normal") p.normal = true;
          if (k === "mask") p.mask = true;
        }
      }
    built.push(p.id);
  }
  copyFileSync(join(HERE, "work/out/clips/human-clips.glb"), join(PUBLIC, "human-clips.glb"));
  writeFileSync(join(PUBLIC, "manifest.json"), JSON.stringify(manifest(list, built), null, 2));
  console.log(`published ${built.length} people + the clip library to ${PUBLIC} (git-ignored)`);
}

async function main() {
  if (flag("check")) return void check();
  if (flag("fetch")) return fetchInputs();
  const dry = flag("dry-run");
  const b = dry ? { path: "blender" } : blender();
  if (!b) {
    check();
    process.exitCode = 1;
    return;
  }
  const only = opt("only");
  const from = opt("from");
  for (const s of [only, from]) if (s && !STEPS.includes(s)) throw new Error(`unknown step ${s} (${STEPS.join(", ")})`);
  const all = people().people;
  const who = opt("person") ? all.filter((p) => p.id === opt("person")) : all;
  if (!who.length) throw new Error(`unknown person ${opt("person")} (${all.map((p) => p.id).join(", ")})`);
  const times = [];
  let reached = !from;
  for (const [i, p] of who.entries()) {
    const rep = join(HERE, "work/out", p.id, "01-report.json");
    const decimated = existsSync(rep) ? JSON.parse(readFileSync(rep, "utf8")).tris > DECIMATE_TARGET : true;
    for (const s of plan(p, { first: i === 0, fast: flag("fast"), decimated })) {
      if (!reached && s.name === from) reached = true;
      if (!reached || (only && s.name !== only)) continue;
      const missing = s.needs.filter((n) => !existsSync(resolve(HERE, n)));
      if (missing.length && !dry) {
        console.log(`\n[${p.id} ${s.name}] waiting for: ${missing.join(", ")}${s.name === "import" || s.name === "windows" ? " (run --fetch)" : ""}`);
        process.exitCode = 1;
        return;
      }
      const t0 = Date.now();
      if (s.node) {
        console.log(`\n[${p.id} ${s.name}] node ${s.node.join(" ")}`);
        if (!dry) {
          if (!which("basisu") || !which("magick")) {
            console.log("  needs basisu and magick (--check): skipped");
            continue;
          }
          execFileSync(process.execPath, s.node, { cwd: HERE, stdio: "inherit" });
        }
      } else {
        const cmd = ["--factory-startup", "-b", ...(s.blend ? [s.blend] : []), "-P", s.script, "--", ...s.args];
        console.log(`\n[${p.id} ${s.name}] ${b.path} ${cmd.join(" ")}`);
        if (dry) continue;
        for (const a of s.args) if (a.startsWith("work/")) mkdirSync(dirname(resolve(HERE, a)), { recursive: true });
        const r = spawnSync(b.path, cmd, { cwd: HERE, stdio: "inherit" });
        if (r.status !== 0) {
          console.log(`[${p.id} ${s.name}] failed (exit ${r.status}) after ${fmt(Date.now() - t0)}: read the [human-v9] / [boxer-v9] ERROR above.`);
          process.exitCode = r.status ?? 1;
          return;
        }
      }
      times.push({ step: `${p.id} ${s.name}`, ms: Date.now() - t0 });
      console.log(`[${p.id} ${s.name}] done in ${fmt(times.at(-1).ms)}`);
    }
  }
  if (dry) return;
  if (flag("publish") && (!only || only === "publish")) publish(all.map((p) => ({ ...p })));
  console.log("\nstep timings:");
  for (const t of times) console.log(`  ${t.step.padEnd(30)} ${fmt(t.ms)}`);
  const total = times.reduce((a, t) => a + t.ms, 0);
  console.log(`  ${"total".padEnd(30)} ${fmt(total)}`);
  mkdirSync(join(HERE, "work/out"), { recursive: true });
  writeFileSync(join(HERE, "work/out/timings.json"), JSON.stringify({ steps: times, total_ms: total }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
