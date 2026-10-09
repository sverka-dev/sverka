import { describe, it, expect } from "vitest";
import type { RunPlan } from "@sverka/workflow";
import type {
  RunQueue,
  QueuedRun,
  WorkerCapabilities,
  WorkspaceRef,
} from "../index.js";

// Spec 57 Stage B — interface sketches only (decision record, deferred).
// These tests pin the contract shapes so a future `sverka worker` and the
// hub's queue endpoint converge on one shape. There is deliberately no
// implementation to exercise.

const plan: RunPlan = {
  apiVersion: "sverka.dev/v1run",
  id: "rp-test",
  graphId: "graph-test",
  entry: { id: "ci/on-push", trigger: { kind: "push" } },
  inputs: {},
  steps: [],
  createdAt: "2026-10-09T00:00:00.000Z",
};

describe("RunQueue contract (Spec 57)", () => {
  it("WorkerCapabilities describes runtimes, network, and step bound", () => {
    const caps: WorkerCapabilities = {
      runtimes: ["host", "container"],
      network: "allowlist",
      maxSteps: 32,
    };
    expect(caps.runtimes).toContain("host");
    const minimal: WorkerCapabilities = {
      runtimes: ["host"],
      network: "none",
    };
    expect(minimal.maxSteps).toBeUndefined();
  });

  it("WorkspaceRef accepts a pinned git commit or a tarball URL", () => {
    const git: WorkspaceRef = {
      kind: "git",
      url: "https://github.com/sverka-dev/sverka.git",
      commit: "d731864fc94adb98db87947b3c3305364858ee55",
    };
    const tarball: WorkspaceRef = {
      kind: "tarball",
      url: "https://hub.example/v1/workspaces/abc.tar.zst",
    };
    expect(git.kind).toBe("git");
    expect(tarball.kind).toBe("tarball");
  });

  it("QueuedRun carries the claim token, RunPlan, and workspace ref", () => {
    const run: QueuedRun = {
      runId: "r-1",
      claimToken: "claim-1",
      project: "sverka-dev/sverka",
      runPlan: plan,
      workspaceRef: {
        kind: "git",
        url: "https://x",
        commit: "d731864fc94adb98db87947b3c3305364858ee55",
      },
    };
    expect(run.runPlan.apiVersion).toBe("sverka.dev/v1run");
    expect(run.claimToken).toBe("claim-1");
  });

  it("RunQueue is implementable — claim/heartbeat/complete/fail", async () => {
    const completed: {
      runId: string;
      report: Record<string, unknown>;
      findings: readonly Record<string, unknown>[];
    }[] = [];
    const queue: RunQueue = {
      claim: async (_workerId, _capabilities) => undefined,
      heartbeat: async (_runId, _claimToken) => {},
      complete: async (runId, _claimToken, report, findings) => {
        completed.push({ runId, report, findings });
      },
      fail: async (_runId, _claimToken, _error) => {},
    };
    const claimed = await queue.claim("w-1", {
      runtimes: ["host"],
      network: "none",
    });
    expect(claimed).toBeUndefined();
    await queue.heartbeat("r-1", "claim-1");
    await queue.complete(
      "r-1",
      "claim-1",
      { schema: "sverka.run/v1", data: {} },
      [{ ruleId: "r", file: "x.ts" }],
    );
    await queue.fail("r-2", "claim-2", "worker crashed");
    expect(completed[0]?.report.schema).toBe("sverka.run/v1");
    expect(completed[0]?.findings).toHaveLength(1);
  });
});
