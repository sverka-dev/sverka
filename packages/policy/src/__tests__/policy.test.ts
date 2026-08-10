import { describe, it, expect } from "vitest";
import { DEFAULT_POLICY, createPolicy, severityRank } from "../policy.js";
import { PolicyError } from "../errors.js";
import type { Policy, PolicyConfig, Verdict } from "../types.js";

describe("severityRank", () => {
  it("orders info < low < medium < high < critical", () => {
    expect(severityRank("info")).toBeLessThan(severityRank("low"));
    expect(severityRank("low")).toBeLessThan(severityRank("medium"));
    expect(severityRank("medium")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("critical"));
  });

  it("returns numeric ranks", () => {
    expect(severityRank("info")).toBe(0);
    expect(severityRank("critical")).toBe(4);
  });
});

describe("DEFAULT_POLICY", () => {
  it("has name 'default'", () => {
    expect(DEFAULT_POLICY.name).toBe("default");
  });

  it("defaults to 'pass'", () => {
    expect(DEFAULT_POLICY.default).toBe("pass");
  });

  it("has two failOn rules: high (always) and medium (onlyNew)", () => {
    expect(DEFAULT_POLICY.failOn).toHaveLength(2);
    expect(DEFAULT_POLICY.failOn[0]).toEqual({
      severity: "high",
      onlyNew: false,
    });
    expect(DEFAULT_POLICY.failOn[1]).toEqual({
      severity: "medium",
      onlyNew: true,
    });
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true);
  });
});

describe("createPolicy", () => {
  it("returns defaults when config is empty", () => {
    const p = createPolicy({});
    expect(p.name).toBe("default");
    expect(p.default).toBe("pass");
    expect(p.failOn).toEqual(DEFAULT_POLICY.failOn);
  });

  it("merges partial config: name only", () => {
    const p = createPolicy({ name: "strict" });
    expect(p.name).toBe("strict");
    expect(p.default).toBe("pass");
    expect(p.failOn).toEqual(DEFAULT_POLICY.failOn);
  });

  it("merges partial config: default only", () => {
    const p = createPolicy({ default: "fail" });
    expect(p.name).toBe("default");
    expect(p.default).toBe("fail");
    expect(p.failOn).toEqual(DEFAULT_POLICY.failOn);
  });

  it("merges partial config: failOn only", () => {
    const failOn = [{ severity: "low" as const, onlyNew: false }];
    const p = createPolicy({ failOn });
    expect(p.name).toBe("default");
    expect(p.default).toBe("pass");
    expect(p.failOn).toEqual(failOn);
  });

  it("merges full config", () => {
    const config: PolicyConfig = {
      name: "strict",
      default: "fail",
      failOn: [{ severity: "critical", onlyNew: true }],
    };
    const p = createPolicy(config);
    expect(p).toEqual<Policy>({
      name: "strict",
      default: "fail",
      failOn: [{ severity: "critical", onlyNew: true }],
    });
  });

  it("fills missing default with 'pass'", () => {
    const p = createPolicy({ name: "x", failOn: [] });
    expect(p.default).toBe("pass");
  });

  it("fills missing name with 'default'", () => {
    const p = createPolicy({ failOn: [] });
    expect(p.name).toBe("default");
  });

  it("fills missing failOn with DEFAULT_POLICY.failOn", () => {
    const p = createPolicy({ name: "x", default: "fail" });
    expect(p.failOn).toEqual(DEFAULT_POLICY.failOn);
  });

  it("throws INVALID_SEVERITY for unknown severity", () => {
    expect(() =>
      createPolicy({
        failOn: [{ severity: "unknown" as unknown as "low", onlyNew: false }],
      }),
    ).toThrow(PolicyError);
    try {
      createPolicy({
        failOn: [{ severity: "boom" as unknown as "low", onlyNew: false }],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyError);
      expect((err as PolicyError).code).toBe("INVALID_SEVERITY");
    }
  });

  it("accepts a Verdict value as default", () => {
    const pass: Verdict = "pass";
    const fail: Verdict = "fail";
    expect(createPolicy({ default: pass }).default).toBe("pass");
    expect(createPolicy({ default: fail }).default).toBe("fail");
  });
});
