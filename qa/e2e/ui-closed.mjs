// QA-01 / FIX-B GAP-004: a building closed from the console. The plaza door stays visibly shut for a player (leaves
// closed, "CLOSED" plaque) and tells them why on every approach (tap/click-to-walk, keyboard walking, E / Interact);
// staff walk in.
//   node qa/e2e/ui-closed.mjs [desktop|phone]   (screenshot: closed-door-player-<vp>.jpg in $QA_EVIDENCE)
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, bodyText, clickText, waitFor, email, api, ADMIN_TOKEN, shot } from "./lib.mjs";
import { DOORS, DOOR_RING, ring, walkTo, hold } from "./world-lib.mjs";

const vp = process.argv[2] ?? "desktop";
const { check, note, done } = suite(`ui-closed-${vp}`);
const adm = { "x-admin-token": ADMIN_TOKEN, "x-admin-user": "qa" };
const MSG = "QA closed: back at 18:00";
const browser = await launch();
await api("/console/buildings/ludo", { method: "PUT", headers: adm, body: { open: false, message: MSG } });

/** the door notice (HUD card), the prompt text and the door state */
const doorState = (page) =>
  page.evaluate(() => ({
    notice: document.querySelector("[data-door-notice]")?.textContent ?? "",
    body: document.body.innerText,
    open: window.__gkProbe?.doors?.ludo ?? 0,
    view: window.__gkProbe?.view,
  }));
const away = ring(DOORS.ludo, DOOR_RING - 13);

try {
  for (const [key, staff] of [["lv1", false], ["it", true]]) {
    const { page, ctx } = await openPage(browser, VIEWPORTS[vp]);
    await loginContext(page, email(key));
    await page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitFor(page, () => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza" && document.querySelector("[aria-label='Account and settings']"), { timeout: 120000 });
    await clickText(page, /account and settings/i);
    await clickText(page, /^Fast$/, { timeout: 1500 });
    await page.keyboard.press("Escape");
    const near = ring(DOORS.ludo, DOOR_RING - 4);
    await walkTo(page, near.x, near.z, { timeout: 60000 });
    // 1. click / tap-to-walk straight into the door
    const b = ring(DOORS.ludo, DOOR_RING + 3);
    const r = await walkTo(page, b.x, b.z, { timeout: 12000, until: (p) => p.view && p.view !== "plaza" });
    await sleep(1200);
    if (staff) {
      check("closed.staff can still walk into a closed building", r.view === "hall:ludo", `view=${r.view}`);
    } else {
      let s = await doorState(page);
      check("closed.click-to-walk: player kept out", s.view === "plaza", `view=${s.view}`);
      check("closed.click-to-walk: door leaves stay shut", s.open < 0.1, `doorOpen=${s.open.toFixed(2)}`);
      check("closed.click-to-walk: notice with the staff message", /Ludo Lounge is closed/.test(s.notice) && s.notice.includes("back at 18:00"), s.notice);
      check("closed.prompt says closed", /Ludo Lounge is closed/.test(s.body), (s.body.match(/[^\n]*is closed[^\n]*/) ?? [""])[0]);
      await shot(page, `closed-door-player-${vp}`, { quality: 45 });
      // dismiss, walk away, the notice is gone; 2. keyboard walking back up to the door: it is shown again
      await clickText(page, /^Close$/, { timeout: 1500 });
      await walkTo(page, away.x, away.z, { timeout: 30000 });
      s = await doorState(page);
      check("closed.notice gone when walking away", !s.notice, s.notice);
      await walkTo(page, ring(DOORS.ludo, DOOR_RING - 7).x, ring(DOORS.ludo, DOOR_RING - 7).z, { timeout: 20000 });
      await hold(page, "KeyW", 3500);
      await sleep(600);
      s = await doorState(page);
      check("closed.keyboard walking: notice shown again", s.notice.includes("back at 18:00"), `${s.notice} open=${s.open.toFixed(2)}`);
      check("closed.keyboard walking: kept out, door shut", s.view === "plaza" && s.open < 0.1, `view=${s.view} open=${s.open.toFixed(2)}`);
      // 3. E / Interact at the door (after dismissing): explains again, does not walk in
      await clickText(page, /^Close$/, { timeout: 1500 });
      await sleep(300);
      await page.keyboard.press("KeyE");
      await sleep(1500);
      s = await doorState(page);
      check("closed.E / Interact: notice shown, still outside", s.notice.includes("back at 18:00") && s.view === "plaza", `${s.notice} view=${s.view}`);
      const btn = await page.evaluate(() => document.querySelector("button[aria-label^='Interact']")?.getAttribute("aria-label") ?? "");
      check("closed.Interact button labelled Closed", /Closed/.test(btn), btn);
      note("closed.pose", JSON.stringify(await page.evaluate(() => ({ x: window.__gkProbe.self.x, z: window.__gkProbe.self.z }))));
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
