import { describe, it, expect } from "vitest";
import { evaluateGate } from "../src/policy-gate.js";
import { DEFAULT_POLICY, createPolicy } from "@sverka/verification";
import type { Finding } from "@sverka/verification";

function makeFinding(severity: string, fingerprint: string, checkId = "test"): Finding {
  return {
    id: `${checkId}:${fingerprint}`,
    fingerprint,
    checkId,
    severity: severity as Finding["severity"],
    confidence: 0.5,
    message: "test finding",
    rule: "rule-1",
    file: "src/index.ts",
    startLine: 1,
    endLine: 1,
    source: {
      tool: "test",
      version: null,
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: null,
    },
  };
}

describe("PolicyGate", () => {
  it("no findings → verdict pass, exit code 0", () => {
    const { result, exitCode } = evaluateGate({ findings: [] });
    expect(result.verdict).toBe("pass");
    expect(exitCode).toBe(0);
  });

  it("high findings → verdict fail, exit code 1", () => {
    const findings = [makeFinding("high", "fp-1")];
    const { result, exitCode } = evaluateGate({ findings });
    expect(result.verdict).toBe("fail");
    expect(exitCode).toBe(1);
  });

  it("baseline fingerprints passed to evaluatePolicy for onlyNew filtering", () => {
    // DEFAULT_POLICY has {severity: "high", onlyNew: false} and {severity: "medium", onlyNew: true}
    // A medium finding in the baseline should NOT trigger the onlyNew rule
    const findings = [makeFinding("medium", "fp-baseline")];
    const { result } = evaluateGate({
      findings,
      baselineFingerprints: ["fp-baseline"],
    });
    // The medium finding is in baseline, so onlyNew:true rule doesn't trigger
    // The high rule doesn't trigger (medium < high)
    expect(result.verdict).toBe("pass");
  });

  it("uses DEFAULT_POLICY when none provided", () => {
    const { result } = evaluateGate({ findings: [] });
    // DEFAULT_POLICY has failOn rules, but with no findings, verdict is "pass"
    expect(result.verdict).toBe("pass");
    // Verify it's the default policy by checking that a high finding triggers it
    const { result: failResult } = evaluateGate({
      findings: [makeFinding("high", "fp-1")],
    });
    expect(failResult.verdict).toBe("fail");
  });

  it("uses provided policy when given", () => {
    const strictPolicy = createPolicy({
      name: "strict",
      default: "pass",
      failOn: [{ severity: "low", onlyNew: false }],
    });
    const { result, exitCode } = evaluateGate({
      findings: [makeFinding("low", "fp-1")],
      policy: strictPolicy,
    });
    expect(result.verdict).toBe("fail");
    expect(exitCode).toBe(1);
  });
});
