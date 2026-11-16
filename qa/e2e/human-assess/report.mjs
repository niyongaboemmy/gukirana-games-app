// QA-HUM-01 realism report: automatic scores from metrics.json (assess.mjs) + the reviewer's visual scores
// (scores.json in the same folder) → realism-report.json and a markdown table on stdout.
//   node qa/e2e/human-assess/report.mjs <round folder>
// scores.json: { "<subject>": { "<criterion id>": [score 0–5, "reason"] } } — subjects: plaza, boxer, ring, fpv
// Rubric: docs/HUMAN-REALISM-RUBRIC.md (a criterion's score = min(auto, visual); pass bar 4).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: report.mjs <round folder>");
const M = JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8")).sections;
const V = existsSync(join(dir, "scores.json"))
  ? JSON.parse(readFileSync(join(dir, "scores.json"), "utf8"))
  : {};
const PASS = 4;
export const CRITERIA = [
  ["proportions", "Proportions"],
  ["face", "Face"],
  ["eyes", "Eyes"],
  ["skin", "Skin"],
  ["hair", "Hair"],
  ["hands", "Hands and fingers"],
  ["clothing", "Clothing"],
  ["motion", "Motion"],
  ["expressions", "Expressions"],
  ["lighting", "Lighting response"],
  ["lod", "LOD transitions"],
  ["perf", "Performance"],
  ["fpv", "First-person view"],
];
// joint-centre segment lengths / stature (de Leva 1996, adjusting Zatsiorsky–Seluyanov; male, female within 3 %)
const REF = { upperArm: 0.162, forearm: 0.154, thigh: 0.243, shank: 0.249 };

function proportions(list) {
  const ms = list.filter((m) => m?.proportions?.headRatio);
  if (!ms.length) return null;
  let score = 5;
  const notes = [];
  for (const m of ms) {
    const p = m.proportions;
    const dev = Math.max(...Object.entries(REF).map(([k, r]) => Math.abs((p[`${k}L`] ?? r) / r - 1)));
    const hr = p.headRatio;
    const s =
      hr >= 7.2 && hr <= 7.9 && dev <= 0.1
        ? 5
        : hr >= 7.0 && hr <= 8.0 && dev <= 0.15
          ? 4
          : hr >= 6.5 && hr <= 8.3 && dev <= 0.22
            ? 3
            : 2;
    score = Math.min(score, s);
    notes.push(`${hr} heads, worst segment ${(dev * 100).toFixed(0)} % off`);
  }
  return [score, notes.join("; ")];
}
function hands(list) {
  const ms = list.filter((m) => m?.hands);
  if (!ms.length) return null;
  const ok = ms.every((m) =>
    ["L", "R"].every((s) => m.hands[s]?.fingers === 5 && m.hands[s].segments.every((x) => x >= 3)),
  );
  return [ok ? 5 : 1, ok ? "5 fingers × 3 segments on both hands" : JSON.stringify(ms.map((m) => m.hands))];
}
/** `skip`: material slots left out (the bind pose's open hands under the fist-shaped gloves / wraps: 8, 9, 10, 13) */
function clothing(list, skip = []) {
  const ms = list.filter((m) => m?.garments);
  if (!ms.length) return null;
  let score = 5;
  const notes = [];
  for (const m of ms) {
    const g = m.garments;
    if (!g.separateGeometry) {
      score = Math.min(score, 2);
      notes.push("clothes are the body surface (no separate garments)");
      continue;
    }
    const pen0 = g.penetration ?? { fraction: 0, worstMm: 0 };
    let pen = pen0;
    if (skip.length && pen0.bySlot) {
      const out = skip.reduce((a, k) => a + (pen0.bySlot[k] ?? 0), 0);
      pen = {
        ...pen0,
        fraction: pen0.tested ? (pen0.inside - out) / pen0.tested : 0,
        worstMm: out ? `≤ ${pen0.worstMm}` : pen0.worstMm,
      };
    }
    const s =
      pen.fraction < 0.005 && (typeof pen.worstMm !== "number" || pen.worstMm <= 5)
        ? 5
        : pen.fraction < 0.015
          ? 4
          : pen.fraction < 0.04
            ? 3
            : 2;
    score = Math.min(score, s);
    notes.push(`inside ${(pen.fraction * 100).toFixed(2)} %, worst ${pen.worstMm} mm`);
  }
  return [score, notes.join("; ")];
}
/** in a live pose (the guard: arms against the chest) the bar is twice as loose as at rest */
function clothingPose(list) {
  const ms = list.filter((m) => m?.garments?.penetration);
  if (!ms.length) return null;
  const f = Math.max(...ms.map((m) => m.garments.penetration.fraction));
  return [
    f < 0.01 ? 5 : f < 0.03 ? 4 : f < 0.08 ? 3 : 2,
    `in the pose: worst ${(f * 100).toFixed(1)} % of garment vertices inside`,
  ];
}
const both = (a, b) => (a && b ? [Math.min(a[0], b[0]), `rest: ${a[1]}; ${b[1]}`] : (a ?? b));
function motion(walks, idles) {
  const w = walks.filter((x) => x?.footSlide);
  if (!w.length) return null;
  const mean = Math.max(...w.map((x) => x.footSlide.meanCm)),
    max = Math.max(...w.map((x) => x.footSlide.maxCm));
  let s = mean <= 1.0 && max <= 2 ? 5 : mean <= 1.5 && max <= 3 ? 4 : mean <= 3 && max <= 6 ? 3 : 2;
  const snap = Math.max(...[...w, ...idles].filter(Boolean).map((x) => x.worstSnap?.deg ?? 0));
  const idle = idles.filter(Boolean);
  const sway = idle.map((x) => x.headSwayMm ?? 0),
    arm = idle.map((x) => x.armFromDownDeg ?? 0);
  if (snap >= 15) s = Math.min(s, 3);
  if (sway.some((x) => x < 2 || x > 30)) s = Math.min(s, 3);
  if (arm.some((x) => x > 35)) s = Math.min(s, 2);
  return [
    s,
    `foot slide worst mean ${mean} cm / max ${max} cm per step; snap ${snap}°/frame; idle sway ${sway.join("/")} mm; arms ${arm.join("/")}° from vertical`,
  ];
}
function eyes(idles) {
  const i = idles.filter((x) => x?.blinks);
  if (!i.length) return null;
  const s = Math.min(
    ...i.map((x) => {
      const b = x.blinks.perMin >= 8 && x.blinks.perMin <= 21;
      const c = x.saccades.perMin >= 10 && x.saccades.maxEyeDeg > 3;
      return b && c ? 5 : b || c ? 3 : 1;
    }),
  );
  return [
    s,
    i
      .map(
        (x) =>
          `${x.blinks.perMin} blinks/min, ${x.saccades.perMin} saccades/min (range ${x.saccades.maxEyeDeg}°)`,
      )
      .join("; "),
  ];
}
function skin(faceMaps) {
  const all = Object.entries(faceMaps).filter(([, v]) => v && v.lRatio !== undefined);
  if (!all.length) return null;
  const fails = [];
  for (const [k, v] of all) {
    const night = /night/.test(k);
    if (v.refRatio !== undefined) {
      // against the matte reference sphere in the skin's own albedo, same light and camera (exposure-independent)
      if (v.refRatio < (night ? 0.6 : 0.75) || v.refRatio > 1.35)
        fails.push(`${k} skin/reference L ${v.refRatio}`);
      if (v.refChromaRatio < 0.65) fails.push(`${k} skin/reference chroma ${v.refChromaRatio}`);
    } else {
      if (!night && (v.lRatio < 0.8 || v.lRatio > 1.5)) fails.push(`${k} L ratio ${v.lRatio}`);
      if (!night && v.chromaRatio < 0.65) fails.push(`${k} chroma ratio ${v.chromaRatio}`);
    }
    if (v.blown > 2) fails.push(`${k} blown ${v.blown} %`);
    if (night && v.L < 4) fails.push(`${k} night L ${v.L}`);
  }
  // a share of the patches, not a count (the matrix has 48)
  const share = fails.length / all.length;
  const s = fails.length === 0 ? 5 : share <= 0.05 ? 4 : share <= 0.2 ? 3 : 2;
  return [
    s,
    fails.length
      ? `${fails.length} of ${all.length} patches off: ${fails.slice(0, 6).join(", ")}${fails.length > 6 ? " …" : ""}`
      : `all ${all.length} patches in range`,
  ];
}
function lod(l) {
  if (!l?.switches) return null;
  if (!l.switches.length) return [5, "no switch in 3–40 m"];
  const pop = Math.max(...l.switches.map((s) => s.pop ?? 0));
  return [
    pop <= 0.5 ? 5 : pop <= 1.5 ? 4 : pop <= 3 ? 3 : 2,
    l.switches
      .map(
        (s) => `${s.from}→${s.to} m: ${s.trisBefore}→${s.trisAfter} tris at ${s.personPx} px, pop ${s.pop}`,
      )
      .join("; "),
  ];
}
function perf(list) {
  const ms = list.filter((m) => m?.tris);
  if (!ms.length) return null;
  const tris = Math.max(...ms.map((m) => m.isolated?.tris || m.tris)),
    calls = Math.max(...ms.map((m) => m.isolated?.calls ?? 0)),
    tex = Math.max(...ms.map((m) => m.textureMB ?? 0));
  const s = tris <= 60000 && calls <= 4 && tex <= 32 ? 5 : tris <= 80000 && calls <= 8 && tex <= 48 ? 4 : 3;
  return [s, `≤ ${tris} tris, ≤ ${calls} calls (incl. shadow), ≤ ${tex} MB textures per person`];
}

function fpv(f) {
  const fr = Object.entries(f?.intrusion ?? {}).filter(([, v]) => v);
  if (!fr.length) return null;
  // own headgear / vest / eyes / teeth / hair at the lens = broken; skin in the guard frame = my own face / shoulders
  const BAD = new Set(["slot1", "slot2", "slot11", "slot12", "slot19", "slot20", "slot21", "slot22"]);
  // (looking down at my own chest the vest is meant to be close)
  const bad = fr.filter(([k, v]) =>
    Object.keys(v.bySlot).some(
      (s) => BAD.has(s) && !(/look-down/.test(k) && (s === "slot1" || s === "slot2")),
    ),
  );
  const guard = fr.filter(([k, v]) => /guard/.test(k) && v.inView > 0);
  const s = bad.length ? 2 : guard.length ? 3 : 4;
  return [
    s,
    `${bad.length} of ${fr.length} frames with my own kit / face within 20 cm of the lens${bad.length ? ` (${bad.map(([k]) => k).join(", ")})` : ""}; guard frames with own body at the lens: ${guard.length}`,
  ];
}

const lab = M.lab ?? {},
  boxer = M.boxer ?? {},
  world = M.world ?? {},
  hall = M.hall ?? {},
  matrix = M.matrix ?? {};
const auto = {
  plaza: {
    proportions: proportions(Object.values(lab.measure ?? {})),
    hands: hands(Object.values(lab.measure ?? {})),
    clothing: clothing(Object.values(lab.measure ?? {})),
    motion: motion([...Object.values(lab.walk ?? {}), world.walk], Object.values(lab.idle ?? {})),
    eyes: eyes(Object.values(lab.idle ?? {})),
    skin: skin({ ...(lab.face ?? {}), ...(matrix.face ?? {}) }),
    lod: lod(M.lod),
    perf: perf([...Object.values(lab.measure ?? {}), world.self]),
  },
  boxer: {
    proportions: proportions(Object.values(boxer.bind ?? {}).flat()),
    hands: hands(Object.values(boxer.bind ?? {}).flat()),
    clothing: both(
      clothing(Object.values(boxer.bind ?? {}).flat(), [8, 9, 10, 13]),
      clothingPose(Object.values(boxer.measure ?? {}).flat()),
    ),
    perf: perf(Object.values(boxer.measure ?? {}).flat()),
  },
  fpv: { fpv: fpv(M.fpv) },
  ring: {
    clothing: clothingPose(hall.measure ?? []),
    hands: hands(hall.measure ?? []),
    perf: perf(hall.measure ?? []),
  },
};
const report = { at: new Date().toISOString(), pass: PASS, subjects: {} };
const lines = [];
for (const subj of Object.keys({ ...auto, ...V })) {
  const rows = [];
  for (const [id, label] of CRITERIA) {
    const a = auto[subj]?.[id] ?? null,
      v = V[subj]?.[id] ?? null;
    if (!a && !v) continue;
    const score = Math.min(a ? a[0] : 5, v ? v[0] : 5);
    rows.push({
      id,
      label,
      auto: a?.[0] ?? null,
      visual: v?.[0] ?? null,
      score,
      pass: score >= PASS,
      autoNote: a?.[1] ?? "",
      visualNote: v?.[1] ?? "",
    });
  }
  report.subjects[subj] = rows;
  lines.push(
    `\n### ${subj}\n\n| Criterion | Auto | Visual | Score | Pass | Evidence |\n| --- | --- | --- | --- | --- | --- |`,
  );
  for (const r of rows)
    lines.push(
      `| ${r.label} | ${r.auto ?? "–"} | ${r.visual ?? "–"} | **${r.score}** | ${r.pass ? "yes" : "no"} | ${[r.autoNote, r.visualNote].filter(Boolean).join(" — ").replace(/\|/g, "/")} |`,
    );
}
writeFileSync(join(dir, "realism-report.json"), JSON.stringify(report, null, 1));
console.log(lines.join("\n"));
