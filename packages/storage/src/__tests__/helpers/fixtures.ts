// Test fixtures for @sverka/storage tests.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunSnapshot } from "@sverka/runtime";

/** Create a temporary directory. Returns the absolute path. */
export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sverka-storage-test-"));
}

/** Remove a temporary directory recursively. */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Build a minimal valid RunSnapshot for testing. */
export function makeSnapshot(runId = "run-1"): RunSnapshot {
  return {
    runId,
    planId: "rp-abc123",
    plan: {
      apiVersion: "sverka.dev/v1run",
      id: "rp-abc123",
      graphId: "graph-def456",
      entry: { id: "on-push", trigger: { kind: "push" } },
      inputs: {},
      steps: [
        {
          id: "ci/build",
          runtime: {},
          operations: [{ kind: "shell", command: "echo build" }],
          inputs: [],
          outputs: [],
          dependencies: [],
        },
      ],
      createdAt: "2026-08-31T00:00:00.000Z",
    },
    completedSteps: [
      { stepId: "ci/build", outputs: { result: "ok" } },
    ],
    suspendedStepId: "ci/approve",
    resumeSchema: { required: ["decision"] },
    suspendedAt: 1725064800000,
    status: "suspended",
  };
}
