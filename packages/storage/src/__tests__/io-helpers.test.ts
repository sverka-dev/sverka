// Spec 31 — io-helpers tests.
import { describe, it, expect } from "vitest";
import { isENOENT } from "../internal/io-helpers.js";

describe("isENOENT", () => {
  it("returns true for ENOENT errors", () => {
    expect(isENOENT(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(
      true,
    );
  });

  it("returns false for other error codes", () => {
    expect(isENOENT(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(
      false,
    );
  });

  it("returns false for non-object rejections instead of throwing", () => {
    expect(isENOENT(null)).toBe(false);
    expect(isENOENT(undefined)).toBe(false);
    expect(isENOENT("ENOENT")).toBe(false);
    expect(isENOENT(404)).toBe(false);
  });
});
