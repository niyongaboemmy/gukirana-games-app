// P3-FGT-19A: compose the annotated design sheets from the path-traced shots (dev only).
//   node qa/fighter-v8/sheets.mjs   → docs/design/fighter-v8/*.jpg
// Inputs: qa/fighter-v8/raw/*.png + raw/log-*.json (joint screen positions), out/<fighter>.json (measures),
// out/cloth/<fighter>-stand.json (pattern dimensions). Style: graphite, chocolate accent, cream text, no emoji.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
const DOCS = join(HERE, "../../docs/design/fighter-v8");
mkdirSync(DOCS, { recursive: true });
const BG = "#141210", PANEL = "#1d1a17", CHOC = "#8a5a36", CREAM = "#efe7da", DIM = "#a99d8c", LINE = "#d9a066";
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

// merge the shoot logs (latest wins) → name → info
const info = {};
for (const f of readdirSync(RAW).filter((f) => f.startsWith("log-")).sort()) for (const e of JSON.parse(readFileSync(join(RAW, f), "utf8"))) if (!e.error) info[e.name] = e;
const meta = (f) => JSON.parse(readFileSync(join(HERE, "out", `${f}.json`), "utf8"));
const cloth = (f) => (existsSync(join(HERE, "out/cloth", `${f}-stand.json`)) ? JSON.parse(readFileSync(join(HERE, "out/cloth", `${f}-stand.json`), "utf8")) : null);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** text helpers for SVG */
const T = (x, y, s, { size = 22, fill = CREAM, weight = 400, anchor = "start" } = {}) => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const lineSvg = (x1, y1, x2, y2, { stroke = LINE, w = 2, dash = "" } = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
const dot = (x, y, r = 5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${LINE}" stroke="${BG}" stroke-width="1.5"/>`;
/** a callout: dot at (px, py), leader to (lx, ly), label lines */
const callout = (px, py, lx, ly, lines, anchor = "start") => {
  let s = dot(px, py) + lineSvg(px, py, lx, ly, { w: 1.6 });
  lines.forEach((l, i) => (s += T(lx + (anchor === "start" ? 8 : -8), ly + 6 + i * 24, l, { size: i ? 18 : 20, fill: i ? DIM : CREAM, weight: i ? 400 : 600, anchor })));
  return s;
};

/**
 * Compose a sheet. panels: [{ img, x, y, w, h, caption, overlay(scale, ox, oy) → svg }], header text.
 */
async function sheet(file, W, H, title, subtitle, panels, extraSvg = "", footer = "") {
  const comps = [];
  // layer 1: panel backgrounds; layer 2: the renders; layer 3: header, captions, callouts
  let bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  for (const p of panels) bg += `<rect x="${p.x - 2}" y="${p.y - 2}" width="${p.w + 4}" height="${p.h + 4}" fill="${PANEL}"/>`;
  bg += "</svg>";
  comps.push({ input: Buffer.from(bg), left: 0, top: 0 });
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  svg += `<rect x="0" y="0" width="${W}" height="96" fill="${BG}"/>`;
  svg += `<rect x="0" y="94" width="${W}" height="2" fill="${CHOC}"/>`;
  svg += T(32, 46, title, { size: 34, weight: 700 }) + T(32, 78, subtitle, { size: 20, fill: DIM });
  svg += T(W - 32, 46, "Gukirana fighter v8 · P3-FGT-19A", { size: 18, fill: DIM, anchor: "end" });
  for (const p of panels) {
    if (p.img && existsSync(join(RAW, `${p.img}.png`))) {
      const buf = await sharp(join(RAW, `${p.img}.png`)).resize(p.w, p.h, { fit: "cover", position: p.pos ?? "centre" }).median(p.median ?? 3).toBuffer();
      comps.push({ input: buf, left: p.x, top: p.y });
    } else if (p.img) svg += T(p.x + p.w / 2, p.y + p.h / 2, `(missing ${p.img})`, { anchor: "middle", fill: DIM });
    if (p.caption) {
      svg += `<rect x="${p.x}" y="${p.y + p.h - 38}" width="${p.w}" height="38" fill="${BG}" fill-opacity="0.72"/>`;
      svg += T(p.x + 12, p.y + p.h - 13, p.caption, { size: 18 });
    }
    if (p.overlay) {
      // joint positions of that shot, scaled into the panel (cover fit)
      const e = info[p.img];
      const proj = e?.info?.proj;
      if (proj) {
        const sw = Number(new URLSearchParams(e.query).get("w")), sh = Number(new URLSearchParams(e.query).get("h"));
        const k = Math.max(p.w / sw, p.h / sh);
        const ox = p.x + (p.w - sw * k) / 2, oy = p.y + (p.h - sh * k) / 2;
        const J = (n) => (proj[n] ? [ox + proj[n][0] * k, oy + proj[n][1] * k] : [p.x, p.y]);
        svg += p.overlay(J, p);
      }
    }
  }
  svg += extraSvg;
  if (footer) svg += T(32, H - 18, footer, { size: 16, fill: DIM });
  svg += "</svg>";
  comps.push({ input: Buffer.from(svg), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).composite(comps).jpeg({ quality: 86, mozjpeg: true }).toFile(join(DOCS, file));
  console.log(file);
}

const mW = meta("mW"), fL = meta("fL");
const r2 = (x) => (+x).toFixed(2);
const cm = (x) => `${Math.round(x * 100)} cm`;

/* 01 hero */
await sheet("01-hero-guard.jpg", 2440, 1640, "The fighter, v8 prototype", "Path-traced prototype on the MakeHuman CC0 base: own sculpt, simulated kit (pattern-cut singlet and satin trunks), SDF-modelled headgear, gloves and boots, broadcast ring light", [
  { img: "hero-mW-guard", x: 24, y: 112, w: 1184, h: 1480, caption: "Male welterweight, red corner, orthodox guard (deep tone, MST 9)" },
  { img: "hero-fL-guard", x: 1232, y: 112, w: 1184, h: 1480, caption: "Female lightweight, blue corner, orthodox guard (brown tone, MST 7)" },
], "", "Original work. Bodies from MakeHuman 1.x (CC0) with Gukirana sculpt, bakes and kit. Not a likeness of any real athlete.");

/* 02 / 03 turnarounds */
for (const [f, label, m] of [["mW", "Male welterweight · 63.5–67 kg · 1.76 m", mW], ["fL", "Female lightweight · 57–60 kg · 1.65 m", fL]]) {
  const ms = m.measure;
  const x0 = 24, pw = 560, ph = 1120, y0 = 112;
  const views = [["front", "Front"], ["34", "3/4"], ["side", "Side"], ["back", "Back"]];
  const panels = views.map(([v, cap], i) => ({ img: `turn-${f}-${v}`, x: x0 + i * (pw + 16), y: y0, w: pw, h: ph, caption: cap }));
  // front panel callouts
  panels[0].overlay = (J, p) => {
    const [tx, ty] = J("top"), [fx, fy] = J("floor");
    const lx0 = p.x + 26;
    let s = lineSvg(lx0 - 10, ty, tx + 210, ty, { dash: "6 6", w: 1.2 }) + lineSvg(lx0 - 10, fy, fx + 210, fy, { dash: "6 6", w: 1.2 });
    s += lineSvg(lx0, ty, lx0, fy, { w: 1.6 }) + T(lx0 + 8, ty + 30, `${m.landmarks.stature.toFixed(2)} m`, { size: 20, weight: 600 });
    s += T(lx0 + 8, ty + 54, `${ms.headsTall} heads`, { size: 17, fill: DIM });
    const [lx, ly] = J("upperarm01.L"), [rx] = J("upperarm01.R");
    s += callout(lx, ly - 10, lx + 70, ly - 70, [`Bideltoid ${cm(ms.bideltoid)}`, `${(ms.bideltoidPerH * 100).toFixed(1)} % of stature`]);
    const [bx, by] = J("band");
    s += callout(bx, by, bx + 190, by - 40, [`Waist ${cm(ms.waistGirth)} / hip ${cm(ms.hipGirth)}`, `WHR ${ms.waistToHip}`]);
    const [nx, ny] = J("neck01");
    s += callout(nx + 14, ny + 4, lx + 70, ny - 150, [`Neck ${cm(ms.neckGirth)}`, `chin–notch ${(ms.neckLengthPerH * 100).toFixed(1)} % H`]);
    return s;
  };
  panels[2].overlay = (J) => {
    const [kx, ky] = J("lowerleg01.L");
    const [cx, cy] = J("spine02");
    return callout(cx, cy, cx + 120, cy - 120, [`Chest ${cm(ms.chestGirth)}`, "lats + serratus read in the vest"]) + callout(kx, ky + 60, kx + 110, ky + 120, [`Calf ${ms.calfGirth[0]} cm`, "gastrocnemius, medial head lower"]);
  };
  panels[3].overlay = (J) => {
    const [ax, ay] = J("lowerarm01.L");
    return callout(ax, ay - 50, ax + 90, ay - 140, [`Upper arm ${ms.upperArmGirth[1]} cm`, `forearm ${ms.forearmGirth[0]} cm`]);
  };
  await sheet(`0${f === "mW" ? 2 : 3}-turnaround-${f === "mW" ? "male" : "female"}.jpg`, x0 * 2 + 4 * pw + 3 * 16, y0 + ph + 70, `Turnaround · ${label}`, "Relaxed stand in full kit, studio light. Measured on the bind-pose body with apps/web/scripts/boxer/measure.mjs", panels, "", "Proportions: stature from the class means (Olympic boxers ♂ 1.76 m, Korean national women 1.63–1.70 m); WHR ♂ 0.83–0.88, ♀ 0.70–0.75; neck chin–notch ≈ 5.2 % H (Drillis & Contini).");
}

/* 04 guard, side broadcast */
const angleNote = (J) => {
  const [hx, hy] = J("head"), [px, py] = J("root"), [kx, ky] = J("lowerleg01.L"), [rx, ry] = J("foot.R"), [wx, wy] = J("wrist.L"), [wr, wry] = J("wrist.R");
  let s = callout(hx, hy + 30, hx + 150, hy - 60, ["Chin tucked ~14°", "behind the lead shoulder (shrug 0.2 rad)"]);
  s += callout(wx, wy, wx + 120, wy - 20, ["Lead glove at eye level", "≈ 25 cm in front of the chin"]);
  s += callout(wr, wry, wr - 130, wry + 120, ["Rear glove at the cheek", "elbow down over the ribs"], "end");
  s += callout(px, py, px - 160, py + 40, ["Hips 5.5 cm lower than stand", "torso bladed 38–44°"], "end");
  s += callout(kx, ky, kx + 140, ky + 60, ["Knees soft, ~20–25° flexion", "weight ~55 % rear (unverified)"]);
  s += callout(rx, ry - 10, rx - 140, ry - 70, ["Rear heel up ~26°", "on the ball of the foot"], "end");
  return s;
};
await sheet("04-guard-side-broadcast.jpg", 1872, 1260, "Guard from the side broadcast camera", "Orthodox guard, arena light (overhead key + four truss fixtures at ~55°), simulated kit in the pose", [
  { img: "guard-side-mW", x: 24, y: 112, w: 900, h: 1100, caption: "Male welterweight", overlay: angleNote },
  { img: "guard-side-fL", x: 948, y: 112, w: 900, h: 1100, caption: "Female lightweight", overlay: angleNote },
]);

/* 05 jab / hook */
await sheet("05-jab-hook.jpg", 1872, 2184, "Key poses: jab and lead hook", "Jab: weight onto the front foot, rear hip turns, lead shoulder up over the chin, head off the centre line. Hook: hips and shoulders turn through, elbow up, rear glove stays home", [
  { img: "jab-mW", x: 24, y: 112, w: 900, h: 1000, caption: "Jab (male)", overlay: (J) => { const [wx, wy] = J("wrist.L"); const [sx, sy] = J("upperarm01.L"); return callout(wx, wy, wx - 40, wy - 120, ["Fist turned over, knuckles level", "arm ~95 % extended"], "end") + callout(sx, sy - 8, sx - 60, sy - 150, ["Lead shoulder raised", "protects the chin"], "end"); } },
  { img: "jab-fL", x: 948, y: 112, w: 900, h: 1000, caption: "Jab (female)" },
  { img: "hook-mW", x: 24, y: 1136, w: 900, h: 1000, caption: "Lead hook (male)", overlay: (J) => { const [ex, ey] = J("lowerarm01.L"); const [px, py] = J("root"); return callout(ex, ey, ex + 110, ey - 110, ["Elbow at shoulder height", "forearm ~horizontal"]) + callout(px, py, px + 150, py + 70, ["Hips turn ~30° through", "pivot on the lead ball"]); } },
  { img: "hook-fL", x: 948, y: 1136, w: 900, h: 1000, caption: "Lead hook (female)" },
]);

/* 06 close-ups */
const cw = 600, chh = 600;
const kitDims = cloth("mW")?.pattern?.dims;
await sheet("06-closeups.jpg", 24 * 2 + 4 * cw + 3 * 16, 112 + 2 * chh + 16 + 70, "Close-ups: head, strap, band, gloves, wraps, boots", "Studio light. Headgear and gloves are SDF-modelled at product size; the singlet and trunks are simulated from their sewing patterns", [
  { img: "cu-head-mW", x: 24, y: 112, w: cw, h: chh, caption: "Open-face headgear: brow roll 3.6 cm, cheek 2.8 cm" },
  { img: "cu-head-fL", x: 24 + (cw + 16), y: 112, w: cw, h: chh, caption: "Webbing chin strap, quilted crown" },
  { img: "cu-strap-mW", x: 24 + 2 * (cw + 16), y: 112, w: cw, h: chh, caption: `Strap ${kitDims ? cm(kitDims.strap) : "5.6 cm"} on the trapezius, bound arm hole` },
  { img: "cu-band-mW", x: 24 + 3 * (cw + 16), y: 112, w: cw, h: chh, caption: "8.5 cm elastic band (IBA 6–10 cm), woven stripes, gathers" },
  { img: "cu-gloves-mW", x: 24, y: 112 + chh + 16, w: cw, h: chh, caption: "10 oz glove: white scoring panel, 5 cm tape" },
  { img: "cu-wraps-mW", x: 24 + (cw + 16), y: 112 + chh + 16, w: cw, h: chh, caption: "Hand wrap: 5.7 cm wide, 2.5–4.5 m (IBA 47.1.4)" },
  { img: "cu-boots-mW", x: 24 + 2 * (cw + 16), y: 112 + chh + 16, w: cw, h: chh, caption: "High-top boot ~22 cm, laced, flat gum sole" },
  { img: "cu-back-fL", x: 24 + 3 * (cw + 16), y: 112 + chh + 16, w: cw, h: chh, caption: "Back: singlet hangs from the shoulder blades" },
]);

/* 07 skin tones */
const tones = ["Deep · MST 9", "Dark brown · MST 8", "Brown · MST 7", "Light brown · MST 6"];
const tp = [];
for (let t = 0; t < 4; t++) {
  tp.push({ img: `tone-${t}-mW`, x: 24 + t * 466, y: 112, w: 450, h: 600, caption: `${tones[t]} (m)` });
  tp.push({ img: `tone-${t}-fL`, x: 24 + t * 466, y: 112 + 616, w: 450, h: 600, caption: `${tones[t]} (f)` });
}
const swatch = ["#46302a", "#664234", "#895c42", "#a77b55"].map((c, i) => `<rect x="${24 + i * 466}" y="${112 + 1232 + 8}" width="450" height="40" fill="${c}"/>` + T(36 + i * 466, 112 + 1232 + 35, `albedo ${c} (Monk ${["#3a312a", "#604134", "#825c43", "#a07e56"][i]})`, { size: 16, fill: CREAM })).join("");
await sheet("07-skin-tones.jpg", 24 * 2 + 4 * 450 + 3 * 16, 112 + 1232 + 60 + 60, "Four Rwandan athlete skin tones under arena light", "Same specular for every tone (F0 ≈ 0.028, IOR 1.4); albedo warmed so deep skin never goes ashy-grey; sweat as patchy clearcoat; colour zones (cheeks, nose, ears, knuckles) scaled down on deep skin", tp, swatch);

/* 08 colour + materials */
const sw = (x, y, c, name, note) => `<rect x="${x}" y="${y}" width="120" height="120" fill="${c}" stroke="#000" stroke-opacity="0.3"/>` + T(x + 136, y + 36, name, { size: 22, weight: 600 }) + T(x + 136, y + 64, note, { size: 17, fill: DIM }) + T(x + 136, y + 90, c, { size: 17, fill: DIM });
let swSvg = "";
const SX = 1290;
[["#c8102e", "Red corner kit", "Pantone 185/186 family (IBA 49.3.6: 185, 199, 485)"], ["#0033a0", "Blue corner kit", "Pantone 286 (IBA: 286, 293, 661)"], ["#ece8df", "Belt line / band", "contrasting, 6–10 cm (IBA 49.3.8)"], ["#5b3a24", "Chocolate brand accent", "binding, side piping (no blue UI)"], ["#efece6", "Glove scoring panel", "white knuckle area, 5 cm tape"], ["#141312", "Boots", "leather / suede upper, gum sole"]].forEach(([c, n, note], i) => (swSvg += sw(SX, 140 + i * 150, c, n, note)));
swSvg += T(SX, 1080, "Materials", { size: 26, weight: 700 });
["Jersey singlet: matte knit (roughness 0.8), mesh weave normal, soft sheen", "Satin trunks: smooth (0.5), lengthwise weave grooves → streaked highlight, sheen", "Leather (gloves, headgear): roughness 0.5–0.66, grain normal, light clearcoat", "Elastic band: ribbed knit normal, matte; webbing straps matte black", "Skin: pore + photo detail normal, roughness zones 0.34–0.7, sweat clearcoat"].forEach((l, i) => (swSvg += T(SX, 1116 + i * 30, l, { size: 18, fill: CREAM })));
await sheet("08-colour-materials.jpg", 2000, 1300, "Colour and material sheet", "Red and blue corner kits with chocolate brand accents", [
  { img: "kit-red-mW", x: 24, y: 112, w: 600, h: 1000, caption: "Red corner" },
  { img: "kit-blue-mW", x: 640, y: 112, w: 600, h: 1000, caption: "Blue corner" },
], swSvg);

/* 09 weight classes */
const cls = [["mW", "Male welterweight", "1.76 m"], ["mH", "Male heavyweight", "1.87 m"], ["fL", "Female lightweight", "1.65 m"], ["fM", "Female middleweight", "1.70 m"]];
await sheet("09-weight-classes.jpg", 24 * 2 + 4 * 520 + 3 * 16, 112 + 1140 + 70, "Weight classes", "Same base, different macro / regional targets and sculpt strength; heights drawn to scale (same camera)", cls.map(([f, n, h], i) => ({ img: `class-${f}`, x: 24 + i * 536, y: 112, w: 520, h: 1140, caption: `${n} · ${h}` })));

/* 10 patterns */
{
  const c = cloth("mW");
  if (c) {
    const P = c.pattern;
    const S = 900; // px per metre
    const poly = (pts, ox, oy, flipY = true) => `<polygon points="${pts.map(([x, y]) => `${(ox + x * S).toFixed(1)},${(oy - (flipY ? y : -y) * S).toFixed(1)}`).join(" ")}" fill="${PANEL}" stroke="${LINE}" stroke-width="2"/>`;
    const d = P.dims;
    let s = "";
    s += poly(P.singletFront, 330, 760) + T(330, 800, "Singlet front (cut 1)", { anchor: "middle", weight: 600 });
    s += poly(P.singletBack, 940, 760) + T(940, 800, "Singlet back (cut 1)", { anchor: "middle", weight: 600 });
    s += poly(P.leg, 1300, 760) + T(1300 + d.legTop * 0.5 * S + 60, 800, "Trunks leg (cut 2, mirrored)", { anchor: "middle", weight: 600 });
    s += poly(P.band.map(([x, y]) => [x * 0.75, y]), 80, 1000) + T(80, 1040, `Elastic band ${cm(d.band)} × ${cm(d.bandW)} (6 % shorter than the body: gathers)`, { weight: 600 });
    const notes = [
      `Singlet panel ${cm(d.W)} at the chest (chest × 1.06 / 2), ${cm(-P.singletFront[0][0] * 2)} at the hem (waist × 1.08 / 2), length ${cm(d.Lt)}, arm hole ${cm(d.arm)}`,
      `Strap ${cm(d.strap)}, neck scoop front ${cm(d.neckFront)}, back ${cm(d.neckBack)}; seams: sides, shoulders; 1 cm bound edges`,
      `Trunks: top ${cm(d.legTop)} per leg (hip × 1.16 / 2), opening ${cm(d.legHem)}, inseam ${cm(d.inseam)}, rise ${cm(d.rise)}`,
      "Seams: inseams, centre front / back rise; legs sewn into the band (longer than it: gathers)",
      "Fabric: jersey 150 g/m², satin 120 g/m², elastic 450 g/m² (solver densities; unverified product weights)",
    ];
    notes.forEach((n, i) => (s += T(80, 1110 + i * 30, n, { size: 19, fill: i < 2 ? CREAM : DIM })));
    await sheet("10-sewing-patterns.jpg", 2100, 1300, "Sewing patterns (male welterweight)", "The garments are simulated from these flat panels: sewn round the body, draped with gravity and collision, then carried into each pose", [], s);
  }
}

/* iterations: v7 (shipped) | v8 draft (sculpted cloth) | v8 (simulated cloth, skin pass) | reference description */
{
  mkdirSync(join(DOCS, "iterations"), { recursive: true });
  const V7 = join(HERE, "../../docs/QA/boxing-v7/closeups.jpg");
  // v7 tiles (left / top / width / height in closeups.jpg): m 3/4 guard (after), strap (after)
  const v7crop = async (l, t, w, h, out) => sharp(V7).extract({ left: l, top: t, width: w, height: h }).png().toFile(join(RAW, `${out}.png`));
  await v7crop(873, 482, 280, 375, "v7-m-front");
  await v7crop(873, 37, 280, 375, "v7-m-34");
  const rows = [
    ["v7-m-front", "it-sculpt-mW", "it-sim-mW", ["Reference: an athlete in competition kit, standing", "· singlet hangs from chest + shoulder blades,", "  soft vertical folds, blouses over the band", "· satin trunks: wide legs, folds from the band", "  gathers, hem sways off the thigh", "· deltoid cap, trapezius slope, lats read", "· skin: warm albedo, broken-up specular"]],
    ["v7-m-34", "it-sculpt-guard", "it-sim-guard", ["Reference: guard under the ring key", "· vest folds under the raised arms, tension", "  lines from the armpit to the chest", "· trunks pull across the bent lead thigh", "· headgear: leather, stitched panels, thick", "  brow roll, chin strap under the jaw", "· short dense shadows under brow and chin"]],
  ];
  const panels = [];
  let s = "";
  rows.forEach(([a, b, c, ref], r) => {
    const y = 150 + r * 830;
    panels.push({ img: a, x: 24, y, w: 600, h: 800, caption: "v7 (shipped, P3-FGT-18)" });
    panels.push({ img: b, x: 640, y, w: 600, h: 800, caption: "v8 draft: sculpted cloth" });
    panels.push({ img: c, x: 1256, y, w: 600, h: 800, caption: "v8: simulated cloth + skin pass" });
    ref.forEach((l, i) => (s += T(1880, y + 40 + i * 32, l, { size: i ? 19 : 22, weight: i ? 400 : 700, fill: i ? CREAM : LINE })));
  });
  s += T(24, 132, "Same camera per row. The reference column is the written description the crops are judged against (docs/FIGHT-REALISM-V7.md R1–R14); no photos are committed.", { size: 18, fill: DIM });
  await sheet("iterations/01-v7-vs-v8.jpg", 2400, 150 + 2 * 830 + 40, "Iteration proof: v7 → v8 draft → v8", "Ours against the reference description", panels, s);
}

/* iterations 02: the glove fix (third user review), before | after per view */
{
  const views = [
    ["front", "Front (striking face)"],
    ["side", "Side (little-finger side, side seam)"],
    ["palm", "Palm / thumb side"],
    ["top", "Top (knuckle roll, back of hand)"],
    ["cuff", "Cuff (opening, binding, tape)"],
    ["guard-broadcast", "Guard, broadcast camera"],
    ["guard-front", "Guard, front"],
    ["jab", "Jab: knuckles flat, palm down"],
    ["hook", "Hook: 90° elbow, palm down"],
  ];
  const cw2 = 380, ch2 = 380;
  const panels = [];
  let s = "";
  views.forEach(([v, cap], i) => {
    const y = 150 + i * (ch2 + 14);
    panels.push({ img: `gb-${v}`, x: 24, y, w: cw2, h: ch2, caption: "before" });
    panels.push({ img: `ga-${v}`, x: 24 + cw2 + 16, y, w: cw2, h: ch2, caption: "after" });
    s += T(24 + 2 * cw2 + 44, y + 40, cap, { size: 24, weight: 700 });
  });
  const notes = [
    "Before: one smooth tube from cuff to tip (28.5 cm), white cap over half the",
    "glove, thumb as a separate finger, glove bent sideways at the wrist.",
    "",
    "After (built like the product):",
    "· padded fist block 11.8 × 11.6 cm round a wrapped fist, front 14.7 cm",
    "  from the wrist joint; cuff 10.4 cm hugging the wrist; ≈ 26.5–27 cm overall",
    "· pronounced knuckle roll, flat striking face, white panel on the knuckle",
    "  face only, raised piping round it",
    "· thumb lying along the side, attached; crease under it",
    "· palm: curled-finger bulge, grip hollow, palm seam; side seam",
    "· cuff: opening for the forearm, bound edge, Velcro strap under 5 cm tape,",
    "  creases where cuff meets hand",
    "· rigid to the hand, 35 % blend into the forearm at the cuff end",
    "· pose: wrists straight (glove continues the forearm), rear glove on the",
    "  cheek / jaw, lead glove at eye height a fist in front, elbows tucked",
  ];
  notes.forEach((l, i) => (s += T(24 + 2 * cw2 + 44, 150 + 4 * (ch2 + 14) + 60 + i * 30, l, { size: 19, fill: i < 3 ? DIM : CREAM })));
  await sheet("iterations/02-gloves-before-after.jpg", 1700, 150 + views.length * (ch2 + 14) + 30, "Gloves: before | after", "Third user review: \"hands gloves are not properly handled\"", panels, s);
}

/* iterations 03: arms and clothing (fourth user review), before | after per view */
{
  const views = [
    ["arms-front", "Guard, front: eyes clear over the gloves"],
    ["arms-side", "Guard, side: elbows down and in, forearms ~60–70°"],
    ["arms-34", "Guard, 3/4: arms hang from the shoulder joint"],
    ["kit-front", "Kit, front: fitted singlet tucked into the band"],
    ["kit-side", "Kit, side"],
    ["kit-back", "Kit, back"],
    ["armhole", "Arm hole: 2–4 cm under the armpit, bound edge"],
    ["band", "Band: 8.5 cm elastic, follows the waist, woven stripes"],
  ];
  const cw3 = 420, ch3 = 540;
  const panels = [];
  let s = "";
  views.forEach(([v, cap], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 24 + col * (2 * cw3 + 60), y = 230 + row * (ch3 + 56);
    panels.push({ img: `ab-${v}`, x, y, w: cw3, h: ch3, caption: "before" });
    panels.push({ img: `aa-${v}`, x: x + cw3 + 12, y, w: cw3, h: ch3, caption: "after" });
    s += T(x, y - 14, cap, { size: 22, weight: 700 });
  });
  s += T(24, 140, "Arms: the guard is rebuilt from the glove centre, the elbow and the back-of-hand direction (wrists straight); the shoulder girdle takes 30 % of the arm swing.", { size: 18, fill: CREAM });
  s += T(24, 166, "Clothes: tapered singlet (chest × 1.06, waist × 1.08), arm hole 20 cm from the strap top, every seam sewn both ways (no slits), 8.5 cm elastic gripping the body. Clean render (median despeckle).", { size: 18, fill: CREAM });
  await sheet("iterations/03-arms-clothes-before-after.jpg", 2 * (2 * cw3 + 60) + 24, 230 + 4 * (ch3 + 56) + 20, "Arms and clothing: before | after", "Fourth user review: \"arms are not properly placed … clothes looks broken … make wearing accurately correct\"", panels, s);
}

/* iterations 04: the arm inside the singlet (fifth user review), before | after + the automated check */
{
  const views = [["arms-front", "Guard, front"], ["arms-side", "Guard, side (lead side)"], ["arms-34", "Guard, 3/4"]];
  const cw4 = 520, ch4 = 670;
  const panels = [];
  let s = "";
  views.forEach(([v, cap], i) => {
    const x = 24 + i * (2 * cw4 + 40);
    panels.push({ img: `sb-${v}`, x, y: 170, w: cw4, h: ch4, caption: `${cap}: before` });
    panels.push({ img: `aa-${v}`, x: x + cw4 + 10, y: 170, w: cw4, h: ch4, caption: `${cap}: after` });
  });
  s += T(24, 140, "Before: the singlet panel wrapped the upper arm like a sleeve. After: the arms are colliders the singlet drapes against from the torso side; the outer arm stays skin.", { size: 18, fill: CREAM });
  let rows = [];
  try {
    rows = JSON.parse(readFileSync(join(RAW, "armtest.json"), "utf8"));
  } catch {}
  const y0 = 170 + ch4 + 50;
  s += T(24, y0, "Automated check (qa/fighter-v8/armtest.mjs): rays to every camera-facing outer upper-arm vertex; fail if > 2 % hit singlet cloth within 4 cm of the skin", { size: 20, weight: 700 });
  rows.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const ok = r.coveredFraction <= 0.02;
    s += T(24 + col * 800, y0 + 40 + row * 28, `${ok ? "PASS" : "FAIL"}  ${r.case}: ${(r.coveredFraction * 100).toFixed(1)} % of ${r.tested}`, { size: 18, fill: ok ? CREAM : LINE });
  });
  const H4 = y0 + 60 + Math.ceil(rows.length / 4) * 28 + 20;
  await sheet("iterations/04-arm-outside-singlet.jpg", 3 * (2 * cw4 + 40) + 8, H4, "The arm passes through the arm hole: before | after", "Fifth user review: \"this arm is not placed properly, it is hidden in the cloth\"", panels, s);
}
