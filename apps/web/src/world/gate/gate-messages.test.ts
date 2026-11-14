import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/session";
import { errMsg, GATE_MSG } from "./gate-store";

describe("gate messages", () => {
  it("a suspended account is told so politely, without any reason (GAP-003)", () => {
    const m = errMsg(new ApiError(401, "ACCOUNT_INACTIVE"));
    expect(m).toBe("This account is suspended. Contact support.");
    expect(m).not.toBe(GATE_MSG.VALIDATION_ERROR);
  });
  it("unknown codes still read as a validation problem; no response is a network problem", () => {
    expect(errMsg(new ApiError(400, "SOMETHING_NEW"))).toBe(GATE_MSG.VALIDATION_ERROR);
    expect(errMsg(new TypeError("fetch failed"))).toBe(GATE_MSG.NETWORK);
  });
});
