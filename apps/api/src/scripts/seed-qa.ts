/**
 * QA seed (QA-01): repeatable, idempotent test accounts and arena events for end-to-end testing. DEV ONLY.
 *
 *   DATABASE_URL=pglite://<scratch dir> pnpm --filter @gukirana/api run seed:qa
 *
 * Opens DATABASE_URL directly (runs migrations), so with PGlite run it BEFORE the API starts — the script refuses to
 * run while an API answers at API_INTERNAL_URL with a PGlite database. Accounts use the reserved `@example.test`
 * domain and are documented in docs/QA/ACCOUNTS.md.
 *
 * Money rules: Stars only through LedgerService.post() with idempotency keys and the existing `stars_grant` entry
 * type (the same recipe as the welcome grant); coins are never touched. XP / status / limits are set directly.
 */
import "reflect-metadata";
import { loadEnv } from "@gukirana/config";
import { createDatabase, eq, users } from "@gukirana/db";
import type { ArenaScopeRule } from "@gukirana/contracts";
import { AccessService } from "../modules/admin-block/access.service.js";
import { ArenaService } from "../modules/arena/arena.service.js";
import { ArenaPresence } from "../modules/arena/presence.js";
import { BuildingsService } from "../modules/console/buildings.service.js";
import { EconomyService } from "../modules/economy/economy.service.js";
import { LedgerService } from "../modules/ledger/ledger.service.js";
import { starsBudget, userStars } from "../modules/ledger/accounts.js";
import { totalXpForLevel } from "../modules/levels/xp.js";
import { WalletService } from "../modules/wallet/wallet.service.js";
import { WELCOME_STARS } from "../modules/identity/identity.service.js";
import { defaultLookCode } from "../modules/identity/default-look.js";
import { newId } from "../common/ids.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed:qa refuses to run with NODE_ENV=production");
  process.exit(2);
}
const env = loadEnv();

const DOMAIN = "@example.test";
const WHO = "qa-seed";

type State = "active" | "suspended" | "limit" | "break";
interface Account {
  key: string;
  email: string;
  phone?: string;
  username: string | null;
  level: number;
  state: State;
  extraStars?: number;
  roles?: string[];
  color: string;
}

/** Keep in sync with docs/QA/ACCOUNTS.md. */
export const QA_ACCOUNTS: Account[] = [
  { key: "new", email: `qa.new${DOMAIN}`, username: null, level: 1, state: "active", color: "#C0392B" },
  { key: "lv1", email: `qa.lv1${DOMAIN}`, username: "qa_lv1", level: 1, state: "active", color: "#2F80ED" },
  { key: "lv5", email: `qa.lv5${DOMAIN}`, phone: "+250789990005", username: "qa_lv5", level: 5, state: "active", color: "#27AE60" },
  { key: "lv12", email: `qa.lv12${DOMAIN}`, username: "qa_lv12", level: 12, state: "active", color: "#8E44AD" },
  { key: "lv30", email: `qa.lv30${DOMAIN}`, username: "qa_lv30", level: 30, state: "active", color: "#D35400" },
  { key: "limit", email: `qa.limit${DOMAIN}`, username: "qa_limit", level: 3, state: "limit", extraStars: 1000, color: "#16A085" },
  { key: "break", email: `qa.break${DOMAIN}`, username: "qa_break", level: 3, state: "break", extraStars: 1000, color: "#7F8C8D" },
  { key: "suspended", email: `qa.suspended${DOMAIN}`, username: "qa_suspended", level: 2, state: "suspended", color: "#34495E" },
  { key: "pvp1", email: `qa.pvp1${DOMAIN}`, username: "qa_pvp1", level: 6, state: "active", extraStars: 2000, color: "#E67E22" },
  { key: "pvp2", email: `qa.pvp2${DOMAIN}`, username: "qa_pvp2", level: 6, state: "active", extraStars: 2000, color: "#1ABC9C" },
  { key: "super", email: `qa.super${DOMAIN}`, username: "qa_super", level: 10, state: "active", roles: ["super_admin"], color: "#F1C40F" },
  { key: "it", email: `qa.it${DOMAIN}`, username: "qa_it", level: 8, state: "active", roles: ["it_admin"], color: "#3498DB" },
  { key: "accountant", email: `qa.accountant${DOMAIN}`, username: "qa_accountant", level: 8, state: "active", roles: ["accountant"], color: "#9B59B6" },
  { key: "support", email: `qa.support${DOMAIN}`, username: "qa_support", level: 8, state: "active", roles: ["support_agent"], color: "#E74C3C" },
  { key: "events", email: `qa.events${DOMAIN}`, username: "qa_events", level: 8, state: "active", roles: ["event_manager"], color: "#2ECC71" },
  { key: "invited", email: `qa.invited${DOMAIN}`, username: "qa_invited", level: 4, state: "active", color: "#5DADE2" },
  { key: "participant", email: `qa.participant${DOMAIN}`, username: "qa_participant", level: 9, state: "active", color: "#AF7AC5" },
  { key: "barred", email: `qa.barred${DOMAIN}`, username: "qa_barred", level: 4, state: "active", color: "#CD6155" },
];

export const QA_DAILY_STAKE_LIMIT = 100;
export const QA_BREAK_HOURS = 168;
export const QA_MEMBERS_EVENT = "QA Members Night";
export const QA_INVITE_EVENT = "QA Invite-only Final";

async function apiIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${env.API_INTERNAL_URL}/healthz`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (env.DATABASE_URL.startsWith("pglite://") && (await apiIsUp())) {
    console.error(`An API answers at ${env.API_INTERNAL_URL}; PGlite is single-process. Stop it (or point API_INTERNAL_URL elsewhere) and re-run.`);
    process.exit(2);
  }
  const { db, close } = await createDatabase(env.DATABASE_URL, { migrate: true });
  try {
    const ledger = new LedgerService(db);
    const access = new AccessService(db);
    const economy = new EconomyService(db);
    const wallet = new WalletService(db, ledger, economy);
    const arena = new ArenaService(db, access, new ArenaPresence());
    const buildings = new BuildingsService(db);
    await access.seed();
    await arena.seed();
    await buildings.seed();

    const ids: Record<string, string> = {};
    for (const a of QA_ACCOUNTS) {
      if (!a.email.endsWith(DOMAIN)) throw new Error(`QA accounts must use ${DOMAIN}: ${a.email}`);
      const xp = totalXpForLevel(a.level);
      const status = a.state === "suspended" ? "suspended" : "active";
      let [u] = await db.select().from(users).where(eq(users.email, a.email));
      if (!u) {
        const id = newId();
        await db.insert(users).values({ id, email: a.email, phone: a.phone ?? null, username: a.username, color: a.color, look: defaultLookCode(id, a.color), xp, status });
        [u] = await db.select().from(users).where(eq(users.id, id));
      } else {
        // reset the profile fields QA relies on (a test run may have renamed / suspended the account)
        await db.update(users).set({ username: a.username, phone: a.phone ?? null, xp, status }).where(eq(users.id, u.id));
      }
      const id = u!.id;
      ids[a.key] = id;
      // the same welcome grant a real sign-up gets (idempotent on the same key)
      await ledger.post({
        type: "stars_grant",
        idempotencyKey: `welcome:${id}`,
        ref: { type: "user", id },
        createdBy: "identity",
        lines: [
          { account: starsBudget(), amount: WELCOME_STARS, direction: "D" },
          { account: userStars(id), amount: WELCOME_STARS, direction: "C" },
        ],
      });
      if (a.extraStars) {
        await ledger.post({
          type: "stars_grant",
          idempotencyKey: `qa-seed:${id}:stars:v1`,
          ref: { type: "user", id },
          createdBy: WHO,
          lines: [
            { account: starsBudget(), amount: a.extraStars, direction: "D" },
            { account: userStars(id), amount: a.extraStars, direction: "C" },
          ],
        });
      }
      if (a.state === "limit") await wallet.setLimits(id, { dailyStakeLimit: QA_DAILY_STAKE_LIMIT });
      if (a.state === "break") {
        const l = await wallet.limits(id);
        if (!l.selfExcludedUntil) await wallet.takeBreak(id, QA_BREAK_HOURS);
      }
      for (const role of a.roles ?? []) await access.grant(id, role, "cli");
    }

    // ---------------- arena: building switch on, one members event now, one invite-only event tomorrow
    await arena.updateSettings({ open: true }, WHO);
    const events = await arena.listEvents();
    const live = (title: string) => events.find((e) => e.title === title && !["ended", "cancelled"].includes(e.status));
    const now = Date.now();
    const H = 3_600_000;
    const iso = (ms: number) => new Date(ms).toISOString();

    let membersId = live(QA_MEMBERS_EVENT)?.id;
    if (!membersId) {
      const rules: ArenaScopeRule[] = [{ kind: "members" }];
      membersId = (await arena.createEvent(
        { title: QA_MEMBERS_EVENT, kind: "watch_party", game: "pool", description: "QA: signed-in members, doors open now", status: "scheduled", doorsOpenAt: iso(now - 10 * 60_000), startsAt: iso(now + 3 * H), endsAt: iso(now + 5 * H), rules, capacity: 40, vipCapacity: 4 },
        WHO,
      )).id;
    }
    let inviteId = live(QA_INVITE_EVENT)?.id;
    if (!inviteId) {
      const rules: ArenaScopeRule[] = [{ kind: "invite" }];
      // starts after the members event ends (no overlap); scheduled so it shows as "upcoming"
      inviteId = (await arena.createEvent(
        { title: QA_INVITE_EVENT, kind: "tournament", game: "ludo", description: "QA: invite-only", status: "scheduled", doorsOpenAt: iso(now + 20 * H), startsAt: iso(now + 21 * H), endsAt: iso(now + 23 * H), rules, capacity: 10, vipCapacity: 0 },
        WHO,
      )).id;
    }
    await arena.invite(inviteId, ids.invited!, "seats", WHO);
    await arena.addParticipant(membersId, ids.participant!, WHO);
    await arena.addParticipant(inviteId, ids.participant!, WHO);
    await arena.bar(ids.barred!, "QA seed: barred for testing", undefined, WHO);

    const out = QA_ACCOUNTS.map((a) => ({ key: a.key, email: a.email, username: a.username, level: a.level, state: a.state, roles: a.roles ?? [], id: ids[a.key], stars: 0 }));
    for (const o of out) o.stars = await ledger.balance(userStars(o.id!));
    console.log(JSON.stringify({ accounts: out, arena: { members: membersId, invite: inviteId }, ledgerTotal: await ledger.totalOfAllBalances() }, null, 2));
  } finally {
    await close();
  }
}

await main().catch((e: unknown) => {
  console.error("seed:qa failed:", (e as Error).message ?? e, JSON.stringify((e as { response?: unknown }).response ?? ""));
  process.exit(1);
});
