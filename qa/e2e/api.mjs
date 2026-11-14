// QA-01 API-level journeys: gate/auth, security, staff console per role, wallet, arena, back-office endpoints.
// Run after `pnpm --filter @gukirana/api run seed:qa` with the QA stack up:  node qa/e2e/api.mjs
import { api, signIn, suite, email, ADMIN_TOKEN, sleep } from "./lib.mjs";

const { check, note, done } = suite("api");
const T = {};
const tok = async (k) => (T[k] ??= (await signIn(email(k))).token);
const adm = { "x-admin-token": ADMIN_TOKEN, "x-admin-user": "qa" };
// an unmasked seeded contact (masked ones look like "qa•••@example.test" / "+25078••••005")
const PII = /qa\.[a-z0-9]+@example\.test|\+2507\d{8}/;

// ------------------------------------------------------------------ gate / auth
{
  const bad = await api("/auth/otp/request", { method: "POST", body: { identifier: "not-a-phone" } });
  check("auth.invalid-identifier.400", bad.status === 400, `${bad.status}`);
  const fresh = `qa.gate${Date.now()}@example.test`;
  const r = await api("/auth/otp/request", { method: "POST", body: { identifier: fresh } });
  check("auth.email-otp.devCode", r.status === 200 && /^\d{6}$/.test(r.json?.devCode ?? ""), `${r.status}`);
  const wrong = await api("/auth/otp/verify", { method: "POST", body: { identifier: fresh, code: r.json.devCode === "000000" ? "111111" : "000000" } });
  check("auth.wrong-code.401", wrong.status === 401, `${wrong.status} ${JSON.stringify(wrong.json)}`);
  const ok = await api("/auth/otp/verify", { method: "POST", body: { identifier: fresh, code: r.json.devCode } });
  check("auth.email-verify.new-account", ok.status === 200 && ok.json?.isNew === true, `${ok.status} isNew=${ok.json?.isNew}`);
  const reuse = await api("/auth/otp/verify", { method: "POST", body: { identifier: fresh, code: r.json.devCode } });
  check("auth.otp-single-use", reuse.status === 401, `${reuse.status}`);
  const me = await api("/me", { token: ok.json.accessToken });
  check("onboarding.new-has-no-username", me.status === 200 && me.json.username === null && me.json.stars === 500, `username=${me.json?.username} stars=${me.json?.stars}`);
  check("privacy.me-masks-email", me.json?.email && !me.json.email.includes(fresh.split("@")[0]), me.json?.email);
  const bad1 = await api("/me", { method: "PATCH", token: ok.json.accessToken, body: { username: "x" } });
  check("onboarding.username-too-short.400", bad1.status === 400, `${bad1.status}`);
  const taken = await api("/me", { method: "PATCH", token: ok.json.accessToken, body: { username: "qa_lv1" } });
  check("onboarding.username-taken.409", taken.status === 409, `${taken.status} ${JSON.stringify(taken.json)}`);
  const name = `gate${String(Date.now()).slice(-6)}`;
  const set = await api("/me", { method: "PATCH", token: ok.json.accessToken, body: { username: name, bodyType: "feminine", color: "#AA5500" } });
  check("onboarding.set-name+avatar", set.status === 200 && set.json.username === name && !!set.json.accessToken, `${set.status}`);
  // logout revokes the refresh cookie
  const cookie = (ok.setCookie ?? "").split(";")[0];
  const lo = await api("/auth/logout", { method: "POST", cookie });
  const after = await api("/auth/refresh", { method: "POST", cookie });
  check("auth.logout-revokes-refresh", lo.status === 204 && after.status === 401, `logout=${lo.status} refresh=${after.status}`);
  // OTP rate limit: 3 per 10 min per identifier
  const spam = `qa.spam${Date.now()}@example.test`;
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await api("/auth/otp/request", { method: "POST", body: { identifier: spam } })).status);
  check("auth.otp-rate-limit", codes.join(",") === "200,200,200,429", codes.join(","));
  // phone sign-in (seeded qa_lv5 has a phone)
  const ph = await signIn("0789990005", { fresh: true });
  const pme = ph.token ? await api("/me", { token: ph.token }) : { json: {} };
  check("auth.phone-sign-in-existing", ph.status === 200 && pme.json.username === "qa_lv5", `${ph.status} ${pme.json?.username}`);
  check("privacy.me-masks-phone", pme.json?.phone && !pme.json.phone.includes("9990005"), pme.json?.phone);
  // suspended account refused at sign-in
  const sus = await signIn(email("suspended"), { fresh: true });
  check("auth.suspended-refused", sus.status === 401 && sus.json?.code === "ACCOUNT_INACTIVE", `${sus.status} ${JSON.stringify(sus.json)}`);
  // no session yet: refresh is a normal 200 { accessToken: null }
  const anon = await api("/auth/refresh", { method: "POST" });
  check("auth.refresh-no-cookie.200-null", anon.status === 200 && anon.json?.accessToken === null, `${anon.status}`);
}

// ------------------------------------------------------------------ security basics
{
  const p = await tok("lv1");
  const forbidden = [
    ["GET", "/console/me"],
    ["GET", "/console/overview"],
    ["GET", "/console/users"],
    ["GET", "/console/finance"],
    ["GET", "/admin/access/roles"],
    ["POST", "/admin/access/grant", { user: "qa_lv1", role: "super_admin" }],
    ["GET", "/admin/arena/settings"],
    ["PUT", "/admin/arena/settings", { open: false }],
  ];
  for (const [m, path, body] of forbidden) {
    const r = await api(path, { method: m, token: p, body });
    check(`security.player-refused ${m} ${path}`, r.status === 403, `${r.status}`);
  }
  for (const path of ["/admin/economy", "/admin/reports/reconciliation", "/admin/reports/summary"]) {
    const r = await api(path, { token: p });
    check(`security.admin-guard-needs-token ${path}`, r.status === 401, `${r.status}`);
  }
  const wrong = await api("/admin/access/roles", { headers: { "x-admin-token": "wrong-token-123456" } });
  check("security.wrong-admin-token.401", wrong.status === 401, `${wrong.status}`);
  for (const path of ["/internal/arena/state", "/internal/access/00000000-0000-0000-0000-000000000000"]) {
    const r = await api(path);
    check(`security.internal-needs-token ${path}`, r.status === 401, `${r.status}`);
  }
  const internalFromPlayer = await api("/internal/matches", { method: "POST", token: p, body: {} });
  check("security.player-cannot-create-match", internalFromPlayer.status === 401, `${internalFromPlayer.status}`);
  const noTok = await api("/wallet");
  check("security.wallet-needs-login", noTok.status === 401, `${noTok.status}`);
  const forged = await api("/me", { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad" });
  check("security.forged-token.401", forged.status === 401, `${forged.status}`);
  // public endpoints: no personal data
  for (const path of ["/arena/status", "/arena/events", "/arena/events?upcoming=1", "/buildings", "/economy", "/healthz"]) {
    const r = await api(path);
    const s = JSON.stringify(r.json ?? "");
    check(`privacy.public ${path} no PII`, r.status === 200 && !PII.test(s), `${r.status} ${s.length}B`);
  }
  const lv30 = (await api("/console/users?q=lv30", { headers: adm })).json?.items?.[0];
  const us = await api("/console/users?q=qa_lv30", { headers: adm });
  check("console.search by a username with '_' finds it", us.json?.items?.some?.((u) => u.username === "qa_lv30"), `q=qa_lv30 → ${us.json?.items?.length} items`);
  const bad = await api("/console/users/not-a-uuid", { headers: adm });
  const badSt = await api("/console/users/not-a-uuid/status", { method: "POST", headers: adm, body: { status: "suspended", reason: "QA bad id" } });
  check("console.bad user id → 4xx (not 500)", bad.status < 500 && badSt.status < 500, `detail ${bad.status}, status ${badSt.status}`);
  if (lv30) {
    const prof = await api(`/players/${lv30.id}`, { token: p });
    check("privacy.player-profile no PII", prof.status === 200 && !PII.test(JSON.stringify(prof.json)), `${prof.status} keys=${Object.keys(prof.json ?? {}).join(",")}`);
  }
  const offices = await api("/admin-block/offices", { token: p });
  check("privacy.office-directory has counts not names", offices.status === 200 && Array.isArray(offices.json) && !/qa_/.test(JSON.stringify(offices.json)), `${offices.status} ${JSON.stringify(offices.json).slice(0, 160)}`);
}

// ------------------------------------------------------------------ console per staff role
const SECTION_ENDPOINTS = {
  overview: ["GET", "/console/overview"],
  users: ["GET", "/console/users?q=qa_"],
  reports: ["GET", "/console/reports"],
  buildings: ["PUT", "/console/buildings/igisoro", { open: true, message: "" }],
  monitor: ["GET", "/console/presence"],
  roles: ["GET", "/admin/access/roles"],
  finance: ["GET", "/console/finance"],
};
const EXPECT = {
  super: ["overview", "visitors", "users", "reports", "buildings", "monitor", "roles", "finance"],
  it: ["overview", "visitors", "users", "reports", "buildings", "monitor"],
  accountant: ["overview", "visitors", "finance"],
  support: ["overview", "visitors", "users", "reports"],
  events: ["overview", "visitors"],
};
for (const [k, sections] of Object.entries(EXPECT)) {
  const t = await tok(k);
  const me = await api("/console/me", { token: t });
  const got = me.json?.sections ?? [];
  check(`console.${k}.sections`, me.status === 200 && JSON.stringify(got) === JSON.stringify(sections), `${me.status} ${JSON.stringify(got)}`);
  for (const [sec, [m, path, body]] of Object.entries(SECTION_ENDPOINTS)) {
    const r = await api(path, { method: m, token: t, body });
    const allowed = sections.includes(sec);
    check(`console.${k}.${sec} ${allowed ? "allowed" : "refused"}`, allowed ? r.status === 200 : r.status === 403, `${m} ${path} → ${r.status}`);
  }
}
{
  const sup = await tok("support");
  const sa = await tok("super");
  const list = await api("/console/users?q=qa_", { token: sup });
  const byName = Object.fromEntries((list.json?.items ?? []).map((u) => [u.username, u]));
  check("console.users.search", list.status === 200 && byName.qa_lv30 && byName.qa_super, `${list.json?.items?.length} items`);
  check("console.users.contacts-masked", !PII.test(JSON.stringify(list.json)), "");
  const lv30 = byName.qa_lv30;
  const det = await api(`/console/users/${lv30?.id}`, { token: sup });
  check("console.users.detail", det.status === 200 && det.json?.level === 30, `${det.status} level=${det.json?.level} keys=${Object.keys(det.json ?? {}).join(",")}`);
  const short = await api(`/console/users/${lv30.id}/status`, { method: "POST", token: sup, body: { status: "suspended", reason: "x" } });
  check("console.suspend.reason-required", short.status === 400, `${short.status}`);
  // a signed-in player keeps working tokens while being suspended?
  const victim = await tok("lv30");
  const s1 = await api(`/console/users/${lv30.id}/status`, { method: "POST", token: sup, body: { status: "suspended", reason: "QA: suspend test" } });
  check("console.suspend.ok", s1.status === 200 && s1.json?.changed === true, `${s1.status} ${JSON.stringify(s1.json)}`);
  const stillMe = await api("/me", { token: victim });
  const stillWallet = await api("/wallet", { token: victim });
  check("console.suspend.existing-access-token-cut-off", stillMe.status === 401 && stillWallet.status === 401, `after suspend: /me ${stillMe.status}, /wallet ${stillWallet.status} (access token valid up to 15 min)`);
  const relogin = await signIn(email("lv30"), { fresh: true });
  check("console.suspend.blocks-new-sign-in", relogin.status === 401, `${relogin.status}`);
  const s2 = await api(`/console/users/${lv30.id}/status`, { method: "POST", token: sup, body: { status: "active", reason: "QA: reactivate" } });
  check("console.reactivate.ok", s2.status === 200 && s2.json?.changed === true, `${s2.status}`);
  const back = await signIn(email("lv30"), { fresh: true });
  check("console.reactivate.can-sign-in", back.status === 200, `${back.status}`);
  const supId = byName.qa_support?.id;
  const self = await api(`/console/users/${supId}/status`, { method: "POST", token: sup, body: { status: "suspended", reason: "QA self" } });
  check("console.protect.self", self.status === 400 && self.json?.code === "CANNOT_CHANGE_SELF", `${self.status} ${self.json?.code}`);
  const supr = await api(`/console/users/${byName.qa_super.id}/status`, { method: "POST", token: sup, body: { status: "suspended", reason: "QA super" } });
  check("console.protect.super-admin", supr.status === 403 && supr.json?.code === "SUPER_ADMIN_PROTECTED", `${supr.status} ${supr.json?.code}`);
  const acc = await api(`/console/users/${lv30.id}/status`, { method: "POST", token: await tok("accountant"), body: { status: "suspended", reason: "QA accountant" } });
  check("console.accountant-cannot-suspend", acc.status === 403, `${acc.status}`);
  // a suspended staff member keeps console access?
  const itId = byName.qa_it?.id;
  const itTok = await tok("it");
  await api(`/console/users/${itId}/status`, { method: "POST", token: sa, body: { status: "suspended", reason: "QA: suspended staff" } });
  const itMe = await api("/console/users?q=qa_", { token: itTok });
  check("console.suspended-staff-refused", itMe.status === 401 || itMe.status === 403, `suspended it_admin → /console/users ${itMe.status}`);
  await api(`/console/users/${itId}/status`, { method: "POST", token: sa, body: { status: "active", reason: "QA: restore" } });
  // admin token on suspend (back office)
  const viaTok = await api(`/console/users/${lv30.id}/status`, { method: "POST", headers: adm, body: { status: "suspended", reason: "QA via admin token" } });
  note("console.admin-token-suspend", `x-admin-token suspend → ${viaTok.status} ${JSON.stringify(viaTok.json)}`);
  if (viaTok.json?.changed) await api(`/console/users/${lv30.id}/status`, { method: "POST", headers: adm, body: { status: "active", reason: "QA restore" } });

  // buildings: close / open, public list follows, audited
  const it = await tok("it");
  const close = await api("/console/buildings/pool", { method: "PUT", token: it, body: { open: false, message: "QA closed for cleaning" } });
  const pub = await api("/buildings");
  const pool = (pub.json ?? []).find?.((b) => b.id === "pool");
  check("console.buildings.close→public", close.status === 200 && pool && pool.open === false && /cleaning/.test(pool.message ?? ""), `${close.status} ${JSON.stringify(pool)}`);
  const open = await api("/console/buildings/pool", { method: "PUT", token: it, body: { open: true, message: "" } });
  const pool2 = ((await api("/buildings")).json ?? []).find?.((b) => b.id === "pool");
  check("console.buildings.reopen clears message", open.status === 200 && pool2?.open === true && !pool2?.message, JSON.stringify(pool2));
  const badB = await api("/console/buildings/casino", { method: "PUT", token: it, body: { open: false } });
  check("console.buildings.unknown-id.400", badB.status === 400, `${badB.status}`);
  const audit = await api("/console/audit?q=building", { token: it });
  check("console.audit has building changes", audit.status === 200 && (audit.json ?? []).some((a) => a.action === "building.close"), `${audit.json?.length} rows`);

  // roles: grant / revoke (super only); visible at once
  const g = await api("/admin/access/grant", { method: "POST", token: sa, body: { user: "qa_lv12", role: "support_agent" } });
  const lvTok = await tok("lv12");
  const lvMe = await api("/console/me", { token: lvTok });
  check("roles.grant takes effect at once", g.status === 201 || g.status === 200 ? lvMe.status === 200 : false, `grant ${g.status}, console/me ${lvMe.status} ${JSON.stringify(lvMe.json?.sections)}`);
  const rv = await api("/admin/access/revoke", { method: "POST", token: sa, body: { user: "qa_lv12", role: "support_agent" } });
  const lvMe2 = await api("/console/me", { token: lvTok });
  check("roles.revoke takes effect at once", lvMe2.status === 403, `revoke ${rv.status}, console/me ${lvMe2.status}`);
  const selfRevoke = await api("/admin/access/revoke", { method: "POST", token: sa, body: { user: "qa_super", role: "super_admin", reason: "QA self revoke" } });
  check("roles.super-cannot-revoke-own-super", selfRevoke.status >= 400, `${selfRevoke.status} ${JSON.stringify(selfRevoke.json)}`);
  if (selfRevoke.status < 400) await api("/admin/access/grant", { method: "POST", headers: adm, body: { user: "qa_super", role: "super_admin", reason: "QA restore" } });
  const noReason = await api("/admin/access/grant", { method: "POST", token: sa, body: { user: "qa_lv12", role: "super_admin" } });
  check("roles.super-grant-needs-reason", noReason.status === 400 && noReason.json?.code === "REASON_REQUIRED", `${noReason.status} ${noReason.json?.code}`);

  // P2-CON-02 account management: sanctions with reasons + ends, notes, export (masked, role-gated), reports, sign-out
  const mute = await api(`/console/users/${lv30.id}/sanctions`, { method: "POST", token: sup, body: { kind: "mute", reason: "QA: mute test", hours: 1 } });
  check("console.mute.ok", mute.status === 200 && !!mute.json?.endsAt, `${mute.status} ${JSON.stringify(mute.json)}`);
  const badMute = await api(`/console/users/${lv30.id}/sanctions`, { method: "POST", token: sup, body: { kind: "mute", reason: "QA", hours: 0 } });
  check("console.mute.validated", badMute.status === 400 && badMute.json?.code === "VALIDATION_ERROR", `${badMute.status}`);
  const mutedRow = (await api("/console/users?q=qa_lv30", { token: sup })).json?.items?.[0];
  check("console.mute.listed", !!mutedRow?.mutedUntil, JSON.stringify(mutedRow?.mutedUntil));
  const unmute = await api(`/console/users/${lv30.id}/lift`, { method: "POST", token: sup, body: { kind: "mute", reason: "QA: unmute" } });
  check("console.unmute.ok", unmute.status === 200 && unmute.json?.changed === true, `${unmute.status}`);
  const noteR = await api(`/console/users/${lv30.id}/notes`, { method: "POST", token: sup, body: { body: "QA: internal note" } });
  const det2 = await api(`/console/users/${lv30.id}`, { token: sup });
  check("console.notes + sanctions in detail", noteR.status === 201 && det2.json?.notes?.[0]?.body === "QA: internal note" && det2.json?.sanctions?.some((s) => s.kind === "mute"), `${noteR.status}`);
  const exp = await api("/console/users/export?q=qa_", { token: sa });
  check("console.export.masked", exp.status === 200 && /^id,username,email/.test(exp.json?.csv ?? "") && !PII.test(exp.json?.csv ?? ""), `${exp.status} rows=${exp.json?.rows}`);
  const expSup = await api("/console/users/export", { token: sup });
  check("console.export.support-refused", expSup.status === 403, `${expSup.status}`);
  const filt = await api("/console/users?minLevel=20&maxLevel=40&q=qa_", { token: sup });
  check("console.users.level-filter", filt.status === 200 && (filt.json?.items ?? []).every((u) => u.level >= 20 && u.level <= 40) && filt.json.items.some((u) => u.username === "qa_lv30"), `${filt.json?.items?.length}`);
  const badFilt = await api("/console/users?minLevel=9&maxLevel=3", { token: sup });
  check("console.users.bad-range.400", badFilt.status === 400, `${badFilt.status}`);
  const reps = await api("/console/reports?status=open", { token: sup });
  check("console.reports.list", reps.status === 200 && Array.isArray(reps.json?.items), `${reps.status}`);
  const repAcc = await api("/console/reports", { token: await tok("accountant") });
  check("console.reports.accountant-refused", repAcc.status === 403, `${repAcc.status}`);

  // overview hides what the role may not see
  const ovA = await api("/console/overview", { token: await tok("accountant") });
  const ovE = await api("/console/overview", { token: await tok("events") });
  note("console.overview accountant", JSON.stringify(ovA.json).slice(0, 300));
  note("console.overview event_manager", JSON.stringify(ovE.json).slice(0, 300));
}

// ------------------------------------------------------------------ finance vs ledger (reconciliation)
{
  const fin = await api("/console/finance", { token: await tok("accountant") });
  const rec = await api("/admin/reports/reconciliation", { headers: adm });
  const sum = await api("/admin/reports/summary", { headers: adm });
  check("finance.console", fin.status === 200, `${fin.status} ${JSON.stringify(fin.json).slice(0, 400)}`);
  check("finance.reconciliation", rec.status === 200, `${rec.status} ${JSON.stringify(rec.json).slice(0, 400)}`);
  note("finance.summary", `${sum.status} ${JSON.stringify(sum.json).slice(0, 400)}`);
  const ints = JSON.stringify(fin.json ?? {}).match(/-?\d+\.\d+/g) ?? [];
  note("finance.non-integer numbers in console finance", ints.slice(0, 10).join(","));
}

// ------------------------------------------------------------------ wallet
{
  const t = await tok("lv1");
  const w = await api("/wallet", { token: t });
  check("wallet.get", w.status === 200 && Number.isSafeInteger(w.json?.stars) && w.json?.coins === 0, `${w.status} stars=${w.json?.stars} coins=${w.json?.coins} pilot=${w.json?.pilotEnabled}`);
  const d1 = await api("/wallet/daily-stars", { method: "POST", token: t });
  const d2 = await api("/wallet/daily-stars", { method: "POST", token: t });
  check("wallet.daily-claim idempotent", d1.status === 200 && d2.status === 200 && d2.json?.granted === 0, `first=${d1.json?.granted} second=${d2.json?.granted} streak=${d1.json?.streak}`);
  const w2 = await api("/wallet", { token: t });
  check("wallet.claimedToday + nextClaimAt", w2.json?.claimedToday === true && !!w2.json?.nextClaimAt, `${w2.json?.claimedToday} ${w2.json?.nextClaimAt}`);
  const q1 = await api("/wallet/quote", { method: "POST", token: t, body: { kind: "buy", currency: "RWF", amount: 1000 } });
  check("wallet.quote buy (pilot off)", q1.status === 200 && q1.json?.pilotEnabled === false, `${q1.status} ${JSON.stringify(q1.json).slice(0, 220)}`);
  const q2 = await api("/wallet/quote", { method: "POST", token: t, body: { kind: "cashout", currency: "RWF", amount: 100 } });
  check("wallet.quote cashout", q2.status === 200, `${q2.status} ${JSON.stringify(q2.json).slice(0, 220)}`);
  const q3 = await api("/wallet/quote", { method: "POST", token: t, body: { kind: "buy", currency: "RWF", amount: 10.5 } });
  check("money.quote rejects fractional", q3.status === 400, `${q3.status} ${JSON.stringify(q3.json).slice(0, 120)}`);
  const q4 = await api("/wallet/quote", { method: "POST", token: t, body: { kind: "buy", currency: "XXX", amount: 100 } });
  check("wallet.quote unknown currency.400", q4.status === 400, `${q4.status}`);
  const lim = await api("/wallet/limits", { method: "PUT", token: t, body: { dailyStakeLimit: 50.5 } });
  check("money.limit rejects fractional", lim.status === 400, `${lim.status}`);
  const brk = await api("/wallet/break", { method: "POST", token: t, body: { hours: 1 } });
  check("wallet.break invalid hours.400", brk.status === 400, `${brk.status}`);
  const lt = await tok("limit");
  const l0 = await api("/wallet/limits", { token: lt });
  check("wallet.seeded limit", l0.json?.dailyStakeLimit === 100, JSON.stringify(l0.json));
  const raise = await api("/wallet/limits", { method: "PUT", token: lt, body: { dailyStakeLimit: 500 } });
  check("wallet.raise limit waits 24 h", raise.json?.dailyStakeLimit === 100 && raise.json?.pendingStakeLimit === 500, JSON.stringify(raise.json));
  const lower = await api("/wallet/limits", { method: "PUT", token: lt, body: { dailyStakeLimit: 100 } });
  check("wallet.lower limit immediate", lower.json?.dailyStakeLimit === 100 && lower.json?.pendingStakeLimit === null, JSON.stringify(lower.json));
  const bt = await tok("break");
  const bl = await api("/wallet/limits", { token: bt });
  check("wallet.seeded break", !!bl.json?.selfExcludedUntil, JSON.stringify(bl.json));
  const shorten = await api("/wallet/break", { method: "POST", token: bt, body: { hours: 24 } });
  check("wallet.break cannot be shortened", shorten.json?.selfExcludedUntil === bl.json?.selfExcludedUntil, `${bl.json?.selfExcludedUntil} → ${shorten.json?.selfExcludedUntil}`);
  const hist = (w2.json?.history ?? []).map((h) => h.type);
  check("wallet.activity lists grants", hist.includes("stars_grant") && hist.includes("stars_daily"), hist.join(","));
}

// ------------------------------------------------------------------ arena
{
  const guest = await api("/arena/status");
  check("arena.guest status", guest.status === 200 && guest.json?.current?.title === "QA Members Night" && guest.json?.claimDenial === "LOGIN_REQUIRED", `${guest.status} open=${guest.json?.open} current=${guest.json?.current?.title} claimDenial=${guest.json?.claimDenial}`);
  const evId = guest.json?.current?.id;
  const nextId = guest.json?.next?.id;
  check("arena.next is the invite-only event", guest.json?.next?.title === "QA Invite-only Final", guest.json?.next?.title);
  const lv1 = await tok("lv1");
  const st = await api("/arena/status", { token: lv1 });
  check("arena.member canClaim", st.json?.canClaim === true, `canEnter=${st.json?.canEnter} canClaim=${st.json?.canClaim} ${st.json?.claimDenial}`);
  const c1 = await api(`/arena/events/${evId}/pass`, { method: "POST", token: lv1 });
  check("arena.claim pass", c1.status === 200 && c1.json?.pass?.zone === "seats", `${c1.status} ${JSON.stringify(c1.json)}`);
  const c1b = await api(`/arena/events/${evId}/pass`, { method: "POST", token: lv1 });
  check("arena.claim idempotent", c1b.status === 200, `${c1b.status}`);
  const rel = await api(`/arena/events/${evId}/pass`, { method: "DELETE", token: lv1 });
  check("arena.return pass", rel.status === 200 && rel.json?.released === true, `${rel.status} ${JSON.stringify(rel.json)}`);
  const barred = await tok("barred");
  const bs = await api("/arena/status", { token: barred });
  check("arena.barred cannot enter", bs.json?.canEnter === false && bs.json?.denial === "BARRED", `${bs.json?.denial}`);
  const bc = await api(`/arena/events/${evId}/pass`, { method: "POST", token: barred });
  check("arena.barred cannot claim", bc.status === 403 && bc.json?.denial === "BARRED", `${bc.status} ${bc.json?.denial}`);
  const ni = await api(`/arena/events/${nextId}/pass`, { method: "POST", token: await tok("lv5") });
  check("arena.invite-only refuses uninvited", ni.status === 403 && ni.json?.denial === "NOT_INVITED", `${ni.status} ${ni.json?.denial}`);
  const inv = await api(`/arena/events/${nextId}/pass`, { method: "POST", token: await tok("invited") });
  check("arena.invited claims", inv.status === 200, `${inv.status} ${JSON.stringify(inv.json)}`);
  const part = await api(`/arena/events/${evId}/pass`, { method: "POST", token: await tok("participant") });
  check("arena.participant gets floor", part.status === 200 && part.json?.pass?.zone === "floor", `${part.status} ${JSON.stringify(part.json)}`);
  // sold out: shrink capacity to the passes issued, then claim
  const ev = (await api("/admin/arena/events", { headers: adm })).json?.find?.((e) => e.id === evId);
  const cap0 = ev?.capacity;
  await api(`/arena/events/${evId}/pass`, { method: "POST", token: await tok("lv12") });
  const shrink = await api(`/admin/arena/events/${evId}`, { method: "PATCH", headers: adm, body: { capacity: 1 } });
  const so = await api(`/arena/events/${evId}/pass`, { method: "POST", token: await tok("lv5") });
  check("arena.sold-out", so.status === 403 && so.json?.denial === "SOLD_OUT", `patch=${shrink.status} claim=${so.status} ${so.json?.denial}`);
  await api(`/admin/arena/events/${evId}`, { method: "PATCH", headers: adm, body: { capacity: cap0 ?? 40 } });
  await api(`/arena/events/${evId}/pass`, { method: "DELETE", token: await tok("lv12") });
  // arena closed: players refused, staff still allowed
  await api("/admin/arena/settings", { method: "PUT", headers: adm, body: { open: false } });
  const cl = await api("/arena/status", { token: lv1 });
  const cs = await api("/arena/status", { token: await tok("events") });
  check("arena.closed refuses players", cl.json?.open === false && cl.json?.canEnter === false && cl.json?.denial === "ARENA_CLOSED", `${cl.json?.denial}`);
  check("arena.closed admits staff", cs.json?.canEnter === true, `${cs.json?.canEnter} ${cs.json?.denial}`);
  await api("/admin/arena/settings", { method: "PUT", headers: adm, body: { open: true } });
  // building master switch (console) also closes the arena
  await api("/console/buildings/arena", { method: "PUT", token: await tok("it"), body: { open: false, message: "QA" } });
  const cl2 = await api("/arena/status", { token: lv1 });
  check("arena.console building switch closes arena", cl2.json?.open === false, `${cl2.json?.open}`);
  await api("/console/buildings/arena", { method: "PUT", token: await tok("it"), body: { open: true, message: "" } });
  // pass limit: MAX_ACTIVE_PASSES = 3 — only two active events can exist without overlap here
  note("arena.pass-limit", "not exercised: needs 4 non-overlapping active events (PASS_LIMIT = 3); covered by unit tests");
  // event manager manages, accountant does not
  const em = await api("/admin/arena/events", { token: await tok("events") });
  const ac = await api("/admin/arena/events", { token: await tok("accountant") });
  check("arena.admin event_manager allowed / accountant refused", em.status === 200 && ac.status === 403, `${em.status}/${ac.status}`);
  // arena staff (super_admin / event_manager) are protected from bars; other staff roles are not arena staff
  const bar = await api("/admin/arena/bars", { method: "POST", token: await tok("super"), body: { user: "qa_events", reason: "QA bar arena staff" } });
  check("arena.cannot bar arena staff", bar.status === 409 && bar.json?.code === "STAFF_PROTECTED", `${bar.status} ${JSON.stringify(bar.json)}`);
  if (bar.status === 200) await api("/admin/arena/bars", { method: "DELETE", headers: adm, body: { user: "qa_events" } });
  const overlap = await api("/admin/arena/events", {
    method: "POST",
    headers: adm,
    body: { title: "QA overlap probe", kind: "exhibition", status: "scheduled", startsAt: new Date(Date.now() + 3600e3).toISOString(), endsAt: new Date(Date.now() + 7200e3).toISOString(), rules: [{ kind: "public" }] },
  });
  check("arena.overlap refused", overlap.status === 409 && overlap.json?.code === "EVENT_OVERLAP", `${overlap.status} ${overlap.json?.code}`);
}

// ------------------------------------------------------------------ ledger invariant
{
  const rec = await api("/admin/reports/reconciliation", { headers: adm });
  note("ledger.reconciliation after api suite", JSON.stringify(rec.json).slice(0, 400));
}
// ------------------------------------------------------------------ P2-CON-02 sign out everywhere (last: it ends qa_lv1's sessions)
{
  const lv1 = await signIn(email("lv1"));
  const lv1Id = (await api("/console/users?q=qa_lv1", { headers: adm })).json?.items?.find((u) => u.username === "qa_lv1")?.id;
  await new Promise((r) => setTimeout(r, 1100)); // the sign-out lands in a later second than the token
  const so = await api(`/console/users/${lv1Id}/sign-out`, { method: "POST", headers: adm, body: { reason: "QA: sign out everywhere" } });
  const lv1Me = await api("/me", { token: lv1.token });
  check("console.sign-out ends sessions", so.status === 200 && so.json?.signedOut >= 1 && lv1Me.status === 401, `${so.status} ${JSON.stringify(so.json)} /me ${lv1Me.status} ${lv1Me.json?.message?.code ?? lv1Me.json?.code}`);
}
await sleep(10);
done();
