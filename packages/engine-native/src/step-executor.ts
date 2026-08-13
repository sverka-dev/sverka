// StepExecutor — runs ordered Operations inside one Step.
// Spec 10 — §22.1 component 3.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StepDefinition, OperationDefinition } from "@sverka/core";
import type { InputValue } from "@sverka/ir";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore, RunEvent } from "./types.js";
import { StepExecError, EngineError } from "./errors.js";

export interface StepExecOptions {
  readonly step: StepDefinition;
  readonly driver: RuntimeDriver;
  readonly workspace: string;
  readonly artifactStore: ArtifactStore;
  readonly valueStore: ValueStore;
  readonly secrets: Readonly<Record<string, string>>;
  readonly emit: (event: RunEvent) => void;
  readonly isCancelled: () => boolean;
}

export interface StepExecResult {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly durationMs: number;
}

/** Execute all operations in a step in order. */
export async function executeStep(opts: StepExecOptions): Promise<StepExecResult> {
  const start = Date.now();
  const { step, driver, workspace, artifactStore, valueStore, emit, isCancelled } = opts;
  const stepWorkspace = join(workspace, step.id);
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
      const error = e instanceof Error ? e.message : String(e);
      return { status: "failed", error, durationMs: Date.now() - start };
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
  const { step, driver, artifactStore, valueStore, emit, secrets } = opts;

  switch (op.kind) {
    case "shell": {
      const env: Record<string, string> = {
        SVERKA_OUTPUT_DIR: outputDir,
        SVERKA_STEP_ID: step.id,
        ...buildSecretEnv(step, secrets),
      };
      // Merge step runtime env vars.
      if (step.runtime.env) {
        for (const [k, v] of Object.entries(step.runtime.env)) {
          if (v !== undefined) env[k] = v;
        }
      }
      const request: ShellExecuteRequest = {
        command: op.command,
        workspace: stepWorkspace,
        env,
        ...(step.runtime.workingDir ? { cwd: join(stepWorkspace, step.runtime.workingDir) } : {}),
        ...(step.timeout !== undefined ? { timeoutMs: step.timeout } : {}),
        ...(step.runtime.image ? { image: step.runtime.image } : {}),
        ...(step.runtime.mode ? { mode: step.runtime.mode } : {}),
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
      break;
    }

    case "exportOutput": {
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
      break;
    }

    case "exportArtifact": {
      const sourcePath = join(stepWorkspace, op.path);
      await artifactStore.store(step.id, op.name, sourcePath);
      break;
    }

    case "importArtifact": {
      const destPath = join(stepWorkspace, op.name);
      await artifactStore.retrieve(op.from, op.output, destPath);
      break;
    }

    case "diagnostic": {
      emit({
        type: "diagnostic",
        stepId: step.id,
        message: op.message,
        severity: op.severity,
      });
      break;
    }
  }
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

function buildSecretEnv(step: StepDefinition, secrets: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  if (step.runtime.secrets) {
    for (const secretRef of step.runtime.secrets) {
      const val = secrets[secretRef];
      if (val !== undefined) {
        env[secretRef] = val;
      }
    }
  }
  return env;
}
