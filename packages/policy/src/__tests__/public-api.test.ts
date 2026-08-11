import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POLICY,
  createPolicy,
  evaluatePolicy,
  PolicyError,
  type Verdict,
  type Policy,
  type FailOnRule,
  type TriggeredFinding,
  type RuleResult,
  type PolicyResult,
  type PolicyConfig,
  type PolicyErrorCode,
} from "../index.js";

describe("public API — functions and constants", () => {
  it("exports DEFAULT_POLICY constant", () => {
    expect(DEFAULT_POLICY).toBeDefined();
    expect(DEFAULT_POLICY.name).toBe("default");
  });

  it("exports createPolicy function", () => {
    expect(typeof createPolicy).toBe("function");
  });

  it("exports evaluatePolicy function", () => {
    expect(typeof evaluatePolicy).toBe("function");
  });
});

describe("public API — error class", () => {
  it("exports PolicyError class", () => {
    const err = new PolicyError("msg", "INVALID_POLICY");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyError");
    expect(err.code).toBe("INVALID_POLICY");
  });
});

describe("public API — types (compile-time check)", () => {
  it("all spec types are importable", () => {
    const _verdict: Verdict = "pass";
    const _policy: Policy = {
      name: "x",
      default: "pass",
      failOn: [{ severity: "low", onlyNew: false }],
    };
    const _rule: FailOnRule = { severity: "low", onlyNew: false };
    const _triggered: TriggeredFinding = {
      finding: {} as never,
      ruleIndex: 0,
    };
    const _ruleResult: RuleResult = {
      ruleIndex: 0,
      triggered: false,
      matched: [],
    };
    const _result: PolicyResult = {
      verdict: "pass",
      triggered: [],
      rules: [],
      summary: "",
    };
    const _config: PolicyConfig = {};
    const _code: PolicyErrorCode = "INVALID_POLICY";
    // Touch all to avoid unused warnings.
    expect(_verdict).toBe("pass");
    expect(_policy.name).toBe("x");
    expect(_rule.severity).toBe("low");
    expect(_triggered.ruleIndex).toBe(0);
    expect(_ruleResult.triggered).toBe(false);
    expect(_result.verdict).toBe("pass");
    expect(_config).toBeDefined();
    expect(_code).toBe("INVALID_POLICY");
  });
});

describe("public API — built package entrypoint", () => {
  it("exports the expected symbols from the built entrypoint when available", async () => {
    const dist = resolve(
      fileURLToPath(import.meta.url),
      "../../dist/index.mjs",
    );
    if (!existsSync(dist)) {
      // Building is a separate Nx target; unit tests run against source.
      return;
    }
    const pkg = await import(dist);
    expect(typeof pkg.createPolicy).toBe("function");
    expect(typeof pkg.evaluatePolicy).toBe("function");
    expect(pkg.DEFAULT_POLICY).toBeDefined();
    expect(typeof pkg.PolicyError).toBe("function");
  });
});
