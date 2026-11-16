#!/usr/bin/env node
// P3-FGT-19B fighter-v8 acceptance harness: ONE command → standard shots, before / after contact sheets, metrics and a
// scored report (docs/FIGHT-REALISM-V8.md §Harness).
//
//   node qa/e2e/fighter-v8/run.mjs --web http://localhost:3971 --out docs/QA/boxing-v8/harness \
//        [--phases v7,v8] [--only broadcast,duel,turnaround,closeup,action,feet] [--quick] [--label round1]
//        [--acceptance qa/e2e/fighter-v8/acceptance.json] [--raw <dir>]
//
// Needs a development build of the web app (the labs, the `?boxer=v7|v8` override of
// world/human/boxer/generation.ts) and Chrome. Each phase is the same shot list with `&boxer=<phase>`: v7 is the
// before, v8 the after (while the v8 assets are not shipped the page falls back to v7 and the report says so).
//
// Writes to --out: sheets/<group>.jpg (before | after per shot), report.json (all metrics per phase + the score),
// report.md (the acceptance table). Raw PNGs go to --raw (default $TMPDIR/fighter-v8/<label>), not to the repo.
// `--label` keeps a run's raw shots apart (raw/<label>/<phase>/) so iteration rounds can be compared with
// `--compare <labelA>` (sheets of this run's after phase beside labelA's).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { FEET, GROUP_COLS, SHOTS, VIEWPORTS } from "./config.mjs";
import { score, summary } from "./metrics.mjs";
import { fighterTriangles, readBoxerGlb } from "../../../apps/web/scripts/boxer/glb-read.mjs";
import { measureGlb } from "../../../apps/web/scripts/boxer/measure-glb.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", process.env.QA_WEB ?? "http://localhost:3971");
const OUT = resolve(arg("out", join(tmpdir(), "fighter-v8", "out")));
const LABEL = arg("label", "run");
const RAW = resolve(arg("raw", join(tmpdir(), "fighter-v8")), LABEL);
const PHASES = arg("phases", "v7,v8").split(",");
const ONLY = arg("only") ? new Set(arg("only").split(",")) : null;
const QUICK = process.argv.includes("--quick");
const COMPARE = arg("compare");
const ACCEPT = JSON.parse(readFileSync(arg("acceptance", join(HERE, "acceptance.json")), "utf8"));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const QUICK_IDS = new Set(["broadcast", "duel-f", "act-guard", "act-jab", "act-hook", "cu-armhole", "turn-f-90"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- in-page libraries ---------------- */
const metricsSrc = readFileSync(join(HERE, "metrics.mjs"), "utf8");
const exported = [...metricsSrc.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
const LIB = [
  readFileSync(join(ROOT, "qa/e2e/human-assess/inpage.js"), "utf8"),
  `(() => {\n${metricsSrc.replace(/^export /gm, "")}\nwindow.__fv8m = { ${exported.join(", ")} };\n})();`,
  readFileSync(join(HERE, "inpage.js"), "utf8"),
].join("\n;\n");

const withPhase = (path, phase) => `${path}${path.includes("?") ? "&" : "?"}boxer=${phase}`;

async function open(browser, path, vp, size) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("  pageerror", e.message.slice(0, 200)));
  const v = { ...VIEWPORTS[vp], ...(size && vp === "desktop" ? { width: size[0], height: size[1] } : {}) };
  await page.setViewport(v);
  await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(
    () => {
      const boxerMode = new URLSearchParams(location.search).get("mode") === "boxer";
      if (boxerMode && !window.__gkBoxer?.ready) return false;
      return (window.__gkProbe?.frames ?? 0) > 40 || (window.__gkRingLab?.frames ?? 0) > 30;
    },
    { timeout: 240_000 },
  );
  return page;
}

async function measure(page, kinds, limits) {
  await page.evaluate(LIB);
  return page.evaluate(
    async (kinds, limits) => {
      const F = window.__fv8;
      const people = F.people();
      const probe = window.__gkProbe?.scene ? window.__gkProbe : window.__gkRingLab;
      const r = { people: people.length, generation: probe?.generation ?? null, v8Requested: probe?.v8Requested ?? null };
      if (kinds.includes("perf")) {
        r.fps = await F.fps(3000);
        r.calls = probe.calls;
        r.tris = probe.tris;
        if (people[0]) {
          r.textureMB = F.textures(people[0]).mb;
          r.textures = F.textures(people[0]).list;
          const iso = F.perFighter(people[0]);
          r.fighterCalls = iso?.calls ?? null;
          r.fighterTris = iso?.tris ?? null;
        }
      }
      if (kinds.includes("cavity")) r.cavity = F.cavity(people);
      if (kinds.includes("joints")) r.joints = people.map((p) => F.joints(p, limits));
      if (kinds.includes("garments"))
        r.garments = people.map((p) => {
          const m = window.__humanAssess.measure(p);
          return m.garments?.penetration ? { fraction: m.garments.penetration.fraction, worstMm: m.garments.penetration.worstMm, bySlot: m.garments.penetration.bySlot } : null;
        });
      return r;
    },
    kinds,
    limits,
  );
}

async function feet(page, seconds) {
  await page.evaluate(LIB);
  return page.evaluate(async (s) => {
    const ps = window.__fv8.people();
    const out = [];
    for (const p of ps.slice(0, 2)) out.push(await window.__fv8.feet(p, s));
    return out;
  }, seconds);
}

function glbFor(gen, g) {
  const dir = join(ROOT, "apps/web/public/assets/characters");
  return gen === "v8" ? join(dir, "v8", `boxer-${g}.glb`) : gen === "v6" ? join(dir, `boxer-${g}-v6.glb`) : gen === "v5" ? join(dir, `boxer-${g}-v5.glb`) : join(dir, `boxer-${g}.glb`);
}

/** one phase: every shot, its raw PNG and its metrics → { shots, feet, generation } */
async function runPhase(browser, phase) {
  const dir = join(RAW, phase);
  mkdirSync(dir, { recursive: true });
  const res = { shots: {}, feet: {}, generation: null, v8Requested: null };
  for (const s of SHOTS) {
    if (ONLY && !ONLY.has(s.group)) continue;
    if (QUICK && !QUICK_IDS.has(s.id)) continue;
    for (const vp of QUICK ? ["desktop"] : s.vps) {
      const t0 = Date.now();
      let page;
      try {
        page = await open(browser, withPhase(s.path, phase), vp, s.size);
        await sleep(s.wait);
        const file = join(dir, `${s.id}-${vp}.png`);
        await page.screenshot({ path: file });
        const m = await measure(page, s.measure ?? [], ACCEPT.jointLimits);
        res.generation ??= m.generation;
        res.v8Requested ??= m.v8Requested;
        (res.shots[s.id] ??= {})[vp] = m;
        console.log(`${phase} ${s.id} ${vp} ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify({ people: m.people, fps: m.fps, calls: m.calls, cav: m.cavity && [m.cavity.skinBackShare, m.cavity.garmentBackShare], jv: m.joints?.reduce((n, j) => n + j.violations, 0), gin: m.garments?.map((g) => g?.fraction) }));
      } catch (e) {
        console.error(`${phase} ${s.id} ${vp} FAILED`, e.message);
        (res.shots[s.id] ??= {})[vp] = { error: e.message };
      } finally {
        await page?.close();
      }
    }
  }
  if (!ONLY || ONLY.has("feet"))
    for (const f of QUICK ? FEET.slice(0, 1) : FEET) {
      let page;
      try {
        page = await open(browser, withPhase(f.path, phase), "desktop");
        await sleep(800);
        res.feet[f.id] = await feet(page, QUICK ? 3 : f.seconds);
        console.log(`${phase} feet ${f.id}`, JSON.stringify(res.feet[f.id].map((x) => [x.maxSlideCm, x.slideCmPerS])));
      } catch (e) {
        console.error(`${phase} feet ${f.id} FAILED`, e.message);
      } finally {
        await page?.close();
      }
    }
  return res;
}

/** the scored metrics object of a phase (the paths acceptance.json names) */
export function aggregate(phase, r) {
  const gen = r.generation ?? (phase === "v8" ? "v8?" : phase);
  const m = { generation: { requested: phase, loaded: r.generation, v8Requested: r.v8Requested }, perf: {}, proportions: {}, triangles: {}, garments: { byPose: {} }, cavity: { skinBack: { byShot: {} }, garmentBack: { byShot: {} } }, joints: { violations: 0, byShot: {}, list: [] }, feet: {} };
  for (const g of ["m", "f"]) {
    const file = glbFor(gen, g);
    if (!existsSync(file)) continue;
    const glb = readBoxerGlb(file);
    m.proportions[g] = measureGlb(glb);
    m.triangles[g] = fighterTriangles(glb).total;
    m.triangles[`${g}ByMesh`] = fighterTriangles(glb).byMesh;
  }
  for (const vp of ["desktop", "phone"]) {
    const b = r.shots.broadcast?.[vp];
    if (b && !b.error) m.perf[vp] = { fps: b.fps, calls: b.calls, tris: b.tris, textureMB: b.textureMB, fighterCalls: b.fighterCalls, fighterTris: b.fighterTris, textures: b.textures };
  }
  const gw = [],
    cs = [],
    cg = [];
  for (const [id, byVp] of Object.entries(r.shots)) {
    const d = byVp.desktop;
    if (!d || d.error) continue;
    if (d.garments?.length) {
      const w = Math.max(...d.garments.map((g) => g?.fraction ?? 0));
      m.garments.byPose[id] = w;
      gw.push(w);
    }
    if (d.cavity) {
      m.cavity.skinBack.byShot[id] = d.cavity.skinBackShare;
      m.cavity.garmentBack.byShot[id] = d.cavity.garmentBackShare;
      cs.push(d.cavity.skinBackShare);
      cg.push(d.cavity.garmentBackShare);
    }
    for (const [vp, x] of Object.entries(byVp))
      if (x?.joints) {
        const v = x.joints.reduce((n, j) => n + j.violations, 0);
        m.joints.byShot[`${id}-${vp}`] = v;
        m.joints.violations += v;
        for (const [k, j] of x.joints.entries()) for (const c of j.checks) if (!c.ok && m.joints.list.length < 40) m.joints.list.push({ shot: id, vp, person: k, ...c });
      }
  }
  m.garments.worst = gw.length ? Math.max(...gw) : null;
  m.garments.summary = summary(gw);
  m.cavity.skinBack.worst = cs.length ? Math.max(...cs) : null;
  m.cavity.garmentBack.worst = cg.length ? Math.max(...cg) : null;
  m.cavity.garmentBack.broadcast = r.shots.broadcast?.desktop?.cavity?.garmentBackShare ?? null;
  m.cavity.skinBack.broadcast = r.shots.broadcast?.desktop?.cavity?.skinBackShare ?? null;
  const fs = Object.values(r.feet).flat();
  if (fs.length) {
    m.feet.maxSlideCm = Math.max(...fs.map((f) => f.maxSlideCm));
    m.feet.slideCmPerS = Math.max(...fs.map((f) => f.slideCmPerS));
    m.feet.byJob = r.feet;
  }
  return m;
}

/* ---------------- contact sheets ---------------- */
function sheets(phases, rawOf, outDir) {
  mkdirSync(join(outDir, "sheets"), { recursive: true });
  const tmp = join(RAW, "_pairs");
  mkdirSync(tmp, { recursive: true });
  const written = [];
  for (const group of [...new Set(SHOTS.map((s) => s.group))]) {
    if (ONLY && !ONLY.has(group)) continue;
    const pairs = [];
    for (const s of SHOTS.filter((x) => x.group === group))
      for (const vp of QUICK ? ["desktop"] : s.vps) {
        const files = phases.map((p) => [p, join(rawOf(p), `${s.id}-${vp}.png`)]).filter(([, f]) => existsSync(f));
        if (!files.length) continue;
        const pair = join(tmp, `${group}-${s.id}-${vp}.png`);
        const w = vp === "phone" ? 560 : s.size ? Math.round(s.size[0] * 0.75) : 640;
        execFileSync("magick", ["montage", ...files.flatMap(([p, f]) => ["-label", p, f]), "-tile", `${files.length}x`, "-geometry", `${w}x+3+3`, "-pointsize", "15", "-fill", "#ddd", "-background", "#151515", pair]);
        execFileSync("magick", [pair, "-gravity", "North", "-background", "#151515", "-fill", "#eee", "-pointsize", "18", "-splice", "0x26", "-annotate", "+0+4", `${s.label} (${vp}) — ${files.map(([p]) => p).join(" | ")}`, pair]);
        pairs.push(pair);
      }
    if (!pairs.length) continue;
    const file = join(outDir, "sheets", `${group}.jpg`);
    execFileSync("magick", ["montage", ...pairs, "-tile", `${Math.min(GROUP_COLS[group] ?? 2, pairs.length)}x`, "-geometry", "+4+4", "-background", "#0d0d0d", "-quality", "80", file]);
    written.push(file);
    console.log("sheet", file);
  }
  return written;
}

/* ---------------- report ---------------- */
const fmt = (v) => (v === null || v === undefined ? "–" : typeof v === "number" ? String(+v.toFixed(4)) : String(v));
function reportMd(byPhase, scores, sheetFiles) {
  const ph = Object.keys(byPhase);
  const last = ph[ph.length - 1];
  const sc = scores[last];
  const lines = [
    `# Fighter v8 harness report`,
    ``,
    `Run \`${LABEL}\`, ${new Date().toISOString()}, web ${WEB}, git ${git()}. Phases: ${ph.map((p) => `${p} (loaded ${byPhase[p].generation.loaded ?? "?"})`).join(", ")}.`,
    `Scored phase: **${last}** — ${sc.pass} pass, ${sc.fail} fail, ${sc.unset} unset (the design's checklist sets them), ${sc.missing} missing.`,
    ``,
    `| Item | Threshold | ${ph.join(" | ")} | Status (${last}) |`,
    `| --- | --- | ${ph.map(() => "---").join(" | ")} | --- |`,
  ];
  for (const it of sc.items) {
    const th = it.equals !== undefined ? `= ${it.equals}` : it.min !== null && it.max !== null ? `${it.min} … ${it.max}` : it.min !== null ? `≥ ${it.min}` : it.max !== null ? `≤ ${it.max}` : "unset";
    const vals = ph.map((p) => fmt(scores[p].items.find((x) => x.id === it.id)?.value));
    lines.push(`| ${it.label} | ${th} | ${vals.join(" | ")} | ${it.status} |`);
  }
  lines.push("", "## Joint-limit violations (first 40)", "");
  for (const p of ph) {
    const l = byPhase[p].joints.list;
    lines.push(`- ${p}: ${byPhase[p].joints.violations}${l.length ? " — " + l.map((v) => `${v.shot}/${v.vp} #${v.person} ${v.joint} ${v.value} > ${v.limit}`).join("; ") : ""}`);
  }
  lines.push("", "## Sheets", "", ...sheetFiles.map((f) => `- ${f.replace(ROOT + "/", "")}`), "");
  return lines.join("\n");
}
function git() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return "?";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600_000, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
  const raw = {};
  try {
    for (const p of PHASES) raw[p] = await runPhase(browser, p);
  } finally {
    await browser.close();
  }
  const byPhase = Object.fromEntries(Object.entries(raw).map(([p, r]) => [p, aggregate(p, r)]));
  const scores = Object.fromEntries(Object.entries(byPhase).map(([p, m]) => [p, score(m, ACCEPT)]));
  const sheetFiles = sheets(COMPARE ? [`${COMPARE}`, PHASES[PHASES.length - 1]] : PHASES, (p) => (COMPARE && p === COMPARE ? join(resolve(RAW, "..", COMPARE), PHASES[PHASES.length - 1]) : join(RAW, p)), OUT);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ label: LABEL, web: WEB, git: git(), at: new Date().toISOString(), phases: byPhase, raw, scores }, null, 1));
  writeFileSync(join(OUT, "report.md"), reportMd(byPhase, scores, sheetFiles));
  const last = scores[PHASES[PHASES.length - 1]];
  console.log(`\nscore (${PHASES[PHASES.length - 1]}): ${last.pass} pass, ${last.fail} fail, ${last.unset} unset, ${last.missing} missing → ${join(OUT, "report.md")}`);
  for (const it of last.items) if (it.status === "fail" || it.status === "missing") console.log(`  ${it.status.toUpperCase()} ${it.id}: ${fmt(it.value)} (${it.label})`);
}
