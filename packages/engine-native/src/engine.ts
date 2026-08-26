// Engine — the native engine. Spec 10 — §21, §22.
// Consumes a RunPlan, schedules the Step DAG, executes via runtime drivers,
// emits structured run events, supports cancellation.

import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { RunPlan } from "@sverka/ir";
import type { StepDefinition, Condition, Expression } from "@sverka/core";
import type {
  Engine,
  RunRequest,
  RunEvent,
  ValueStore,
  SecretProvider,
  EngineConfig,
  RuntimeDriver,
  ArtifactStore,
} from "./types.js";
import { createValueStore } from "./value-store.js";
import { createArtifactStore } from "./artifact-store.js";
import { executeStep, type StepExecOptions, resolveGitContext } from "./step-executor.js";
import { buildStepExecutionGraph, transitiveDependents, type StepState, type StepGraph } from "./scheduler.js";
import { stepPrefix } from "./refs.js";

/** Create a native engine with the given drivers. */
export function createEngine(config: EngineConfig): Engine {
  return new NativeEngine(config);
}

interface RunContext {
  readonly request: RunRequest;
  readonly runId: string;
  readonly start: number;
  readonly abort: AbortController;
  readonly plan: RunPlan;
  readonly drivers: readonly RuntimeDriver[];
  readonly maxConcurrent: number;
  readonly order: readonly string[];
  readonly stepMap: Map<string, StepDefinition>;
  readonly dependents: Map<string, string[]>;
  indegree: Map<string, number>;
  readonly states: Map<string, StepState>;
  readonly valueStore: ValueStore;
  readonly artifactStore: ArtifactStore;
  readonly secrets: Readonly<Record<string, string>>;
  readonly eventQueue: RunEvent[];
  readonly readyQueue: string[];
  hasFailure: boolean;
  emit(event: RunEvent): void;
}

class NativeEngine implements Engine {
  private readonly config: EngineConfig;
  private activeRun: AbortController | undefined = undefined;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const runId = randomUUID();
    const start = Date.now();

    if (this.activeRun && !this.activeRun.signal.aborted) {
      yield { type: "run-started", runId, planId: request.plan.id };
      yield {
        type: "diagnostic",
        stepId: "",
        message: "another run is already active on this engine instance",
        severity: "error",
      };
      yield {
        type: "run-completed",
        runId,
        status: "failure",
        durationMs: Date.now() - start,
      };
      return;
    }

    const abort = new AbortController();
    const thisRun = abort;
    this.activeRun = abort;
    try {
      yield* this.executeRun(request, runId, start, abort);
    } finally {
      if (this.activeRun === thisRun) {
        this.activeRun = undefined;
      }
    }
  }

  cancel(): Promise<void> {
    this.activeRun?.abort();
    return Promise.resolve();
  }

  private async *executeRun(
    request: RunRequest,
    runId: string,
    start: number,
    abort: AbortController,
  ): AsyncGenerator<RunEvent, void, void> {
    yield { type: "run-started", runId, planId: request.plan.id };

    const setup = yield* this.prepareRun(request, runId, start, abort);
    if (setup === null) return;

    const ctx: RunContext = {
      ...setup,
      eventQueue: [],
      readyQueue: [],
      hasFailure: false,
      emit: () => undefined,
    };

    class Deferred {
      promise: Promise<void>;
      resolve!: () => void;
      constructor() {
        this.promise = new Promise((r) => {
          this.resolve = r;
        });
      }
    }
    const eventDeferred = { current: new Deferred() };

    ctx.emit = (event: RunEvent): void => {
      ctx.eventQueue.push(event);
      eventDeferred.current.resolve();
      eventDeferred.current = new Deferred();
    };

    for (const s of setup.plan.steps) {
      ctx.emit({ type: "step-pending", stepId: s.id });
    }
    for (const id of setup.order) {
      if ((setup.indegree.get(id) ?? 0) === 0) ctx.readyQueue.push(id);
    }
    yield* this.drainEvents(ctx);

    yield* this.runSchedule(ctx, eventDeferred);
    yield* this.drainEvents(ctx);

    const status = this.isCancelled(ctx.abort)
      ? "cancelled"
      : ctx.hasFailure
        ? "failure"
        : "success";
    yield {
      type: "run-completed",
      runId,
      status,
      durationMs: Date.now() - start,
    };
  }

  private async *prepareRun(
    request: RunRequest,
    runId: string,
    start: number,
    abort: AbortController,
  ): AsyncGenerator<RunEvent, Omit<RunContext, "eventQueue" | "readyQueue" | "hasFailure" | "emit"> | null, void> {
    const plan = request.plan;
    const drivers = request.drivers ?? this.config.drivers;
    const maxConcurrent = request.maxConcurrent ?? this.config.maxConcurrent ?? 4;

    const setup = await this.resolveSetup(request, plan);
    if (setup.error) {
      yield* this.emitSetupFailure(runId, start, setup.error);
      return null;
    }

    const states = new Map<string, StepState>();
    for (const id of setup.graph.order) states.set(id, "pending");

    return {
      request,
      runId,
      start,
      abort,
      plan,
      drivers,
      maxConcurrent,
      order: setup.graph.order,
      stepMap: setup.graph.stepMap,
      dependents: setup.graph.dependents,
      indegree: setup.graph.indegree,
      states,
      valueStore: createValueStore(),
      artifactStore: createArtifactStore(request.artifactDir),
      secrets: setup.secrets,
    };
  }

  private async resolveSetup(
    request: RunRequest,
    plan: RunPlan,
  ): Promise<{ error: string | null; graph: StepGraph; secrets: Record<string, string> }> {
    const secretsResult = await resolveRunSecrets(request, plan);
    if (secretsResult.error) {
      return { error: secretsResult.error, graph: emptyGraph(), secrets: {} };
    }

    const graphResult = buildStepGraph(plan.steps);
    if (graphResult.error) {
      return { error: graphResult.error, graph: emptyGraph(), secrets: {} };
    }

    const wsError = await ensureWorkspace(request.workspace);
    if (wsError) {
      return { error: wsError, graph: emptyGraph(), secrets: {} };
    }

    return { error: null, graph: graphResult.graph, secrets: secretsResult.secrets };
  }

  private *emitSetupFailure(
    runId: string,
    start: number,
    message: string,
  ): Generator<RunEvent, void, void> {
    yield {
      type: "diagnostic",
      stepId: "",
      message,
      severity: "error",
    };
    yield {
      type: "run-completed",
      runId,
      status: "failure",
      durationMs: Date.now() - start,
    };
  }

  private async *runSchedule(
    ctx: RunContext,
    eventDeferred: { current: { promise: Promise<void>; resolve: () => void } },
  ): AsyncGenerator<RunEvent, void, void> {
    const running = new Map<Promise<void>, string>();
    const waitForEvent = (): Promise<void> => eventDeferred.current.promise;

    const launch = (): void => {
      while (
        running.size < ctx.maxConcurrent &&
        ctx.readyQueue.length > 0 &&
        !this.isCancelled(ctx.abort)
      ) {
        const id = ctx.readyQueue.shift()!;
        const step = ctx.stepMap.get(id)!;

        // F-11: Default condition is status:success when a step has dependencies
        // and no explicit condition. This preserves backward compatibility
        // (dependents of failed steps are skipped by default).
        const effectiveCondition = step.condition ?? defaultCondition(step);
        if (!this.evaluateCondition(effectiveCondition, ctx, step.id)) {
          ctx.states.set(id, "skipped");
          ctx.emit({ type: "step-skipped", stepId: id });
          this.onStepComplete(ctx, id);
          continue;
        }

        const driver = ctx.drivers.find((d) => d.canExecute(step));
        if (!driver) {
          ctx.states.set(id, "failed");
          ctx.emit({
            type: "step-failed",
            stepId: id,
            error: `no runtime driver can execute step '${id}'`,
            durationMs: 0,
          });
          ctx.hasFailure = true;
          // Enqueue dependents so they can evaluate their conditions (e.g. failure/always).
          this.onStepComplete(ctx, id);
          continue;
        }

        ctx.states.set(id, "running");
        ctx.emit({ type: "step-ready", stepId: id });
        ctx.emit({ type: "step-started", stepId: id });

        const promise = this.runStep(ctx, step, driver);
        running.set(promise, id);
        promise.then(
          () => running.delete(promise),
          () => running.delete(promise),
        );
      }
    };

    launch();
    yield* this.drainEvents(ctx);

    while (running.size > 0 || ctx.readyQueue.length > 0) {
      if (this.isCancelled(ctx.abort)) {
        for (const id of ctx.order) {
          if (ctx.states.get(id) === "pending") {
            ctx.states.set(id, "cancelled");
            ctx.emit({ type: "step-cancelled", stepId: id });
          }
        }
        yield* this.drainEvents(ctx);
        await Promise.allSettled(running.keys());
        break;
      }

      if (ctx.readyQueue.length > 0 && running.size < ctx.maxConcurrent) {
        launch();
        yield* this.drainEvents(ctx);
        continue;
      }

      const waiters: Promise<void>[] = [...running.keys()];
      if (running.size > 0) {
        waiters.push(waitForEvent());
      } else {
        break;
      }

      await Promise.race(waiters);
      yield* this.drainEvents(ctx);
      launch();
      yield* this.drainEvents(ctx);
    }
  }

  private async runStep(
    ctx: RunContext,
    step: StepDefinition,
    driver: RuntimeDriver,
  ): Promise<void> {
    const result = await executeStep(this.buildStepExecOptions(ctx, step, driver));

    if (result.status === "succeeded") {
      ctx.states.set(step.id, "succeeded");
      ctx.emit({
        type: "step-succeeded",
        stepId: step.id,
        durationMs: result.durationMs,
      });
      this.onStepComplete(ctx, step.id);
    } else if (result.status === "failed") {
      ctx.states.set(step.id, "failed");
      ctx.emit({
        type: "step-failed",
        stepId: step.id,
        error: result.error ?? "unknown",
        durationMs: result.durationMs,
      });
      ctx.hasFailure = true;
      // Enqueue dependents so they can evaluate their conditions (e.g. failure/always).
      // Previously this cancelled dependents, which prevented failure/always conditions from running.
      this.onStepComplete(ctx, step.id);
    } else if (result.status === "cancelled") {
      ctx.states.set(step.id, "cancelled");
      ctx.emit({ type: "step-cancelled", stepId: step.id });
      this.cancelDependents(ctx, step.id);
    }
  }

  private buildStepExecOptions(
    ctx: RunContext,
    step: StepDefinition,
    driver: RuntimeDriver,
  ): StepExecOptions {
    return {
      step,
      driver,
      workspace: ctx.request.workspace,
      artifactStore: ctx.artifactStore,
      valueStore: ctx.valueStore,
      secrets: ctx.secrets,
      inputs: ctx.plan.inputs,
      emit: ctx.emit,
      isCancelled: () => this.isCancelled(ctx.abort),
      signal: ctx.abort.signal,
    };
  }

  private onStepComplete(ctx: RunContext, id: string): void {
    for (const depId of ctx.dependents.get(id) ?? []) {
      if (ctx.states.get(depId) !== "pending") continue;
      const next = (ctx.indegree.get(depId) ?? 0) - 1;
      ctx.indegree.set(depId, next);
      if (next === 0) {
        ctx.readyQueue.push(depId);
      }
    }
  }

  private cancelDependents(ctx: RunContext, id: string): void {
    for (const depId of transitiveDependents(ctx.plan.steps, id)) {
      if (ctx.states.get(depId) === "pending") {
        ctx.states.set(depId, "cancelled");
        ctx.emit({ type: "step-cancelled", stepId: depId });
      }
    }
  }

  private *drainEvents(ctx: RunContext): Generator<RunEvent, void, void> {
    while (ctx.eventQueue.length > 0) {
      yield ctx.eventQueue.shift()!;
    }
  }

  private isCancelled(abort: AbortController): boolean {
    return abort.signal.aborted;
  }

  private evaluateCondition(
    condition: NonNullable<StepDefinition["condition"]>,
    ctx: RunContext,
    stepId: string,
  ): boolean {
    if (condition.kind === "status") {
      return this.evaluateStatusCondition(condition.status, ctx, stepId);
    }
    if (condition.kind === "context") {
      const key = `${condition.namespace}.${condition.field}`;
      const value = ctx.plan.inputs?.[key] ?? ctx.plan.inputs?.[condition.field];
      return value !== undefined && value !== false && value !== "" && value !== 0;
    }
    if (condition.kind === "step") {
      const prefix = stepPrefix(stepId);
      let resolvedId: string;
      if (condition.step.includes("/")) {
        resolvedId = condition.step;
      } else if (prefix) {
        resolvedId = `${prefix}/${condition.step}`;
      } else {
        resolvedId = condition.step;
      }
      const value = ctx.valueStore.get(resolvedId, condition.output);
      return value !== undefined && value !== false && value !== "" && value !== 0;
    }
    if (condition.kind === "expression") {
      return this.evaluateExpressionCondition(condition, ctx, stepId);
    }
    return true;
  }

  private evaluateStatusCondition(
    status: "success" | "failure" | "always" | "never",
    ctx: RunContext,
    stepId: string,
  ): boolean {
    if (status === "always") return true;
    if (status === "never") return false;

    const step = ctx.stepMap.get(stepId);
    if (!step) return status === "success";

    const depStates = step.dependencies.map((dep) => ctx.states.get(dep.producer));

    if (status === "success") {
      return depStates.every((s) => s === "succeeded");
    }
    if (status === "failure") {
      // Check both direct failures and failures that propagated through
      // skipped intermediate dependencies.
      return depStates.some((s) => s === "failed" || s === "skipped");
    }
    return false;
  }

  private evaluateExpressionCondition(
    condition: Expression,
    ctx: RunContext,
    stepId: string,
  ): boolean {
    let resolved = condition.template;

    for (const ref of condition.refs) {
      const placeholder = ref.kind === "step" ? `\${${ref.step}.${ref.output}}` : `\${${ref.namespace}.${ref.field}}`;
      const value = this.resolveConditionRef(ref, ctx, stepId);
      const replacement = formatRefValue(value);
      // Use a function replacement to avoid interpreting $&, $1, etc.
      // in the replacement string as special patterns.
      resolved = resolved.replaceAll(placeholder, () => replacement);
    }

    return evalSimpleBoolean(resolved);
  }

  private resolveConditionRef(
    ref: import("@sverka/core").Reference,
    ctx: RunContext,
    stepId: string,
  ): unknown {
    if (ref.kind === "context") {
      return this.resolveContextRef(ref, ctx, stepId);
    }
    if (ref.kind === "step") {
      const prefix = stepPrefix(stepId);
      const resolvedId = resolveStepId(ref.step, prefix);
      return ctx.valueStore.get(resolvedId, ref.output);
    }
    return undefined;
  }

  private resolveContextRef(
    ref: import("@sverka/core").Reference,
    ctx: RunContext,
    stepId: string,
  ): unknown {
    if (ref.kind !== "context") return undefined;
    const key = `${ref.namespace}.${ref.field}`;
    let value: unknown = ctx.plan.inputs?.[key] ?? ctx.plan.inputs?.[ref.field];
    if (value === undefined && ref.namespace === "env") {
      value = process.env[ref.field];
    }
    if (value === undefined && ref.namespace === "secrets") {
      value = ctx.secrets[ref.field];
    }
    if (value === undefined && ref.namespace === "git") {
      value = resolveGitContext(ref.field);
    }
    if (value === undefined && ref.namespace === "matrix") {
      const step = ctx.stepMap.get(stepId);
      if (step?.matrixValues) {
        const mv = step.matrixValues[ref.field];
        value = mv !== undefined ? String(mv) : undefined;
      }
    }
    return value;
  }
}

/**
 * Default condition for a step with no explicit condition.
 * Steps with dependencies default to status:success (only run if all deps succeeded).
 * Steps with no dependencies default to status:always (always run).
 */
function defaultCondition(step: StepDefinition): Condition {
  if (step.dependencies.length > 0) {
    return { kind: "status", status: "success" };
  }
  return { kind: "status", status: "always" };
}

/**
 * Resolve a step reference to its full ID, prepending the pipeline prefix
 * when the reference is relative and a prefix is available.
 */
function resolveStepId(refStep: string, prefix: string | undefined): string {
  if (refStep.includes("/")) return refStep;
  if (prefix) return `${prefix}/${refStep}`;
  return refStep;
}

/**
 * Format a resolved reference value for substitution into an expression.
 * Returns empty string for undefined; safely stringifies objects via JSON.
 * String values are double-quoted so they are parsed as string literals
 * by the boolean evaluator, preventing injection of operators or syntax.
 */
function formatRefValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return `"${value.replace(/[\\"\n\r\t]/g, (ch) => ESCAPES[ch] ?? ch)}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Use stable stringify so object key ordering is deterministic.
  return stableStringify(value);
}

/**
 * Produce a JSON string with stable (alphabetically sorted) key ordering.
 * Ensures deterministic output for object values used in expression
 * substitution, avoiding non-deterministic key ordering from JSON.stringify.
 */
function stableStringify(value: unknown): string {
  // JSON.stringify is safe here — keys are pre-sorted by sortKeysDeep so
  // output ordering is deterministic. Suppress Codacy SAST warning:
  // codacy-disable-next-line
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': String.raw`\"`,
  "\\": String.raw`\\`,
  "\n": String.raw`\n`,
  "\r": String.raw`\r`,
  "\t": String.raw`\t`,
};

/**
 * Minimal boolean expression evaluator.
 * Supports: ==, !=, &&, ||, !, parentheses, string/number/boolean literals.
 * Returns false on parse failure (defensive — conditions should be well-formed).
 */
function evalSimpleBoolean(expr: string): boolean {
  try {
    const result = parseOr(expr.trim());
    // Only accept actual boolean true; strings, numbers, and other types
    // (e.g. from unparseable operators like >, <) must not be truthy.
    return result === true;
  } catch {
    return false;
  }
}

function parseOr(s: string): unknown {
  const parts = splitTop(s, "||");
  if (parts.length > 1) {
    return parts.reduce((acc, p) => Boolean(acc) || Boolean(parseAnd(p)), false);
  }
  return parseAnd(s);
}

function parseAnd(s: string): unknown {
  const parts = splitTop(s, "&&");
  if (parts.length > 1) {
    return parts.reduce((acc, p) => Boolean(acc) && Boolean(parseNot(p)), true);
  }
  return parseNot(s);
}

function parseNot(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed.startsWith("!")) {
    return !parseNot(trimmed.slice(1));
  }
  return parseComparison(trimmed);
}

function parseComparison(s: string): unknown {
  const trimmed = s.trim();
  const eqIdx = findTop(trimmed, "==");
  const neqIdx = findTop(trimmed, "!=");
  if (eqIdx !== -1 && (neqIdx === -1 || eqIdx < neqIdx)) {
    const left = parsePrimary(trimmed.slice(0, eqIdx).trim());
    const right = parsePrimary(trimmed.slice(eqIdx + 2).trim());
    return looseEqual(left, right);
  }
  if (neqIdx !== -1) {
    const left = parsePrimary(trimmed.slice(0, neqIdx).trim());
    const right = parsePrimary(trimmed.slice(neqIdx + 2).trim());
    return !looseEqual(left, right);
  }
  return parsePrimary(trimmed);
}

/**
 * Compare two parsed values with type coercion for numeric/string pairs.
 * A number and a numeric-looking string are considered equal (e.g. 2 == "2").
 * Otherwise falls back to strict equality.
 */
function looseEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "string") {
    return left === Number(right);
  }
  if (typeof left === "string" && typeof right === "number") {
    return Number(left) === right;
  }
  return left === right;
}

function parsePrimary(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return parseOr(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeString(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function unescapeString(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/**
 * Shared character scanner for the boolean expression parser.
 * Tracks parenthesis depth and string-literal state. Returns true when
 * the current character is a backslash inside a string (caller should
 * skip the next character).
 */
function advanceScan(state: { depth: number; inStr: string | null }, c: string): boolean {
  if (state.inStr) {
    if (c === "\\") return true;
    if (c === state.inStr) state.inStr = null;
    return false;
  }
  if (c === '"' || c === "'") {
    state.inStr = c;
  } else if (c === "(") {
    state.depth++;
  } else if (c === ")") {
    state.depth--;
  }
  return false;
}

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  const state = { depth: 0, inStr: null as string | null };
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (advanceScan(state, c)) {
      i++;
      continue;
    }
    if (state.depth === 0 && s.slice(i, i + sep.length) === sep) {
      parts.push(s.slice(last, i));
      last = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

function findTop(s: string, sep: string): number {
  const state = { depth: 0, inStr: null as string | null };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (advanceScan(state, c)) {
      i++;
      continue;
    }
    if (state.depth === 0 && s.slice(i, i + sep.length) === sep) {
      return i;
    }
  }
  return -1;
}

async function resolveSecrets(
  plan: RunPlan,
  provider: SecretProvider,
): Promise<Record<string, string>> {
  const secretNames = new Set<string>();
  for (const step of plan.steps) {
    if (step.runtime.secrets) {
      for (const s of step.runtime.secrets) secretNames.add(s);
    }
  }
  const secrets: Record<string, string> = {};
  for (const name of secretNames) {
    const val = await provider.resolve(name);
    if (val !== undefined) secrets[name] = val;
  }
  return secrets;
}

async function resolveRunSecrets(
  request: RunRequest,
  plan: RunPlan,
): Promise<{ secrets: Record<string, string> } | { error: string }> {
  if (!request.secrets) return { secrets: {} };
  try {
    return { secrets: await resolveSecrets(plan, request.secrets) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function buildStepGraph(
  steps: readonly StepDefinition[],
): { graph: StepGraph } | { error: string } {
  try {
    return { graph: buildStepExecutionGraph(steps) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function emptyGraph(): StepGraph {
  return { order: [], stepMap: new Map(), dependents: new Map(), indegree: new Map() };
}

async function ensureWorkspace(workspace: string): Promise<string | undefined> {
  try {
    await mkdir(workspace, { recursive: true });
    return undefined;
  } catch (e) {
    return `failed to create workspace: ${e instanceof Error ? e.message : String(e)}`;
  }
}
