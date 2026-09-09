// Test helpers for @sverka/sarif-viewer-web

import type { Finding } from "@sverka/verification";

/** Build a Finding with sensible defaults and optional overrides. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const fingerprint = overrides.fingerprint ?? "fp1";
  const checkId = overrides.checkId ?? "ci/lint";
  return {
    id: overrides.id ?? `${checkId}:${fingerprint}`,
    fingerprint,
    checkId,
    severity: overrides.severity ?? "high",
    confidence: overrides.confidence ?? 0.5,
    message: overrides.message ?? "test finding",
    rule: overrides.rule ?? "rule-1",
    file: overrides.file ?? "src/index.ts",
    startLine: overrides.startLine ?? 10,
    endLine: overrides.endLine ?? 10,
    source: overrides.source ?? {
      tool: "test-tool",
      version: null,
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: null,
    },
    ...overrides,
  };
}

/** A minimal valid SARIF log with one run and the given results. */
export function makeSarif(
  results: Array<{
    ruleId: string;
    message: string;
    file: string;
    startLine: number;
    endLine?: number;
    level?: string;
  }> = [],
): unknown {
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "test-tool",
            version: "1.0.0",
            rules: results.map((r) => ({
              id: r.ruleId,
              name: r.ruleId,
            })),
          },
        },
        results: results.map((r) => ({
          ruleId: r.ruleId,
          level: r.level ?? "warning",
          message: { text: r.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: r.file },
                region: {
                  startLine: r.startLine,
                  endLine: r.endLine ?? r.startLine,
                },
              },
            },
          ],
        })),
      },
    ],
  };
}
