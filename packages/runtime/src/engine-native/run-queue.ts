// Spec 57 — hosted engine, Stage B sketch (decision record, deferred).
// The worker↔hub queue contract for self-hosted remote execution:
// interfaces only — no implementation ships until Spec 55's adoption gate
// proves demand. Recorded now so the eventual `sverka worker` process and
// the hub's `/v1/runs/queue` endpoint are designed against one shape, and
// so Stage B does not paint Stage C (managed workers) into a corner.
// See engdocs/adr/ADR-018.

import type { RunPlan } from "@sverka/workflow";

/** How the worker materializes the checkout a queued run executes in —
 * a git ref to clone/fetch, or a tarball URL to download and extract. */
export type WorkspaceRef =
  | { readonly kind: "git"; readonly url: string; readonly ref: string }
  | { readonly kind: "tarball"; readonly url: string };

/** A run submitted to the hub queue waiting for a worker to claim it. */
export interface QueuedRun {
  readonly runId: string;
  /** Hub project namespace, e.g. "sverka-dev/sverka" (Spec 55). */
  readonly project: string;
  /** The serialized Run Plan the worker executes (Spec 06). */
  readonly runPlan: RunPlan;
  readonly workspaceRef: WorkspaceRef;
}

/** What a worker can execute — the hub matches queued runs against
 * these so a host-only worker never claims a container step. */
export interface WorkerCapabilities {
  readonly runtimes: readonly ("host" | "container")[];
  readonly network: "none" | "allowlist";
  readonly maxSteps?: number;
}

/** The queue endpoint a self-hosted `sverka worker` polls (Stage B).
 * Submission side is `sverka run --submit`; the worker claims,
 * executes with the native engine, and completes against the same
 * `POST /v1/runs` report sink Stage A bootstrap jobs already use. */
export interface RunQueue {
  /** Atomically claim a queued run this worker can execute —
   * undefined when the queue is empty or nothing matches
   * `capabilities`. */
  claim(
    workerId: string,
    capabilities: WorkerCapabilities,
  ): Promise<QueuedRun | undefined>;
  /** Keep a claimed run alive — a missed heartbeat window lets the hub
   * re-queue the run for another worker. */
  heartbeat(runId: string): Promise<void>;
  /** Report completion. `report` is the `sverka.run/v1` payload the run
   * wrote to `report.json`; `findings` is the run's normalized finding
   * set (report.json carries only the count). Together they fill the
   * `POST /v1/runs` envelope `{project, entry, report, findings}`
   * (Spec 55) — `project`/`entry` come from the claimed `QueuedRun`,
   * not the worker. Spec 38's typed `RunReport`/`Finding` models
   * replace the open records when they land. */
  complete(
    runId: string,
    report: Record<string, unknown>,
    findings: readonly Record<string, unknown>[],
  ): Promise<void>;
  /** Report failure — `error` is a human-readable message. */
  fail(runId: string, error: string): Promise<void>;
}
