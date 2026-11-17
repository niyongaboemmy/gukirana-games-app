#!/usr/bin/env node
// P3-FGT-21: boxer v9 pipeline runner (docs/design/boxer-v9/BLENDER-PIPELINE.md). Finds Blender, says what to install
// when something is missing, and runs the Blender steps headless (`blender -b -P <step>.py -- ...`) in order.
//
//   node apps/web/scripts/boxer-v9/run.mjs --check            # what is installed, what is missing (runs nothing else)
//   node apps/web/scripts/boxer-v9/run.mjs --init             # make work/ (git-ignored) and work/pipeline.json
//   node apps/web/scripts/boxer-v9/run.mjs [--dry-run] [--from rig] [--only cloth]
//
// Steps: import, decimate, rig, clips, cloth, gear, bake, export, library, ktx2. Between "decimate" and "rig" there
// is one manual web step (Mixamo auto-rig): the runner stops there and prints exactly what to upload and download.
// The Python steps are UNTESTED (written before Blender was installed); this runner's --check / --init / --dry-run
// paths were run with Node 24.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "work");
const KTX2 = resolve(HERE, "../boxer/ktx2.mjs");
const MIN_BLENDER = [4, 2];
const STEPS = ["import", "decimate", "rig", "clips", "cloth", "gear", "bake", "export", "library", "ktx2"];

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** first existing executable among candidates, or null */
function which(name) {
  const exts = platform() === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const e of exts) {
      const p = join(dir, name + e);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

export function blenderCandidates(env = process.env, os = platform(), home = homedir()) {
  const c = [];
  if (env.BLENDER) c.push(env.BLENDER);
  if (os === "darwin") c.push("/Applications/Blender.app/Contents/MacOS/Blender", join(home, "Applications/Blender.app/Contents/MacOS/Blender"));
  if (os === "linux") c.push("/usr/bin/blender", "/snap/bin/blender", join(home, "blender/blender"));
  if (os === "win32") for (const v of ["5.0", "4.5", "4.4", "4.3", "4.2"]) c.push(`C:\\Program Files\\Blender Foundation\\Blender ${v}\\blender.exe`);
  return c;
}

function findBlender() {
  const p = blenderCandidates().find((x) => existsSync(x)) ?? which("blender");
  if (!p) return null;
  const out = spawnSync(p, ["--version"], { encoding: "utf8" });
  const m = /Blender (\d+)\.(\d+)(?:\.(\d+))?/.exec(out.stdout ?? "");
  return { path: p, version: m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null };
}

const okVersion = (v) => !!v && (v[0] > MIN_BLENDER[0] || (v[0] === MIN_BLENDER[0] && v[1] >= MIN_BLENDER[1]));

function check() {
  const b = findBlender();
  const tools = { basisu: which("basisu"), magick: which("magick") };
  console.log("boxer v9 pipeline: tool check\n");
  if (!b) {
    console.log("  Blender      MISSING");
    console.log("    install: free from https://www.blender.org/download/ (4.2 LTS or newer; 4.5 LTS recommended).");
    console.log("    macOS: drag Blender.app into /Applications (found automatically), or set BLENDER=/path/to/Blender.");
  } else {
    const v = b.version ? b.version.join(".") : "unknown";
    console.log(`  Blender      ${b.path} (version ${v})${okVersion(b.version) ? "" : `  TOO OLD: need ${MIN_BLENDER.join(".")}+`}`);
  }
  console.log(`  basisu       ${tools.basisu ?? "MISSING (only for the ktx2 step): brew install basis_universal"}`);
  console.log(`  magick       ${tools.magick ?? "MISSING (only for the ktx2 step): brew install imagemagick"}`);
  console.log("\n  Accounts the steps need (free, made by you, never by the agent): Epic Games (MetaHuman Creator in Unreal");
  console.log("  Engine 5.7+), Adobe ID (mixamo.com), Sketchfab (to download the CC-BY gear).");
  return { blender: b && okVersion(b.version) ? b : null, tools };
}

function init() {
  for (const d of ["in/metahuman/m", "in/metahuman/f", "in/mixamo/m", "in/mixamo/f", "in/gear/glove", "in/gear/headgear", "in/gear/shoe", "out"]) mkdirSync(join(WORK, d), { recursive: true });
  const cfg = join(WORK, "pipeline.json");
  if (!existsSync(cfg)) copyFileSync(join(HERE, "pipeline.example.json"), cfg);
  console.log(`made ${WORK} (git-ignored) and ${cfg}. Put the downloads in work/in/ as README.md says, then run without --init.`);
}

/** the Blender command lines for every step (pure: no I/O) */
export function plan(cfg) {
  const f = cfg.fighter ?? "m";
  const o = (n) => `work/out/${f}/${n}`;
  const py = (s) => join(HERE, s);
  const step = (name, blend, script, args, needs) => ({ name, blend, script: py(script), args, needs });
  const gear = (cfg.gear ?? []).filter((g) => g.enabled !== false);
  const out = [
    step("import", null, "01_import_body.py", ["--input", cfg.body.input, "--out", o("01-body.blend"), ...(cfg.body.height ? ["--height", String(cfg.body.height)] : [])], [cfg.body.input]),
    step("decimate", o("01-body.blend"), "02_decimate.py", ["--out", o("02-body.blend"), "--fbx", o("body-for-mixamo.fbx"), "--target", String(cfg.body.target ?? 19000)], [o("01-body.blend")]),
    step("rig", o("02-body.blend"), "03_rig.py", ["--mixamo", cfg.mixamo_character, "--out", o("03-rigged.blend")], [o("02-body.blend"), cfg.mixamo_character]),
    step("clips", o("03-rigged.blend"), "04_retarget_clips.py", ["--clips", py("mixamo-clips.json"), "--dir", cfg.mixamo_clips_dir, "--out", o("04-clips.blend"), "--report", o("clips-report.json")], [o("03-rigged.blend")]),
    step("cloth", o("04-clips.blend"), "05_cloth.py", ["--poses", py("cloth-poses.json"), "--out", o("05-cloth.blend"), "--report", o("correctives.json"), "--garments", (cfg.cloth?.garments ?? ["singlet", "trunks"]).join(","), "--target", String(cfg.cloth?.target ?? 3500), ...(cfg.cloth?.source_singlet ? ["--source-singlet", cfg.cloth.source_singlet] : []), ...(cfg.cloth?.source_trunks ? ["--source-trunks", cfg.cloth.source_trunks] : [])], [o("04-clips.blend")]),
  ];
  let prev = o("05-cloth.blend");
  gear.forEach((g, i) => {
    const next = o(`06-gear-${i + 1}.blend`);
    const a = ["--input", g.input, "--mode", g.mode, "--out", next, "--target", String(g.target ?? 2200)];
    if (g.side) a.push("--side", g.side);
    if (g.rotate) a.push("--rotate", g.rotate);
    if (g.length) a.push("--length", String(g.length));
    if (g.cut_below !== undefined && g.cut_below >= 0) a.push("--cut-below", String(g.cut_below));
    if (g.mirror) a.push("--mirror");
    if (g.hide_hands) a.push("--hide-hands");
    if (g.hide_feet) a.push("--hide-feet");
    out.push(step("gear", prev, "06_fit_gear.py", a, [prev, g.input]));
    prev = next;
  });
  out.push(step("bake", prev, "07_bake.py", ["--out-dir", o("maps"), "--out", o("07-baked.blend"), "--plan", o("ktx2-plan.json"), "--size", String(cfg.bake?.size ?? 2048), "--rough-min", String(cfg.bake?.rough_min ?? 0.42)], [prev]));
  out.push(step("export", o("07-baked.blend"), "08_export.py", ["--what", "fighter", "--out", o(`boxer-${f}.glb`), "--lod1", o(`boxer-${f}-lod1.glb`), "--lod1-tris", String(cfg.lod1_tris ?? 12000)], [o("07-baked.blend")]));
  out.push(step("library", o("07-baked.blend"), "08_export.py", ["--what", "clips", "--out", "work/out/clips/boxer-clips.glb"], [o("07-baked.blend")]));
  out.push({ name: "ktx2", node: [KTX2, "--plan", o("ktx2-plan.json")], needs: [o("ktx2-plan.json")] });
  return out;
}

const MANUAL = {
  rig: (cfg) =>
    `MANUAL STEP (Mixamo auto-rig, about 5 minutes, needs your free Adobe ID):\n` +
    `  1. open https://www.mixamo.com, sign in, "Upload Character", choose work/out/${cfg.fighter ?? "m"}/body-for-mixamo.fbx;\n` +
    `  2. place the markers (chin, wrists, elbows, knees, groin), skeleton LOD "Standard Skeleton (65)", Next;\n` +
    `  3. with that character selected: Download, Format "FBX Binary (.fbx)", Pose "T-pose", Skin "With Skin";\n` +
    `  4. save it as ${cfg.mixamo_character}, then the clips (docs/design/boxer-v9/MIXAMO-MOVES.md) into ${cfg.mixamo_clips_dir};\n` +
    `  5. run this again with --from rig.`,
};

function main() {
  if (flag("check")) return void check();
  if (flag("init")) return void init();
  const cfgPath = opt("config") ?? join(WORK, "pipeline.json");
  if (!existsSync(cfgPath)) {
    console.log(`no ${cfgPath}: run with --init first (it copies pipeline.example.json).`);
    process.exitCode = 1;
    return;
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const steps = plan(cfg);
  const from = opt("from"),
    only = opt("only");
  for (const s of [from, only]) if (s && !STEPS.includes(s)) throw new Error(`unknown step ${s} (${STEPS.join(", ")})`);
  const start = from ? steps.findIndex((s) => s.name === from) : 0;
  const todo = steps.slice(start).filter((s) => !only || s.name === only);
  const dry = flag("dry-run");
  const blender = dry ? { path: "blender" } : check().blender;
  if (!blender && todo.some((s) => s.script)) {
    console.log("\nBlender is needed for these steps: install it (above) and run again.");
    process.exitCode = 1;
    return;
  }
  for (const s of todo) {
    const missing = s.needs.filter((p) => !existsSync(resolve(HERE, p)));
    if (missing.length && !dry) {
      console.log(`\n[${s.name}] waiting for: ${missing.join(", ")}`);
      if (MANUAL[s.name]) console.log(MANUAL[s.name](cfg));
      process.exitCode = 1;
      return;
    }
    if (s.node) {
      console.log(`\n[${s.name}] node ${s.node.join(" ")}`);
      if (!dry) execFileSync(process.execPath, s.node, { cwd: HERE, stdio: "inherit" });
      continue;
    }
    const cmd = ["--factory-startup", "-b", ...(s.blend ? [s.blend] : []), "-P", s.script, "--", ...s.args];
    console.log(`\n[${s.name}] ${blender.path} ${cmd.join(" ")}`);
    if (dry) continue;
    for (const p of s.args) if (p.startsWith("work/out/")) mkdirSync(dirname(resolve(HERE, p)), { recursive: true });
    const r = spawnSync(blender.path, cmd, { cwd: HERE, stdio: "inherit" });
    if (r.status !== 0) {
      console.log(`[${s.name}] failed (exit ${r.status}). The scripts are untested: read the error above, fix the script or the config.`);
      process.exitCode = r.status ?? 1;
      return;
    }
  }
  console.log(`\ndone. Outputs in work/out/. Judge them with docs/design/boxer-v9/CHECKLIST.md before anything ships.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
