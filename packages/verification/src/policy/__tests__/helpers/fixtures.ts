import type { Finding, Severity } from "../../../findings/index.js";

/**
 * Build a minimal Finding with sensible defaults. Override any field.
 */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "check-1:fp-1",
    fingerprint: "fp-1",
    checkId: "check-1",
    severity: "medium",
    confidence: 0.5,
    message: "message",
    rule: "rule-1",
    file: "src/index.ts",
    startLine: 1,
    endLine: 1,
    source: {
      tool: "eslint",
      version: "1.0.0",
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: "warning",
    },
    ...overrides,
  };
}

/**
 * Build a finding with a specific severity and a deterministic fingerprint
 * derived from the severity (so each severity is distinct in baseline tests).
 */
export function findingAt(
  severity: Severity,
  overrides: Partial<Finding> = {},
): Finding {
  return makeFinding({
    severity,
    fingerprint: `fp-${severity}`,
    id: `check-1:fp-${severity}`,
    ...overrides,
  });
}
