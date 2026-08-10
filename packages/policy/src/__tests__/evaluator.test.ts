import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../evaluator.js";
import { DEFAULT_POLICY, createPolicy } from "../policy.js";
import { PolicyError } from "../errors.js";
import type { Policy } from "../types.js";
import { findingAt, makeFinding } from "./helpers/fixtures.js";

// ─── Test plan 1: default policy ───────────────────────────────────────────

describe("default policy", () => {
  it("no findings → pass", () => {
    const r = evaluatePolicy([], DEFAULT_POLICY, []);
    expect(r.verdict).toBe("pass");
  });

  it("only info → pass", () => {
    const r = evaluatePolicy([findingAt("info")], DEFAULT_POLICY, []);
    expect(r.verdict).toBe("pass");
  });

  it("only low → pass", () => {
    const r = evaluatePolicy([findingAt("low")], DEFAULT_POLICY, []);
    expect(r.verdict).toBe("pass");
  });

  it("medium with empty baseline → fail (onlyNew: true, all new)", () => {
    const r = evaluatePolicy([findingAt("medium")], DEFAULT_POLICY, []);
    expect(r.verdict).toBe("fail");
  });

  it("medium in baseline → pass (onlyNew filters it out)", () => {
    const f = findingAt("medium");
    const r = evaluatePolicy([f], DEFAULT_POLICY, [f.fingerprint]);
    expect(r.verdict).toBe("pass");
  });

  it("high → fail (always, regardless of baseline)", () => {
    const f = findingAt("high");
    const r = evaluatePolicy([f], DEFAULT_POLICY, [f.fingerprint]);
    expect(r.verdict).toBe("fail");
  });

  it("critical → fail", () => {
    const r = evaluatePolicy([findingAt("critical")], DEFAULT_POLICY, []);
    expect(r.verdict).toBe("fail");
  });
});

// ─── Test plan 2: failOn rules ─────────────────────────────────────────────

describe("failOn rules", () => {
  it("severity 'low' fails on low, medium, high, critical", () => {
    const policy = createPolicy({
      failOn: [{ severity: "low", onlyNew: false }],
    });
    for (const sev of ["low", "medium", "high", "critical"] as const) {
      const r = evaluatePolicy([findingAt(sev)], policy, []);
      expect(r.verdict).toBe("fail");
    }
  });

  it("severity 'critical' fails only on critical", () => {
    const policy = createPolicy({
      failOn: [{ severity: "critical", onlyNew: false }],
    });
    for (const sev of ["info", "low", "medium", "high"] as const) {
      const r = evaluatePolicy([findingAt(sev)], policy, []);
      expect(r.verdict).toBe("pass");
    }
    const r = evaluatePolicy([findingAt("critical")], policy, []);
    expect(r.verdict).toBe("fail");
  });

  it("onlyNew: true with baseline excludes baseline findings", () => {
    const f = findingAt("high");
    const policy = createPolicy({
      failOn: [{ severity: "high", onlyNew: true }],
    });
    const r = evaluatePolicy([f], policy, [f.fingerprint]);
    expect(r.verdict).toBe("pass");
  });

  it("onlyNew: false includes baseline findings", () => {
    const f = findingAt("high");
    const policy = createPolicy({
      failOn: [{ severity: "high", onlyNew: false }],
    });
    const r = evaluatePolicy([f], policy, [f.fingerprint]);
    expect(r.verdict).toBe("fail");
  });

  it("checkIds filter restricts to specified checks", () => {
    const a = makeFinding({ checkId: "check-a", severity: "high" });
    const b = makeFinding({ checkId: "check-b", severity: "high" });
    const policy = createPolicy({
      failOn: [{ severity: "high", onlyNew: false, checkIds: ["check-a"] }],
    });
    const r = evaluatePolicy([a, b], policy, []);
    expect(r.verdict).toBe("fail");
    expect(r.triggered).toHaveLength(1);
    expect(r.triggered[0]?.finding.checkId).toBe("check-a");
  });

  it("checkIds filter with no matches → not triggered", () => {
    const a = makeFinding({ checkId: "check-a", severity: "high" });
    const policy = createPolicy({
      failOn: [{ severity: "high", onlyNew: false, checkIds: ["check-z"] }],
    });
    const r = evaluatePolicy([a], policy, []);
    expect(r.verdict).toBe("pass");
    expect(r.triggered).toHaveLength(0);
  });

  it("multiple failOn rules evaluated independently", () => {
    const low = findingAt("low");
    const crit = findingAt("critical");
    const policy = createPolicy({
      failOn: [
        { severity: "critical", onlyNew: false },
        { severity: "low", onlyNew: false },
      ],
    });
    const r = evaluatePolicy([low, crit], policy, []);
    expect(r.verdict).toBe("fail");
    expect(r.rules).toHaveLength(2);
    expect(r.rules[0]?.triggered).toBe(true); // critical rule matches crit
    expect(r.rules[1]?.triggered).toBe(true); // low rule matches both
    // critical rule matched only the critical finding
    expect(r.rules[0]?.matched).toHaveLength(1);
    // low rule matched both findings
    expect(r.rules[1]?.matched).toHaveLength(2);
  });
});

// ─── Test plan 3: verdict computation ──────────────────────────────────────

describe("verdict computation", () => {
  it("multiple triggered rules → single fail", () => {
    const f = findingAt("critical");
    const policy = createPolicy({
      failOn: [
        { severity: "low", onlyNew: false },
        { severity: "high", onlyNew: false },
      ],
    });
    const r = evaluatePolicy([f], policy, []);
    expect(r.verdict).toBe("fail");
    expect(r.rules.filter((x) => x.triggered)).toHaveLength(2);
  });

  it("no triggered rules → policy.default", () => {
    const policy = createPolicy({
      default: "pass",
      failOn: [{ severity: "critical", onlyNew: false }],
    });
    const r = evaluatePolicy([findingAt("low")], policy, []);
    expect(r.verdict).toBe("pass");
  });

  it("default 'fail' with no triggers → fail", () => {
    const policy = createPolicy({
      default: "fail",
      failOn: [{ severity: "critical", onlyNew: false }],
    });
    const r = evaluatePolicy([findingAt("low")], policy, []);
    expect(r.verdict).toBe("fail");
  });
});

// ─── Test plan 5: determinism ──────────────────────────────────────────────

describe("determinism", () => {
  it("identical findings + policy → identical PolicyResult across runs", () => {
    const findings = [findingAt("high"), findingAt("medium"), findingAt("low")];
    const policy = DEFAULT_POLICY;
    const baseline = ["fp-medium"];
    const r1 = evaluatePolicy(findings, policy, baseline);
    const r2 = evaluatePolicy(findings, policy, baseline);
    expect(r2).toEqual(r1);
  });
});

// ─── Test plan 6: summary output ───────────────────────────────────────────

describe("summary output", () => {
  it("pass summary when no triggers", () => {
    const r = evaluatePolicy([findingAt("info")], DEFAULT_POLICY, []);
    expect(r.summary).toBe("pass: no findings triggered any rule");
  });

  it("counts triggered findings by severity and lists rule count", () => {
    const policy = createPolicy({
      failOn: [{ severity: "low", onlyNew: false }],
    });
    const r = evaluatePolicy(
      [
        makeFinding({ severity: "high", fingerprint: "fp-h1", id: "c:fp-h1" }),
        makeFinding({
          severity: "medium",
          fingerprint: "fp-m1",
          id: "c:fp-m1",
        }),
        makeFinding({ severity: "high", fingerprint: "fp-h2", id: "c:fp-h2" }),
      ],
      policy,
      [],
    );
    expect(r.verdict).toBe("fail");
    // 3 findings triggered 1 rule (2 high, 1 medium)
    expect(r.summary).toBe(
      "fail: 3 findings triggered 1 rule (2 high, 1 medium)",
    );
  });

  it("counts multiple triggered rules", () => {
    const policy = createPolicy({
      failOn: [
        { severity: "critical", onlyNew: false },
        { severity: "low", onlyNew: false },
      ],
    });
    const r = evaluatePolicy([findingAt("critical")], policy, []);
    // 1 finding triggered 2 rules (1 critical)
    expect(r.summary).toBe("fail: 1 finding triggered 2 rules (1 critical)");
  });
});

// ─── Test plan 7: error cases ──────────────────────────────────────────────

describe("error cases", () => {
  it("INVALID_POLICY when failOn is missing", () => {
    const bad = { name: "x", default: "pass" } as unknown as Policy;
    expect(() => evaluatePolicy([], bad, [])).toThrow(PolicyError);
    try {
      evaluatePolicy([], bad, []);
    } catch (err) {
      expect((err as PolicyError).code).toBe("INVALID_POLICY");
    }
  });

  it("INVALID_POLICY when failOn is not an array", () => {
    const bad = {
      name: "x",
      default: "pass",
      failOn: { severity: "low" },
    } as unknown as Policy;
    expect(() => evaluatePolicy([], bad, [])).toThrow(PolicyError);
    try {
      evaluatePolicy([], bad, []);
    } catch (err) {
      expect((err as PolicyError).code).toBe("INVALID_POLICY");
    }
  });

  it("INVALID_SEVERITY for unknown severity in hand-constructed policy", () => {
    const bad = {
      name: "x",
      default: "pass",
      failOn: [{ severity: "boom", onlyNew: false }],
    } as unknown as Policy;
    expect(() => evaluatePolicy([], bad, [])).toThrow(PolicyError);
    try {
      evaluatePolicy([], bad, []);
    } catch (err) {
      expect((err as PolicyError).code).toBe("INVALID_SEVERITY");
    }
  });
});

// ─── Test plan 8: edge cases ───────────────────────────────────────────────

describe("edge cases", () => {
  it("empty findings array → pass with default policy", () => {
    const r = evaluatePolicy([], DEFAULT_POLICY, []);
    expect(r.verdict).toBe("pass");
    expect(r.triggered).toHaveLength(0);
    expect(r.rules).toHaveLength(2);
    expect(r.rules.every((x) => !x.triggered)).toBe(true);
  });

  it("empty baseline fingerprints array → all findings new", () => {
    const policy = createPolicy({
      failOn: [{ severity: "medium", onlyNew: true }],
    });
    const r = evaluatePolicy([findingAt("medium")], policy, []);
    expect(r.verdict).toBe("fail");
  });

  it("finding with severity exactly at threshold (inclusive)", () => {
    const policy = createPolicy({
      failOn: [{ severity: "medium", onlyNew: false }],
    });
    const r = evaluatePolicy([findingAt("medium")], policy, []);
    expect(r.verdict).toBe("fail");
    expect(r.triggered).toHaveLength(1);
  });

  it("TriggeredFinding records ruleIndex", () => {
    const policy = createPolicy({
      failOn: [
        { severity: "critical", onlyNew: false },
        { severity: "low", onlyNew: false },
      ],
    });
    const r = evaluatePolicy([findingAt("high")], policy, []);
    // high matches the low rule (index 1) but not the critical rule (index 0)
    expect(r.triggered).toHaveLength(1);
    expect(r.triggered[0]?.ruleIndex).toBe(1);
  });

  it("RuleResult preserves evaluation order", () => {
    const policy = createPolicy({
      failOn: [
        { severity: "critical", onlyNew: false },
        { severity: "low", onlyNew: false },
      ],
    });
    const r = evaluatePolicy([findingAt("critical")], policy, []);
    expect(r.rules).toHaveLength(2);
    expect(r.rules[0]?.ruleIndex).toBe(0);
    expect(r.rules[1]?.ruleIndex).toBe(1);
  });
});
