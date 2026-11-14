// QA-01 world journeys (UI): plaza controls, people (with a realtime bot), chat, settings, avatar editor, wallet,
// halls (door walk in/out, table picker, practice vs AI, Leave), performance and cross-cutting UI scans.
//   node qa/e2e/ui-world.mjs [desktop|phone|tablet] [account key, default lv12] [sections, default all]
// sections: plaza,people,settings,wallet,halls
import { Client } from "colyseus.js";
import { launch, openPage, loginContext, saveSession, VIEWPORTS, WEB, RT, suite, sleep, buttons, bodyText, clickText, shot, waitFor, perf, email, signIn } from "./lib.mjs";
import { DOORS, DOOR_RING, ring, view, pose, walkTo, installFrameMeter, resetFrames, frames, hold } from "./world-lib.mjs";

const vp = process.argv[2] ?? "desktop";
const who = process.argv[3] ?? "lv12";
const only = new Set((process.argv[4] ?? "plaza,people,settings,wallet,halls").split(","));
const { check, note, done } = suite(`ui-world-${vp}`);
const phone = vp === "phone" || vp === "portrait";

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
/** UI scan: emojis in visible text, blue-ish button backgrounds (the palette is chocolate + one accent), tiny text */
async function scan(page, label) {
  const r = await page.evaluate((emojiSrc) => {
    const emoji = new RegExp(emojiSrc, "u");
    const txt = document.body.innerText;
    const em = [...txt].filter((c) => emoji.test(c));
    const blue = [];
    for (const el of document.querySelectorAll("button,[role=button]")) {
      if (!el.getClientRects().length) continue;
      if (/^Colou?r /i.test(el.getAttribute("aria-label") || el.innerText || "")) continue; // avatar colour swatches
      const bg = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
      const [r, g, b, a = 1] = bg;
      if (a > 0.3 && b > r + 50 && b > g + 25) blue.push(`${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24)}=${getComputedStyle(el).backgroundColor}`);
    }
    const unlabeled = [...document.querySelectorAll("button")].filter((b) => b.getClientRects().length && !(b.innerText || "").trim() && !b.getAttribute("aria-label") && !b.title).length;
    return { emoji: [...new Set(em)].join(""), blue: blue.slice(0, 6), unlabeled };
  }, EMOJI.source);
  check(`ui.${label}.no emojis`, !r.emoji, r.emoji);
  check(`ui.${label}.no blue buttons`, r.blue.length === 0, r.blue.join(" ; "));
  check(`ui.${label}.icon buttons labelled`, r.unlabeled === 0, `${r.unlabeled} unlabeled`);
}

/** realtime bot in the same plaza room (another seeded player) */
async function bot(key) {
  const s = await signIn(email(key));
  const c = new Client(RT);
  const room = await c.joinOrCreate("plaza", { token: s.token });
  const inbox = [];
  room.onMessage("*", (type, msg) => inbox.push({ type, msg }));
  return { room, inbox, sid: room.sessionId };
}
const got = async (b, type, ms = 6000, where = () => true) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = b.inbox.find((x) => x.type === type && where(x.msg));
    if (m) return m.msg;
    await sleep(100);
  }
  return null;
};

const browser = await launch();
const { page, errors, ctx } = await openPage(browser, VIEWPORTS[vp]);
await loginContext(page, email(who));
const t0 = Date.now();
await page.goto(`${WEB}/world`, { waitUntil: "domcontentloaded", timeout: 120000 });
const ready = await waitFor(page, () => window.__gkProbe?.ready && window.__gkProbe?.view === "plaza" && document.querySelector("[aria-label='Account and settings']"), { timeout: 120000 });
const marks = await page.evaluate(() => window.__gkProbe?.marks);
check("plaza.boot (signed in, deep link /world)", ready, `${Date.now() - t0} ms marks=${JSON.stringify(marks)}`);
await installFrameMeter(page);
await sleep(2500);
const pp = await perf(page, 3000);
note("perf.plaza", JSON.stringify(pp));
check("perf.plaza fps >= 30 (headless)", pp.fps >= 30, JSON.stringify(pp));
await scan(page, "plaza-hud");
await shot(page, `plaza-${vp}`, { quality: 45 });

const section = async (name, fn) => {
  if (!only.has(name)) return;
  try {
    await fn();
  } catch (e) {
    check(`${name}.section crashed (test tool)`, false, String(e?.stack ?? e).slice(0, 300));
  }
};

// ------------------------------------------------------------------ plaza controls
await section("plaza", async () => {
  const p0 = await pose(page);
  if (!phone) {
    await page.mouse.click(5, 300); // focus the canvas area without UI
    await hold(page, "KeyW", 1500);
    const p1 = await pose(page);
    check("plaza.keyboard W walks", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);
    const yaw0 = await page.evaluate(() => window.__gkCam?.yaw);
    await hold(page, "KeyA", 700);
    await sleep(600);
    const yaw1 = await page.evaluate(() => window.__gkCam?.yaw);
    note("plaza.keyboard A turns (camera yaw)", `${yaw0?.toFixed?.(2)} → ${yaw1?.toFixed?.(2)}`);
  } else {
    const joy = await page.$("[aria-label='Move']");
    check("plaza.joystick present on phone", !!joy);
    if (joy) {
      const bb = await joy.boundingBox();
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      const cdp = await page.createCDPSession();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
      for (let i = 1; i <= 10; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy - i * 4 }] });
        await sleep(30);
      }
      await sleep(1500);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const p1 = await pose(page);
      check("plaza.joystick walks", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);
      await sleep(800);
      const p2 = await pose(page);
      check("plaza.joystick release stops", Math.hypot(p2.x - p1.x, p2.z - p1.z) < 0.6, `drift ${Math.hypot(p2.x - p1.x, p2.z - p1.z).toFixed(2)} m`);
    }
  }
  // tap / click the ground to walk there
  const vpS = VIEWPORTS[vp];
  const pa = await pose(page);
  if (phone) await page.touchscreen.tap(vpS.width * 0.55, vpS.height * 0.7);
  else await page.mouse.click(vpS.width * 0.55, vpS.height * 0.72);
  await sleep(300);
  const tgt = await page.evaluate(() => window.__gkNav?.target);
  await sleep(2500);
  const pb = await pose(page);
  check("plaza.tap/click ground walks", !!tgt || Math.hypot(pb.x - pa.x, pb.z - pa.z) > 0.8, `target=${JSON.stringify(tgt)} moved ${Math.hypot(pb.x - pa.x, pb.z - pa.z).toFixed(2)} m`);
  // benches: walk to the bench pair at bearing 159° (r 26 m), stand in front of it, then sit
  const bench = ring(159 - (2.0 / 26) * (180 / Math.PI), 24.8);
  await page.keyboard.down("Shift");
  await walkTo(page, bench.x, bench.z, { timeout: 40000 });
  await page.keyboard.up("Shift");
  const near = await waitFor(page, () => !!window.__gkWorld?.()?.social?.nearSeat, { timeout: 5000 });
  note("plaza.bench near seat prompt", String(near));
  const sat = await page.evaluate(() => {
    try {
      window.__gkAct?.sitNearest?.();
      return true;
    } catch (e) {
      return String(e);
    }
  });
  const seated = await waitFor(page, () => window.__gkWorld?.()?.social?.seated, { timeout: 25000 });
  check("plaza.bench sit (nearest)", sat === true && seated, `seated=${seated}`);
  const sbtn = await buttons(page);
  note("plaza.bench seated buttons", JSON.stringify(sbtn.filter((t) => /stand|sit|interact/i.test(t))));
  await page.evaluate(() => window.__gkAct?.standFromBench?.());
  const stood = await waitFor(page, () => !window.__gkWorld?.()?.social?.seated, { timeout: 8000 });
  check("plaza.bench stand", stood);
});

// ------------------------------------------------------------------ people (bot), chat, person menu
await section("people", async () => {
  const b = await bot("pvp2");
  const me = await pose(page);
  const sendMove = (dx, dz) => b.room.send("move", { x: Math.round((me.x + dx) * 100), y: 0, z: Math.round((me.z + dz) * 100), yaw: 0, anim: 0, t: Date.now() % 2147483647 });
  for (let i = 0; i < 6; i++) {
    sendMove(1.6, 0);
    await sleep(250);
  }
  const seen = await waitFor(page, (n) => (window.__gkWorld?.()?.players ?? []).some((p) => p.name === n), { timeout: 10000, arg: "qa_pvp2" });
  check("people.bot visible in the plaza", seen);
  const nearby = (await buttons(page)).find((t) => /nearby/.test(t));
  note("people.nearby counter", nearby ?? "(none)");
  // nearby chat from the bot shows
  b.room.send("chat", { text: "hello from qa bot", scope: "nearby" });
  const bubble = await waitFor(page, () => /hello from qa bot/.test(document.body.innerText), { timeout: 6000 });
  note("people.nearby chat visible without opening chat", String(bubble));
  // open chat (T) and send a room message
  await page.keyboard.press("KeyT");
  const chatOpen = await waitFor(page, () => !!document.querySelector("[role=tablist][aria-label='Chat channels']"), { timeout: 5000 });
  check("chat.T opens the chat panel", chatOpen);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => t.innerText.trim()));
  note("chat.tabs", JSON.stringify(tabs));
  check("chat.bot message listed", /hello from qa bot/.test(await bodyText(page)));
  const input = await page.$("[role=dialog] input, form input, input[aria-label]");
  if (input) {
    await input.type("hi from the qa ui", { delay: 10 });
    await page.keyboard.press("Enter");
    const recv = await got(b, "chat", 5000, (m) => /hi from the qa ui/.test(m.text));
    check("chat.send reaches others", !!recv, JSON.stringify(recv)?.slice(0, 160));
    await input.type("you are an idiot", { delay: 5 });
    await page.keyboard.press("Enter");
    const filtered = await got(b, "chat", 3000, (m) => /idiot|\*/.test(m.text));
    note("chat.filter (insult)", filtered ? `delivered as: ${filtered.text}` : "not delivered / warned");
  } else check("chat.input found", false);
  await page.keyboard.press("Escape");
  await sleep(400);
  const chatClosed = await page.evaluate(() => !document.querySelector("[role=tablist][aria-label='Chat channels']"));
  check("a11y.Esc closes chat", chatClosed);
  if (!chatClosed) await clickText(page, /close chat/i, { timeout: 1000 });
  // private message request from the bot → request UI
  b.room.send("dm", { to: await page.evaluate(() => window.__gkWorld?.()?.you), text: "private hello from bot" });
  await sleep(1500);
  const dmTxt = await bodyText(page);
  const dmButtons = await buttons(page);
  note("dm.request UI", `${/private hello|wants to chat|message request|request/i.test(dmTxt)} buttons=${JSON.stringify(dmButtons.filter((t) => /accept|block|decline|ignore|reply|chat/i.test(t)))}`);
  // handshake consent: bot asks, UI shows a consent prompt
  b.room.send("pair-request", { to: await page.evaluate(() => window.__gkWorld?.()?.you), kind: "handshake" });
  const inv = await waitFor(page, () => !!window.__gkWorld?.()?.social?.pairInvite, { timeout: 6000 });
  const pairBtns = (await buttons(page)).filter((t) => /accept|shake|yes|no|decline|not now/i.test(t));
  check("people.handshake asks for consent", inv && pairBtns.length > 0, JSON.stringify(pairBtns));
  if (await clickText(page, /^(accept|shake|yes)/i, { timeout: 2000 })) {
    const start = await got(b, "pair-start", 5000);
    check("people.handshake accepted → both start", !!start, JSON.stringify(start)?.slice(0, 120));
  }
  // person menu: click the bot
  await sleep(2500);
  const at = await page.evaluate((sid) => window.__gkProject?.(sid), b.sid);
  if (at && at.z < 1) {
    if (phone) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    const menu = await waitFor(page, () => !!document.querySelector("[role=dialog][aria-label$=': actions']"), { timeout: 4000 });
    check("people.person menu opens on click", menu, `at ${Math.round(at.x)},${Math.round(at.y)}`);
    if (menu) {
      const mb = await page.evaluate(() => [...document.querySelectorAll("[role=dialog][aria-label$=': actions'] button")].map((x) => (x.innerText || x.getAttribute("aria-label") || "").trim()));
      note("people.person menu actions", JSON.stringify(mb));
      await scan(page, "person-menu");
      if (await clickText(page, /^wave/i, { timeout: 1500 })) {
        const waved = await got(b, "waved", 4000);
        check("people.wave reaches the person", !!waved);
      }
      await page.keyboard.press("Escape");
      await sleep(300);
      check("a11y.Esc closes person menu", await page.evaluate(() => !document.querySelector("[role=dialog][aria-label$=': actions']")));
    }
  } else note("people.person menu", `bot not on screen: ${JSON.stringify(at)}`);
  // voice toggle (no mic in headless)
  const vb = await clickText(page, /^voice$/i, { timeout: 1500 });
  await sleep(1200);
  note("voice.toggle", `clicked=${vb} text=${(await bodyText(page)).match(/voice[^|\n]{0,60}/gi)?.slice(0, 4).join(" / ")}`);
  await page.keyboard.press("Escape");
  await b.room.leave();
});

// ------------------------------------------------------------------ settings, theme, avatar editor
await section("settings", async () => {
  await clickText(page, /account and settings/i);
  const open = await waitFor(page, () => /Sign out/.test(document.body.innerText), { timeout: 4000 });
  check("settings.opens", open);
  await scan(page, "settings");
  const contrast = async () =>
    page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bgOf = (el) => {
        while (el) {
          const c = getComputedStyle(el).backgroundColor;
          const a = c.match(/\d+(\.\d+)?/g)?.map(Number);
          if (a && (a.length < 4 || a[3] > 0.5)) return c;
          el = el.parentElement;
        }
        return "rgb(0,0,0)";
      };
      const bad = [];
      let n = 0;
      for (const el of document.querySelectorAll("[role=dialog] *, .pcard *")) {
        if (!el.childNodes.length || ![...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue;
        if (!el.getClientRects().length) continue;
        n++;
        const L1 = lum(getComputedStyle(el).color);
        const L2 = lum(bgOf(el));
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < 4.5) bad.push(`${el.innerText.trim().slice(0, 20)}:${ratio.toFixed(1)}`);
      }
      return { n, bad: bad.slice(0, 8), badCount: bad.length };
    });
  for (const theme of ["Light", "Dark"]) {
    await clickText(page, new RegExp(`^${theme}$`), { timeout: 1500 });
    await sleep(500);
    const c = await contrast();
    check(`theme.${theme.toLowerCase()} text contrast >= 4.5 (settings panel)`, c.badCount === 0, `${c.badCount}/${c.n} low: ${c.bad.join(", ")}`);
    if (c.badCount) await shot(page, `settings-${theme.toLowerCase()}-${vp}`, { quality: 50 });
  }
  for (const pace of ["Slow", "Fast", "Normal"]) check(`settings.pace ${pace}`, await clickText(page, new RegExp(`^${pace}$`), { timeout: 1000 }));
  check("settings.sounds toggle", await clickText(page, /^game sounds$/i, { timeout: 1000 }));
  await clickText(page, /^game sounds$/i, { timeout: 1000 });
  await page.keyboard.press("Escape");
  await sleep(400);
  const closed = await page.evaluate(() => !/Sign out/.test(document.body.innerText));
  check("a11y.Esc closes settings", closed);
  if (!closed) await clickText(page, /^close$/i);
  // focus order: Tab through the HUD
  const order = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.innerText || document.activeElement?.tagName || "").trim().slice(0, 24)));
  }
  note("a11y.tab order (HUD)", order.join(" → "));
  // avatar editor
  check("avatar.editor opens", await clickText(page, /style your avatar/i, { timeout: 2000 }));
  await sleep(1500);
  const ab = await buttons(page);
  note("avatar.editor buttons", JSON.stringify(ab.slice(0, 30)));
  await scan(page, "avatar-editor");
  await shot(page, `avatar-editor-${vp}`, { quality: 45 });
  await page.keyboard.press("Escape");
  await sleep(600);
  const stillEditor = await page.evaluate(() => /Skin|Hair|Outfit/i.test(document.body.innerText) && !document.querySelector("[aria-label='Account and settings']"));
  check("a11y.Esc closes avatar editor", !stillEditor);
  if (stillEditor) await clickText(page, /^(done|close|back|save)/i, { timeout: 1500 });
});

// ------------------------------------------------------------------ wallet
await section("wallet", async () => {
  const starsBtn = await page.$("[aria-label^='Open your wallet']");
  check("wallet.stars button in HUD", !!starsBtn, await page.evaluate((e) => e?.getAttribute("aria-label"), starsBtn));
  await starsBtn?.click();
  const opened = await waitFor(page, () => /Stars/i.test(document.body.innerText) && /Coins|coin/i.test(document.body.innerText), { timeout: 8000 });
  check("wallet.opens with Stars + Coins", opened, (await bodyText(page)).slice(0, 300).replace(/\n+/g, " | "));
  await scan(page, "wallet");
  await shot(page, `wallet-${vp}`, { quality: 45 });
  const wb = await buttons(page);
  note("wallet.buttons", JSON.stringify(wb.slice(0, 40)));
  if (await clickText(page, /daily|claim/i, { timeout: 2000 })) {
    await sleep(1500);
    note("wallet.daily claim", (await bodyText(page)).match(/(claimed|come back|streak|\+\d+)[^|\n]{0,60}/gi)?.slice(0, 4).join(" / ") ?? "");
  }
  for (const t of ["Activity", "Play safe|Limits|Play-safe", "Top up|Buy|Add coins", "Cash out|Withdraw"]) {
    const ok = await clickText(page, new RegExp(t, "i"), { timeout: 2000 });
    await sleep(1200);
    const txt = (await bodyText(page)).replace(/\n+/g, " | ");
    note(`wallet.${t.split("|")[0]}`, `${ok} ${txt.slice(0, 260)}`);
    if (/Top up|Cash out/.test(t)) check(`wallet.${t.split("|")[0]} stops at pilot (no payment)`, !ok || /pilot|not available|coming|licen|soon/i.test(txt), txt.slice(0, 200));
    await clickText(page, /^back$/i, { timeout: 800 });
  }
  await page.keyboard.press("Escape");
  await sleep(600);
  check("a11y.Esc closes wallet", await page.evaluate(() => !!document.querySelector("[aria-label='Account and settings']")));
});

// ------------------------------------------------------------------ halls
await section("halls", async () => {
  // run there (Fast pace + Shift)
  await clickText(page, /account and settings/i);
  await clickText(page, /^Fast$/, { timeout: 1500 });
  await page.keyboard.press("Escape");
  await clickText(page, /^close$/i, { timeout: 500 });
  for (const game of (process.env.QA_HALLS ?? "pool,ludo,igisoro").split(",")) {
    await waitFor(page, () => window.__gkProbe?.view === "plaza", { timeout: 15000 });
    const deg = DOORS[game];
    const near = ring(deg, DOOR_RING - 4);
    await page.keyboard.down("Shift");
    await walkTo(page, near.x, near.z, { timeout: 60000 });
    await resetFrames(page);
    const tIn = Date.now();
    const beyond = ring(deg, DOOR_RING + 3);
    const r = await walkTo(page, beyond.x, beyond.z, { timeout: 20000, until: (p) => p.view && p.view !== "plaza" });
    await page.keyboard.up("Shift");
    const inMs = Date.now() - tIn;
    const fin = await frames(page);
    await waitFor(page, (g) => location.pathname === `/room/${g}`, { timeout: 8000, arg: game });
    check(`halls.${game}.door walk in`, r.view === `hall:${game}`, `${inMs} ms from 4 m out; worst frame ${fin.worst} ms; gaps>100ms ${JSON.stringify(fin.gaps)}; url ${page.url()}`);
    check(`perf.${game}.no freeze crossing in (worst frame < 250 ms)`, fin.worst < 250, `${fin.worst} ms`);
    await sleep(1500);
    const hp = await perf(page, 2500);
    note(`perf.hall:${game}`, JSON.stringify(hp));
    await scan(page, `hall-${game}`);
    // table picker → sit → practice vs AI
    const picked = await clickText(page, /find a free table|^free table$/i, { timeout: 4000 });
    if (!picked) note(`halls.${game}.buttons (no picker)`, JSON.stringify(await buttons(page)));
    check(`halls.${game}.table picker`, picked);
    const sat = await waitFor(page, () => /Stand up/.test(document.body.innerText), { timeout: 15000 });
    check(`halls.${game}.sit at a table`, sat);
    if (sat) {
      check(`halls.${game}.practice vs AI starts`, await clickText(page, /practice vs ai/i, { timeout: 3000 }));
      await sleep(2500);
      await clickText(page, /^1 vs 1$/i, { timeout: 1500 });
      await sleep(1500);
      const howTo = /How to play/i.test(await bodyText(page));
      note(`halls.${game}.how-to shown`, String(howTo));
      await clickText(page, /^got it$/i, { timeout: 2000 });
      await sleep(800);
      const g0 = await page.evaluate(() => document.body.innerText.length);
      // a few moves: keyboard controls from the how-to (Space/Enter roll / play; arrows pick)
      for (const k of ["Space", "Enter", "ArrowRight", "Enter", "Space", "Enter"]) {
        await page.keyboard.press(k);
        await sleep(900);
      }
      await shot(page, `practice-${game}-${vp}`, { quality: 45 });
      const gtxt = (await bodyText(page)).replace(/\n+/g, " | ");
      note(`halls.${game}.practice text after moves`, gtxt.slice(0, 300));
      check(`halls.${game}.practice responds to input`, gtxt.length !== g0 || /turn|roll|your move|AI|thinking/i.test(gtxt), "");
      // pause (menu) and leave the game
      await page.keyboard.press("Escape");
      await sleep(800);
      const menuBtns = await buttons(page);
      check(`halls.${game}.pause menu (Esc)`, menuBtns.some((t) => /resume/i.test(t)), JSON.stringify(menuBtns.slice(0, 12)));
      // leave the practice game from the pause menu: Leave → "Leave the match?" → Leave (both scoped to the dialog)
      const inDialog = (re) =>
        page.evaluate((src) => {
          const d = [...document.querySelectorAll("[role=dialog]")].pop();
          const el = d && [...d.querySelectorAll("button,a")].find((b) => new RegExp(src, "i").test(b.innerText.trim()));
          el?.click();
          return !!el;
        }, re);
      const l1 = await inDialog("^leave$");
      await sleep(700);
      const confirm = await page.evaluate(() => /Leave the match\?/.test(document.body.innerText) && /ends this practice game/.test(document.body.innerText));
      check(`halls.${game}.leave asks to confirm (practice wording)`, l1 && confirm);
      await inDialog("^leave$");
      const tL = Date.now();
      const atTable = await waitFor(page, (g) => location.pathname === `/room/${g}` && /Stand up|Find a free table/.test(document.body.innerText), { timeout: 15000, arg: game });
      check(`halls.${game}.leave game → back in the hall`, atTable, `${Date.now() - tL} ms url=${page.url()} ${(await bodyText(page)).slice(0, 120).replace(/\n+/g, " | ")}`);
      await clickText(page, /^stand up$/i, { timeout: 2000 });
      await sleep(1000);
    }
    // Leave fail-safe (HUD) → plaza
    await resetFrames(page);
    const tOut = Date.now();
    const left = await clickText(page, /^leave$/i, { timeout: 3000 });
    const back = await waitFor(page, () => window.__gkProbe?.view === "plaza", { timeout: 20000 });
    const fo = await frames(page);
    check(`halls.${game}.Leave → plaza`, left && back, `${Date.now() - tOut} ms; worst frame ${fo.worst} ms; url ${page.url()}`);
    check(`perf.${game}.no freeze leaving (worst frame < 250 ms)`, fo.worst < 250, `${fo.worst} ms`);
  }
  // continuous walk out through the door (no Leave button): enter pool again and walk back out the door
  const deg = DOORS.ludo;
  const near = ring(deg, DOOR_RING - 3);
  await page.keyboard.down("Shift");
  await walkTo(page, near.x, near.z, { timeout: 60000 });
  await walkTo(page, ring(deg, DOOR_RING + 3).x, ring(deg, DOOR_RING + 3).z, { timeout: 20000, until: (p) => p.view !== "plaza" });
  await page.keyboard.up("Shift");
  await sleep(2000);
  const inside = await pose(page);
  // the exit is behind you: walk back (S) until the plaza
  await resetFrames(page);
  const tW = Date.now();
  await page.keyboard.down("KeyS");
  await page.keyboard.down("Shift");
  const outOk = await waitFor(page, () => window.__gkProbe?.view === "plaza", { timeout: 25000 });
  await page.keyboard.up("KeyS");
  await page.keyboard.up("Shift");
  const fw = await frames(page);
  check("halls.walk out through the door (S) → plaza", outOk, `${Date.now() - tW} ms from ${JSON.stringify(inside)}; worst frame ${fw.worst} ms`);
});

check("cross.no page/console errors (world run)", errors.length === 0, errors.slice(0, 8).join(" || "));
await saveSession(page, email(who));
await ctx.close();
await browser.close();
done();
process.exit(0);
