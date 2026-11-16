// P3-FGT-19A: the shot list for the design sheets (dev only). Writes raw/shots.json for shoot.mjs.
//   node qa/fighter-v8/shots.mjs [quality multiplier]   → node qa/fighter-v8/shoot.mjs qa/fighter-v8/raw/shots.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const Qm = Number(process.argv[2] ?? 1);
const lm = (f) => JSON.parse(readFileSync(join(HERE, "out", `${f}.json`), "utf8")).landmarks;
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join("&");
const spp = (n) => Math.round(n * Qm);
const shots = [];
const add = (name, o) => shots.push([name, q(o)]);

// hero: broadcast 3/4 from the lead side, arena light, ring
add("hero-mW-guard", { f: "mW", pose: "guard", light: "arena", ring: 1, az: 38, el: 7, dist: 5.6, fov: 22, ty: 1.0, w: 1200, h: 1500, spp: spp(700), tone: 0, sweat: 0.5 });
add("hero-fL-guard", { f: "fL", pose: "guard", light: "arena", ring: 1, az: 38, el: 7, dist: 5.4, fov: 22, ty: 0.95, w: 1200, h: 1500, spp: spp(700), tone: 2, sweat: 0.45, corner: "blue" });
// turnarounds (studio): front, 3/4, side, back
for (const [f, tone, corner] of [["mW", 0, "red"], ["fL", 2, "blue"]]) {
  const H = f === "mW" ? 1.76 : 1.65;
  for (const [n, az] of [["front", 0], ["34", 35], ["side", 90], ["back", 180]]) add(`turn-${f}-${n}`, { f, pose: "stand", light: "studio", az, el: 3, dist: 7.2, fov: 17, ty: H * 0.5, w: 560, h: 1120, spp: spp(320), tone, corner, sweat: 0.2 });
}
// guard from the side broadcast camera (perpendicular to the fighting line)
for (const [f, tone, corner, az] of [["mW", 0, "red", 90], ["fL", 2, "blue", 90]]) add(`guard-side-${f}`, { f, pose: "guard", light: "arena", ring: 1, az, el: 6, dist: 6, fov: 20, ty: 0.95, w: 900, h: 1100, spp: spp(420), tone, corner, sweat: 0.45 });
// key poses
for (const [f, tone, corner] of [["mW", 0, "red"], ["fL", 2, "blue"]]) {
  add(`jab-${f}`, { f, pose: "jab", light: "arena", ring: 1, az: 95, el: 6, dist: 6.2, fov: 20, tz: 0.15, ty: 1.0, w: 900, h: 1000, spp: spp(380), tone, corner, sweat: 0.5 });
  add(`hook-${f}`, { f, pose: "hook", light: "arena", ring: 1, az: 25, el: 6, dist: 5.6, fov: 20, ty: 1.0, w: 900, h: 1000, spp: spp(380), tone, corner, sweat: 0.5 });
}
// close-ups (studio)
const mW = lm("mW"), fL = lm("fL");
add("cu-head-mW", { f: "mW", pose: "stand", light: "studio", target: "head,0,-0.035,0", az: 22, el: 0, dist: 0.72, fov: 24, w: 800, h: 900, spp: spp(420), tone: 0, sweat: 0.55 });
add("cu-head-fL", { f: "fL", pose: "stand", light: "studio", target: "head,0,-0.035,0", az: -22, el: 0, dist: 0.7, fov: 24, w: 800, h: 900, spp: spp(420), tone: 2, sweat: 0.5, corner: "blue" });
add("cu-strap-mW", { f: "mW", pose: "stand", light: "studio", target: "upperarm01.L,-0.06,-0.02,0", az: 45, el: 18, dist: 0.6, fov: 26, w: 800, h: 800, spp: spp(380), tone: 0, sweat: 0.5, hg: 0 });
add("cu-band-mW", { f: "mW", pose: "stand", light: "studio", tx: 0.03, ty: mW.bandTop - 0.06, tz: 0.08, az: 28, el: 4, dist: 0.85, fov: 26, w: 800, h: 800, spp: spp(380), tone: 0 });
add("cu-gloves-mW", { f: "mW", pose: "guard", light: "studio", target: "wrist.L,0,0.04,0.06", az: 40, el: 8, dist: 0.62, fov: 26, w: 800, h: 800, spp: spp(380), tone: 0 });
add("cu-wraps-mW", { f: "mW", pose: "stand", light: "studio", target: "wrist.R,0,-0.03,0", az: -40, el: 10, dist: 0.5, fov: 26, w: 800, h: 800, spp: spp(380), tone: 0, gl: 0, wr: 1 });
add("cu-boots-mW", { f: "mW", pose: "guard", light: "studio", tx: 0, ty: 0.13, tz: 0, az: 55, el: 8, dist: 1.2, fov: 26, w: 800, h: 800, spp: spp(320), tone: 0 });
add("cu-back-fL", { f: "fL", pose: "guard", light: "studio", target: "spine01,0,0.0,0", az: 160, el: 6, dist: 1.3, fov: 26, w: 800, h: 800, spp: spp(320), tone: 2, corner: "blue" });
// skin tones under arena light (head in headgear + shoulder)
for (let t = 0; t < 4; t++) {
  add(`tone-${t}-mW`, { f: "mW", pose: "stand", light: "arena", target: "head,0,-0.09,0", az: 30, el: 4, dist: 1.05, fov: 24, w: 600, h: 800, spp: spp(380), tone: t, sweat: 0.55, exp: 1.2 });
  add(`tone-${t}-fL`, { f: "fL", pose: "stand", light: "arena", target: "head,0,-0.09,0", az: -30, el: 4, dist: 1.0, fov: 24, w: 600, h: 800, spp: spp(380), tone: t, sweat: 0.5, exp: 1.2, corner: "blue" });
}
// corner kits and the weight classes
add("kit-red-mW", { f: "mW", pose: "stand", light: "studio", az: 30, el: 3, dist: 4.2, fov: 22, ty: 0.95, w: 600, h: 1000, spp: spp(320), tone: 1 });
add("kit-blue-mW", { f: "mW", pose: "stand", light: "studio", az: 30, el: 3, dist: 4.2, fov: 22, ty: 0.95, w: 600, h: 1000, spp: spp(320), tone: 1, corner: "blue" });
for (const [f, tone, corner] of [["mW", 0, "red"], ["mH", 1, "blue"], ["fL", 2, "red"], ["fM", 3, "blue"]]) add(`class-${f}`, { f, pose: "stand", light: "studio", az: 20, el: 2, dist: 7.6, fov: 17, ty: 0.94, w: 520, h: 1140, spp: spp(300), tone, corner });

// iteration proof: the first v8 draft (sculpted cloth, sim=0) beside the simulated kit, same camera
add("it-sculpt-mW", { f: "mW", pose: "stand", light: "studio", az: 25, el: 2, dist: 3.2, fov: 24, ty: 1.12, w: 600, h: 800, spp: spp(260), tone: 0, sim: 0 });
add("it-sim-mW", { f: "mW", pose: "stand", light: "studio", az: 25, el: 2, dist: 3.2, fov: 24, ty: 1.12, w: 600, h: 800, spp: spp(260), tone: 0 });
add("it-sculpt-guard", { f: "mW", pose: "guard", light: "arena", az: -70, el: 4, dist: 3.4, fov: 24, ty: 1.1, w: 600, h: 800, spp: spp(260), tone: 0, sim: 0 });
add("it-sim-guard", { f: "mW", pose: "guard", light: "arena", az: -70, el: 4, dist: 3.4, fov: 24, ty: 1.1, w: 600, h: 800, spp: spp(260), tone: 0 });

/** the glove work item (third user review): product views + guard / jab / hook close-ups, under a prefix */
function gloveShots(px) {
  const g = { f: "mW", light: "studio", tone: 0, spp: spp(260), w: 700, h: 700 };
  const iso = { ...g, pose: "stand", only: "gloveL", target: "wrist.L,0.01,-0.085,0.03", dist: 0.68, fov: 30, floor: 0 };
  add(`${px}-front`, { ...iso, az: 0, el: 5 });
  add(`${px}-side`, { ...iso, az: 90, el: 5 });
  add(`${px}-palm`, { ...iso, az: -90, el: 5 });
  add(`${px}-top`, { ...iso, az: 30, el: 60 });
  add(`${px}-cuff`, { ...iso, az: 160, el: -25 });
  add(`${px}-guard-broadcast`, { ...g, pose: "guard", light: "arena", target: "head,0,-0.1,0.1", az: 90, el: 4, dist: 1.3, fov: 28, w: 800, h: 800 });
  add(`${px}-guard-front`, { ...g, pose: "guard", light: "arena", target: "head,0,-0.1,0.1", az: 5, el: 4, dist: 1.4, fov: 28, w: 800, h: 800 });
  add(`${px}-jab`, { ...g, pose: "jab", light: "arena", target: "upperarm01.L,0,0,0.3", az: 75, el: 6, dist: 1.6, fov: 30, w: 800, h: 700 });
  add(`${px}-hook`, { ...g, pose: "hook", light: "arena", target: "upperarm01.L,-0.12,0,0.2", az: 20, el: 10, dist: 1.5, fov: 30, w: 800, h: 700 });
}
/** the arms + clothing work item (fourth user review): guard from three sides, kit front / side / back, arm hole, band */
function fixShots(px) {
  const g = { f: "mW", tone: 0, spp: spp(520), w: 700, h: 900 };
  add(`${px}-arms-front`, { ...g, pose: "guard", light: "arena", az: 0, el: 3, dist: 2.6, fov: 26, ty: 1.2 });
  add(`${px}-arms-side`, { ...g, pose: "guard", light: "arena", az: 90, el: 3, dist: 2.6, fov: 26, ty: 1.2 });
  add(`${px}-arms-34`, { ...g, pose: "guard", light: "arena", az: 40, el: 3, dist: 2.6, fov: 26, ty: 1.2 });
  add(`${px}-kit-front`, { ...g, pose: "stand", light: "studio", az: 0, el: 2, dist: 3.4, fov: 24, ty: 1.05 });
  add(`${px}-kit-side`, { ...g, pose: "stand", light: "studio", az: 90, el: 2, dist: 3.4, fov: 24, ty: 1.05 });
  add(`${px}-kit-back`, { ...g, pose: "stand", light: "studio", az: 180, el: 2, dist: 3.4, fov: 24, ty: 1.05 });
  add(`${px}-armhole`, { ...g, pose: "guard", light: "studio", target: "spine01,0.1,-0.05,0", az: 100, el: 6, dist: 1.0, fov: 28, w: 700, h: 700 });
  add(`${px}-band`, { ...g, pose: "stand", light: "studio", tx: 0.02, ty: 1.0, tz: 0.06, az: 30, el: 6, dist: 0.85, fov: 28, w: 700, h: 700 });
}
if (process.argv[3]?.startsWith("fix:")) {
  shots.length = 0;
  fixShots(process.argv[3].slice(4));
  mkdirSync(join(HERE, "raw"), { recursive: true });
  writeFileSync(join(HERE, "raw", "fix.json"), JSON.stringify(shots, null, 1));
  console.log(`${shots.length} fix shots → raw/fix.json`);
  process.exit(0);
}
if (process.argv[3]?.startsWith("gloves:")) {
  shots.length = 0;
  gloveShots(process.argv[3].slice(7));
  mkdirSync(join(HERE, "raw"), { recursive: true });
  writeFileSync(join(HERE, "raw", "gloves.json"), JSON.stringify(shots, null, 1));
  console.log(`${shots.length} glove shots → raw/gloves.json`);
  process.exit(0);
}
gloveShots("ga");
fixShots("aa");

mkdirSync(join(HERE, "raw"), { recursive: true });
writeFileSync(join(HERE, "raw", "shots.json"), JSON.stringify(shots, null, 1));
console.log(`${shots.length} shots → raw/shots.json`);
