import type { PlanOperation } from "@sverka/ir";
import type { Executor, ExecuteRequest, ExecuteResult } from "../executor.js";
import type { OperationOutcome } from "../result.js";
import type { SchedulerConfig } from "../scheduler.js";
import { ExecutorError } from "../errors.js";
import {
  cancelledOutcome,
  failureOutcome,
  toOutcome,
  shouldRetry,
  cancellableSleep,
} from "./scheduler-helpers.js";

/** Context needed to run the retry loop. */
export interface RetryContext {
  readonly config: SchedulerConfig;
  readonly isCancelled: () => boolean;
}

/**
 * Execute an operation with retry logic. Runs the executor up to maxAttempts
 * times, applying backoff between attempts, and classifying outcomes.
 */
export async function executeWithRetry(
  ctx: RetryContext,
  executor: Executor,
  op: PlanOperation,
): Promise<OperationOutcome> {
  const { maxAttempts, backoffSeconds, retryOn } = op.retry;
  const start = Date.now();
  let lastResult: ExecuteResult | undefined;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (ctx.isCancelled()) return cancelledOutcome(op.id, Date.now() - start);
    const request = buildRequest(ctx.config, op);
    const result = await executeAttempt(
      ctx, executor, op, request, attempt, maxAttempts, retryOn, backoffSeconds, start,
    );
    if (result.outcome) return result.outcome;
    if (result.lastResult) lastResult = result.lastResult;
    if (result.lastError) lastError = result.lastError;
  }
  if (lastResult) return toOutcome(op.id, lastResult, false);
  return failureOutcome(op.id, Date.now() - start, lastError?.message ?? "retries exhausted");
}

function buildRequest(
  config: SchedulerConfig,
  op: PlanOperation,
): ExecuteRequest {
  return {
    operation: op,
    workspace: config.workspace,
    env: op.env ?? {},
    credentials: config.credentials,
    cacheDir: config.cacheDir,
    artifactDir: config.artifactDir,
  };
}

async function executeAttempt(
  ctx: RetryContext,
  executor: Executor,
  op: PlanOperation,
  request: ExecuteRequest,
  attempt: number,
  maxAttempts: number,
  retryOn: readonly ("failure" | "timeout")[],
  backoffSeconds: number,
  start: number,
): Promise<{ outcome?: OperationOutcome; lastResult?: ExecuteResult; lastError?: Error }> {
  try {
    const result = await executor.execute(request);
    if (ctx.isCancelled()) return { outcome: cancelledOutcome(op.id, Date.now() - start) };
    if (result.status === "success" || result.status === "skipped") {
      return { outcome: toOutcome(op.id, result, false) };
    }
    const isTimeout = result.error?.includes("timeout") ?? false;
    if (!shouldRetry(attempt, maxAttempts, retryOn, isTimeout)) {
      return { outcome: toOutcome(op.id, result, false) };
    }
    if (backoffSeconds > 0) await cancellableSleep(backoffSeconds * 1000, ctx.isCancelled);
    return { lastResult: result };
  } catch (e) {
    return handleExecutorThrow(
      ctx, executor, op, e, attempt, maxAttempts, retryOn, backoffSeconds, start,
    );
  }
}

async function handleExecutorThrow(
  ctx: RetryContext,
  executor: Executor,
  op: PlanOperation,
  e: unknown,
  attempt: number,
  maxAttempts: number,
  retryOn: readonly ("failure" | "timeout")[],
  backoffSeconds: number,
  start: number,
): Promise<{ outcome?: OperationOutcome; lastError?: Error }> {
  const wrapped = new ExecutorError(
    e instanceof Error ? e.message : String(e),
    { operationId: op.id, executor: executor.name },
  );
  const isTimeout = e instanceof Error && e.message.includes("timeout");
  if (!shouldRetry(attempt, maxAttempts, retryOn, isTimeout)) {
    return { outcome: failureOutcome(op.id, Date.now() - start, wrapped.message) };
  }
  if (backoffSeconds > 0) await cancellableSleep(backoffSeconds * 1000, ctx.isCancelled);
  return { lastError: wrapped };
}
