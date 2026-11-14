import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, matches, users, type Database } from "@gukirana/db";
import { LedgerService } from "../ledger/ledger.service.js";
import { matchEscrow, userStars } from "../ledger/accounts.js";
import { EconomyService } from "../economy/economy.service.js";
import { WalletService } from "../wallet/wallet.service.js";
import { LevelsService } from "../levels/levels.service.js";
import { GamesService } from "./games.service.js";

let db: Database;
let close: () => Promise<void>;
let ledger: LedgerService;
let wallet: WalletService;
let games: GamesService;

const a = "66666666-0000-4000-8000-000000000001";
const b = "66666666-0000-4000-8000-000000000002";
const brk = "66666666-0000-4000-8000-000000000003";
const poor = "66666666-0000-4000-8000-000000000004";

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  db = d.db;
  close = d.close;
  ledger = new LedgerService(db);
  const economy = new EconomyService(db);
  wallet = new WalletService(db, ledger, economy);
  games = new GamesService(db, ledger, new LevelsService(db, wallet), economy, wallet);
  await db.insert(users).values([
    { id: a, email: "a@example.test", username: "pa" },
    { id: b, email: "b@example.test", username: "pb" },
    { id: brk, email: "brk@example.test", username: "pbrk" },
    { id: poor, email: "poor@example.test", username: "ppoor" },
  ]);
  for (const u of [a, b, brk]) await wallet.claimDaily(u); // 200 Stars each, through the ledger
  await wallet.takeBreak(brk, 168);
});
afterAll(() => close());

const create = (ids: string[], stake: number) =>
  games.create({ game: "igisoro", variant: "classic", stake, players: ids.map((userId, seat) => ({ userId, seat })) });

describe("eligibility (pre-check for challenges and quick match)", () => {
  it("names the precise reason for the player concerned", async () => {
    expect(await games.eligibility(a, 25)).toEqual({ ok: true });
    expect(await games.eligibility(brk, 25)).toEqual({ ok: false, reason: "ON_A_BREAK" });
    expect(await games.eligibility(brk, 0)).toEqual({ ok: true }); // free games stay allowed on a break
    expect(await games.eligibility(poor, 25)).toEqual({ ok: false, reason: "INSUFFICIENT_FUNDS" });
    expect(await games.eligibility("66666666-0000-4000-8000-00000000ffff", 0)).toEqual({ ok: false, reason: "UNKNOWN_PLAYER" });
  });

  it("create() re-checks and names the player in the error", async () => {
    const err = await create([a, brk], 25).catch((e: { getResponse(): unknown }) => e.getResponse());
    expect(err).toMatchObject({ code: "ON_A_BREAK", userId: brk });
    expect(await ledger.balance(userStars(a))).toBe(200); // nothing locked
  });
});

describe("a suspended player (GAP-001)", () => {
  it("cannot be put into a match, even a free one", async () => {
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, b));
    expect(await games.eligibility(b, 0)).toEqual({ ok: false, reason: "ACCOUNT_INACTIVE" });
    const err = await create([a, b], 0).catch((e: { getResponse(): unknown }) => e.getResponse());
    expect(err).toMatchObject({ code: "ACCOUNT_INACTIVE", userId: b });
    await db.update(users).set({ status: "active" }).where(eq(users.id, b));
  });

  it("their active matches are voided and every stake refunded through the ledger", async () => {
    const m = await create([a, b], 25);
    expect(await ledger.balance(userStars(a))).toBe(175);
    expect(await ledger.balance(matchEscrow(m.matchId, "STAR"))).toBe(50);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, b));
    expect(await games.voidActiveFor(b)).toEqual([m.matchId]);
    expect(await ledger.balance(userStars(a))).toBe(200);
    expect(await ledger.balance(userStars(b))).toBe(200);
    expect(await ledger.balance(matchEscrow(m.matchId, "STAR"))).toBe(0);
    const [row] = await db.select().from(matches).where(eq(matches.id, m.matchId));
    expect(row?.status).toBe("void");
    expect(await games.voidActiveFor(b)).toEqual([]); // idempotent
  });
});
