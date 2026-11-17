#!/usr/bin/env node
// P3-FGT-21 / P3-FGT-22: boxer v9 pipeline runner (docs/design/boxer-v9/BLENDER-PIPELINE.md). Finds Blender, says what
// is missing, and runs the Blender steps headless (`blender -b -P <step>.py -- ...`) in order, timing each step.
//
//   node apps/web/scripts/boxer-v9/run.mjs --check                 # what is installed, what is missing
//   node apps/web/scripts/boxer-v9/run.mjs --init                  # make work/ (git-ignored) and work/pipeline.json
//   node apps/web/scripts/boxer-v9/run.mjs --body metahuman|scan|test --clips mixamo|cmu [--gear sketchfab|placeholder]
//        [--fighter m|f] [--dry-run] [--from <step>] [--only <step>] [--fast] [--publish-test] [--config <json>]
//
// --body test runs the whole pipeline on stand-ins that need no login: the shipped v8 GLB as the body AND as the
// rig source (its own Bip01 skeleton, so the Mixamo web step is skipped). --clips cmu takes the CMU BVH takes listed
// in cmu-clips.json from work/in/cmu/. --gear placeholder makes a primitive glove (make_placeholder_gear.py).
// --fast bakes 1k maps with 16 samples (test runs). --publish-test copies a --body test result into the git-ignored
// apps/web/public/assets/characters/_v9test/ for the dev-only lab (/play/boxing-lab?mode=boxer&v9=1), and a --body scan
// result (CMU clips only) into _v9test/scan/ (v9=scan).
//
// Steps: placeholder (only with --gear placeholder), scanprep (only with --body scan: re-pose and rig a raw scan
// offline, P3-FGT-23), import, decimate, rig, clips, cloth, gear, bake, export, library,
// ktx2, publish (only with --publish-test). With --body metahuman the runner stops before "rig" until the Mixamo
// auto-rig download is in place, and prints exactly what to upload and download. --body scan rigs offline (scanprep).
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "work");
const KTX2 = resolve(HERE, "../boxer/ktx2.mjs");
const PUBLIC_TEST = resolve(HERE, "../../public/assets/characters/_v9test");
const V8_TEST_BODY = "../../public/assets/characters/v8/boxer-m.glb";
const MIN_BLENDER = [4, 2];
const STEPS = [
  "placeholder",
  "scanprep",
  "import",
  "decimate",
  "rig",
  "clips",
  "cloth",
  "gear",
  "bake",
  "export",
  "library",
  "ktx2",
  "publish",
];
const CMU_MIRROR = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data";

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
  if (os === "darwin")
    c.push(
      "/Applications/Blender.app/Contents/MacOS/Blender",
      join(home, "Applications/Blender.app/Contents/MacOS/Blender"),
    );
  if (os === "linux") c.push("/usr/bin/blender", "/snap/bin/blender", join(home, "blender/blender"));
  if (os === "win32")
    for (const v of ["5.2", "5.1", "5.0", "4.5", "4.4", "4.3", "4.2"])
      c.push(`C:\\Program Files\\Blender Foundation\\Blender ${v}\\blender.exe`);
  return c;
}

function findBlender() {
  const p = blenderCandidates().find((x) => existsSync(x)) ?? which("blender");
  if (!p) return null;
  const out = spawnSync(p, ["--version"], { encoding: "utf8" });
  const m = /Blender (\d+)\.(\d+)(?:\.(\d+))?/.exec(out.stdout ?? "");
  return { path: p, version: m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null };
}

const okVersion = (v) =>
  !!v && (v[0] > MIN_BLENDER[0] || (v[0] === MIN_BLENDER[0] && v[1] >= MIN_BLENDER[1]));

function check(quiet = false) {
  const b = findBlender();
  const tools = { basisu: which("basisu"), magick: which("magick") };
  const say = quiet ? () => {} : console.log;
  say("boxer v9 pipeline: tool check\n");
  if (!b) {
    say("  Blender      MISSING");
    say(
      "    install: free from https://www.blender.org/download/ (4.2 LTS or newer; verified on 5.2.4 LTS).",
    );
    say(
      "    macOS: drag Blender.app into /Applications (found automatically), or set BLENDER=/path/to/Blender.",
    );
  } else {
    const v = b.version ? b.version.join(".") : "unknown";
    say(
      `  Blender      ${b.path} (version ${v})${okVersion(b.version) ? "" : `  TOO OLD: need ${MIN_BLENDER.join(".")}+`}`,
    );
  }
  say(`  basisu       ${tools.basisu ?? "MISSING (only for the ktx2 step): brew install basis_universal"}`);
  say(`  magick       ${tools.magick ?? "MISSING (only for the ktx2 step): brew install imagemagick"}`);
  say(
    "\n  Accounts the real inputs need (free, made by you, never by the agent): Epic Games (MetaHuman Creator in Unreal",
  );
  say(
    "  Engine 5.7+), Adobe ID (mixamo.com), Sketchfab (to download the CC-BY gear). --body test --clips cmu needs none.",
  );
  return { blender: b && okVersion(b.version) ? b : null, tools };
}

function init() {
  for (const d of [
    "in/metahuman/m",
    "in/metahuman/f",
    "in/scan/m",
    "in/scan/f",
    "in/mixamo/m",
    "in/mixamo/f",
    "in/cmu",
    "in/gear/glove",
    "in/gear/headgear",
    "in/gear/shoe",
    "out",
  ])
    mkdirSync(join(WORK, d), { recursive: true });
  const cfg = join(WORK, "pipeline.json");
  if (!existsSync(cfg)) copyFileSync(join(HERE, "pipeline.example.json"), cfg);
  console.log(
    `made ${WORK} (git-ignored) and ${cfg}. Put the downloads in work/in/ as BLENDER-PIPELINE.md says, then run without --init.`,
  );
}

/**
 * The effective config: pipeline.json (or the example) with the --body / --clips / --gear choices applied (pure).
 * body: metahuman (cfg.body.input), scan (cfg.scan.input) or test (the v8 GLB, rigged by its own skeleton).
 */
export function profile(base, { body, clips, gear, fast } = {}) {
  const cfg = structuredClone(base);
  const f = cfg.fighter ?? "m";
  cfg.rig = {
    source: cfg.mixamo_character,
    map: "mixamo",
    source_mesh: "",
    manual: true,
    ...(cfg.rig ?? {}),
  };
  if (body === "test") {
    cfg.body = { ...cfg.body, input: V8_TEST_BODY, include: ["body", "hair_cap"], height: 0, unwrap: true };
    cfg.rig = { source: V8_TEST_BODY, map: "bip01", source_mesh: "body", manual: false };
    cfg.kind = "test";
  } else if (body === "scan") {
    // (P3-FGT-23) a raw scan goes through 00_scan_prep.py first: upright, metres, re-posed into our A-pose and rigged
    // offline onto Bip01 joints (bone heat), so no Mixamo upload is needed. scan.prep: false keeps the old route (a
    // scan already in an A-pose, rigged through the Mixamo web step).
    const scan = cfg.scan ?? {};
    const raw = scan.input ?? `work/in/scan/${f}/body.obj`;
    if (scan.prep === false) {
      cfg.body = { ...cfg.body, height: 0, ...scan, input: raw };
    } else {
      const apose = `work/out/${f}/scan-apose.glb`;
      const rigSrc = `work/out/${f}/scan-rig.glb`;
      cfg.scanprep = {
        input: raw,
        out: apose,
        rig_out: rigSrc,
        joints: scan.joints ?? "",
        height: scan.height ?? 0,
      };
      cfg.body = { ...cfg.body, unwrap: true, ...scan, height: 0, input: apose };
      cfg.rig = { source: rigSrc, map: "bip01", source_mesh: "body", manual: false };
    }
    cfg.kind = "scan";
  } else {
    cfg.kind = "metahuman";
  }
  if (clips === "cmu") cfg.clips = { list: "cmu-clips.json", dir: cfg.cmu_dir ?? "work/in/cmu", map: "cmu" };
  else cfg.clips = { list: "mixamo-clips.json", dir: cfg.mixamo_clips_dir, map: "mixamo" };
  if (gear === "placeholder") {
    const g = "work/in/gear/placeholder/glove.glb";
    cfg.placeholder = g;
    cfg.gear = [
      { input: g, mode: "glove", side: "L", length: 0.3, target: 2200, hide_hands: true },
      { input: g, mode: "glove", side: "R", mirror: true, length: 0.3, target: 2200, hide_hands: true },
    ];
  }
  if (fast) cfg.bake = { ...(cfg.bake ?? {}), size: 1024, samples: 16 };
  return cfg;
}

/** the command lines for every step (pure: no I/O) */
export function plan(cfg) {
  const f = cfg.fighter ?? "m";
  const o = (n) => `work/out/${f}/${n}`;
  const py = (s) => join(HERE, s);
  const step = (name, blend, script, args, needs) => ({ name, blend, script: py(script), args, needs });
  const gear = (cfg.gear ?? []).filter((g) => g.enabled !== false);
  const rig = cfg.rig ?? { source: cfg.mixamo_character, map: "mixamo" };
  const clips = cfg.clips ?? { list: "mixamo-clips.json", dir: cfg.mixamo_clips_dir, map: "mixamo" };
  const out = [];
  if (cfg.placeholder)
    out.push({
      ...step(
        "placeholder",
        null,
        "make_placeholder_gear.py",
        ["--out", cfg.placeholder, "--kind", "glove"],
        [],
      ),
      produces: cfg.placeholder,
    });
  if (cfg.scanprep) {
    const sp = cfg.scanprep;
    out.push(
      step(
        "scanprep",
        null,
        "00_scan_prep.py",
        [
          "--input",
          sp.input,
          "--out",
          sp.out,
          "--rig-out",
          sp.rig_out,
          "--report",
          o("scan-prep.json"),
          ...(sp.joints ? ["--joints", sp.joints] : []),
          ...(sp.height ? ["--height", String(sp.height)] : []),
        ],
        [sp.input],
      ),
    );
  }
  out.push(
    step(
      "import",
      null,
      "01_import_body.py",
      [
        "--input",
        cfg.body.input,
        "--out",
        o("01-body.blend"),
        ...(cfg.body.height ? ["--height", String(cfg.body.height)] : []),
        ...(cfg.body.include?.length ? ["--include", cfg.body.include.join(",")] : []),
      ],
      [cfg.body.input],
    ),
    step(
      "decimate",
      o("01-body.blend"),
      "02_decimate.py",
      [
        "--out",
        o("02-body.blend"),
        "--fbx",
        o("body-for-mixamo.fbx"),
        "--target",
        String(cfg.body.target ?? 19000),
        "--face-tris",
        String(cfg.body.face_tris ?? 5000),
        ...(cfg.body.unwrap ? ["--unwrap"] : []),
      ],
      [o("01-body.blend")],
    ),
    step(
      "rig",
      o("02-body.blend"),
      "03_rig.py",
      [
        "--mixamo",
        rig.source,
        "--map",
        rig.map,
        ...(rig.source_mesh ? ["--source-mesh", rig.source_mesh] : []),
        "--out",
        o("03-rigged.blend"),
      ],
      [o("02-body.blend"), rig.source],
    ),
    step(
      "clips",
      o("03-rigged.blend"),
      "04_retarget_clips.py",
      [
        "--clips",
        py(clips.list),
        "--dir",
        clips.dir,
        "--map",
        clips.map,
        "--out",
        o("04-clips.blend"),
        "--report",
        o("clips-report.json"),
      ],
      [o("03-rigged.blend"), clips.dir],
    ),
    step(
      "cloth",
      o("04-clips.blend"),
      "05_cloth.py",
      [
        "--poses",
        py("cloth-poses.json"),
        "--out",
        o("05-cloth.blend"),
        "--report",
        o("correctives.json"),
        "--garments",
        (cfg.cloth?.garments ?? ["singlet", "trunks"]).join(","),
        "--target",
        String(cfg.cloth?.target ?? 3500),
        ...(cfg.cloth?.source_singlet ? ["--source-singlet", cfg.cloth.source_singlet] : []),
        ...(cfg.cloth?.source_trunks ? ["--source-trunks", cfg.cloth.source_trunks] : []),
      ],
      [o("04-clips.blend")],
    ),
  );
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
  out.push(
    step(
      "bake",
      prev,
      "07_bake.py",
      [
        "--out-dir",
        o("maps"),
        "--out",
        o("07-baked.blend"),
        "--plan",
        o("ktx2-plan.json"),
        "--size",
        String(cfg.bake?.size ?? 2048),
        "--samples",
        String(cfg.bake?.samples ?? 64),
        "--rough-min",
        String(cfg.bake?.rough_min ?? 0.42),
      ],
      [prev],
    ),
  );
  out.push(
    step(
      "export",
      o("07-baked.blend"),
      "08_export.py",
      [
        "--what",
        "fighter",
        "--out",
        o(`boxer-${f}.glb`),
        "--lod1",
        o(`boxer-${f}-lod1.glb`),
        "--lod1-tris",
        String(cfg.lod1_tris ?? 12000),
      ],
      [o("07-baked.blend")],
    ),
  );
  out.push(
    step(
      "library",
      o("07-baked.blend"),
      "08_export.py",
      ["--what", "clips", "--out", "work/out/clips/boxer-clips.glb"],
      [o("07-baked.blend")],
    ),
  );
  out.push({ name: "ktx2", node: [KTX2, "--plan", o("ktx2-plan.json")], needs: [o("ktx2-plan.json")] });
  return out;
}

const MANUAL = {
  rig: (cfg) =>
    `MANUAL STEP (Mixamo auto-rig, about 5 minutes, needs your free Adobe ID):\n` +
    `  1. open https://www.mixamo.com, sign in, "Upload Character", choose work/out/${cfg.fighter ?? "m"}/body-for-mixamo.fbx;\n` +
    `  2. place the markers (chin, wrists, elbows, knees, groin), skeleton LOD "Standard Skeleton (65)", Next;\n` +
    `  3. with that character selected: Download, Format "FBX Binary (.fbx)", Pose "T-pose", Skin "With Skin";\n` +
    `  4. save it as ${cfg.rig?.source ?? cfg.mixamo_character}, then the clips (docs/design/boxer-v9/MIXAMO-MOVES.md) into ${cfg.mixamo_clips_dir};\n` +
    `  5. run this again with --from rig.`,
  import: (cfg) =>
    cfg.kind === "scan"
      ? `The scanned body is missing: put the FBX / GLB / OBJ at ${cfg.body.input} (or set scan.input in work/pipeline.json). ASSET-SOURCES.md lists free scans.`
      : `The MetaHuman export is missing: follow docs/design/boxer-v9/METAHUMAN-SPEC.md and save the full-body FBX as ${cfg.body.input}.\n` +
        `  (No MetaHuman yet? --body test runs the whole pipeline on the v8 stand-in body.)`,
  scanprep: (cfg) =>
    `The scan is missing: put the OBJ / FBX / GLB / PLY at ${cfg.scanprep?.input} (docs/design/boxer-v9/SCAN-GUIDE.md), or set scan.input in work/pipeline.json.`,
  placeholder: () => "",
};

/** the clip files a clip list needs that are not in its folder */
function missingClips(cfg) {
  const list = JSON.parse(readFileSync(join(HERE, cfg.clips.list), "utf8"));
  const have = existsSync(resolve(HERE, cfg.clips.dir))
    ? new Set(readdirSync(resolve(HERE, cfg.clips.dir)))
    : new Set();
  return {
    all: [...new Set(list.map((c) => c.file))],
    missing: [...new Set(list.map((c) => c.file).filter((f) => !have.has(f)))],
  };
}

function clipHelp(cfg, missing, all) {
  if (cfg.clips.map === "cmu") {
    return (
      `CMU clips missing in ${cfg.clips.dir}: ${missing.join(", ")}. They are free (CMU Graphics Lab Motion Capture Database, BVH conversion\n` +
      `by B. Hahne). Download them yourself into that folder (untrusted data: a folder of their own, nothing else in it), e.g.\n` +
      missing
        .map(
          (f) => `  curl -fL -o ${cfg.clips.dir}/${f} ${CMU_MIRROR}/${f.slice(0, 2).padStart(3, "0")}/${f}`,
        )
        .join("\n")
    );
  }
  return `Mixamo clips missing in ${cfg.clips.dir}: ${missing.length} of ${all.length} (${missing.slice(0, 6).join(", ")}${missing.length > 6 ? " ..." : ""}). Download them as docs/design/boxer-v9/MIXAMO-MOVES.md says. Missing ones are skipped; none at all stops the step.`;
}

function publishTest(cfg) {
  const f = cfg.fighter ?? "m";
  // (P3-FGT-23) a --body scan result may go to _v9test/scan/ for the dev-only lab (v9=scan): that folder is git-ignored
  // like the rest of _v9test/ and is never committed or deployed. MetaHuman / Mixamo outputs still never go there.
  if (cfg.kind !== "test" && cfg.kind !== "scan")
    throw new Error(
      "--publish-test only copies a --body test or scan result: MetaHuman / Mixamo outputs never go into public/ (LICENCES.md)",
    );
  if (cfg.clips?.map !== "cmu")
    throw new Error("--publish-test needs --clips cmu: Mixamo clips never go into public/ (LICENCES.md)");
  const dest = cfg.kind === "scan" ? join(PUBLIC_TEST, "scan") : PUBLIC_TEST;
  const src = join(WORK, "out", f);
  mkdirSync(join(dest, "maps"), { recursive: true });
  copyFileSync(join(src, `boxer-${f}.glb`), join(dest, "boxer-m.glb"));
  copyFileSync(join(WORK, "out/clips/boxer-clips.glb"), join(dest, "boxer-clips.glb"));
  // the phone-size KTX2 maps and an index { object: { normal: file, color: file, ... } } for the lab
  const planFile = join(src, "ktx2-plan.json");
  const jobs = existsSync(planFile)
    ? JSON.parse(readFileSync(planFile, "utf8")).filter(
        // (the scan review needs face close-ups: it takes the desktop-size maps)
        (j) => j.variant === (cfg.kind === "scan" ? "desktop" : "phone") && existsSync(resolve(HERE, j.out)),
      )
    : [];
  const index = {};
  for (const j of jobs) {
    copyFileSync(resolve(HERE, j.out), join(dest, "maps", basename(j.out)));
    (index[j.object] ??= {})[j.map] = basename(j.out);
  }
  writeFileSync(join(dest, "maps.json"), JSON.stringify(index, null, 2));
  console.log(
    `copied the ${cfg.kind} fighter, the clip library and ${jobs.length} KTX2 maps to ${dest} (git-ignored)`,
  );
}

const fmt = (ms) =>
  ms < 60_000
    ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;

function main() {
  if (flag("check")) return void check();
  if (flag("init")) return void init();
  const cfgPath = opt("config") ?? join(WORK, "pipeline.json");
  const body = opt("body") ?? "metahuman";
  const clipsKind = opt("clips") ?? "mixamo";
  const gearKind = opt("gear") ?? (body === "test" ? "placeholder" : "sketchfab");
  for (const [k, v, ok] of [
    ["body", body, ["metahuman", "scan", "test"]],
    ["clips", clipsKind, ["mixamo", "cmu"]],
    ["gear", gearKind, ["sketchfab", "placeholder"]],
  ])
    if (!ok.includes(v)) throw new Error(`--${k} is ${ok.join(" | ")} (got ${v})`);
  if (!existsSync(cfgPath) && body !== "test") {
    console.log(
      `no ${cfgPath}: run with --init first (it copies pipeline.example.json), or try --body test --clips cmu.`,
    );
    process.exitCode = 1;
    return;
  }
  const base = JSON.parse(
    readFileSync(existsSync(cfgPath) ? cfgPath : join(HERE, "pipeline.example.json"), "utf8"),
  );
  const cfg = profile(base, { body, clips: clipsKind, gear: gearKind, fast: flag("fast") });
  const steps = plan(cfg);
  if (flag("publish-test")) steps.push({ name: "publish", publish: true, needs: [] });
  const from = opt("from"),
    only = opt("only");
  for (const s of [from, only])
    if (s && !STEPS.includes(s)) throw new Error(`unknown step ${s} (${STEPS.join(", ")})`);
  const start = from
    ? Math.max(
        0,
        steps.findIndex((s) => s.name === from),
      )
    : 0;
  const todo = steps.slice(start).filter((s) => !only || s.name === only);
  const dry = flag("dry-run");
  console.log(
    `boxer v9: body ${body}, clips ${clipsKind}, gear ${gearKind}, fighter ${cfg.fighter ?? "m"}${flag("fast") ? ", fast bake" : ""}`,
  );
  const blender = dry ? { path: "blender" } : check(true).blender;
  if (!blender && todo.some((s) => s.script)) {
    check();
    console.log("\nBlender is needed for these steps: install it (above) and run again.");
    process.exitCode = 1;
    return;
  }
  const times = [];
  for (const s of todo) {
    if (s.name === "clips" && !dry) {
      // (checked when the step is reached: the first MetaHuman run does steps 1-2 before any clip exists)
      const c = missingClips(cfg);
      if (c.missing.length === c.all.length) {
        console.log(`\n[clips] ${clipHelp(cfg, c.missing, c.all)}`);
        process.exitCode = 1;
        return;
      }
      if (c.missing.length) console.log(`\n[clips] note: ${clipHelp(cfg, c.missing, c.all)}`);
    }
    const missing = s.needs.filter((p) => !existsSync(resolve(HERE, p)));
    if (s.produces && existsSync(resolve(HERE, s.produces)) && !only) {
      console.log(`\n[${s.name}] ${s.produces} exists: skipped`);
      continue;
    }
    if (missing.length && !dry) {
      console.log(`\n[${s.name}] waiting for: ${missing.join(", ")}`);
      const m = MANUAL[s.name === "rig" && cfg.rig?.manual === false ? "none" : s.name];
      if (m) console.log(m(cfg));
      process.exitCode = 1;
      return;
    }
    const t0 = Date.now();
    if (s.publish) {
      if (!dry) publishTest(cfg);
    } else if (s.node) {
      console.log(`\n[${s.name}] node ${s.node.join(" ")}`);
      if (!dry) {
        const tools = check(true).tools;
        if (!tools.basisu || !tools.magick) {
          console.log(`[${s.name}] needs basisu and magick (run --check): skipped`);
          process.exitCode = 1;
          return;
        }
        execFileSync(process.execPath, s.node, { cwd: HERE, stdio: "inherit" });
      }
    } else {
      const cmd = ["--factory-startup", "-b", ...(s.blend ? [s.blend] : []), "-P", s.script, "--", ...s.args];
      console.log(`\n[${s.name}] ${blender.path} ${cmd.join(" ")}`);
      if (dry) continue;
      for (const p of s.args)
        if (p.startsWith("work/")) mkdirSync(dirname(resolve(HERE, p)), { recursive: true });
      const r = spawnSync(blender.path, cmd, { cwd: HERE, stdio: "inherit" });
      if (r.status !== 0) {
        console.log(
          `[${s.name}] failed (exit ${r.status}) after ${fmt(Date.now() - t0)}: read the [boxer-v9] ERROR above.`,
        );
        process.exitCode = r.status ?? 1;
        return;
      }
    }
    if (!dry) {
      times.push({
        step:
          s.name +
          (s.name === "gear" ? ` ${basename(String(s.args[s.args.indexOf("--out") + 1]), ".blend")}` : ""),
        ms: Date.now() - t0,
      });
      console.log(`[${s.name}] done in ${fmt(times.at(-1).ms)}`);
    }
  }
  if (dry) return;
  console.log("\nstep timings:");
  for (const t of times) console.log(`  ${t.step.padEnd(22)} ${fmt(t.ms)}`);
  const total = times.reduce((a, t) => a + t.ms, 0);
  console.log(`  ${"total".padEnd(22)} ${fmt(total)}`);
  const tf = join(WORK, "out", cfg.fighter ?? "m", "timings.json");
  mkdirSync(dirname(tf), { recursive: true });
  writeFileSync(
    tf,
    JSON.stringify(
      { body, clips: clipsKind, gear: gearKind, fast: flag("fast"), steps: times, total_ms: total },
      null,
      2,
    ),
  );
  console.log(
    `\ndone. Outputs in work/out/. Judge them with docs/design/boxer-v9/CHECKLIST.md before anything ships.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
