import { describe, expect, it } from "vitest";
import { keyFromSeed, signResult, verifyResult } from "./index.js";

describe("result signing", () => {
  const { privateKey, publicKey } = keyFromSeed();
  const base = { matchId: "m1", game: "ludo", ranks: { a: 1, b: 2 }, reason: "normal" as const, stateHash: "h", finishedAt: "t" };

  it("verifies a genuine result", () => {
    expect(verifyResult(signResult(base, privateKey), publicKey)).toBe(true);
  });
  it("rejects a tampered result", () => {
    const signed = signResult(base, privateKey);
    expect(verifyResult({ ...signed, ranks: { a: 2, b: 1 } }, publicKey)).toBe(false);
  });
  it("rejects a result signed with another key", () => {
    const other = keyFromSeed("11".repeat(32));
    expect(verifyResult(signResult(base, other.privateKey), publicKey)).toBe(false);
  });
});
