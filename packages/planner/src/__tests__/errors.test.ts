import { describe, it, expect } from "vitest";
import { DiscoveryError } from "../errors.js";
import type { DiscoveryErrorCode } from "../errors.js";

describe("DiscoveryError", () => {
  it("is an Error subclass", () => {
    const err = new DiscoveryError("boom", "ROOT_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name, message, and code", () => {
    const err = new DiscoveryError("root gone", "ROOT_NOT_FOUND");
    expect(err.name).toBe("DiscoveryError");
    expect(err.message).toBe("root gone");
    expect(err.code).toBe("ROOT_NOT_FOUND");
  });

  it("chains a cause when provided", () => {
    const inner = new Error("ENOENT");
    const err = new DiscoveryError("git missing", "GIT_UNAVAILABLE", inner);
    expect(err.cause).toBe(inner);
  });

  it("cause is undefined when omitted", () => {
    const err = new DiscoveryError("no repo", "GIT_NOT_A_REPO");
    expect(err.cause).toBeUndefined();
  });

  it("supports all four error codes", () => {
    const codes: DiscoveryErrorCode[] = [
      "ROOT_NOT_FOUND",
      "GIT_UNAVAILABLE",
      "GIT_NOT_A_REPO",
      "TRAVERSAL_FAILED",
    ];
    for (const code of codes) {
      const err = new DiscoveryError("msg", code);
      expect(err.code).toBe(code);
    }
  });
});
