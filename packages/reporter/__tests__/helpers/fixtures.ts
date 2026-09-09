// Test helpers for @sverka/reporter

import type { RunEvent } from "@sverka/runtime";
import type { TextWriter } from "../../src/index.js";

/** A mock writer that captures all lines written. */
export class MockWriter implements TextWriter {
  readonly lines: string[] = [];

  writeLine(text: string): void {
    this.lines.push(text);
  }

  get text(): string {
    return this.lines.join("\n");
  }
}

/** Create a run-started event. */
export function runStarted(runId: string, planId: string): RunEvent {
  return { type: "run-started", runId, planId };
}

/** Create a step-pending event. */
export function stepPending(stepId: string): RunEvent {
  return { type: "step-pending", stepId };
}

/** Create a step-ready event. */
export function stepReady(stepId: string): RunEvent {
  return { type: "step-ready", stepId };
}

/** Create a step-started event. */
export function stepStarted(stepId: string): RunEvent {
  return { type: "step-started", stepId };
}

/** Create a step-succeeded event. */
export function stepSucceeded(stepId: string, durationMs: number): RunEvent {
  return { type: "step-succeeded", stepId, durationMs };
}

/** Create a step-failed event. */
export function stepFailed(stepId: string, error: string, durationMs: number): RunEvent {
  return { type: "step-failed", stepId, error, durationMs };
}

/** Create a step-skipped event. */
export function stepSkipped(stepId: string): RunEvent {
  return { type: "step-skipped", stepId };
}

/** Create a step-cancelled event. */
export function stepCancelled(stepId: string): RunEvent {
  return { type: "step-cancelled", stepId };
}

/** Create a step-cache-hit event. */
export function stepCacheHit(stepId: string, key: string): RunEvent {
  return { type: "step-cache-hit", stepId, key };
}

/** Create a step-retry event. */
export function stepRetry(stepId: string, attempt: number, nextAttemptMs: number): RunEvent {
  return { type: "step-retry", stepId, attempt, nextAttemptMs };
}

/** Create a run-completed event. */
export function runCompleted(runId: string, status: "success" | "failure" | "cancelled", durationMs: number): RunEvent {
  return { type: "run-completed", runId, status, durationMs };
}

/** Create a diagnostic event. */
export function diagnostic(stepId: string, message: string, severity: "info" | "warn" | "error" = "info"): RunEvent {
  return { type: "diagnostic", stepId, message, severity };
}

/** A minimal valid SARIF 2.1.0 log with one finding. */
export const SAMPLE_SARIF = {
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: [
    {
      tool: {
        driver: {
          name: "test-linter",
          version: "1.0.0",
          informationUri: "https://example.com",
          rules: [
            {
              id: "rule-1",
              name: "TestRule",
              shortDescription: { text: "A test rule" },
            },
          ],
        },
      },
      results: [
        {
          ruleId: "rule-1",
          level: "error",
          message: { text: "Test finding" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/index.ts" },
                region: { startLine: 10, endLine: 10 },
              },
            },
          ],
        },
      ],
    },
  ],
};

/** A SARIF log with no results. */
export const EMPTY_SARIF = {
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: [
    {
      tool: {
        driver: {
          name: "test-linter",
          version: "1.0.0",
        },
      },
      results: [],
    },
  ],
};
