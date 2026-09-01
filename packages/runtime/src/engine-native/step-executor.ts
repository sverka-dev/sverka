// StepExecutor — runs ordered Operations inside one Step.
// Spec 10 — §22.1 component 3.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { spawnSync } from "node:child_process";
import type { StepDefinition, OperationDefinition } from "@sverka/workflow";
import type { InputValue } from "@sverka/workflow";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore, RunEvent } from "./types.js";
import type { AgentDriver, AgentExecuteRequest, AgentResult } from "./agent-driver.js";
import { StepExecError, EngineError, AgentDriverError } from "./errors.js";
import { stepPrefix, resolveProducerId } from "./refs.js";

export interface StepExecOptions {
  readonly step: StepDefinition;
  readonly driver: RuntimeDriver;
  readonly workspace: string;
  readonly artifactStore: ArtifactStore;
  readonly valueStore: ValueStore;
  readonly secrets: Readonly<Record<string, string>>;
  readonly inputs?: Readonly<Record<string, InputValue>>;
  readonly emit: (event: RunEvent) => void;
  readonly isCancelled: () => boolean;
  readonly signal?: AbortSignal;
  readonly agentDrivers?: readonly AgentDriver[];
  readonly artifactDir?: string;
}

export interface StepExecResult {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
}

/** Execute all operations in a step in order. */
export async function executeStep(opts: StepExecOptions): Promise<StepExecResult> {
  const start = Date.now();
  const { step, workspace, isCancelled } = opts;
  // Keep per-step scratch directories inside .sverka/workspace but run commands
  // from the project root so project-relative tooling works as expected.
  const stepWorkspace = resolveUnder(workspace, join(".sverka", "workspace", step.id));
  const outputDir = join(stepWorkspace, ".outputs");

  try {
    await mkdir(stepWorkspace, { recursive: true });
    await mkdir(outputDir, { recursive: true });
  } catch (e) {
    return {
      status: "failed",
      error: `failed to create workspace: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - start,
    };
  }

  for (const op of step.operations) {
    if (isCancelled()) {
      return { status: "cancelled", durationMs: Date.now() - start };
    }

    try {
      await executeOperation(op, opts, stepWorkspace, outputDir);
    } catch (e) {
      if (isCancelled()) {
        return { status: "cancelled", durationMs: Date.now() - start };
      }
      const error = e instanceof Error ? e.message : String(e);
      const exitCode = e instanceof StepExecError ? e.exitCode : undefined;
      const timedOut = e instanceof StepExecError ? e.timedOut : undefined;
      return { status: "failed", error, durationMs: Date.now() - start, ...(exitCode !== undefined ? { exitCode } : {}), ...(timedOut ? { timedOut } : {}) };
    }
    if (isCancelled()) {
      return { status: "cancelled", durationMs: Date.now() - start };
    }
  }

  return { status: "succeeded", durationMs: Date.now() - start };
}

async function executeOperation(
  op: OperationDefinition,
  opts: StepExecOptions,
  stepWorkspace: string,
  outputDir: string,
): Promise<void> {
  switch (op.kind) {
    case "shell":
      await executeShellOperation(op, opts, stepWorkspace, outputDir);
      break;
    case "exportOutput":
      await executeExportOutputOperation(op, opts, outputDir);
      break;
    case "exportArtifact":
      await executeExportArtifactOperation(op, opts, stepWorkspace);
      break;
    case "importArtifact":
      await executeImportArtifactOperation(op, opts, stepWorkspace);
      break;
    case "diagnostic":
      executeDiagnosticOperation(op, opts);
      break;
    case "agent":
      await executeAgentOperation(op, opts);
      break;
  }
}

async function executeShellOperation(
  op: Extract<OperationDefinition, { kind: "shell" }>,
  opts: StepExecOptions,
  stepWorkspace: string,
  outputDir: string,
): Promise<void> {
  const { step, driver, secrets, valueStore, inputs, signal, workspace } = opts;
  const env = buildShellEnv(step, outputDir, stepScopedSecrets(opts));
  const cwd = step.runtime.workingDir
    ? resolveUnder(stepWorkspace, step.runtime.workingDir)
    : stepWorkspace;
  const command = interpolateCommand(op.command, step, valueStore, inputs, secrets, workspace);
  const request: ShellExecuteRequest = {
    command,
    workspace: stepWorkspace,
    env,
    cwd,
    ...(step.timeout !== undefined ? { timeoutMs: step.timeout } : {}),
    ...(step.runtime.image ? { image: step.runtime.image } : {}),
    ...(step.runtime.mode ? { mode: step.runtime.mode } : {}),
    ...(step.runtime.shell ? { shell: step.runtime.shell } : {}),
    ...(step.runtime.network ? { network: step.runtime.network } : {}),
    ...((step.runtime as { imageDigest?: string }).imageDigest !== undefined
      ? { imageDigest: (step.runtime as { imageDigest?: string }).imageDigest }
      : {}),
    ...(signal !== undefined ? { signal } : {}),
  };
  const result: ShellResult = await driver.executeShell(request);
  if (result.exitCode !== 0) {
    throw new StepExecError(
      result.timedOut
        ? `step '${step.id}' timed out`
        : `step '${step.id}' shell command failed with exit code ${result.exitCode}`,
      result.timedOut ? "TIMEOUT" : "STEP_EXEC_ERROR",
      undefined,
      result.exitCode,
      result.timedOut,
    );
  }
}

async function executeExportOutputOperation(
  op: Extract<OperationDefinition, { kind: "exportOutput" }>,
  opts: StepExecOptions,
  outputDir: string,
): Promise<void> {
  const { step, valueStore } = opts;
  assertSafeFileName(op.name);
  const outputPath = join(outputDir, op.name);
  let content: string;
  try {
    content = await readFile(outputPath, "utf-8");
  } catch (e) {
    throw new StepExecError(
      `output '${op.name}' not found in $SVERKA_OUTPUT_DIR: ${e instanceof Error ? e.message : String(e)}`,
      "OUTPUT_CAPTURE_ERROR",
      e,
    );
  }
  const value = parseOutputValue(content, op.type);
  valueStore.set(step.id, op.name, value);
}

async function executeExportArtifactOperation(
  op: Extract<OperationDefinition, { kind: "exportArtifact" }>,
  opts: StepExecOptions,
  stepWorkspace: string,
): Promise<void> {
  const { step, artifactStore } = opts;
  assertSafeFileName(op.name);
  const sourcePath = resolveUnder(stepWorkspace, op.path);
  await artifactStore.store(step.id, op.name, sourcePath);
}

async function executeImportArtifactOperation(
  op: Extract<OperationDefinition, { kind: "importArtifact" }>,
  opts: StepExecOptions,
  stepWorkspace: string,
): Promise<void> {
  const { step, artifactStore } = opts;
  assertSafeFileName(op.name);
  const prefix = stepPrefix(step.id);
  const producerId = resolveProducerId(prefix, op.from);
  const destPath = join(stepWorkspace, op.name);
  await artifactStore.retrieve(producerId, op.output, destPath);
}

function executeDiagnosticOperation(
  op: Extract<OperationDefinition, { kind: "diagnostic" }>,
  opts: StepExecOptions,
): void {
  const { step, emit } = opts;
  emit({
    type: "diagnostic",
    stepId: step.id,
    message: op.message,
    severity: op.severity,
  });
}

/**
 * Execute an agent operation. Spec 27.
 *
 * 1. Select an AgentDriver from config.agentDrivers using canExecute(engine).
 * 2. If no driver is available, fail the step with NO_AGENT_DRIVER.
 * 3. Resolve/interpolate the prompt.
 * 4. Resolve tool references through the plugin registry. Missing tools are
 *    non-fatal: emit a warning and run without that tool.
 * 5. Execute the driver.
 * 6. Save the result artifact to <artifactDir>/<stepId>/agent-result.json.
 * 7. Mark success unless finishReason === "error".
 * 8. Wrap driver-thrown errors in AgentDriverError (AGENT_EXECUTION_FAILED).
 */
async function executeAgentOperation(
  op: Extract<OperationDefinition, { kind: "agent" }>,
  opts: StepExecOptions,
): Promise<void> {
  const { step, emit, agentDrivers, artifactDir, signal, valueStore, inputs, secrets, workspace } = opts;

  // 1. Select a driver.
  const drivers = agentDrivers ?? [];
  const driver = drivers.find((d) => d.canExecute(op.engine));

  // 2. No driver → fail step (do not throw out of the engine).
  if (!driver) {
    throw new AgentDriverError(
      `NO_AGENT_DRIVER: no agent driver can execute engine '${op.engine}' for step '${step.id}'`,
      "NO_AGENT_DRIVER",
    );
  }

  // 3. Resolve/interpolate the prompt (reuse shell interpolation logic).
  const prompt = interpolateCommand(op.prompt, step, valueStore, inputs, secrets, workspace);

  // 4. Resolve tool references. Missing tools are non-fatal.
  //    The plugin registry is not yet wired (Spec 23 follow-up); for now we
  //    treat all tool refs as "unknown" and emit a warning, then run without
  //    them. This keeps the contract: missing tools never fail the step.
  let resolvedTools = op.tools;
  if (op.tools && op.tools.length > 0) {
    const known: typeof op.tools = [];
    for (const ref of op.tools) {
      // Plugin registry lookup would go here. Until the registry is wired,
      // every tool ref is treated as missing → warn + skip.
      emit({
        type: "diagnostic",
        stepId: step.id,
        message: `agent tool '${ref.plugin}.${ref.tool}' not found; running without it`,
        severity: "warn",
      });
    }
    resolvedTools = known.length > 0 ? known : undefined;
  }

  // 5. Execute the driver. Wrap thrown errors.
  let result: AgentResult;
  try {
    const request: AgentExecuteRequest = {
      engine: op.engine,
      ...(op.model !== undefined ? { model: op.model } : {}),
      prompt,
      ...(resolvedTools !== undefined ? { tools: resolvedTools } : {}),
      ...(op.maxTokens !== undefined ? { maxTokens: op.maxTokens } : {}),
      ...(signal !== undefined ? { signal } : {}),
    };
    result = await driver.executeAgent(request);
  } catch (e) {
    throw new AgentDriverError(
      `AGENT_EXECUTION_FAILED: agent execution failed for step '${step.id}': ${e instanceof Error ? e.message : String(e)}`,
      "AGENT_EXECUTION_FAILED",
      e,
    );
  }

  // 6. Save the result artifact to <artifactDir>/<stepId>/agent-result.json.
  if (artifactDir !== undefined) {
    const resultDir = join(artifactDir, step.id);
    await mkdir(resultDir, { recursive: true });
    const resultPath = join(resultDir, "agent-result.json");
    await writeFile(resultPath, JSON.stringify(result, null, 2), "utf-8");
  }

  // 7. Mark success unless finishReason === "error".
  if (result.finishReason === "error") {
    throw new AgentDriverError(
      `AGENT_EXECUTION_FAILED: agent for step '${step.id}' finished with reason 'error'`,
      "AGENT_EXECUTION_FAILED",
    );
  }
}

/**
 * Filter the run-level secrets map to only the secrets declared by this step.
 * Prevents a step from interpolating secrets it did not declare.
 *
 * Safe-outputs (Spec 25): steps without `permissions.write` are read-only
 * and receive an empty secret set, even if they declare `runtime.secrets`.
 * Steps with at least one write declaration resolve secrets normally.
 */
function stepScopedSecrets(opts: StepExecOptions): Readonly<Record<string, string>> {
  return scopeSecretsForStep(opts.step, opts.secrets);
}

/**
 * Filter the run-level secrets map to only the secrets declared by a step.
 * Safe-outputs (Spec 25): read-only steps (no `permissions.write`) get no
 * secrets, even if they declare `runtime.secrets`.
 */
export function scopeSecretsForStep(
  step: StepDefinition,
  secrets: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (!step.runtime.secrets) return {};
  // Safe-outputs: read-only steps get no secrets
  const writes = step.permissions?.write;
  if (!writes || writes.length === 0) return {};
  const scoped: Record<string, string> = {};
  for (const name of step.runtime.secrets) {
    if (secrets[name] !== undefined) {
      scoped[name] = secrets[name];
    }
  }
  return scoped;
}

function buildShellEnv(
  step: StepDefinition,
  outputDir: string,
  secrets: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  // Inject secrets first.
  if (step.runtime.secrets) {
    for (const secretRef of step.runtime.secrets) {
      const val = secrets[secretRef];
      if (val !== undefined) {
        env[secretRef] = val;
      }
    }
  }

  // Merge runtime-provided env vars.
  if (step.runtime.env) {
    for (const [k, v] of Object.entries(step.runtime.env)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
  }

  // Restore engine-reserved values last so they cannot be overwritten.
  env.SVERKA_OUTPUT_DIR = outputDir;
  env.SVERKA_STEP_ID = step.id;

  return env;
}

function parseOutputValue(content: string, type: string): InputValue {
  const trimmed = content.trim();
  if (type === "number") {
    const n = Number(trimmed);
    if (Number.isNaN(n)) {
      throw new StepExecError(
        `output value '${trimmed}' is not a valid number`,
        "OUTPUT_CAPTURE_ERROR",
      );
    }
    return n;
  }
  if (type === "boolean") {
    return trimmed === "true";
  }
  return trimmed;
}

function resolveCwd(base: string, workingDir: string | undefined): string {
  if (!workingDir) return base;
  if (isAbsolute(workingDir)) return workingDir;
  return resolveUnder(base, workingDir);
}

export function resolveUnder(base: string, subpath: string): string {
  if (isAbsolute(subpath)) {
    throw new EngineError(`path must be relative: '${subpath}'`, "STEP_EXEC_ERROR");
  }
  const resolved = normalize(join(base, subpath));
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new EngineError(`path escapes workspace: '${subpath}'`, "STEP_EXEC_ERROR");
  }
  return resolved;
}

function assertSafeFileName(name: string): void {
  if (!name || name === "." || name === "..") {
    throw new EngineError(`invalid file name: '${name}'`, "STEP_EXEC_ERROR");
  }
  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    throw new EngineError(`file name must be a base name: '${name}'`, "STEP_EXEC_ERROR");
  }
}

/** Quote a value so it is safe for POSIX shell interpolation. */
function shellQuote(value: InputValue): string {
  const s = String(value);
  if (/^[a-zA-Z0-9_\/.\-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function interpolateCommand(
  command: string,
  step: StepDefinition,
  valueStore: ValueStore,
  inputs: Readonly<Record<string, InputValue>> | undefined,
  secrets: Readonly<Record<string, string>>,
  workspace: string,
): string {
  const prefix = stepPrefix(step.id);
  const declaredSecrets = new Set(step.runtime.secrets ?? []);
  const runtimeEnv = step.runtime.env ?? {};
  return command.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    const dot = key.lastIndexOf(".");
    if (dot === -1) {
      if (inputs && inputs[key] !== undefined) {
        return shellQuote(inputs[key] as InputValue);
      }
      throw new StepExecError(`unresolved input reference '\${${key}}'`, "STEP_EXEC_ERROR");
    }
    const ns = key.slice(0, dot);
    const field = key.slice(dot + 1);

    // Secrets: emit env var reference ($FIELD), never the raw value.
    // Only secrets declared in step.runtime.secrets are accessible.
    if (ns === "secrets") {
      if (!declaredSecrets.has(field)) {
        throw new StepExecError(
          `step '${step.id}' references undeclared secret '${field}'`,
          "STEP_EXEC_ERROR",
        );
      }
      return `$${field}`;
    }

    // Context ref resolution (F-35, F-15) — env.X prioritizes runtime.env over process.env
    const ctxValue = resolveContextRef(ns, field, inputs, runtimeEnv, workspace, step.matrixValues);
    if (ctxValue !== undefined) {
      return shellQuote(ctxValue as InputValue);
    }

    // Step output resolution
    const stepId = resolveProducerId(prefix, ns);
    const value = valueStore.get(stepId, field);
    if (value !== undefined) {
      return shellQuote(value as InputValue);
    }
    const inputKey = `${ns}.${field}`;
    if (inputs && inputs[inputKey] !== undefined) {
      return shellQuote(inputs[inputKey] as InputValue);
    }
    throw new StepExecError(`unresolved step reference '\${${key}}'`, "STEP_EXEC_ERROR");
  });
}

/**
 * Resolve a context ref (namespace.field) against runtime state.
 * Returns undefined if the namespace is not a context namespace or the value is not found.
 * Secrets are handled separately in interpolateCommand (emit env var ref, not raw value).
 */
function resolveContextRef(
  namespace: string,
  field: string,
  inputs: Readonly<Record<string, InputValue>> | undefined,
  runtimeEnv: Readonly<Record<string, string>>,
  workspace: string,
  matrixValues?: Readonly<Record<string, string | number>>,
): string | undefined {
  switch (namespace) {
    case "env":
      // Prioritize step.runtime.env over process.env
      if (runtimeEnv[field] !== undefined) return runtimeEnv[field];
      return process.env[field];
    case "inputs":
      return inputs?.[field] !== undefined ? String(inputs[field]) : undefined;
    case "git":
      return resolveGitContext(field, workspace);
    case "matrix":
      return resolveMatrixField(matrixValues, field);
    // change, event, run, secrets — not resolved here
    default:
      return undefined;
  }
}

function resolveMatrixField(
  matrixValues: Readonly<Record<string, string | number>> | undefined,
  field: string,
): string | undefined {
  if (matrixValues === undefined) return undefined;
  const mv = matrixValues[field];
  return mv !== undefined ? String(mv) : undefined;
}

/**
 * Resolve git.* context refs using git CLI.
 * Uses spawnSync with a controlled environment (PATH + HOME only) to avoid
 * leaking sensitive env vars into the git subprocess. Runs in the workspace
 * directory so git context reflects the project repo.
 *
 * S4036: PATH is intentionally inherited from the host to locate git.
 * This is safe because the engine runs in a trusted CI context where PATH
 * is controlled by the operator, not by untrusted user input.
 */
export function resolveGitContext(field: string, cwd?: string): string | undefined {
  const controlledEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "", // NOSONAR: trusted CI environment
    HOME: process.env.HOME ?? "",
  };
  const opts = { encoding: "utf-8" as const, env: controlledEnv, ...(cwd ? { cwd } : {}) };
  const args = gitContextArgs(field);
  if (args === undefined) return undefined;
  try {
    const r = spawnSync("git", args, opts); // NOSONAR
    return r.status === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Map a git context field name to the corresponding git CLI arguments. */
function gitContextArgs(field: string): readonly string[] | undefined {
  switch (field) {
    case "sha":
      return ["rev-parse", "HEAD"];
    case "branch":
      return ["rev-parse", "--abbrev-ref", "HEAD"];
    case "tag":
      return ["describe", "--tags", "--exact-match"];
    default:
      return undefined;
  }
}
