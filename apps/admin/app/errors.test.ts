import { describe, expect, it } from "vitest";
import { plainError } from "./errors";

const thrown = (body: unknown) => new Error(JSON.stringify(body));

describe("back-office errors in plain words (GAP-015)", () => {
  it("API codes", () => {
    expect(plainError(thrown({ code: "LAST_SUPER_ADMIN" }))).toMatch(/last active Super Admin/);
    expect(plainError(thrown({ message: { code: "CANNOT_REVOKE_OWN_SUPER_ADMIN" } }))).toMatch(/own Super Admin/);
  });
  it("a wrong token reads as such, not as a raw 401", () => {
    expect(plainError(thrown({ statusCode: 401, message: "Unauthorized" }))).toBe("Wrong or missing admin token.");
    expect(plainError(thrown({ status: 401 }))).toBe("Wrong or missing admin token.");
  });
  it("anything else is shown as-is", () => {
    expect(plainError(thrown({ code: "SOMETHING_NEW" }))).toBe("SOMETHING_NEW");
    expect(plainError(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });
});
