// QA-HUM-01 human realism assessment: a fixed, repeatable set of shots + automated measurements of the people in the
// app, written as contact sheets and a metrics JSON (then scored by report.mjs against docs/HUMAN-REALISM-RUBRIC.md).
//
//   node qa/e2e/human-assess/assess.mjs --web http://localhost:3995 --out docs/QA/human-realism/baseline \
//        [--only lab,matrix,lod,boxer,world,hall] [--config qa/e2e/human-assess/shots.json] [--quick]
//
// Needs the dev web app (development build: the dev hooks and the dev-only labs) with its API behind /api/v1 for the
// world / hall sections (dev OTP sign-in). Raw screenshots go to $TMPDIR/gk-human-assess/<run>/, contact sheets
// (ImageMagick `magick montage`) and metrics.json to --out.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const WEB = arg("web", process.env.QA_WEB ?? "http://localhost:3995");
const OUT = arg("out", join(tmpdir(), "gk-human-assess", "out"));
const ONLY = new Set((arg("only", "lab,matrix,lod,campus,boxer,world,hall,fpv") ?? "").split(","));
const QUICK = process.argv.includes("--quick");
const CFG = JSON.parse(readFileSync(arg("config", join(HERE, "shots.json")), "utf8"));
const RAW = join(tmpdir(), "gk-human-assess", String(Date.now()));
const SHEETS = join(OUT, "sheets");
mkdirSync(RAW, { recursive: true });
mkdirSync(SHEETS, { recursive: true });
const LIB = readFileSync(join(HERE, "inpage.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
};
const metrics = { at: new Date().toISOString(), web: WEB, git: gitRev(), sections: {} };
const save = () => writeFileSync(join(OUT, "metrics.json"), JSON.stringify(metrics, null, 1));

function gitRev() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE }).toString().trim();
  } catch {
    return null;
  }
}
function sheet(name, files, { cols = 4, tile = "480x" } = {}) {
  const ok = files.filter((f) => f && existsSync(f));
  if (!ok.length) return null;
  const out = join(SHEETS, `${name}.jpg`);
  const labels = ok.flatMap((f) => [
    "-label",
    f
      .split("/")
      .pop()
      .replace(/\.(jpg|png)$/, ""),
  ]);
  // labels must precede their file: interleave
  const args = [];
  ok.forEach((f, i) => args.push(labels[i * 2], labels[i * 2 + 1], f));
  execFileSync("magick", [
    "montage",
    ...args,
    "-tile",
    `${Math.min(cols, ok.length)}x`,
    "-geometry",
    `${tile}+3+3`,
    "-background",
    "#141414",
    "-fill",
    "#dddddd",
    "-pointsize",
    "13",
    "-quality",
    "80",
    out,
  ]);
  return out;
}
/** mean L* (0–100), chroma and blown-highlight share of a patch of an image */
function patchStats(file, x, y, w, h) {
  try {
    const crop = `${Math.max(1, Math.round(w))}x${Math.max(1, Math.round(h))}+${Math.max(0, Math.round(x))}+${Math.max(0, Math.round(y))}`;
    const lab = execFileSync("magick", [
      file,
      "-crop",
      crop,
      "+repage",
      "-colorspace",
      "Lab",
      "-format",
      "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]",
      "info:",
    ])
      .toString()
      .trim()
      .split(" ")
      .map(Number);
    const blown = Number(
      execFileSync("magick", [
        file,
        "-crop",
        crop,
        "+repage",
        "-colorspace",
        "gray",
        "-threshold",
        "96%",
        "-format",
        "%[fx:mean]",
        "info:",
      ]).toString(),
    );
    const sd = Number(
      execFileSync("magick", [
        file,
        "-crop",
        crop,
        "+repage",
        "-colorspace",
        "gray",
        "-format",
        "%[fx:standard_deviation]",
        "info:",
      ]).toString(),
    );
    return {
      L: +(lab[0] * 100).toFixed(1),
      chroma: +(Math.hypot(lab[1] - 0.5, lab[2] - 0.5) * 255).toFixed(1),
      hue: +((Math.atan2(lab[2] - 0.5, lab[1] - 0.5) * 180) / Math.PI).toFixed(0),
      blown: +(blown * 100).toFixed(2),
      texture: +(sd * 100).toFixed(2),
    };
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 120) };
  }
}
/** CIE L*, chroma of an sRGB hex (the look's skin albedo: the reference for the rendered cheek) */
function hexLab(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
  const X = (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047,
    Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2],
    Z = (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const L = 116 * f(Y) - 16,
    a = 500 * (f(X) - f(Y)),
    b = 200 * (f(Y) - f(Z));
  return { L: +L.toFixed(1), chroma: +Math.hypot(a, b).toFixed(1) };
}
/** rendered cheek vs albedo: L ratio (exposure of the skin) and chroma ratio (< 0.6 = greyed / ashy) */
async function withAlbedo(page, st, file, patch) {
  // the same patch on the matte reference sphere in the skin's albedo (human lab), same light, same camera
  if (file && patch) {
    await page.evaluate(() => {
      const h = window.__gkHuman,
        e = h.anchors().eyes;
      h.referenceAt = [e[0], e[1] - 0.045, e[2] + 0.03];
      h.reference = true;
    });
    await sleep(250);
    const ref = file.replace(/\.jpg$/, "-ref.jpg");
    await page.screenshot({ path: ref, type: "jpeg", quality: 90 });
    await page.evaluate(() => (window.__gkHuman.reference = false));
    await sleep(150);
    const r = patchStats(ref, patch.x, patch.y, patch.w, patch.h);
    if (!r.error && !st.error)
      Object.assign(st, {
        refL: r.L,
        refChroma: r.chroma,
        refRatio: +(st.L / Math.max(r.L, 0.1)).toFixed(2),
        refChromaRatio: +(st.chroma / Math.max(r.chroma, 0.1)).toFixed(2),
      });
  }
  const hex = await page.evaluate(() => window.__gkHuman.current?.skinTone ?? null);
  if (!hex || st.error) return st;
  const a = hexLab(hex);
  return {
    ...st,
    skin: hex,
    albedoL: a.L,
    albedoChroma: a.chroma,
    lRatio: +(st.L / a.L).toFixed(2),
    chromaRatio: +(st.chroma / a.chroma).toFixed(2),
  };
}
function rmse(a, b, crop) {
  try {
    const c = `${crop.w}x${crop.h}+${crop.x}+${crop.y}`;
    const r = execFileSync(
      "magick",
      [
        "compare",
        "-metric",
        "RMSE",
        "(",
        a,
        "-crop",
        c,
        "+repage",
        ")",
        "(",
        b,
        "-crop",
        c,
        "+repage",
        ")",
        "null:",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return parseRmse(r.toString());
  } catch (e) {
    return parseRmse(String(e.stderr ?? e.stdout ?? ""));
  }
}
const parseRmse = (s) => {
  const m = /\(([\d.e-]+)\)/.exec(s);
  return m ? +(Number(m[1]) * 100).toFixed(2) : null;
};

const browser = await puppeteer.launch({
  executablePath: process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--mute-audio"],
  protocolTimeout: 600_000,
});

async function newPage(vp = VIEWPORTS.desktop) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on("pageerror", (e) => console.error("  pageerror", String(e.message).slice(0, 200)));
  return page;
}
const inject = (page) => page.evaluate(LIB);

/* ------------------------------------------------------------------ the human lab (plaza person) */
async function openLab(page, query) {
  await page.goto(`${WEB}/play/human-lab?${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => window.__gkHuman?.ready, { timeout: 180_000 });
  await inject(page);
  await settle(page);
}
/** the person is built (a visible skinned mesh) and a few frames went by */
async function settle(page, ms = 900) {
  await page.waitForFunction(
    () => {
      const h = window.__gkHuman;
      if (!h?.person) return false;
      let ok = false;
      h.person.traverse((o) => {
        if (o.isSkinnedMesh) {
          let v = true;
          for (let p = o; p; p = p.parent) if (!p.visible) v = false;
          if (v) ok = true;
        }
      });
      return ok;
    },
    { timeout: 120_000 },
  );
  await sleep(ms);
}
async function labView(page, name, over = {}) {
  await page.evaluate(
    (name, over) => {
      const v = window.__gkHumanViews[name];
      Object.assign(window.__gkHuman.view, { az: v[0], el: v[1], dist: v[2], target: v[3], fov: v[4] }, over);
    },
    name,
    over,
  );
  await sleep(350);
}
async function snap(page, file, quality = 82) {
  const p = join(RAW, file.endsWith(".jpg") ? file : `${file}.jpg`);
  await page.screenshot({ path: p, type: "jpeg", quality });
  return p;
}
async function labMeasure(page) {
  return page.evaluate(() => {
    const p = window.__humanAssess.people(window.__gkHuman.scene)[0];
    if (!p) return null;
    const m = window.__humanAssess.measure(p);
    m.isolated = window.__humanAssess.isolate(
      window.__gkHuman.scene,
      p,
      window.__gkHuman.gl,
      window.__gkHuman.camera,
    );
    return m;
  });
}
async function labSample(page, seconds) {
  return page.evaluate(
    async (s) => window.__humanAssess.sample(window.__humanAssess.people(window.__gkHuman.scene)[0], s),
    seconds,
  );
}
/** face patch under the eyes (cheek / nose bridge) in screen px for the current view */
async function cheekPatch(page) {
  return page.evaluate(() => {
    const h = window.__gkHuman,
      a = h.anchors();
    const c = h.camera,
      w = innerWidth,
      hh = innerHeight;
    const e = a.eyes,
      pr = (p) => window.__humanAssess.project(p, c, w, hh);
    const [x, y] = pr([e[0], e[1] - 0.045, e[2] + 0.03]);
    const [x2] = pr([e[0] + 0.03, e[1] - 0.045, e[2] + 0.03]);
    const s = Math.max(6, Math.abs(x2 - x));
    return { x: x - s, y: y - s / 2, w: 2 * s, h: s, dpr: devicePixelRatio };
  });
}

async function sectionLab() {
  const res = { views: {}, measure: {}, idle: {}, walk: {}, face: {} };
  metrics.sections.lab = res;
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    if (QUICK && vpName === "phone") continue;
    const page = await newPage(vp);
    for (const light of CFG.lab.lights) {
      if (vpName === "phone" && light !== "day" && QUICK) continue;
      for (const look of CFG.lab.looks) {
        await openLab(page, `${look.query}&light=${light}&cam=full`);
        const views = vpName === "phone" ? CFG.lab.phoneViews : CFG.lab.views;
        const files = [];
        for (const v of views) {
          await labView(page, v);
          files.push(await snap(page, `lab-${vpName}-${look.id}-${light}-${v}`));
          if (v === "face") {
            const p = await cheekPatch(page);
            res.face[`${vpName}/${look.id}/${light}`] = await withAlbedo(
              page,
              patchStats(files.at(-1), p.x * p.dpr, p.y * p.dpr, p.w * p.dpr, p.h * p.dpr),
              files.at(-1),
              { x: p.x * p.dpr, y: p.y * p.dpr, w: p.w * p.dpr, h: p.h * p.dpr },
            );
          }
        }
        res.views[`${vpName}/${look.id}/${light}`] = sheet(`lab-${vpName}-${look.id}-${light}`, files, {
          cols: vpName === "phone" ? 3 : 5,
          tile: vpName === "phone" ? "420x" : "384x",
        });
        if (vpName === "desktop" && light === "day") {
          await labView(page, "full");
          res.measure[look.id] = await labMeasure(page);
          res.idle[look.id] = await labSample(page, QUICK ? 4 : 10);
          // walking: three speeds, a side strip, foot sliding per step
          for (const speed of CFG.lab.walkSpeeds) {
            await page.evaluate((s) => {
              window.__gkHuman.person.position.set(-12, 0, 0);
              window.__gkHuman.walk.speed = s;
            }, speed);
            await labView(page, "walk");
            await sleep(1600);
            const strip = [];
            for (let i = 0; i < 8; i++) {
              strip.push(await snap(page, `walk-${look.id}-${speed}-${i}`));
              await sleep(90);
            }
            res.walk[`${look.id}@${speed}`] = await labSample(page, QUICK ? 3 : 5);
            sheet(`walk-${look.id}-${speed}`, strip, { cols: 8, tile: "240x" });
            await page.evaluate(() => {
              window.__gkHuman.walk.speed = 0;
              window.__gkHuman.person.position.set(0, 0, 0);
              window.__gkHuman.person.rotation.y = 0;
            });
            await sleep(600);
          }
        }
        save();
      }
    }
    await page.close();
  }
}

/* ------------------------------------------------------------------ skin tone × age × body matrix */
async function sectionMatrix() {
  const res = { face: {} };
  metrics.sections.matrix = res;
  const page = await newPage(VIEWPORTS.desktop);
  for (const light of CFG.matrix.lights) {
    await openLab(page, `${CFG.matrix.base}&light=${light}&cam=face`);
    for (const body of CFG.matrix.bodies) {
      const faces = [],
        fulls = [];
      for (const age of CFG.matrix.ages)
        for (const skin of CFG.matrix.skins) {
          await page.evaluate((o) => (window.__gkHuman.look = o), `?body=${body}&skin=${skin}&age=${age}`);
          await sleep(500);
          await settle(page, 700);
          await labView(page, "face");
          const f = await snap(page, `matrix-${light}-${body}-${age}-s${skin}-face`);
          faces.push(f);
          const p = await cheekPatch(page);
          res.face[`${light}/${body}/${age}/s${skin}`] = await withAlbedo(
            page,
            patchStats(f, p.x, p.y, p.w, p.h),
            f,
            p,
          );
          if (!QUICK) {
            await labView(page, "full34");
            fulls.push(await snap(page, `matrix-${light}-${body}-${age}-s${skin}-full`));
          }
        }
      sheet(`matrix-${light}-${body}-faces`, faces, { cols: CFG.matrix.skins.length, tile: "300x" });
      if (fulls.length)
        sheet(`matrix-${light}-${body}-full`, fulls, { cols: CFG.matrix.skins.length, tile: "300x" });
      save();
    }
  }
  await page.close();
}

/* ------------------------------------------------------------------ LOD transitions (remote-player LOD) */
async function sectionLod() {
  const res = { sweep: [], switches: [] };
  metrics.sections.lod = res;
  const page = await newPage(VIEWPORTS.desktop);
  await openLab(page, `${CFG.lab.looks[0].query}&light=day&cam=full&lod=1`);
  let prev = null;
  for (let d = 3; d <= 40; d += 0.5) {
    await labView(page, "full", { dist: d, el: 2 });
    await sleep(120);
    const r = await page.evaluate(() => {
      const p = window.__humanAssess.people(window.__gkHuman.scene)[0];
      const iso = window.__humanAssess.isolate(
        window.__gkHuman.scene,
        p,
        window.__gkHuman.gl,
        window.__gkHuman.camera,
      );
      const box = window.__humanAssess.screenBox(p, window.__gkHuman.camera, innerWidth, innerHeight);
      return { ...iso, px: Math.round(box.h) };
    });
    res.sweep.push({ d, ...r });
    if (prev && Math.abs(r.tris - prev.tris) > 200)
      res.switches.push({ from: prev.d, to: d, trisBefore: prev.tris, trisAfter: r.tris, personPx: r.px });
    prev = { d, ...r };
  }
  // popping: the image change across each switch vs the change over the same step without a switch
  for (const s of res.switches) {
    const shots = [];
    for (const d of [s.from - 0.5, s.from, s.to]) {
      await labView(page, "full", { dist: d, el: 2 });
      await sleep(250);
      shots.push(await snap(page, `lod-${d}`, 92));
    }
    const box = await page.evaluate(() => {
      const p = window.__humanAssess.people(window.__gkHuman.scene)[0];
      return window.__humanAssess.screenBox(p, window.__gkHuman.camera, innerWidth, innerHeight);
    });
    const crop = {
      x: Math.max(0, Math.round(box.x - 10)),
      y: Math.max(0, Math.round(box.y - 10)),
      w: Math.round(box.w + 20),
      h: Math.round(box.h + 20),
    };
    s.rmseSwitch = rmse(shots[1], shots[2], crop);
    s.rmseControl = rmse(shots[0], shots[1], crop);
    s.pop =
      s.rmseSwitch !== null && s.rmseControl !== null ? +(s.rmseSwitch - s.rmseControl).toFixed(2) : null;
    sheet(`lod-switch-${s.from}`, shots, { cols: 3, tile: "420x" });
  }
  save();
  await page.close();
}

/* ------------------------------------------------------------------ boxers in the boxing lab */
async function sectionBoxer() {
  const res = { views: {}, measure: {}, idle: {} };
  metrics.sections.boxer = res;
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    if (QUICK && vpName === "phone") continue;
    const page = await newPage(vp);
    for (const job of CFG.boxer.jobs) {
      const files = [];
      for (const cam of vpName === "phone" ? CFG.boxer.phoneCams : CFG.boxer.cams) {
        await page.goto(`${WEB}/play/boxing-lab?${job.query}&cam=${cam}`, {
          waitUntil: "domcontentloaded",
          timeout: 180_000,
        });
        await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 20, {
          timeout: 180_000,
        });
        await sleep(900);
        files.push(await snap(page, `boxer-${vpName}-${job.id}-${cam}`));
        if (vpName === "desktop" && cam === CFG.boxer.cams[0]) {
          // proportions in the standing bind pose (the guard crouches), garments / clipping in the guard
          await page.goto(`${WEB}/play/boxing-lab?${job.query}&cam=${cam}&bind=1&headgear=0`, {
            waitUntil: "domcontentloaded",
            timeout: 180_000,
          });
          await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 20, {
            timeout: 180_000,
          });
          await sleep(600);
          await inject(page);
          res.bind ??= {};
          res.bind[job.id] = await page.evaluate(() =>
            window.__humanAssess.people(window.__gkBoxer.scene).map((p) => window.__humanAssess.measure(p)),
          );
          await page.goto(`${WEB}/play/boxing-lab?${job.query}&cam=${cam}`, {
            waitUntil: "domcontentloaded",
            timeout: 180_000,
          });
          await page.waitForFunction(() => window.__gkBoxer?.ready && window.__gkProbe?.frames > 20, {
            timeout: 180_000,
          });
          await sleep(600);
          await inject(page);
          res.measure[job.id] = await page.evaluate(() => {
            const sc = window.__gkBoxer.scene,
              ps = window.__humanAssess.people(sc);
            return ps.map((p) => window.__humanAssess.measure(p));
          });
          res.idle[job.id] = await page.evaluate(
            async (s) => {
              const p = window.__humanAssess.people(window.__gkBoxer.scene)[0];
              return p ? window.__humanAssess.sample(p, s) : null;
            },
            QUICK ? 3 : 8,
          );
        }
      }
      res.views[`${vpName}/${job.id}`] = sheet(`boxer-${vpName}-${job.id}`, files, {
        cols: 4,
        tile: vpName === "phone" ? "420x" : "384x",
      });
      save();
    }
    await page.close();
  }
}

/* ------------------------------------------------------------------ the world: me on the plaza, time of day, crowd */
async function signIn(page, prefix) {
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.evaluate(async (prefix) => {
    const phone = prefix + String(Date.now() % 1000).padStart(3, "0");
    const r = await fetch("/api/v1/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: phone }),
    }).then((x) => x.json());
    const v = await fetch("/api/v1/auth/otp/verify", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: phone, code: r.devCode }),
    }).then((x) => x.json());
    await fetch("/api/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` },
      body: JSON.stringify({ username: "hq" + (Date.now() % 100000) }),
    });
  }, prefix);
}
/** inspector camera: renders the app's scene from our own viewpoint (dev builds expose the renderer on __gkProbe) */
async function installInspector(page) {
  await page.evaluate(() => {
    const pr = window.__gkProbe,
      gl = pr.gl;
    if (!gl || gl.__qaPatched) return;
    const render = gl.render.bind(gl);
    gl.render = (s, c) => render(s, window.__qaCam && c === pr.cam ? window.__qaCam : c);
    gl.__qaPatched = true;
  });
}
/** aim the inspector at a person: view = [az°, el°, dist, target "head" | "body" | "feet" | "hand"], az relative to their facing */
async function aim(page, idx, view, fov = 30) {
  return page.evaluate(
    (idx, view, fov) => {
      const pr = window.__gkProbe;
      const ps = window.__humanAssess.people(pr.root);
      const p =
        typeof idx === "number"
          ? ps[idx]
          : (ps.find(idx === "self" ? (q) => q.root === window.__qaSelfRoot : () => false) ?? ps[0]);
      if (!p) return null;
      const cam = (window.__qaCam ??= pr.cam.clone());
      cam.aspect = pr.cam.aspect;
      cam.fov = fov;
      cam.near = 0.02;
      cam.updateProjectionMatrix();
      const head = p.bones.find((b) => /(^|_)head$/i.test(b.name));
      const hand = p.bones.find((b) => /R_Hand$/i.test(b.name));
      const base = p.top.getWorldPosition(cam.position.clone());
      const headY = head ? head.getWorldPosition(cam.position.clone()).y : base.y + 1.6;
      const T =
        view[3] === "head" && head
          ? head.getWorldPosition(cam.position.clone()).add({ x: 0, y: 0.07, z: 0 })
          : view[3] === "hand" && hand
            ? hand.getWorldPosition(cam.position.clone())
            : base.clone().setY(view[3] === "feet" ? base.y + 0.12 : base.y + (headY - base.y) * 0.55);
      // facing: where the eyes look (head → eyes, horizontal), else the person root's +z
      const eyes = p.bones.filter((b) => /(L_?|R_?)Eye$/i.test(b.name));
      let fwd = null;
      if (head && eyes.length) {
        const h = head.getWorldPosition(cam.position.clone());
        const e = eyes
          .reduce(
            (a, b) => a.add(b.getWorldPosition(cam.position.clone())),
            cam.position.clone().set(0, 0, 0),
          )
          .multiplyScalar(1 / eyes.length);
        fwd = e.sub(h).setY(0);
        if (fwd.lengthSq() < 1e-6) fwd = null;
        else fwd.normalize();
      }
      fwd ??= cam.position
        .clone()
        .set(0, 0, 1)
        .applyQuaternion(p.root.getWorldQuaternion(cam.quaternion.clone()));
      const yaw = Math.atan2(fwd.x, fwd.z) + (view[0] * Math.PI) / 180;
      const el = (view[1] * Math.PI) / 180;
      cam.position.set(
        T.x + Math.sin(yaw) * Math.cos(el) * view[2],
        T.y + Math.sin(el) * view[2],
        T.z + Math.cos(yaw) * Math.cos(el) * view[2],
      );
      cam.lookAt(T);
      cam.updateMatrixWorld(true);
      return { idx: ps.indexOf(p), n: ps.length };
    },
    idx,
    view,
    fov,
  );
}
/** hide / show the HUD (every element that is not the 3D canvas or one of its ancestors) for inspector shots */
async function hud(page, show) {
  await page.evaluate((show) => {
    const c = document.querySelector("canvas");
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    const walk = (el) => {
      for (const k of el.children) {
        if (keep.has(k)) walk(k);
        else if (k !== c) k.style.visibility = show ? "" : "hidden";
      }
    };
    walk(document.body);
  }, show);
}
const WORLD_VIEWS = {
  full: [0, 3, 4.6, "body"],
  full34: [35, 4, 4.6, "body"],
  side: [90, 3, 4.6, "body"],
  back: [180, 4, 4.6, "body"],
  face: [0, 2, 0.65, "head", 28],
  face34: [35, 3, 0.65, "head", 28],
  hand: [-70, 10, 0.55, "hand"],
};

async function sectionWorld() {
  const res = { views: {}, self: null, walk: null, crowd: null, perf: {} };
  metrics.sections.world = res;
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    if (QUICK && vpName === "phone") continue;
    const page = await newPage(vp);
    await signIn(page, "0788415");
    await page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.__gkProbe?.ready && window.__gkProbe.frames > 60, {
      timeout: 180_000,
    });
    await sleep(8000);
    await inject(page);
    await installInspector(page);
    // me = the person nearest my pose
    await page.evaluate(() => {
      const pr = window.__gkProbe,
        me = pr.self;
      let best = null,
        bd = 1e9;
      for (const p of window.__humanAssess.people(pr.root)) {
        const w = p.top.getWorldPosition(pr.cam.position.clone());
        const d = Math.hypot(w.x - me.x, w.z - me.z);
        if (d < bd) ((bd = d), (best = p));
      }
      window.__qaSelfRoot = best?.root ?? null;
    });
    for (const [phase, minutes] of Object.entries(CFG.world.tod)) {
      await page.evaluate((m) => window.__gkTod?.pin(m, true), minutes);
      await sleep(2500);
      const files = [];
      await hud(page, false);
      for (const v of vpName === "phone" ? ["full34", "face"] : Object.keys(WORLD_VIEWS)) {
        const wv = WORLD_VIEWS[v];
        await aim(page, "self", wv, wv[4] ?? 30);
        await sleep(400);
        files.push(await snap(page, `world-${vpName}-${phase}-${v}`));
      }
      // the app's own follow camera as the player sees it
      await page.evaluate(() => (window.__qaCam = null));
      await hud(page, true);
      await sleep(300);
      files.push(await snap(page, `world-${vpName}-${phase}-game-camera`));
      res.views[`${vpName}/${phase}`] = sheet(`world-${vpName}-${phase}`, files, {
        cols: 4,
        tile: vpName === "phone" ? "420x" : "384x",
      });
      res.perf[`${vpName}/${phase}`] = await page.evaluate(() => ({
        calls: window.__gkProbe.calls,
        tris: window.__gkProbe.tris,
        textures: window.__gkProbe.textures,
        fps: Math.round(window.__gkPerf?.fps ?? 0),
      }));
    }
    if (vpName === "desktop") {
      res.self = await page.evaluate(() => {
        const pr = window.__gkProbe,
          p = window.__humanAssess.people(pr.root).find((q) => q.root === window.__qaSelfRoot);
        if (!p) return null;
        const m = window.__humanAssess.measure(p);
        m.isolated = window.__humanAssess.isolate(pr.root, p, pr.gl, pr.cam);
        return m;
      });
      // the crowd: every person on screen, their triangles and distance (LOD in context)
      res.crowd = await page.evaluate(() => {
        const pr = window.__gkProbe,
          cam = pr.cam;
        return window.__humanAssess.people(pr.root).map((p) => {
          const w = p.top.getWorldPosition(cam.position.clone());
          return {
            d: +w.distanceTo(cam.position).toFixed(1),
            tris: p.meshes.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0),
            meshes: p.meshes.length,
          };
        });
      });
      // walking in the game: tap-to-walk 14 m, sample my feet
      await page.evaluate(() => window.__gkTod?.pin(600, true));
      await page.evaluate(() => {
        const s = window.__gkProbe.self;
        window.__gkNav.goal = null;
        window.__gkNav.target = { x: s.x + 10, z: s.z - 10 };
      });
      await sleep(900);
      const strip = [];
      await hud(page, false);
      await aim(page, "self", [90, 3, 4.8, "body"]);
      res.walk = await page.evaluate(async () => {
        const pr = window.__gkProbe,
          p = window.__humanAssess.people(pr.root).find((q) => q.root === window.__qaSelfRoot);
        return p ? window.__humanAssess.sample(p, 4) : null;
      });
      for (let i = 0; i < 6; i++) {
        await aim(page, "self", [90, 3, 4.8, "body"]);
        strip.push(await snap(page, `world-walk-${i}`));
        await sleep(120);
      }
      sheet("world-walk", strip, { cols: 6, tile: "300x" });
    }
    save();
    await page.close();
  }
}

/* ------------------------------------------------------------------ the boxing hall: referee, boxers, staff */
async function sectionHall() {
  const res = { people: [], views: {}, perf: {} };
  metrics.sections.hall = res;
  const page = await newPage(VIEWPORTS.desktop);
  await signIn(page, "0788416");
  await page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => window.__gkProbe?.ready && window.__gkProbe.frames > 60, {
    timeout: 180_000,
  });
  await sleep(6000);
  await page.evaluate(() => window.__gkStage.getState().show("hall:boxing"));
  await page.waitForFunction(() => window.__gkProbe?.view === "hall:boxing" && window.__gkProbe.ready, {
    timeout: 180_000,
  });
  await sleep(8000);
  if (CFG.hall.practice) {
    await page.evaluate((r) => window.__gkFight?.actions.practice(r, 1), CFG.hall.ring);
    for (let i = 0; i < 20; i++) {
      const done = await page.evaluate(() => {
        const box = [...document.querySelectorAll('input[type="checkbox"]')].find((b) =>
          b.closest("label")?.textContent?.includes("accept"),
        );
        if (!box) return false;
        if (!box.checked) box.click();
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /Accept and continue/.test(b.textContent ?? ""),
        );
        if (btn && !btn.disabled) (btn.click(), true);
        return !!btn && !btn.disabled;
      });
      if (done) break;
      await sleep(500);
    }
    for (
      let i = 0;
      i < 80 &&
      (await page.evaluate(() => window.__gkFight?.bridge.getState().mine?.snap?.phase)) !== "round";
      i++
    )
      await sleep(500);
    await sleep(2500);
  }
  await inject(page);
  await installInspector(page);
  const files = [await snap(page, "hall-game-camera")];
  await hud(page, false);
  // people nearest the camera (the ring): full + face of each
  const list = await page.evaluate(() => {
    const pr = window.__gkProbe,
      cam = pr.cam;
    return window.__humanAssess
      .people(pr.root)
      .map((p, i) => ({
        i,
        d: p.top.getWorldPosition(cam.position.clone()).distanceTo(cam.position),
        name: p.meshes.map((m) => m.name).join("+"),
        tris: p.meshes.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0),
      }))
      .sort((a, b) => a.d - b.d);
  });
  res.people = list.map((x) => ({ ...x, d: +x.d.toFixed(1) }));
  for (const p of list.slice(0, CFG.hall.people)) {
    for (const v of ["full34", "face"]) {
      const wv = WORLD_VIEWS[v];
      await aim(page, p.i, wv, wv[4] ?? 30);
      await sleep(400);
      files.push(await snap(page, `hall-p${p.i}-${v}`));
    }
  }
  const ms = await page.evaluate(
    (ids) => {
      const pr = window.__gkProbe,
        ps = window.__humanAssess.people(pr.root);
      return ids.map((i) => ({ i, ...window.__humanAssess.measure(ps[i]) }));
    },
    list.slice(0, CFG.hall.people).map((p) => p.i),
  );
  res.measure = ms;
  await page.evaluate(() => (window.__qaCam = null));
  await hud(page, true);
  if (CFG.hall.fpv) {
    await page.evaluate(CFG.hall.fpv);
    await sleep(1500);
    files.push(await snap(page, "hall-fpv"));
  }
  res.perf = await page.evaluate(() => ({
    calls: window.__gkProbe.calls,
    tris: window.__gkProbe.tris,
    textures: window.__gkProbe.textures,
  }));
  res.views.desktop = sheet("hall-people", files, { cols: 4, tile: "384x" });
  save();
  await page.close();
}

/* ------------------------------------------------------------------ first-person fight view (fight lab, no login) */
async function sectionFpv() {
  const res = { frames: {}, intrusion: {} };
  metrics.sections.fpv = res;
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    if (QUICK && vpName === "phone") continue;
    const page = await newPage(vp);
    await page.goto(`${WEB}/fight-lab?${CFG.fpv.query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.__gkRingLab?.frames > 30 && window.__gkPractice?.session(), {
      timeout: 180_000,
    });
    await inject(page);
    for (
      let i = 0;
      i < 80 && (await page.evaluate(() => window.__gkPractice.session().state.phase)) !== "round";
      i++
    )
      await sleep(250);
    await sleep(1200);
    await page.keyboard.down("w");
    await sleep(700);
    await page.keyboard.up("w");
    await sleep(500);
    const files = [];
    const frame = async (name) => {
      res.intrusion[`${vpName}/${name}`] = await page.evaluate(async () => {
        const sc = window.__gkRingLab.scene;
        const { camera } = await window.__humanAssess.grab(sc);
        return window.__humanAssess.lensIntrusion(sc, camera, 0.2);
      });
      files.push(await snap(page, `fpv-${vpName}-${name}`));
    };
    await frame("guard");
    for (const [k, name, at] of CFG.fpv.punches) {
      await page.keyboard.press(k);
      await sleep(at);
      await frame(name);
      await sleep(650);
    }
    await page.keyboard.down("l");
    await sleep(500);
    await frame("block");
    await page.keyboard.up("l");
    await page.evaluate(() => Object.assign(window.__gkFpvLook ?? {}, { yaw: 0, pitch: 0.95, held: true }));
    await sleep(900);
    await frame("look-down");
    await page.evaluate(() => Object.assign(window.__gkFpvLook ?? {}, { yaw: 0, pitch: 0, held: false }));
    await page.evaluate(() => window.__gkRingLab.ui.getState().set({ fightCam: "fight" }));
    await sleep(1800);
    files.push(await snap(page, `fpv-${vpName}-side-camera`));
    res.frames[vpName] = sheet(`fpv-${vpName}`, files, {
      cols: 4,
      tile: vpName === "phone" ? "420x" : "400x",
    });
    save();
    await page.close();
  }
}

/* ------------------------------------------------------------------ campus people (P2-AVA-12) */
const setAct = (page, a) => page.evaluate((a) => (window.__gkHuman.act = a), a);
/** a strip of `n` frames `gap` ms apart */
async function strip(page, name, n, gap) {
  const files = [];
  for (let i = 0; i < n; i++) {
    files.push(await snap(page, `${name}-${i}`));
    await sleep(gap);
  }
  return files;
}
async function sectionCampus() {
  const C = CFG.campus;
  const res = { caps: {}, clothes: {}, motion: {}, reactions: {} };
  metrics.sections.campus = res;
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const page = await newPage(vp);
    // headwear: day + night on desktop, day on the phone
    for (const light of vpName === "desktop" ? ["day", "night"] : ["day"]) {
      const files = [];
      for (const look of C.caps) {
        await openLab(page, `${look.query}&light=${light}&cam=face34`);
        for (const v of C.capViews) {
          await labView(page, v);
          files.push(await snap(page, `cap-${vpName}-${light}-${look.id}-${v}`));
        }
      }
      res.caps[`${vpName}/${light}`] = sheet(`caps-${vpName}-${light}`, files, { cols: C.capViews.length, tile: vpName === "phone" ? "360x" : "300x" });
      save();
    }
    // clothing close-ups (day, sunset on desktop)
    for (const light of vpName === "desktop" ? ["day", "sunset"] : ["day"]) {
      const files = [];
      for (const look of C.clothes) {
        await openLab(page, `${look.query}&light=${light}&cam=torso34`);
        for (const v of C.clothViews) {
          await labView(page, v);
          files.push(await snap(page, `cloth-${vpName}-${light}-${look.id}-${v}`));
        }
      }
      res.clothes[`${vpName}/${light}`] = sheet(`clothes-${vpName}-${light}`, files, { cols: C.clothViews.length, tile: vpName === "phone" ? "360x" : "300x" });
      save();
    }
    if (vpName === "phone") {
      await page.close();
      continue;
    }
    // motion strips: walk, run, start → stop, standing jump, running jump (side view, the camera tracks)
    for (const look of C.motionLooks) {
      await openLab(page, `${look.query}&light=day&cam=walk`);
      const go = async (speed, act = null) =>
        page.evaluate(
          (s, a) => {
            window.__gkHuman.person.position.set(s > 0 ? -10 : 0, 0, 0);
            window.__gkHuman.person.rotation.y = s > 0 ? Math.PI / 2 : 0;
            window.__gkHuman.walk.speed = s;
            window.__gkHuman.act = a;
          },
          speed,
          act,
        );
      for (const [name, speed] of [
        ["walk", 1.4],
        ["run", 3.4],
      ]) {
        await go(speed);
        await labView(page, "walk");
        await sleep(1800);
        res.motion[`${look.id}/${name}`] = sheet(`motion-${look.id}-${name}`, await strip(page, `m-${look.id}-${name}`, 10, 60), { cols: 10, tile: "200x" });
        res.motion[`${look.id}/${name}/sample`] = await labSample(page, 3);
      }
      // start → stop: walk 1.2 s, stop, the settle frames
      await go(0);
      await labView(page, "walk");
      await sleep(800);
      await go(1.6);
      const ss = await strip(page, `m-${look.id}-start`, 5, 120);
      await sleep(600);
      await page.evaluate(() => (window.__gkHuman.walk.speed = 0));
      ss.push(...(await strip(page, `m-${look.id}-stop`, 7, 110)));
      res.motion[`${look.id}/startstop`] = sheet(`motion-${look.id}-startstop`, ss, { cols: 12, tile: "200x" });
      // standing jump
      await go(0);
      await labView(page, "jump");
      await sleep(900);
      await setAct(page, C.jump);
      res.motion[`${look.id}/jump`] = sheet(`motion-${look.id}-jump`, await strip(page, `m-${look.id}-jump`, 12, 70), { cols: 12, tile: "200x" });
      await setAct(page, null);
      await sleep(1200);
      // running jump
      await go(3.4);
      await labView(page, "jump");
      await sleep(1600);
      await setAct(page, C.jump);
      res.motion[`${look.id}/runjump`] = sheet(`motion-${look.id}-runjump`, await strip(page, `m-${look.id}-runjump`, 12, 70), { cols: 12, tile: "200x" });
      await go(0);
      save();
    }
    // reactions (full 3/4 view, three moments each) and their faces
    for (const look of C.motionLooks) {
      await openLab(page, `${look.query}&light=day&cam=full34`);
      const files = [];
      const faces = [];
      for (const [code, name] of C.reactions) {
        await setAct(page, null);
        await labView(page, "full34");
        await sleep(1500);
        await setAct(page, code);
        for (const t of [350, 650, 900]) {
          await sleep(t);
          files.push(await snap(page, `r-${look.id}-${name}-${t}`));
        }
        await labView(page, "face34");
        await sleep(200);
        faces.push(await snap(page, `rf-${look.id}-${name}`));
      }
      await setAct(page, null);
      res.reactions[look.id] = sheet(`reactions-${look.id}`, files, { cols: 9, tile: "220x" });
      res.reactions[`${look.id}/faces`] = sheet(`reactions-${look.id}-faces`, faces, { cols: 6, tile: "260x" });
      save();
    }
    await page.close();
  }
}

try {
  for (const [k, fn] of Object.entries({
    campus: sectionCampus,
    fpv: sectionFpv,
    lab: sectionLab,
    matrix: sectionMatrix,
    lod: sectionLod,
    boxer: sectionBoxer,
    world: sectionWorld,
    hall: sectionHall,
  })) {
    if (!ONLY.has(k)) continue;
    const t0 = Date.now();
    console.log(`section ${k} …`);
    try {
      await fn();
    } catch (e) {
      console.error(`section ${k} failed:`, e.message);
      metrics.sections[k] = { ...(metrics.sections[k] ?? {}), error: String(e.message).slice(0, 300) };
    }
    console.log(`section ${k} done in ${Math.round((Date.now() - t0) / 1000)} s`);
    save();
  }
} finally {
  await browser.close();
}
console.log(`metrics → ${join(OUT, "metrics.json")}\nsheets → ${SHEETS}\nraw → ${RAW}`);
