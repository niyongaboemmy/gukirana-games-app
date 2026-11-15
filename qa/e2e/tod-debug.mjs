// P2-WLD-19 debug helper: sign in, open the plaza, pin a time and dump the outdoor lights / environment / fog.
//   BASE=http://localhost:3960 node qa/e2e/tod-debug.mjs [minutes] [shot.jpg]
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE ?? "http://localhost:3960";
const min = Number(process.argv[2] ?? 750);
const out = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--ignore-gpu-blocklist"], protocolTimeout: 600000 });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
p.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 300)));
p.on("console", (m) => ["error", "warn", "warning"].includes(m.type()) && console.log("console", m.type(), m.text().slice(0, 400)));
await p.goto(`${BASE}/gate`, { waitUntil: "domcontentloaded" });
await p.evaluate(async () => {
  const phone = "0789" + String(Date.now() % 1000000).padStart(6, "0");
  const r = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone }) }).then((r) => r.json());
  const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone, code: r.devCode }) }).then((r) => r.json());
  await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "dbg" + (Date.now() % 100000) }) });
});
await p.goto(`${BASE}/world`, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 120; i++) {
  if (await p.evaluate(() => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza").catch(() => false)) break;
  await sleep(1000);
}
await sleep(5000);
await p.evaluate((m) => window.__gkTod?.pin(m, true), min);
await p.evaluate(() => Object.assign(window.__gkCam, { yaw: 0, pitch: 0.2, distance: 9 }));
await sleep(3000);
const info = await p.evaluate(() => {
  const root = window.__gkTodRoot;
  const out = { tod: window.__gkTod?.state(), scenes: [] };
  const seen = new Set();
  root?.traverse((o) => {
    if (o.isScene && !seen.has(o)) {
      seen.add(o);
      const s = { name: o.name, visible: o.visible, env: !!o.environment, envI: o.environmentIntensity, fog: o.fog ? [o.fog.color.getHexString(), o.fog.density] : null, lights: [] };
      o.traverse((l) => {
        if (l.isLight) s.lights.push({ t: l.type, i: +l.intensity.toFixed(3), c: l.color.getHexString(), vis: l.visible, sh: l.shadow ? +l.shadow.intensity.toFixed(2) : null, pos: l.position.toArray().map((v) => +v.toFixed(1)) });
      });
      out.scenes.push(s);
    }
  });
  const lg = root?.getObjectByName('lighting');
  out.calls = window.__gkProbe?.calls;
  out.lightingGroupFog = lg?.fog ? lg.fog.type : null;
  return out;
});
console.log(JSON.stringify(info));
if (out) await p.screenshot({ path: out, type: "jpeg", quality: 70 });
const evalSrc = process.env.EVAL_FILE ? (await import("node:fs")).readFileSync(process.env.EVAL_FILE, "utf8") : process.env.EVAL;
if (evalSrc) {
  const steps = evalSrc.split(";;");
  for (let i = 0; i < steps.length; i++) {
    console.log("eval", i, JSON.stringify(await p.evaluate(steps[i]).catch((e) => String(e))));
    await sleep(1500);
    if (out) await p.screenshot({ path: out.replace(".jpg", `-e${i}.jpg`), type: "jpeg", quality: 60 });
  }
}
await b.close();
