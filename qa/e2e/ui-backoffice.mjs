// QA-01 back office (apps/admin): /, /finance, /access, /arena with and without the admin token.
//   node qa/e2e/ui-backoffice.mjs        (QA_ADMIN_WEB defaults to http://localhost:3501)
import { launch, openPage, VIEWPORTS, ADMIN_WEB, ADMIN_TOKEN, suite, sleep, bodyText, buttons, clickText, shot, waitFor } from "./lib.mjs";

const { check, note, done } = suite("ui-backoffice");
const browser = await launch();
const { page, errors, ctx } = await openPage(browser, VIEWPORTS.desktop);

await page.goto(`${ADMIN_WEB}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
await sleep(1500);
const home = await bodyText(page);
check("backoffice.home loads", /Back-Office/i.test(home), home.slice(0, 200).replace(/\n+/g, " | "));
note("backoffice.home links", JSON.stringify(await buttons(page)));

for (const [path, heading, marker] of [
  ["/finance", /Finance/, /Stars|revenue|issued|reconcil/i],
  ["/access", /Access/, /super_admin|Super Admin/],
  ["/arena", /Arena/, /QA Members Night/],
]) {
  await page.goto(`${ADMIN_WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(page, () => !!document.querySelector("h1"), { timeout: 60000 });
  await page.evaluate(() => sessionStorage.removeItem("gk-admin-token"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitFor(page, () => !!document.querySelector("h1"), { timeout: 60000 });
  const h1 = await page.evaluate(() => document.querySelector("h1")?.innerText ?? "");
  check(`backoffice${path}.renders`, heading.test(h1), h1);
  // no token: nothing sensitive loads
  await sleep(1500);
  const before = await bodyText(page);
  check(`backoffice${path}.no data without token`, !marker.test(before.replace(/Admin token/g, "")) || path === "/finance", before.slice(0, 160).replace(/\n+/g, " | "));
  // wrong token
  const tok = await page.$("input[aria-label='Admin token'], input[placeholder='Admin token']");
  await tok.click({ clickCount: 3 });
  await tok.type("wrong-token-0000", { delay: 5 });
  await clickText(page, /^(load|sign in|connect|refresh|use token|go)$/i, { timeout: 1500 });
  await page.keyboard.press("Enter");
  await sleep(1500);
  const wrong = await bodyText(page);
  check(`backoffice${path}.wrong token shows an error`, /401|unauthor|invalid|wrong|denied|failed|error/i.test(wrong), wrong.slice(0, 200).replace(/\n+/g, " | "));
  // right token
  await tok.click({ clickCount: 3 });
  await tok.type(ADMIN_TOKEN, { delay: 5 });
  await clickText(page, /^(load|sign in|connect|refresh|use token|go)$/i, { timeout: 1500 });
  await page.keyboard.press("Enter");
  const ok = await waitFor(page, (src) => new RegExp(src, "i").test(document.body.innerText), { timeout: 15000, arg: marker.source });
  check(`backoffice${path}.loads data with the admin token`, ok, (await bodyText(page)).slice(0, 300).replace(/\n+/g, " | "));
  await shot(page, `backoffice${path.replace("/", "-")}`, { quality: 45 });
  if (path === "/finance") {
    const t = await bodyText(page);
    note("backoffice.finance numbers", t.match(/(Stars issued|Player balances|Escrow|Reconciliation)[^\n]{0,60}/gi)?.slice(0, 6).join(" / ") ?? t.slice(0, 300));
  }
}
check("backoffice.no page errors", errors.filter((e) => !/401/.test(e)).length === 0, errors.slice(0, 6).join(" || "));
await ctx.close();
await browser.close();
done();
process.exit(0);
