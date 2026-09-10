// @sverka/verification — test helpers for findings.

import type { Finding } from "./types.js";

/** Default values for makeFinding. */
const FINDING_DEFAULTS = {
  fingerprint: "fp1",
  checkId: "ci/lint",
  severity: "high" as const,
  confidence: 0.5,
  message: "test finding",
  rule: "rule-1",
  file: "src/index.ts",
  startLine: 10,
  endLine: 10,
  source: {
    tool: "test-tool",
    version: null,
    format: "sarif",
    originalRuleId: "rule-1",
    originalSeverity: null,
  },
};

/** Build a Finding with sensible defaults and optional overrides. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const fingerprint = overrides.fingerprint ?? FINDING_DEFAULTS.fingerprint;
  const checkId = overrides.checkId ?? FINDING_DEFAULTS.checkId;
  const base: Finding = {
    ...FINDING_DEFAULTS,
    ...overrides,
    id: overrides.id ?? `${checkId}:${fingerprint}`,
    fingerprint,
    checkId,
  } as Finding;
  return base;
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

/** Minimal valid SARIF 2.1.0 JSON string with one result.
 *  Shared by CLI integration tests across sarif-viewer-tui and sarif-viewer-web. */
export const VALID_SARIF_JSON = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "test-tool" } },
      results: [
        {
          ruleId: "test-rule",
          level: "error",
          message: { text: "test message" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "test.ts" },
                region: { startLine: 1 },
              },
            },
          ],
        },
      ],
    },
  ],
});
