import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports createHostDriver", () => {
    expect(typeof api.createHostDriver).toBe("function");
  });

  it("exports createAllowlist", () => {
    expect(typeof api.createAllowlist).toBe("function");
  });

  it("exports error classes", () => {
    expect(api.HostDriverError).toBeDefined();
    expect(api.CommandNotAllowedError).toBeDefined();
  });
});
