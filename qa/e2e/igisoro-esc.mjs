// FIX-B re-check: Esc opens the game menu in Igisoro practice after keyboard moves (QA-01 test-tool note).
//   node qa/e2e/igisoro-esc.mjs [desktop|phone] [runs, default 3]
// Opens practice (/play/igisoro), dismisses How to play, plays the same keys as ui-world.mjs, logs the focused element
// and open dialogs after each key, then presses Esc and expects the game menu (Resume).
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, suite, sleep, clickText, waitFor, email, buttons } from "./lib.mjs";

const vp = process.argv[2] ?? "desktop";
const runs = Number(process.argv[3] ?? 3);
const { check, note, done } = suite(`igisoro-esc-${vp}`);
const browser = await launch();
const { page, ctx, errors } = await openPage(browser, VIEWPORTS[vp]);
await loginContext(page, email("lv12"));
const state = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      focus: a && a !== document.body ? `${a.tagName}:${(a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 24)}` : "body",
      modals: [...document.querySelectorAll('[aria-modal="true"]')].map((d) => (d.textContent || "").trim().slice(0, 24)),
    };
  });
for (let i = 0; i < runs; i++) {
  await page.goto(`${WEB}/play/igisoro`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFor(page, () => /Igisoro/i.test(document.body.innerText), { timeout: 60000 });
  await sleep(2500);
  await clickText(page, /^1 vs 1$/i, { timeout: 1500 });
  await sleep(1000);
  await clickText(page, /^got it$/i, { timeout: 3000 });
  await sleep(600);
  const trail = [JSON.stringify(await state())];
  for (const k of ["Space", "Enter", "ArrowRight", "Enter", "Space", "Enter"]) {
    await page.keyboard.press(k);
    await sleep(900);
    trail.push(`${k}→${JSON.stringify(await state())}`);
  }
  await page.keyboard.press("Escape");
  await sleep(800);
  const b = await buttons(page);
  const ok = b.some((t) => /resume/i.test(t));
  note(`igisoro.run${i + 1}.trail`, trail.join(" "));
  check(`igisoro.run${i + 1}: Esc after moves opens the game menu`, ok, ok ? "" : JSON.stringify(await state()));
  if (ok) await page.keyboard.press("Escape");
}
check("igisoro: no page errors", errors.length === 0, errors.slice(0, 4).join(" || "));
await saveSession(page, email("lv12"));
await ctx.close();
await browser.close();
done();
process.exit(0);
