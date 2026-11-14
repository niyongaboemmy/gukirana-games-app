import { describe, expect, it } from "vitest";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_RE, UsernameSchema } from "./identity.js";

describe("username rule (GAP-010)", () => {
  it("3–16 letters, digits, _ . -", () => {
    for (const ok of ["abc", "qa_lv30", "Ngabo.K", "a-b", "Ünïcødé", "x".repeat(USERNAME_MAX)]) expect(USERNAME_RE.test(ok)).toBe(true);
    for (const bad of ["ab", "x".repeat(USERNAME_MAX + 1), "with space", "semi;colon", "", "emoji😀"]) expect(USERNAME_RE.test(bad)).toBe(false);
    expect(USERNAME_MIN).toBe(3);
  });
  it("the schema the API uses is the same rule", () => {
    expect(UsernameSchema.safeParse("ab").success).toBe(false);
    expect(UsernameSchema.safeParse("abc").success).toBe(true);
  });
});
