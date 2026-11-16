// Boxing v6 evidence (P3-FGT-17, docs/HUMAN-REALISM-VR-RESEARCH.md): the rebuilt ring bodies, before (the P3-FGT-16
// bodies and shading: glb=before) beside after, for every shot — full body front / side / back, guard / jab / hook /
// clinch in the two-fighter lab (desktop 1280×720 and phone 844×390 at DPR 2), close-ups of the shoulder, arm hole,
// waistband, gloves, headgear and face; both bodies and three skin tones (index 1 deep, 5 medium, 9 light).
//   node qa/e2e/boxing-v6-sheet.mjs <outDir> [group,...]   (QA_WEB defaults to http://localhost:3962)
// groups: body, actions-desktop, actions-phone, closeups
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.QA_WEB ?? "http://localhost:3962";
const out = process.argv[2];
const only = process.argv[3]?.split(",");
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "boxing-v6-"));

const LAB = "mode=boxer&clip=guard&at=0.5";
const DUEL = "body=boxer&headgear=1&red=feminine&blue=masculine&rtone=5&btone=1";
/** group → { size [w, h, dpr], cols, shots: [label, query] } */
const GROUPS = {
  body: {
    size: [560, 760, 1],
    cols: 4,
    shots: [
      ["m deep tone: front", `${LAB}&gender=m&tone=1&cam=full&az=0&dist=3.0`],
      ["m deep tone: side", `${LAB}&gender=m&tone=1&cam=full&az=90&dist=3.0`],
      ["m deep tone: back", `${LAB}&gender=m&tone=1&cam=full&az=180&dist=3.0`],
      ["f medium tone: front", `${LAB}&gender=f&tone=5&cam=full&az=0&dist=3.0`],
      ["f medium tone: side", `${LAB}&gender=f&tone=5&cam=full&az=-90&dist=3.0`],
      ["f medium tone: back", `${LAB}&gender=f&tone=5&cam=full&az=180&dist=3.0`],
      ["m light tone: 3/4", `${LAB}&gender=m&tone=9&cam=full&az=30&dist=3.0`],
      ["f light tone: 3/4", `${LAB}&gender=f&tone=9&cam=full&az=-30&dist=3.0`],
    ],
  },
  "actions-desktop": {
    size: [1280, 720, 1],
    cols: 2,
    shots: [
      ["guard", `${DUEL}&clip=guard&at=0.5&cam=side&gap=1.1`],
      ["jab (impact)", `${DUEL}&clip=jab&at=impact&cam=side&gap=1.1`],
      ["lead hook (impact)", `${DUEL}&clip=leadHook&at=impact&cam=side&gap=0.9`],
      ["clinch", `${DUEL}&clip=clinch&at=1.7&cam=side`],
      ["guard, close", `${DUEL}&clip=guard&at=0.5&cam=close&gap=1.1`],
      ["jab, front", `${DUEL}&clip=jab&at=impact&cam=front&gap=1.1`],
    ],
  },
  "actions-phone": {
    size: [844, 390, 2],
    cols: 2,
    shots: [
      ["guard", `${DUEL}&clip=guard&at=0.5&cam=side&gap=1.1`],
      ["jab (impact)", `${DUEL}&clip=jab&at=impact&cam=side&gap=1.1`],
      ["lead hook (impact)", `${DUEL}&clip=leadHook&at=impact&cam=side&gap=0.9`],
      ["clinch", `${DUEL}&clip=clinch&at=1.7&cam=side`],
    ],
  },
  closeups: {
    size: [600, 600, 1],
    cols: 4,
    shots: [
      ["shoulder (m, guard)", `${LAB}&gender=m&tone=1&headgear=0&cam=shoulderL`],
      ["shoulder (f, jab)", `mode=boxer&clip=jab&at=impact&gender=f&tone=5&headgear=0&cam=shoulderL`],
      ["arm hole (m, hook)", `mode=boxer&clip=leadHook&at=impact&gender=m&tone=1&headgear=0&cam=backL&dist=0.55`],
      ["arm hole (f, guard)", `${LAB}&gender=f&tone=5&headgear=0&cam=armpitL`],
      ["waistband (m)", `${LAB}&gender=m&tone=9&cam=full&dist=1.15&az=20&el=-4`],
      ["waistband (f)", `${LAB}&gender=f&tone=5&cam=full&dist=1.15&az=-35&el=-4`],
      ["gloves + headgear (m)", `${LAB}&gender=m&tone=1&cam=face34&dist=0.95`],
      ["gloves + headgear (f)", `${LAB}&gender=f&tone=9&cam=face&dist=0.95&az=40`],
      ["face (m)", `${LAB}&gender=m&tone=1&headgear=0&cam=face&dist=0.55`],
      ["face (f)", `${LAB}&gender=f&tone=5&headgear=0&cam=face34&dist=0.55`],
      ["back (m, guard)", `${LAB}&gender=m&tone=9&headgear=0&cam=back&dist=1.0`],
      ["chest (f, guard)", `${LAB}&gender=f&tone=9&headgear=0&cam=front&dist=0.9`],
    ],
  },
};

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const perf = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  for (const [group, g] of Object.entries(GROUPS)) {
    if (only && !only.includes(group)) continue;
    const [w, h, dpr] = g.size;
    await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: h < 500, hasTouch: h < 500 });
    const pairs = [];
    for (const [label, q] of g.shots) {
      const files = [];
      for (const which of ["before", "after"]) {
        const url = `${WEB}/play/boxing-lab?${q}${which === "before" ? "&glb=before" : ""}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction(() => window.__gkProbe?.frames > 40, { timeout: 240000 });
        await new Promise((r) => setTimeout(r, 900));
        const f = join(tmp, `${group}-${pairs.length}-${which}.png`);
        await page.screenshot({ path: f });
        perf.push({ group, label, which, ...(await page.evaluate(() => ({ calls: window.__gkProbe.calls, tris: window.__gkProbe.tris }))) });
        files.push(f);
      }
      const pair = join(tmp, `${group}-${pairs.length}-pair.png`);
      const tw = Math.round(w * dpr * (g.cols > 2 ? 0.5 : 0.42));
      execFileSync("magick", ["montage", "-label", "before", files[0], "-label", "after", files[1], "-tile", "2x", "-geometry", `${tw}x+3+3`, "-pointsize", "18", "-fill", "#ddd", "-background", "#151515", pair]);
      execFileSync("magick", [pair, "-gravity", "North", "-background", "#151515", "-fill", "#eee", "-pointsize", "22", "-splice", "0x30", "-annotate", "+0+4", `${label} — before (P3-FGT-16) | after (P3-FGT-17)`, pair]);
      pairs.push(pair);
      console.log(group, label);
    }
    const sheet = join(out, `${group}.jpg`);
    execFileSync("magick", ["montage", ...pairs, "-tile", `${Math.max(1, Math.floor(g.cols / 2))}x`, "-geometry", "+4+4", "-background", "#0d0d0d", "-quality", "78", sheet]);
    console.log("sheet", sheet);
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, `frames${only ? "-" + only.join("-") : ""}.json`), JSON.stringify(perf, null, 1));
