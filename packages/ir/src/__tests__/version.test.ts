import { describe, it, expect } from "vitest";
import { PLAN_SCHEMA_VERSION } from "../version.js";

describe("PLAN_SCHEMA_VERSION", () => {
  it("equals sverka.dev/v1", () => {
    expect(PLAN_SCHEMA_VERSION).toBe("sverka.dev/v1");
  });
});
