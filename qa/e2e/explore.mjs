// Ad-hoc exploration helper: node qa/e2e/explore.mjs <path> [viewport] [identifier|-] [waitMs]
// Opens a page (optionally signed in), waits, prints visible buttons / inputs / text and saves a screenshot to OUT.
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, OUT, buttons, bodyText, sleep } from "./lib.mjs";

const [path = "/", vp = "desktop", who = "-", wait = "8000"] = process.argv.slice(2);
const b = await launch();
const { page, errors } = await openPage(b, VIEWPORTS[vp]);
if (who !== "-") await loginContext(page, who);
const t0 = Date.now();
await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await sleep(Number(wait));
console.log("url", page.url(), "after", Date.now() - t0, "ms");
console.log("buttons", JSON.stringify(await buttons(page)));
console.log(
  "inputs",
  JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("input,textarea,select")].map((i) => ({ type: i.type, name: i.name, ph: i.placeholder, aria: i.getAttribute("aria-label") })))),
);
console.log("text", (await bodyText(page)).slice(0, 1500).replace(/\n+/g, " | "));
console.log(
  "probe",
  JSON.stringify(
    await page.evaluate(() => {
      const p = window.__gkProbe;
      return p ? { frames: p.frames, view: p.view, ready: p.ready, marks: p.marks, programs: p.programs } : null;
    }),
  ),
);
await page.screenshot({ path: `${OUT}/explore-${vp}.jpg`, type: "jpeg", quality: 50 });
console.log("shot", `${OUT}/explore-${vp}.jpg`);
console.log("errors", JSON.stringify(errors.slice(0, 10)));
if (who !== "-") await saveSession(page, who);
await b.close();
