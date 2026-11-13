import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, users } from "@gukirana/db";
import { SocialService } from "./social.service.js";

let close: () => Promise<void>;
let social: SocialService;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  close = d.close;
  await d.db.insert(users).values([
    { id: A, email: "a@example.rw", username: "Aline", xp: 0 },
    { id: B, phone: "+250788000111", username: "Bosco", xp: 1200 },
    { id: C, email: "c@example.rw" }, // not onboarded (no username)
  ]);
  social = new SocialService(d.db);
});
afterAll(() => close());

describe("SocialService", () => {
  it("public profile never exposes phone or email", async () => {
    const p = await social.publicProfile(B);
    expect(p).toMatchObject({ id: B, username: "Bosco" });
    expect(p.level).toBeGreaterThan(1);
    expect(JSON.stringify(p)).not.toContain("+250");
    expect(JSON.stringify(p)).not.toContain("@");
    await expect(social.publicProfile(C)).rejects.toThrow();
  });

  it("block list: add (idempotent), list, remove; not yourself", async () => {
    await social.block(A, B);
    await social.block(A, B);
    expect((await social.blocks(A)).map((b) => b.username)).toEqual(["Bosco"]);
    expect(await social.blocks(B)).toEqual([]);
    await expect(social.block(A, A)).rejects.toThrow();
    await social.unblock(A, B);
    expect(await social.blocks(A)).toEqual([]);
  });

  it("reports are queued with chat evidence and rate limited", async () => {
    const r = await social.report(A, { targetId: B, reason: "scam", context: { place: "plaza", chat: [{ name: "Bosco", text: "pay me first", t: 1 }] } });
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
    await expect(social.report(A, { targetId: A, reason: "other" })).rejects.toThrow();
    for (let i = 0; i < 19; i++) await social.report(A, { targetId: B, reason: "harassment" });
    await expect(social.report(A, { targetId: B, reason: "harassment" })).rejects.toThrow();
  });
});
