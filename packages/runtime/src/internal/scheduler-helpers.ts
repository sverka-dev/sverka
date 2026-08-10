import type { ExecuteResult } from "../executor.js";
import type { OperationOutcome, ExecutionResult } from "../result.js";
import type { Scheduler } from "../scheduler.js";

/** Build a cancelled outcome for an operation. */
export function cancelledOutcome(
  opId: string,
  durationMs = 0,
): OperationOutcome {
  return {
    operationId: opId,
    status: "cancelled",
    durationMs,
    logs: "",
    artifacts: [],
    fromCache: false,
  };
}

/** Build a failure outcome for an operation. */
export function failureOutcome(
  opId: string,
  durationMs: number,
  error: string,
): OperationOutcome {
  return {
    operationId: opId,
    status: "failure",
    durationMs,
    logs: "",
    artifacts: [],
    error,
    fromCache: false,
  };
}

/** Convert an ExecuteResult to an OperationOutcome. */
export function toOutcome(
  opId: string,
  r: ExecuteResult,
  fromCache: boolean,
): OperationOutcome {
  return {
    operationId: opId,
    status: r.status,
    ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
    durationMs: r.durationMs,
    logs: r.logs,
    artifacts: r.artifacts,
    ...(r.error !== undefined ? { error: r.error } : {}),
    fromCache,
  };
}

/** Decide whether a retry should be attempted. */
export function shouldRetry(
  attempt: number,
  maxAttempts: number,
  retryOn: readonly ("failure" | "timeout")[],
  isTimeout: boolean,
): boolean {
  return (
    attempt < maxAttempts &&
    (retryOn.includes("failure") || (isTimeout && retryOn.includes("timeout")))
  );
}

/** Compute the final execution status from run state. */
export function computeFinalStatus(
  cancelled: boolean,
  fatalFailure: boolean,
  outcomes: ReadonlyMap<string, OperationOutcome>,
): ExecutionResult["status"] {
  if (cancelled) return "partial";
  if (fatalFailure) return "failure";
  if (outcomesHaveFailureOrCancelled(outcomes)) return "partial";
  return "success";
}

function outcomesHaveFailureOrCancelled(
  outcomes: ReadonlyMap<string, OperationOutcome>,
): boolean {
  for (const o of outcomes.values()) {
    if (o.status === "failure" || o.status === "cancelled") return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function cancellableSleep(
  ms: number,
  scheduler: Scheduler,
): Promise<void> {
  const deadline = Date.now() + ms;
  // Poll every 10ms (or sooner) so cancel() is observed promptly.
  while (Date.now() < deadline) {
    // `cancelled` is private; access via a cast to a minimal shape.
    if ((scheduler as unknown as { cancelled: boolean }).cancelled) return;
    const wait = Math.min(10, deadline - Date.now());
    if (wait <= 0) return;
    await sleep(wait);
  }
}
