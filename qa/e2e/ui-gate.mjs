// QA-01 gate journeys (UI): first load, sign-in by email + phone (dev OTP), onboarding, sign-out walk, suspended refusal.
//   node qa/e2e/ui-gate.mjs [desktop|phone]
import { launch, openPage, VIEWPORTS, WEB, suite, sleep, buttons, bodyText, clickText, shot, waitFor, perf, email } from "./lib.mjs";

const vp = process.argv[2] ?? "desktop";
const { check, note, done } = suite(`ui-gate-${vp}`);
const b = await launch();

async function typeId(page, id) {
  const input = await page.waitForSelector("input", { timeout: 30000 });
  await input.click({ clickCount: 3 });
  await input.type(id, { delay: 15 });
}

/** capture the dev OTP from the API response */
function otpCatcher(page) {
  const box = { code: null };
  page.on("response", async (r) => {
    if (r.url().includes("/auth/otp/request") && r.status() === 200) {
      try {
        box.code = (await r.json()).devCode ?? null;
      } catch {
        /* ignore */
      }
    }
  });
  return box;
}

async function enterCode(page, box) {
  const t0 = Date.now();
  while (!box.code && Date.now() - t0 < 10000) await sleep(100);
  await waitFor(page, () => /Enter your code/i.test(document.body.innerText), { timeout: 15000 });
  // the panel offers "Dev code: …… (tap to fill)" in dev; otherwise use the on-screen keypad
  if (!(await clickText(page, /tap to fill/i, { timeout: 2000 }))) {
    for (const d of box.code ?? "000000") await clickText(page, new RegExp(`^${d}$`), { timeout: 2000 });
  }
  await sleep(300);
  await clickText(page, /^verify$/i, { timeout: 1500 });
  await waitFor(page, () => !/Enter your code/i.test(document.body.innerText) || /wrong|expired|doesn't look right|not active|suspend/i.test(document.body.innerText), { timeout: 20000 });
}

// ------------------------------------------------------------------ 1. first load + new account by email + onboarding
{
  const { page, errors, ctx } = await openPage(b, VIEWPORTS[vp]);
  const box = otpCatcher(page);
  const t0 = Date.now();
  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const skel = await page.evaluate(() => document.body.innerText.slice(0, 200));
  note("gate.first-paint text", skel.replace(/\n+/g, " | "));
  const ready = await waitFor(page, () => window.__gkProbe?.ready && window.__gkProbe?.view === "gate", { timeout: 90000 });
  const marks = await page.evaluate(() => window.__gkProbe?.marks);
  check("gate.loads + 3D ready", ready && page.url().endsWith("/gate"), `url=${page.url()} after ${Date.now() - t0} ms marks=${JSON.stringify(marks)}`);
  const hasInput = await waitFor(page, () => !!document.querySelector("input"), { timeout: 30000 });
  check("gate.id panel shows", hasInput, JSON.stringify(await buttons(page)));
  // bad id → message
  await typeId(page, "12");
  await clickText(page, /send code/i);
  await sleep(600);
  const badMsg = await bodyText(page);
  check("gate.bad id message", /phone number|email/i.test(badMsg) && /Enter a phone number|doesn't look right/i.test(badMsg), badMsg.slice(0, 200).replace(/\n/g, " | "));
  const fresh = `qa.ui${Date.now()}@example.test`;
  await typeId(page, fresh);
  await clickText(page, /send code/i);
  const codeStep = await waitFor(page, () => /code/i.test(document.body.innerText) && !!document.querySelector("input"), { timeout: 15000 });
  note("gate.code step text", (await bodyText(page)).slice(0, 300).replace(/\n+/g, " | "));
  const devShown = await page.evaluate(() => /Dev code/i.test(document.body.innerText));
  note("gate.dev code visible in DOM panel", String(devShown));
  await enterCode(page, box);
  const tCode = Date.now();
  const setup = await waitFor(page, () => !/Enter your code/i.test(document.body.innerText) && !!document.querySelector("input"), { timeout: 30000 });
  check("onboarding.setup step after code", codeStep && setup, `${Date.now() - tCode} ms; text=${(await bodyText(page)).slice(0, 300).replace(/\n+/g, " | ")}`);
  note("onboarding.buttons", JSON.stringify(await buttons(page)));
  await shot(page, `gate-onboarding-${vp}`);
  const name = `ui${String(Date.now()).slice(-7)}`;
  const nameInput = await page.$("input");
  await nameInput.click({ clickCount: 3 });
  await nameInput.type(name, { delay: 20 });
  // avatar options: click a body type / outfit button if present
  const opts = (await buttons(page)).filter((t) => /feminine|masculine|neutral|woman|man|style|hair|outfit/i.test(t));
  note("onboarding.avatar options", JSON.stringify(opts.slice(0, 12)));
  const entered = (await clickText(page, /^(enter|done|continue|let'?s go|walk in|start|save)/i)) || (await page.keyboard.press("Enter"), true);
  const tIn = Date.now();
  const inWorld = await waitFor(page, () => location.pathname === "/world" && window.__gkProbe?.view === "plaza", { timeout: 40000 });
  check("onboarding.finish → plaza", entered && inWorld, `${Date.now() - tIn} ms url=${page.url()}`);
  const me = await page.evaluate(async () => (await fetch("/api/v1/auth/refresh", { method: "POST" })).status);
  note("session.refresh status in world", String(me));
  const p = await perf(page, 3000);
  note("perf.plaza first entry", JSON.stringify(p));
  // sign-out: settings / menu → Sign out → walk out of the gate
  const allBtns = await buttons(page);
  note("plaza.hud buttons", JSON.stringify(allBtns));
  let signedOut = await clickText(page, /sign out|log out/i, { timeout: 1500 });
  if (!signedOut) {
    (await clickText(page, /settings|menu|profile|account/i, { timeout: 3000 })) && (await sleep(600));
    note("settings.buttons", JSON.stringify(await buttons(page)));
    signedOut = await clickText(page, /sign out|log out/i, { timeout: 3000 });
    if (signedOut) await clickText(page, /^(sign out|yes|confirm)/i, { timeout: 1500 });
  }
  const tOut = Date.now();
  const atGate = await waitFor(page, () => location.pathname === "/gate", { timeout: 30000 });
  const leaving = await page.evaluate(() => window.__gkStage?.getState?.().exiting ?? null);
  check("gate.sign-out walks out to the gate", signedOut && atGate, `${Date.now() - tOut} ms url=${page.url()} exiting=${leaving}`);
  await sleep(4000);
  const refresh = await page.evaluate(async () => (await (await fetch("/api/v1/auth/refresh", { method: "POST" })).json()).accessToken);
  check("gate.sign-out ends the session", !refresh, `refresh token after sign-out: ${refresh ? "still valid" : "none"}`);
  check("gate.no page errors (new account run)", errors.length === 0, errors.slice(0, 6).join(" || "));
  await ctx.close();
}

// ------------------------------------------------------------------ 2. returning player by phone + suspended refused
{
  const { page, errors, ctx } = await openPage(b, VIEWPORTS[vp]);
  const box = otpCatcher(page);
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(page, () => !!document.querySelector("input"), { timeout: 90000 });
  await typeId(page, email("suspended"));
  await clickText(page, /send code/i);
  await waitFor(page, () => /code/i.test(document.body.innerText), { timeout: 15000 });
  await enterCode(page, box);
  await sleep(2500);
  const txt = (await bodyText(page)).split(email("suspended")).join("<email>");
  const refusedClear = /suspend|blocked|not active|contact support|deactivated/i.test(txt);
  check("gate.suspended refused with a clear message", refusedClear && !page.url().includes("/world"), txt.slice(0, 300).replace(/\n+/g, " | "));
  if (!refusedClear) await shot(page, `gate-suspended-${vp}`);
  // returning player by phone (seeded qa_lv5 phone); the refused verify above logs an expected 401
  errors.length = 0;
  box.code = null;
  await page.goto(`${WEB}/gate`, { waitUntil: "domcontentloaded" });
  await waitFor(page, () => !!document.querySelector("input"), { timeout: 60000 });
  await typeId(page, "0789 990 005");
  await clickText(page, /send code/i);
  await waitFor(page, () => /code/i.test(document.body.innerText), { timeout: 15000 });
  await enterCode(page, box);
  const t0 = Date.now();
  const inWorld = await waitFor(page, () => location.pathname === "/world" && window.__gkProbe?.view === "plaza", { timeout: 40000 });
  check("gate.returning player by phone walks in (no setup)", inWorld, `${Date.now() - t0} ms url=${page.url()}`);
  check("gate.no page errors (phone run)", errors.length === 0, errors.slice(0, 6).join(" || "));
  await ctx.close();
}

await b.close();
done();
