// QA-01 staff console at /console for each staff role + a non-staff player refused; suspend / reactivate in the UI,
// buildings close / reopen; finance numbers vs the ledger report.
//   node qa/e2e/ui-console.mjs [desktop|tablet]
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, buttons, bodyText, clickText, shot, waitFor, email, api, ADMIN_TOKEN } from "./lib.mjs";

const vp = process.argv[2] ?? "desktop";
const { check, note, done } = suite(`ui-console-${vp}`);
const NAMES = { overview: "Overview", visitors: "Visitors", users: "People", buildings: "Buildings", monitor: "Live monitor", roles: "Roles", finance: "Finance" };
const EXPECT = {
  super: ["overview", "visitors", "users", "buildings", "monitor", "roles", "finance"],
  it: ["overview", "visitors", "users", "buildings", "monitor"],
  accountant: ["overview", "visitors", "finance"],
  support: ["overview", "visitors", "users"],
  events: ["overview", "visitors"],
};
const browser = await launch();

async function openConsole(key) {
  const o = await openPage(browser, VIEWPORTS[vp]);
  await loginContext(o.page, email(key));
  const t0 = Date.now();
  await o.page.goto(`${WEB}/console`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const ok = await waitFor(o.page, () => !!document.querySelector("nav[aria-label='Sections']") || /staff only|Sign in at the gate/i.test(document.body.innerText), { timeout: 60000 });
  return { ...o, ok, ms: Date.now() - t0 };
}
const navItems = (page) => page.evaluate(() => [...document.querySelectorAll("nav[aria-label='Sections'] button, nav[aria-label='Sections'] a")].map((b) => b.innerText.trim().split("\n")[0]));

// ------------------------------------------------------------------ non-staff refused
{
  const { page, ctx, ok, errors } = await openConsole("lv5");
  await sleep(1500);
  const txt = await bodyText(page);
  check("console.player refused (staff only)", ok && /staff only/i.test(txt) && !(await page.$("nav[aria-label='Sections']")), txt.slice(0, 200).replace(/\n+/g, " | "));
  note("console.player refused errors", errors.slice(0, 4).join(" || "));
  await saveSession(page, email("lv5"));
  await ctx.close();
}

// ------------------------------------------------------------------ each staff role
for (const [key, sections] of Object.entries(EXPECT)) {
  const { page, ctx, ok, ms, errors } = await openConsole(key);
  const nav = ok ? await navItems(page) : [];
  const want = sections.map((s) => NAMES[s]);
  check(`console.${key}.boot`, ok, `${ms} ms`);
  check(`console.${key}.sections shown`, JSON.stringify(nav) === JSON.stringify(want), `${JSON.stringify(nav)} vs ${JSON.stringify(want)}`);
  for (const s of sections) {
    const clicked = await clickText(page, new RegExp(`^${NAMES[s]}`), { timeout: 3000 });
    await sleep(1200);
    const txt = await bodyText(page);
    const errShown = /something went wrong|failed|error/i.test(txt);
    check(`console.${key}.${s} renders`, clicked && !errShown, txt.slice(0, 160).replace(/\n+/g, " | "));
  }
  if (key === "super") await shot(page, `console-super-${vp}`, { quality: 50 });
  // Esc / log off
  const before = page.url();
  await page.keyboard.press("Escape");
  await sleep(1200);
  note(`console.${key}.Esc`, `${before} → ${page.url()} nav=${!!(await page.$("nav[aria-label='Sections']"))}`);
  check(`console.${key}.no page errors`, errors.filter((e) => !/401|403/.test(e)).length === 0, errors.slice(0, 5).join(" || "));
  await saveSession(page, email(key));
  await ctx.close();
}

// ------------------------------------------------------------------ support: suspend + reactivate in the UI
{
  const { page, ctx, ok } = await openConsole("support");
  if (ok) {
    await clickText(page, /^People/);
    await sleep(800);
    const search = await page.$("input[aria-label^='Search']");
    await search.type("qa_lv30", { delay: 20 });
    await sleep(1500);
    const exact = await page.evaluate(() => /qa_lv30/.test(document.querySelector("main, .gkc-main, body").innerText.replace(/Search[^\n]*/, "")) && !/No accounts match/.test(document.body.innerText));
    check("console.people search finds 'qa_lv30' (username with _)", exact, (await bodyText(page)).match(/No accounts match\.?/)?.[0] ?? "");
    if (!exact) {
      await search.click({ clickCount: 3 });
      await search.type("lv30", { delay: 20 });
      await sleep(1500);
    }
    // desktop: rows are <tr onClick>; phone: .gkc-row buttons
    const opened = await page.evaluate(() => {
      const el = [...document.querySelectorAll("tr, .gkc-row")].find((r) => /qa_lv30/.test(r.innerText));
      el?.click();
      return !!el;
    });
    const drawer = await waitFor(page, () => !!document.querySelector("aside[aria-label='Account']"), { timeout: 5000 });
    check("console.people open account drawer", opened && drawer);
    const dtxt = await bodyText(page);
    check("console.people drawer masks contacts", !/qa\.lv30@example\.test/.test(dtxt), dtxt.match(/qa[^\s|]*@example\.test/)?.[0] ?? "");
    if (await clickText(page, /^suspend account$/i, { timeout: 3000 })) {
      await clickText(page, /^confirm$/i, { timeout: 2000 });
      await sleep(600);
      const short = /3 characters or more/i.test(await bodyText(page));
      check("console.suspend needs a reason (UI)", short);
      const reason = await page.$("#reason");
      await reason?.type("QA UI suspend test", { delay: 10 });
      await clickText(page, /^confirm$/i, { timeout: 2000 });
      await sleep(1500);
      const st = (await api("/console/users?q=lv30", { headers: { "x-admin-token": ADMIN_TOKEN } })).json?.items?.[0]?.status;
      check("console.suspend via UI", st === "suspended", st);
      await clickText(page, /^reactivate account$/i, { timeout: 3000 });
      await (await page.$("#reason"))?.type("QA UI reactivate", { delay: 10 });
      await clickText(page, /^confirm$/i, { timeout: 2000 });
      await sleep(1500);
      const st2 = (await api("/console/users?q=lv30", { headers: { "x-admin-token": ADMIN_TOKEN } })).json?.items?.[0]?.status;
      check("console.reactivate via UI", st2 === "active", st2);
      const hist = await bodyText(page);
      check("console.account history shows the actions", /QA UI suspend test/.test(hist), "");
    } else check("console.suspend button", false);
    await page.keyboard.press("Escape");
    await sleep(400);
    check("a11y.Esc closes the account drawer", !(await page.$("aside[aria-label='Account']")));
  }
  await saveSession(page, email("support"));
  await ctx.close();
}

// ------------------------------------------------------------------ it_admin: close + reopen a building in the UI
{
  const { page, ctx, ok } = await openConsole("it");
  if (ok) {
    await clickText(page, /^Buildings/);
    await sleep(1000);
    const bt = await buttons(page);
    note("console.buildings buttons", JSON.stringify(bt.filter((t) => /close|reopen|open/i.test(t))));
    // the row switch ("Igisoro Court open") asks for an optional door message, then "Close building"
    await clickText(page, /^Igisoro Court open$/i, { timeout: 2000 });
    await sleep(600);
    const msg = await page.$("input[id^='msg-']");
    await msg?.type("QA back soon", { delay: 10 });
    if (await clickText(page, /^close building$/i, { timeout: 3000 })) {
      await sleep(1500);
      const pub = (await api("/buildings")).json ?? [];
      const closed = pub.find((b) => !b.open);
      check("console.close building via UI", !!closed, JSON.stringify(closed));
      if (closed) {
        check("console.close message shown at the door", /QA back soon/.test(closed.message ?? ""), closed.message);
        await clickText(page, /^Igisoro Court open$/i, { timeout: 3000 }); // switch back on
        await sleep(1500);
        const again = ((await api("/buildings")).json ?? []).find((b) => b.id === closed.id);
        check("console.reopen building via UI", again?.open === true, JSON.stringify(again));
      }
    } else check("console.close building button", false);
  }
  await saveSession(page, email("it"));
  await ctx.close();
}

// ------------------------------------------------------------------ accountant: finance numbers vs the ledger report
{
  const { page, ctx, ok } = await openConsole("accountant");
  if (ok) {
    await clickText(page, /^Finance/);
    await sleep(2000);
    const txt = (await bodyText(page)).replace(/\n+/g, " | ");
    const sum = (await api("/admin/reports/summary?days=7", { headers: { "x-admin-token": ADMIN_TOKEN } })).json;
    const rec = (await api("/admin/reports/reconciliation", { headers: { "x-admin-token": ADMIN_TOKEN } })).json;
    note("finance.ui text", txt.slice(0, 600));
    note("finance.api", JSON.stringify({ sum: sum?.byCurrency, rec }));
    const issued = sum?.byCurrency?.STAR?.starsIssued;
    const shown = issued != null && (txt.includes(String(issued)) || txt.includes(Number(issued).toLocaleString("en-US")));
    check("finance.UI shows Stars issued matching the ledger report", shown, `starsIssued=${issued}`);
    check("finance.UI shows reconciliation ok", /balanced|ok|matches|reconcil/i.test(txt), "");
    await shot(page, `console-finance-${vp}`, { quality: 50 });
  }
  await saveSession(page, email("accountant"));
  await ctx.close();
}

await browser.close();
done();
process.exit(0);
