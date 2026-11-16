// Boxing v7 evidence (P3-FGT-18, docs/FIGHT-REALISM-V7.md): the art-director pass on the ring people, BEFORE (the
// P3-FGT-17 people: a dev server started with NEXT_PUBLIC_FF_BOXER_V7=0) beside AFTER (the flag on), shot by shot.
// The flag changes the bodies, shading, ring lighting and guard together, so the two halves come from two runs:
//   NEXT_PUBLIC_FF_BOXER_V7=0 next dev …  →  node qa/e2e/boxing-v7-sheet.mjs <outDir> shoot before [group,…]
//   (flag on)                 next dev …  →  node qa/e2e/boxing-v7-sheet.mjs <outDir> shoot after  [group,…]
//                                         →  node qa/e2e/boxing-v7-sheet.mjs <outDir> sheet [label] [group,…]
// `sheet` montages raw/<label-a>/ beside raw/<label-b>/ (default before | after; `sheet roundN` puts after beside
// raw/roundN to compare iteration rounds). QA_WEB defaults to http://localhost:3962. Groups: broadcast (the user's
// view: the fight lab's practice ring, side camera, desktop 1280×720 and phone 844×390), duel (two-fighter lab under
// the ring rig: side / close / front), closeups (studio light), base (MakeHuman boxer vs the Rocketbox body in guard).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3962";
const [out, cmd, label = "after", groupsArg] = process.argv.slice(2);
const only = (cmd === "sheet" ? groupsArg : groupsArg)?.split(",");
const DUEL = "body=boxer&headgear=1&red=feminine&blue=feminine&rtone=5&btone=1&light=ring";
const DUEL_M = "body=boxer&headgear=1&red=masculine&blue=masculine&rtone=9&btone=1&light=ring";
const LAB = "mode=boxer&clip=guard&at=0.5";
const FIGHT = "/fight-lab?scene=1&auto=1&level=1&rounds=3&secs=60&name=Aline";

/** group → { size [w, h, dpr], cols, shots: [name, label, path, waitMs] } */
const GROUPS = {
  broadcast: {
    cols: 2,
    shots: [
      ["fight-desktop-a", "practice ring, side camera, 1280×720 (round 1)", FIGHT, 9000, [1280, 720, 1]],
      ["fight-desktop-b", "practice ring, side camera, 1280×720 (a few seconds on)", FIGHT, 14000, [1280, 720, 1]],
      ["fight-phone-a", "practice ring, side camera, 844×390 DPR 2", FIGHT, 9000, [844, 390, 2]],
      ["fight-phone-b", "practice ring, side camera, 844×390 DPR 2 (later)", FIGHT, 14000, [844, 390, 2]],
    ],
  },
  duel: {
    cols: 2,
    shots: [
      ["duel-guard-side", "guard, side camera (f / f)", `/play/boxing-lab?${DUEL}&clip=guard&at=0.5&cam=side&gap=1.1`, 900, [1280, 720, 1]],
      ["duel-jab-side", "jab at impact, side camera", `/play/boxing-lab?${DUEL}&clip=jab&at=impact&cam=side&gap=1.1`, 900, [1280, 720, 1]],
      ["duel-hook-side", "lead hook at impact, side camera", `/play/boxing-lab?${DUEL}&clip=leadHook&at=impact&cam=side&gap=0.9`, 900, [1280, 720, 1]],
      ["duel-clinch-side", "clinch with the referee, side camera", `/play/boxing-lab?${DUEL}&clip=clinch&at=1.7&cam=side`, 900, [1280, 720, 1]],
      ["duel-guard-close", "guard, close camera", `/play/boxing-lab?${DUEL}&clip=guard&at=0.5&cam=close&gap=1.1`, 900, [1280, 720, 1]],
      ["duel-m-guard-close", "guard, close camera (m / m)", `/play/boxing-lab?${DUEL_M}&clip=guard&at=0.5&cam=close&gap=1.1`, 900, [1280, 720, 1]],
      ["duel-guard-phone", "guard, side camera, 844×390 DPR 2", `/play/boxing-lab?${DUEL}&clip=guard&at=0.5&cam=side&gap=1.1`, 900, [844, 390, 2]],
      ["duel-jab-front", "jab at impact, front camera", `/play/boxing-lab?${DUEL}&clip=jab&at=impact&cam=front&gap=1.1`, 900, [1280, 720, 1]],
    ],
  },
  closeups: {
    cols: 4,
    shots: [
      ["cu-body-side-f", "f side, guard", `/play/boxing-lab?${LAB}&gender=f&tone=5&cam=full&az=-90&dist=3.0`, 700, [560, 760, 1]],
      ["cu-body-34-m", "m 3/4, guard", `/play/boxing-lab?${LAB}&gender=m&tone=1&cam=full&az=30&dist=3.0`, 700, [560, 760, 1]],
      ["cu-body-back-f", "f back, guard", `/play/boxing-lab?${LAB}&gender=f&tone=9&cam=full&az=180&dist=3.0`, 700, [560, 760, 1]],
      ["cu-body-front-m", "m front, guard", `/play/boxing-lab?${LAB}&gender=m&tone=5&cam=full&az=0&dist=3.0`, 700, [560, 760, 1]],
      ["cu-shoulder-f", "strap + shoulder (f, guard)", `/play/boxing-lab?${LAB}&gender=f&tone=5&headgear=0&cam=shoulderL`, 600, [600, 600, 1]],
      ["cu-back-f", "shoulder blade / strap from behind (f)", `/play/boxing-lab?${LAB}&gender=f&tone=5&headgear=0&cam=backL&dist=0.7`, 600, [600, 600, 1]],
      ["cu-armhole-m", "arm hole (m, hook)", `/play/boxing-lab?mode=boxer&clip=leadHook&at=impact&gender=m&tone=1&headgear=0&cam=backL&dist=0.55`, 600, [600, 600, 1]],
      ["cu-trunks-f", "trunks + band (f)", `/play/boxing-lab?${LAB}&gender=f&tone=5&cam=full&dist=1.15&az=-35&el=-4`, 600, [600, 600, 1]],
      ["cu-trunks-m", "trunks + band (m)", `/play/boxing-lab?${LAB}&gender=m&tone=9&cam=full&dist=1.15&az=20&el=-4`, 600, [600, 600, 1]],
      ["cu-headgear-34", "headgear 3/4 (m)", `/play/boxing-lab?${LAB}&gender=m&tone=1&cam=face34&dist=0.95`, 600, [600, 600, 1]],
      ["cu-headgear-back", "headgear back: lacing, velcro (f)", `/play/boxing-lab?${LAB}&gender=f&tone=5&cam=face34&dist=0.95&az=175`, 600, [600, 600, 1]],
      ["cu-glove", "gloves (f)", `/play/boxing-lab?${LAB}&gender=f&tone=9&cam=face&dist=0.95&az=40`, 600, [600, 600, 1]],
    ],
  },
  base: {
    cols: 2,
    shots: [
      ["base-makehuman", "MakeHuman CC0 boxer body (current base), guard, side camera", `/play/boxing-lab?${DUEL}&clip=guard&at=0.5&cam=side&gap=1.1`, 900, [1280, 720, 1]],
      ["base-rocketbox", "Rocketbox MIT body (the campus people), same guard, side camera", `/play/boxing-lab?headgear=1&red=feminine&blue=masculine&light=ring&clip=guard&at=0.5&cam=side&gap=1.1`, 1500, [1280, 720, 1]],
      ["base-makehuman-close", "MakeHuman boxer body, close camera", `/play/boxing-lab?${DUEL}&clip=guard&at=0.5&cam=close&gap=1.1`, 900, [1280, 720, 1]],
      ["base-rocketbox-close", "Rocketbox body, close camera", `/play/boxing-lab?headgear=1&red=feminine&blue=masculine&light=ring&clip=guard&at=0.5&cam=close&gap=1.1`, 1500, [1280, 720, 1]],
    ],
  },
};

async function shoot(phase) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
  const perf = [];
  try {
    for (const [group, g] of Object.entries(GROUPS)) {
      if (only && !only.includes(group)) continue;
      const dir = join(out, "raw", phase);
      mkdirSync(dir, { recursive: true });
      for (const [name, , path, wait, [w, h, dpr]] of g.shots) {
        const page = await browser.newPage();
        page.on("pageerror", (e) => console.error("pageerror", name, e.message));
        await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: h < 500, hasTouch: h < 500 });
        await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction(() => (window.__gkProbe?.frames ?? 0) > 40 || (window.__gkRingLab?.frames ?? 0) > 30 || (window.__gkRingLab?.fps ?? 0) > 0, { timeout: 240000 });
        await new Promise((r) => setTimeout(r, wait));
        await page.screenshot({ path: join(dir, `${name}.png`) });
        const p = await page.evaluate(() => {
          const s = window.__gkRingLab ?? window.__gkProbe;
          return s ? { calls: s.calls, tris: s.tris, fps: s.fps ?? null } : null;
        });
        perf.push({ phase, group, name, size: `${w}x${h}@${dpr}`, ...p });
        console.log(phase, name, JSON.stringify(p));
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, "raw", phase, `frames${only ? "-" + only.join("-") : ""}.json`), JSON.stringify(perf, null, 1));
}

function sheet(a, b) {
  for (const [group, g] of Object.entries(GROUPS)) {
    if (only && !only.includes(group)) continue;
    const pairs = [];
    const tmp = join(out, "raw", "_pairs");
    mkdirSync(tmp, { recursive: true });
    if (group === "base") {
      // the base decision: the two bases side by side (both shot in the after run)
      for (let i = 0; i < g.shots.length; i += 2) {
        const [n1, l1] = g.shots[i];
        const [n2, l2] = g.shots[i + 1];
        const f1 = join(out, "raw", b, `${n1}.png`), f2 = join(out, "raw", b, `${n2}.png`);
        if (!existsSync(f1) || !existsSync(f2)) continue;
        const pair = join(tmp, `${group}-${i}.png`);
        execFileSync("magick", ["montage", "-label", l1, f1, "-label", l2, f2, "-tile", "2x", "-geometry", "640x+3+3", "-pointsize", "15", "-fill", "#ddd", "-background", "#151515", pair]);
        pairs.push(pair);
      }
    } else
      for (const [name, lab, , , [w]] of g.shots) {
        const fa = join(out, "raw", a, `${name}.png`), fb = join(out, "raw", b, `${name}.png`);
        if (!existsSync(fa) || !existsSync(fb)) continue;
        const pair = join(tmp, `${group}-${name}.png`);
        const tw = Math.round(Math.min(w, 1280) * (g.cols > 2 ? 0.5 : 0.5));
        execFileSync("magick", ["montage", "-label", a, fa, "-label", b, fb, "-tile", "2x", "-geometry", `${tw}x+3+3`, "-pointsize", "16", "-fill", "#ddd", "-background", "#151515", pair]);
        execFileSync("magick", [pair, "-gravity", "North", "-background", "#151515", "-fill", "#eee", "-pointsize", "20", "-splice", "0x28", "-annotate", "+0+4", `${lab} — ${a} | ${b}`, pair]);
        pairs.push(pair);
      }
    if (!pairs.length) continue;
    const file = join(out, `${group}${a === "before" && b === "after" ? "" : `-${a}-vs-${b}`}.jpg`);
    execFileSync("magick", ["montage", ...pairs, "-tile", `${group === "closeups" ? 2 : 1}x`, "-geometry", "+4+4", "-background", "#0d0d0d", "-quality", "80", file]);
    console.log("sheet", file);
  }
}

if (cmd === "shoot") await shoot(label);
else if (cmd === "sheet") sheet(label === "after" ? "before" : label, label === "after" ? "after" : "after");
else throw new Error("usage: boxing-v7-sheet.mjs <outDir> shoot <before|after|roundN> [groups] | sheet [before|roundN] [groups]");
