// QA-01 a building closed from the console: the plaza door keeps players out (with the message) but lets staff in.
//   node qa/e2e/ui-closed.mjs [desktop|phone]
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, bodyText, clickText, waitFor, email, api, ADMIN_TOKEN, shot } from "./lib.mjs";
import { DOORS, DOOR_RING, ring, walkTo } from "./world-lib.mjs";

const vp = process.argv[2] ?? "desktop";
const { check, done } = suite(`ui-closed-${vp}`);
const adm = { "x-admin-token": ADMIN_TOKEN, "x-admin-user": "qa" };
const browser = await launch();
await api("/console/buildings/ludo", { method: "PUT", headers: adm, body: { open: false, message: "QA closed: back at 18:00" } });
try {
  for (const [key, staff] of [["lv1", false], ["it", true]]) {
    const { page, ctx } = await openPage(browser, VIEWPORTS[vp]);
    await loginContext(page, email(key));
    await page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitFor(page, () => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza" && document.querySelector("[aria-label='Account and settings']"), { timeout: 120000 });
    await clickText(page, /account and settings/i);
    await clickText(page, /^Fast$/, { timeout: 1500 });
    await page.keyboard.press("Escape");
    await page.keyboard.down("Shift");
    const near = ring(DOORS.ludo, DOOR_RING - 4);
    await walkTo(page, near.x, near.z, { timeout: 60000 });
    const b = ring(DOORS.ludo, DOOR_RING + 3);
    const r = await walkTo(page, b.x, b.z, { timeout: 12000, until: (p) => p.view && p.view !== "plaza" });
    await page.keyboard.up("Shift");
    await sleep(1200);
    const txt = (await bodyText(page)).replace(/\n+/g, " | ");
    if (staff) check("closed.staff can still walk into a closed building", r.view === "hall:ludo", `view=${r.view}`);
    else {
      check("closed.player kept out of a closed building", r.view !== "hall:ludo", `view=${r.view}`);
      check("closed.player sees the door message", /back at 18:00|closed/i.test(txt), txt.match(/[^|]*(closed|18:00)[^|]*/i)?.[0] ?? "");
      await shot(page, `closed-door-player-${vp}`, { quality: 45 });
      const nearPortal = await page.evaluate(() => window.__gkProbe?.self && JSON.stringify({ x: window.__gkProbe.self.x, z: window.__gkProbe.self.z }));
      console.log("NOTE  closed.pose", nearPortal);
    }
    await saveSession(page, email(key));
    await ctx.close();
  }
} finally {
  await api("/console/buildings/ludo", { method: "PUT", headers: adm, body: { open: true, message: "" } });
}
await browser.close();
done();
process.exit(0);
