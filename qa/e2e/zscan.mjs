import puppeteer from "puppeteer-core";
import fs from "node:fs";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const lib = fs.readFileSync(new URL("./zscan-lib.js", import.meta.url), "utf8");
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal","--ignore-gpu-blocklist"], protocolTimeout: 600000 });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const where = process.argv[2] ?? "gate";
if (where === "gate") { await p.goto((process.env.BASE ?? "http://localhost:3200") + "/gate", { waitUntil: "domcontentloaded" }); await sleep(25000); }
else {
  await p.goto((process.env.BASE ?? "http://localhost:3200") + "/gate", { waitUntil: "domcontentloaded" });
  await p.evaluate(async () => { const phone = "0788413" + String(Date.now() % 1000).padStart(3, "0");
    const r = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone }) }).then(r=>r.json());
    const v = await fetch("/api/v1/auth/otp/verify", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: phone, code: r.devCode }) }).then(r=>r.json());
    await fetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${v.accessToken}` }, body: JSON.stringify({ username: "zs" + (Date.now() % 100000) }) }); });
  await p.goto((process.env.BASE ?? "http://localhost:3200") + "/world", { waitUntil: "domcontentloaded" }); await sleep(30000);
  if (where !== "plaza") { await p.evaluate((w)=>window.__gkStage.getState().show(w), where); await sleep(15000); }
}
await p.evaluate(lib);
const r = await p.evaluate(() => window.__zscan({ top: 60 }));
console.log(where, "flat tris:", r.tris); console.log(r.hits.join("\n"));
const w = await p.evaluate(() => window.__zscanWalls({ top: 40 }));
console.log(where, "wall faces:", w.faces); console.log(w.hits.join("\n"));
await b.close();
