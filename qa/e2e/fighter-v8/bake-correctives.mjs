#!/usr/bin/env node
// P3-FGT-19B: bake the v8 garments' pose correctives (apps/web/src/world/human/boxer/corrective.ts) on the game's own
// rig, in the browser (the boxing lab, correctives off): candidate frames of the boxing clips are posed, the states
// picked by farthest-point sampling over the limbs' joint rotations, and at each state the singlet / trunks are pushed
// clear of the drawn skin (inpage-checks.js bakeState). Output: apps/web/scripts/boxer/corr-v8/boxer-{m,f}.json, which
// the next `V8=1 build.mjs` carries into the GLB's extras while the garment meshes still match.
//
//   node qa/e2e/fighter-v8/bake-correctives.mjs --web http://localhost:3971 [--genders m,f] [--max 56] [--steps 10]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", "http://localhost:3971");
const GENDERS = arg("genders", "m,f").split(",");
const MAX = +arg("max", 128);
const STEPS = +arg("steps", 14);
const GAP = +arg("gap", 0.007);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** the clips a fighter plays in a bout (stance, footwork, punches, defence, reactions, the clinch) */
const CLIPS = ["guard", "guardIdle", "stepForward", "stepBack", "jab", "cross", "leadHook", "rearHook", "leadUppercut", "rearUppercut", "leadBody", "rearBody", "blockHigh", "blockLow", "slipLeft", "slipRight", "duck", "hitHeadLight", "hitHeadHeavy", "hitBodyLight", "hitBodyHeavy", "stagger", "knockdown", "clinch", "touchGloves"];
const OUT = join(HERE, "../../../apps/web/scripts/boxer/corr-v8");

const src = readFileSync(join(HERE, "metrics.mjs"), "utf8");
const names = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
const LIB = [readFileSync(join(HERE, "../human-assess/inpage.js"), "utf8"), `(()=>{${src.replace(/^export /gm, "")}\nwindow.__fv8m={${names}};})();`, readFileSync(join(HERE, "inpage.js"), "utf8"), readFileSync(join(HERE, "inpage-checks.js"), "utf8")].join("\n;\n");

const ang = (a, b) => {
  let d = 0;
  for (let k = 0; k < a.length; k += 4) {
    const c = Math.min(1, Math.abs(a[k] * b[k] + a[k + 1] * b[k + 1] + a[k + 2] * b[k + 2] + a[k + 3] * b[k + 3]));
    d += (2 * Math.acos(c)) ** 2;
  }
  return Math.sqrt(d);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 1800000, args: ["--use-angle=metal"] });
mkdirSync(OUT, { recursive: true });
for (const g of GENDERS) {
  const t0 = Date.now();
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 500 });
  await page.goto(`${WEB}/play/boxing-lab?mode=boxer&gender=${g}&clip=guard&at=0.5&cam=full&boxer=v8&corr=0`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForFunction(() => window.__gkBoxer?.ready && (window.__gkProbe?.frames ?? 0) > 30, { timeout: 300000 });
  await page.evaluate(LIB);
  // candidate frames and their features
  const cands = await page.evaluate(
    (clips, steps) => {
      const B = window.__gkBoxer;
      const person = window.__fv8.people()[0];
      const out = [];
      for (const clip of clips) {
        const info = B.clips[clip];
        if (!info) continue;
        // (the hooks' arc is fast — the lead arm turns ~1 rad between two of these steps — so 0.08–0.22 s is also
        // sampled every 10 ms)
        const ts = [];
        for (let k = 0; k <= steps; k++) ts.push((info.duration * k) / steps);
        if (clip === "leadHook" || clip === "rearHook") for (let t = 0.08; t <= 0.2201; t += 0.01) ts.push(+t.toFixed(3));
        for (const t of ts) {
          B.probe.poseNow(B.sampleClip(clip, t));
          out.push({ clip, t, id: `${clip}@${t.toFixed(3)}`, f: window.__fv8c.corrFeats(person) });
        }
      }
      return out;
    },
    CLIPS,
    STEPS,
  );
  // farthest-point sampling, from the guard — one library for the arms (the singlet's rows) and one for the legs (the
  // trunks' rows): a texture column is an arm state for a singlet row and a leg state for a trunks row
  const fps = (limbs) => {
    const d = (a, b) => Math.max(...limbs.map((l) => ang(a.f[l], b.f[l])));
    const pick = [cands.find((c) => c.clip === "guard") ?? cands[0]];
    const dmin = cands.map((c) => d(c, pick[0]));
    while (pick.length < MAX) {
      let bi = -1,
        bd = 0.05;
      dmin.forEach((x, i) => x > bd && ((bd = x), (bi = i)));
      if (bi < 0) break;
      pick.push(cands[bi]);
      cands.forEach((c, i) => (dmin[i] = Math.min(dmin[i], d(c, cands[bi]))));
    }
    return { pick, cover: Math.max(...dmin) };
  };
  const arm = fps(["armL", "armR"]),
    leg = fps(["legL", "legR"]);
  console.log(`${g}: ${cands.length} candidate frames; arm states ${arm.pick.length} (cover ${arm.cover.toFixed(3)} rad), leg states ${leg.pick.length} (cover ${leg.cover.toFixed(3)} rad)`);
  const info = await page.evaluate(() => window.__fv8c.corrInfo(window.__fv8.people()[0]));
  const byId = new Map();
  for (const st of [...arm.pick, ...leg.pick]) {
    if (byId.has(st.id)) continue;
    const r = await page.evaluate(
      (clip, t, gap) => {
        const B = window.__gkBoxer;
        B.probe.poseNow(B.sampleClip(clip, t));
        return window.__fv8c.bakeState(window.__fv8.people()[0], { gap, rounds: 4, final: 4 });
      },
      st.clip,
      st.t,
      GAP,
    );
    byId.set(st.id, { ...st, ...r });
    console.log(`  ${st.id.padEnd(22)} inside ${r.before.inside}/${r.before.tested} → ${r.after.inside}   push ≤ ${r.maxMm} mm, ${r.deltas.length} vertices`);
  }
  // rows: every vertex its library's states move; each row's part, local index and left share
  const partOf = (i) => {
    for (const [name, [off, n]] of Object.entries(info.parts)) if (i >= off && i < off + n) return [name, i - off];
    return null;
  };
  const posX = await page.evaluate(() => {
    const m = window.__fv8.people()[0].meshes.find((x) => x.geometry.attributes._mat);
    return Array.from(m.geometry.attributes.position.array.filter((_, k) => k % 3 === 0));
  });
  const libOf = (i) => (partOf(i)?.[0] === "kit_trunks" ? leg.pick : arm.pick);
  const set = new Map();
  for (const [lib, want] of [
    [arm.pick, "kit_vest"],
    [leg.pick, "kit_trunks"],
  ])
    for (const st of lib) for (const [i] of byId.get(st.id).deltas) if (partOf(i)?.[0] === want && !set.has(i)) set.set(i, set.size);
  const rows = [...set.keys()].map((i) => {
    const [part, local] = partOf(i);
    const left = Math.max(0, Math.min(1, 0.5 + (info.leftX * posX[i]) / 0.08));
    return [part, local, Math.round(left * 255), info.mask[i] ?? 255];
  });
  const S = Math.max(arm.pick.length, leg.pick.length),
    R = rows.length,
    SCALE = 0.0001;
  const d16 = new Int16Array(R * S * 3);
  for (const lib of [arm.pick, leg.pick])
    lib.forEach((st, s) => {
      for (const [i, x, y, z] of byId.get(st.id).deltas) {
        const r = set.get(i);
        if (r === undefined || libOf(i) !== lib) continue;
        d16[(r * S + s) * 3] = Math.max(-32767, Math.min(32767, Math.round(x / SCALE)));
        d16[(r * S + s) * 3 + 1] = Math.max(-32767, Math.min(32767, Math.round(y / SCALE)));
        d16[(r * S + s) * 3 + 2] = Math.max(-32767, Math.min(32767, Math.round(z / SCALE)));
      }
    });
  const parts = Object.fromEntries(["kit_vest", "kit_trunks"].map((n) => [n, info.parts[n][1]]));
  const lib = (pick) => pick.map((b) => ({ id: b.id, f: b.f }));
  const data = { version: 2, parts, bones: info.bones, scale: SCALE, n: S, rows, armStates: lib(arm.pick), legStates: lib(leg.pick), delta: Buffer.from(d16.buffer).toString("base64") };
  writeFileSync(join(OUT, `boxer-${g}.json`), JSON.stringify(data));
  console.log(`${g}: ${R} rows × ${S} states → ${(JSON.stringify(data).length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.close();
}
await browser.close();
