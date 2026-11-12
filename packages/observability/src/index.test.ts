import { describe, expect, it } from "vitest";
import { maskPhone } from "./index.js";

describe("maskPhone", () => {
  it("keeps only the prefix and last digits", () => {
    expect(maskPhone("+250788123123")).toBe("+2507****123");
  });
});
