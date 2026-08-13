// StepExecutor — runs ordered Operations inside one Step.
// Spec 10 — §22.1 component 3.

import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { StepDefinition, OperationDefinition } from "@sverka/core";
import type { InputValue } from "@sverka/ir";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore, RunEvent } from "./types.js";
import { StepExecError, EngineError } from "./errors.js";
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
}

export interface StepExecResult {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly durationMs: number;
}

/** Execute all operations in a step in order. */
export async function executeStep(opts: StepExecOptions): Promise<StepExecResult> {
  const start = Date.now();
  const { step, workspace, isCancelled } = opts;
  const stepWorkspace = resolveUnder(workspace, step.id);
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
      return { status: "failed", error, durationMs: Date.now() - start };
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
  }
}

async function executeShellOperation(
  op: Extract<OperationDefinition, { kind: "shell" }>,
  opts: StepExecOptions,
  stepWorkspace: string,
  outputDir: string,
): Promise<void> {
  const { step, driver, secrets, valueStore, inputs, signal } = opts;
  const env = buildShellEnv(step, outputDir, secrets);
  const command = interpolateCommand(op.command, step, valueStore, inputs);
  const cwd = step.runtime.workingDir
    ? resolveUnder(stepWorkspace, step.runtime.workingDir)
    : stepWorkspace;
  const request: ShellExecuteRequest = {
    command,
    workspace: stepWorkspace,
    env,
    cwd,
    ...(step.timeout !== undefined ? { timeoutMs: step.timeout } : {}),
    ...(step.runtime.image ? { image: step.runtime.image } : {}),
    ...(step.runtime.mode ? { mode: step.runtime.mode } : {}),
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

function resolveUnder(base: string, subpath: string): string {
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

function interpolateCommand(
  command: string,
  step: StepDefinition,
  valueStore: ValueStore,
  inputs: Readonly<Record<string, InputValue>> | undefined,
): string {
  const prefix = stepPrefix(step.id);
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
