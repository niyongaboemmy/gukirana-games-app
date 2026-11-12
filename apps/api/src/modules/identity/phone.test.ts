import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, normalizePhone, parseLoginId } from "./phone.js";

describe("phone", () => {
  it("normalises Rwandan numbers", () => {
    expect(normalizePhone("0788 123 456")).toBe("+250788123456");
    expect(normalizePhone("250738123456")).toBe("+250738123456");
    expect(normalizePhone("+250 722 123 456")).toBe("+250722123456");
  });
  it("rejects junk", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("0712345678")).toBeNull();
  });
  it("masks", () => expect(maskPhone("+250788123456")).toBe("+25078••••456"));
});

describe("login id", () => {
  it("accepts phone or email", () => {
    expect(parseLoginId("0788123456")).toEqual({ kind: "phone", value: "+250788123456" });
    expect(parseLoginId(" Aline@Example.RW ")).toEqual({ kind: "email", value: "aline@example.rw" });
    expect(parseLoginId("not-an-id")).toBeNull();
    expect(parseLoginId("a@b")).toBeNull();
  });
  it("masks email", () => expect(maskEmail("aline@example.rw")).toBe("al•••@example.rw"));
});
