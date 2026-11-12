import { describe, expect, it } from "vitest";
import { filterChat, sanitizeName } from "./chat-filter.js";

describe("filterChat", () => {
  it("masks phone numbers", () => {
    const r = filterChat("call me 0788 123 456 ok");
    expect(r.text).toBe("call me ••• ok");
    expect(r.reason).toBe("contact-or-payment");
  });
  it("blocks payment requests outside escrow", () => {
    expect(filterChat("send me momo and I let you win").blocked).toBe(true);
  });
  it("keeps normal chat", () => {
    expect(filterChat("anyone for pool? 50 coins")).toEqual({ text: "anyone for pool? 50 coins", blocked: false });
  });
  it("sanitizes names", () => {
    expect(sanitizeName("<b>Aline</b>")).toBe("bAlineb");
    expect(sanitizeName("x").startsWith("Player")).toBe(true);
  });
});
