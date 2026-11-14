// QA-01 session restore check: open a page with only the refresh cookie and count /auth/refresh calls + outcome.
// Two refresh calls with the same (rotating) cookie → the second is REFRESH_INVALID and the player can be signed out.
//   node qa/e2e/session-race.mjs [path=/world] [account=lv1] [runs=3]
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, email } from "./lib.mjs";

const [path = "/world", key = "lv1", runs = "3"] = process.argv.slice(2);
const { check, note, done } = suite(`session-race-${key}`);
const b = await launch();
for (let i = 0; i < Number(runs); i++) {
  const { page, ctx } = await openPage(b, VIEWPORTS.desktop);
  await loginContext(page, email(key));
  const calls = [];
  page.on("response", (r) => {
    if (r.url().includes("/auth/refresh")) calls.push(r.status());
  });
  await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sleep(9000);
  const at = new URL(page.url()).pathname;
  note(`run ${i + 1}`, `refresh calls ${JSON.stringify(calls)} → ${at}`);
  check(`session.restore run ${i + 1} (one refresh, stays signed in)`, calls.filter((s) => s !== 200).length === 0 && at !== "/gate", `calls=${JSON.stringify(calls)} landed=${at}`);
  await saveSession(page, email(key));
  await ctx.close();
}
await b.close();
done();
process.exit(0);
