// QA-01 Administrative Block + Tournament Arena (UI). One browser, accounts one after another.
//   node qa/e2e/ui-buildings.mjs [desktop|phone] [admin,arena]
// Admin block: enter by the door, office picker, reception chat, lobby seat, role holder auto-enter + officer computer
// → console boot. Arena: barred / closed door behaviour, event card + scopes in plain words, pass claim / return, seat
// finder + sit / stand, removal when an admin closes the arena.
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, buttons, bodyText, clickText, shot, waitFor, email, api, ADMIN_TOKEN, perf } from "./lib.mjs";
import { DOORS, DOOR_RING, ring, walkTo, installFrameMeter, resetFrames, frames } from "./world-lib.mjs";

const vp = process.argv[2] ?? "desktop";
const only = new Set((process.argv[3] ?? "admin,arena").split(","));
const { check, note, done } = suite(`ui-buildings-${vp}`);
const adm = { "x-admin-token": ADMIN_TOKEN, "x-admin-user": "qa" };
const browser = await launch();

async function plaza(key) {
  const o = await openPage(browser, VIEWPORTS[vp]);
  await loginContext(o.page, email(key));
  await o.page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const ok = await waitFor(o.page, () => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza" && document.querySelector("[aria-label='Account and settings']"), { timeout: 120000 });
  await installFrameMeter(o.page);
  await clickText(o.page, /account and settings/i);
  await clickText(o.page, /^Fast$/, { timeout: 1500 });
  await o.page.keyboard.press("Escape");
  return { ...o, ok, key };
}
/** run to a building door and through it; returns the resulting view and timings */
async function walkIn(page, id) {
  const deg = DOORS[id];
  await page.keyboard.down("Shift");
  const near = ring(deg, DOOR_RING - 4);
  await walkTo(page, near.x, near.z, { timeout: 60000 });
  await resetFrames(page);
  const t0 = Date.now();
  const b = ring(deg, DOOR_RING + 3);
  const r = await walkTo(page, b.x, b.z, { timeout: 15000, until: (p) => p.view && p.view !== "plaza" });
  await page.keyboard.up("Shift");
  return { view: r.view, ms: Date.now() - t0, frames: await frames(page), timeout: !!r.timeout };
}
const close = async (o) => {
  await saveSession(o.page, email(o.key));
  await o.ctx.close();
};

// ================================================================== Administrative Block
if (only.has("admin")) {
  // visitor (non-staff)
  {
    const o = await plaza("lv5");
    const { page, errors } = o;
    const r = await walkIn(page, "admin");
    check("admin.door walk in", r.view === "hall:admin", JSON.stringify(r));
    check("perf.admin.no freeze crossing in", r.frames.worst < 250, `${r.frames.worst} ms`);
    await waitFor(page, () => window.__gkProbe?.ready, { timeout: 15000 });
    await sleep(2000);
    note("perf.hall:admin", JSON.stringify(await perf(page, 2500)));
    const txt = (await bodyText(page)).replace(/\n+/g, " | ");
    note("admin.arrival text", txt.slice(0, 400));
    const btn = await buttons(page);
    note("admin.buttons", JSON.stringify(btn));
    // office picker
    const picker = (await clickText(page, /^offices$|office directory|choose an office/i, { timeout: 3000 })) || /Choose the office/i.test(txt);
    await sleep(800);
    const ptxt = await bodyText(page);
    check("admin.office picker lists the four offices", picker && ["Super Admin", "IT Office", "Accountant", "Customer Support"].every((n) => ptxt.includes(n)), ptxt.slice(0, 300).replace(/\n+/g, " | "));
    check("admin.picker: visitors knock (no staff names)", !/qa_support|qa_super|qa_it\b/.test(ptxt));
    await shot(page, `admin-picker-${vp}`, { quality: 45 });
    // reception chat
    // the picker footer has "Reception" (the counter prompt says "Talk to reception")
    const rec = await clickText(page, /^reception$|talk to reception/i, { timeout: 3000 });
    await sleep(1200);
    const recTxt = await bodyText(page);
    check("admin.reception chat opens", rec && /welcome to the Administrative Block|Reception/i.test(recTxt), recTxt.slice(0, 200).replace(/\n+/g, " | "));
    if (rec) {
      const input = await page.$("input[aria-label], textarea");
      if (input) {
        await input.type("Who is in the IT office?", { delay: 10 });
        await page.keyboard.press("Enter");
        await sleep(3500);
        const ans = (await bodyText(page)).replace(/\n+/g, " | ");
        note("admin.reception answer", ans.slice(-400));
        check("admin.reception answers (rule-based fallback)", /staffed|nobody|no one|available|knock|can't share|empty|not in/i.test(ans));
      }
      await page.keyboard.press("Escape");
      await sleep(400);
    }
    // go to an office (Customer Support, nobody inside) and knock → nobody inside
    await clickText(page, /^offices$|office directory/i, { timeout: 1500 });
    await sleep(500);
    const went = await clickText(page, /customer support/i, { timeout: 2000 });
    await sleep(500);
    const goBtn = await clickText(page, /^go to office$/i, { timeout: 2000 });
    // walk to the door: the prompt reads "Knock on Customer Support" (E)
    const atDoor = await waitFor(page, () => /Knock on Customer Support/i.test(document.body.innerText), { timeout: 40000 });
    note("admin.walk to office door", `go=${goBtn} prompt=${atDoor}`);
    if (atDoor) {
      if (!(await clickText(page, /Knock on Customer Support/i, { timeout: 1500 }))) await page.keyboard.press("KeyE");
    }
    const nob = await waitFor(page, () => /Nobody is in this office|Nobody inside/i.test(document.body.innerText), { timeout: 12000 });
    check("admin.knock on an empty office → 'Nobody inside'", went && nob, (await bodyText(page)).slice(0, 200).replace(/\n+/g, " | "));
    await shot(page, `admin-knock-empty-${vp}`, { quality: 45 });
    // knock UI states driven by the dev QA hook (no second browser): knocking → wait → declined
    const hook = await page.evaluate(() => !!window.__gkOffice);
    if (hook) {
      await page.evaluate(() => window.__gkOffice.emit("office-knocking", { office: "customer-support", knockId: "qa1", expiresInMs: 30000 }));
      await sleep(600);
      const k1 = await bodyText(page);
      await page.evaluate(() => window.__gkOffice.emit("office-wait", { office: "customer-support", knockId: "qa1", expiresInMs: 180000, reason: "ASKED" }));
      await sleep(600);
      const k2 = await bodyText(page);
      await page.evaluate(() => window.__gkOffice.emit("office-refused", { office: "customer-support", knockId: "qa1", reason: "DECLINED" }));
      await sleep(600);
      const k3 = await bodyText(page);
      check("admin.knock UI: waiting / please wait / declined copy", /Waiting for an answer|Knocking/i.test(k1) && /wait/i.test(k2) && /can't see you right now|Declined/i.test(k3), [k1, k2, k3].map((t) => t.match(/(Knocking|Waiting|wait|Declined)[^|\n]{0,60}/i)?.[0]).join(" / "));
    } else note("admin.__gkOffice hook", "missing");
    // lobby seat
    const seat = await page.evaluate(() => {
      try {
        window.__gkAct?.sitNearest?.();
        return true;
      } catch (e) {
        return String(e);
      }
    });
    const sat = await waitFor(page, () => window.__gkWorld?.()?.social?.seated, { timeout: 20000 });
    check("admin.lobby seat", seat === true && sat, `seated=${sat}`);
    await page.evaluate(() => window.__gkAct?.standFromBench?.());
    // leave
    await resetFrames(page);
    const t0 = Date.now();
    await clickText(page, /^leave$/i, { timeout: 3000 });
    const back = await waitFor(page, () => window.__gkProbe?.view === "plaza", { timeout: 20000 });
    check("admin.Leave → plaza", back, `${Date.now() - t0} ms worst frame ${(await frames(page)).worst} ms`);
    check("admin.visitor run: no page errors", errors.length === 0, errors.slice(0, 6).join(" || "));
    await close(o);
  }
  // role holder (support agent) walks into Customer Support, uses the officer computer → console
  {
    const o = await plaza("support");
    const { page, errors } = o;
    const r = await walkIn(page, "admin");
    check("admin.staff door walk in", r.view === "hall:admin", JSON.stringify(r));
    await waitFor(page, () => window.__gkProbe?.ready, { timeout: 15000 });
    await sleep(1500);
    await page.evaluate(() => window.__gkAdmin?.goToOffice?.("customer-support"));
    const inside = await waitFor(page, () => /You are in the Customer Support/i.test(document.body.innerText) || window.__gkOffice?.store?.getState?.().inside === "customer-support", { timeout: 60000 });
    check("admin.role holder auto-enters the office (no knock)", inside, (await bodyText(page)).slice(0, 200).replace(/\n+/g, " | "));
    const ib = await buttons(page);
    note("admin.inside office buttons", JSON.stringify(ib));
    const comp = await clickText(page, /computer|use the computer|console|sit at the desk/i, { timeout: 4000 });
    const boot = await waitFor(page, () => /Starting Gukirana Control|Signing in as|Checking your staff role/i.test(document.body.innerText) || !!document.querySelector("nav[aria-label='Sections']"), { timeout: 20000 });
    const nav = await waitFor(page, () => !!document.querySelector("nav[aria-label='Sections']"), { timeout: 20000 });
    check("admin.officer computer → console boot", comp && boot && nav, `clicked=${comp} boot=${boot} nav=${nav}`);
    if (nav) {
      await clickText(page, /^Visitors/, { timeout: 2000 });
      await sleep(800);
      note("admin.console visitors (from office)", (await bodyText(page)).slice(0, 300).replace(/\n+/g, " | "));
      await shot(page, `admin-console-from-office-${vp}`, { quality: 45 });
      await clickText(page, /^log off$|back to the playground/i, { timeout: 2000 });
      await sleep(1500);
      check("admin.console log off returns to the office", !(await page.$("nav[aria-label='Sections']")) && (await page.evaluate(() => window.__gkProbe?.view)) === "hall:admin", page.url());
    }
    check("admin.staff run: no page errors", errors.length === 0, errors.slice(0, 6).join(" || "));
    await close(o);
  }
}

// ================================================================== Tournament Arena
if (only.has("arena")) {
  // barred user at the door
  {
    const o = await plaza("barred");
    const r = await walkIn(o.page, "arena");
    await sleep(1500);
    const txt = (await bodyText(o.page)).replace(/\n+/g, " | ");
    check("arena.barred user does not get in", r.view !== "hall:arena" || /can't enter the arena|not allowed in the arena/i.test(txt), `view=${r.view} ${txt.slice(0, 200)}`);
    check("arena.barred message in plain words", /can't enter the arena|not allowed in the arena/i.test(txt), txt.match(/(can't|not allowed)[^|]{0,80}/i)?.[0] ?? "");
    await shot(o.page, `arena-barred-${vp}`, { quality: 45 });
    await close(o);
  }
  // member: event card, pass, seat finder, sit, stand; then an admin closes the arena → walked out
  {
    const o = await plaza("lv1");
    const { page, errors } = o;
    const r = await walkIn(page, "arena");
    check("arena.member walks in", r.view === "hall:arena", JSON.stringify(r));
    check("perf.arena.no freeze crossing in", r.frames.worst < 250, `${r.frames.worst} ms`);
    await waitFor(page, () => window.__gkProbe?.ready, { timeout: 20000 });
    await sleep(2000);
    note("perf.hall:arena", JSON.stringify(await perf(page, 2500)));
    const txt = (await bodyText(page)).replace(/\n+/g, " | ");
    note("arena.arrival text", txt.slice(0, 500));
    note("arena.buttons", JSON.stringify(await buttons(page)));
    const card = (await clickText(page, /today in the arena|event|QA Members Night/i, { timeout: 3000 })) || /QA Members Night/.test(txt);
    await sleep(800);
    const ctxt = (await bodyText(page)).replace(/\n+/g, " | ");
    check("arena.event card shows the event + who may come in plain words", card && /QA Members Night/.test(ctxt) && /(signed-in|members|everyone|anyone|players)/i.test(ctxt), ctxt.slice(0, 300));
    const got = await clickText(page, /^get a pass$/i, { timeout: 3000 });
    const have = await waitFor(page, () => /You have a pass|Bowl seat pass/i.test(document.body.innerText), { timeout: 8000 });
    check("arena.get a pass", got && have);
    await shot(page, `arena-card-${vp}`, { quality: 45 });
    const finder = await clickText(page, /^find a seat$/i, { timeout: 3000 });
    await sleep(800);
    const best = await clickText(page, /best free seat/i, { timeout: 3000 });
    const seated = await waitFor(page, () => /^Seat [A-Z0-9-]+/m.test(document.body.innerText) || /Stand up/.test(document.body.innerText), { timeout: 45000 });
    check("arena.seat finder → walk to best seat → sit", finder && best && seated, (await bodyText(page)).match(/(Seat|Walking to seat|Asking for seat)[^|\n]{0,30}/g)?.slice(0, 4).join(" / ") ?? "");
    if (seated) {
      await clickText(page, /^stand up$/i, { timeout: 2000 });
      await sleep(800);
      check("arena.stand up", !/Stand up/.test(await bodyText(page)));
    }
    // admin closes the arena → the member is walked out to the plaza
    await api("/admin/arena/settings", { method: "PUT", headers: adm, body: { open: false } });
    const out = await waitFor(page, () => window.__gkProbe?.view === "plaza", { timeout: 25000 });
    const otxt = (await bodyText(page)).replace(/\n+/g, " | ");
    check("arena.close by admin walks people out to the plaza", out, otxt.match(/arena has closed[^|]{0,60}/i)?.[0] ?? otxt.slice(0, 160));
    // closed door
    const r2 = await walkIn(page, "arena");
    await sleep(1200);
    const ctx2 = (await bodyText(page)).replace(/\n+/g, " | ");
    check("arena.closed door keeps players out with a message", r2.view !== "hall:arena" || /arena is closed/i.test(ctx2), `view=${r2.view} ${ctx2.match(/arena is closed[^|]{0,60}/i)?.[0] ?? ""}`);
    await api("/admin/arena/settings", { method: "PUT", headers: adm, body: { open: true } });
    // return the pass via the API (UI return covered by the card if offered)
    const st = await api("/arena/status", { token: null });
    note("arena.status after reopen (guest)", JSON.stringify({ open: st.json?.open, current: st.json?.current?.title }));
    check("arena.member run: no page errors", errors.length === 0, errors.slice(0, 6).join(" || "));
    await close(o);
  }
  // guest at the arena door (no account): /room/arena deep link
  {
    const o = await openPage(browser, VIEWPORTS[vp]);
    await o.page.goto(`${WEB}/room/arena`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(6000);
    note("arena.guest deep link", `${o.page.url()} ${(await bodyText(o.page)).slice(0, 160).replace(/\n+/g, " | ")}`);
    check("arena.guest is sent to the gate", o.page.url().includes("/gate"), o.page.url());
    await o.ctx.close();
  }
}

await browser.close();
done();
process.exit(0);
