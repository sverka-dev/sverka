// RetryPolicy — step-level retries with exponential backoff. Spec 20.
// Wraps executeStep in a retry loop that re-runs the whole step on matching
// failures, emitting step-retry events before each retry.

import type { RetryPolicy, BackoffSpec, RetryWhen } from "@sverka/workflow";
import type { RunEvent } from "./types.js";
import { executeStep, type StepExecOptions, type StepExecResult } from "./step-executor.js";

/**
 * Classify a failed StepExecResult into a RetryWhen category.
 * Used to decide whether a retry matches the policy's `when` filter.
 */
export function classifyRetryWhen(result: StepExecResult): RetryWhen {
  if (result.timedOut) return "timeout";
  if (result.exitCode !== undefined && result.exitCode !== 0) return "script_failure";
  return "unknown_failure";
}

/**
 * Compute the backoff delay (ms) for the nth retry (1-indexed).
 * delay = min(baseMs * factor^(n-1), maxMs ?? Infinity).
 * Returns 0 when backoff is omitted (immediate retry).
 */
export function computeBackoffDelay(backoff: BackoffSpec | undefined, retryNumber: number): number {
  if (!backoff) return 0;
  const factor = backoff.factor ?? 2;
  const raw = backoff.baseMs * Math.pow(factor, retryNumber - 1);
  return backoff.maxMs !== undefined ? Math.min(raw, backoff.maxMs) : raw;
}

/**
 * Sleep that resolves early when the abort signal fires.
 * Returns true if the sleep was interrupted by cancellation.
 */
export async function cancellableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (ms <= 0 || signal.aborted) return signal.aborted;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Decide whether a failed result should be retried per the policy.
 * - exitCodes (if set) overrides `when`: retry iff exitCode ∈ exitCodes.
 * - when (if set): retry iff classified RetryWhen ∈ when or when includes "always".
 * - Both omitted: retry on any failure (equivalent to "always").
 */
export function shouldRetry(
  result: StepExecResult,
  retry: RetryPolicy,
): boolean {
  if (retry.exitCodes !== undefined) {
    return result.exitCode !== undefined && retry.exitCodes.includes(result.exitCode);
  }
  if (retry.when !== undefined) {
    if (retry.when.includes("always")) return true;
    const classified = classifyRetryWhen(result);
    return retry.when.includes(classified);
  }
  return true; // default: retry on any failure
}

/**
 * Execute a step with retry. Re-runs the whole step (all operations) up to
 * `retry.max` retries on matching failures, applying exponential backoff.
 * Emits `step-retry` events before each retry. Returns the final result.
 */
export async function executeStepWithRetry(
  opts: StepExecOptions,
  retry: RetryPolicy | undefined,
  emit: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<StepExecResult> {
  // No retry policy or max <= 0: single attempt, no retry.
  if (!retry || retry.max <= 0) {
    return executeStep(opts);
  }

  const { step } = opts;
  let attempt = 0;

  while (true) {
    const result = await executeStep(opts);
    if (result.status !== "failed") return result;
    if (attempt >= retry.max) return result; // exhausted

    if (!shouldRetry(result, retry)) return result; // non-matching failure

    attempt++;
    const delay = computeBackoffDelay(retry.backoff, attempt);
    emit({ type: "step-retry", stepId: step.id, attempt, nextAttemptMs: delay });

    if (delay > 0) {
      const cancelled = await cancellableSleep(delay, signal);
      if (cancelled) {
        return { status: "cancelled", durationMs: 0 };
      }
    }
  }
}
