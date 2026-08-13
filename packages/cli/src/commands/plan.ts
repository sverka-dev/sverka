// plan command — bind Entry + inputs → Run Plan, display steps.
// Spec 17 — §30.

import { synthesize } from "@sverka/core";
import { bindRunPlan } from "@sverka/planner";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";
import { findConfig, loadConfig } from "../internal/config.js";

export interface PlanArgs {
  entryId?: string;
}

/**
 * Bind an Entry and Inputs into a Run Plan and display it.
 */
export async function planCommand(
  args: PlanArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`plan: root=${global.root} entry=${args.entryId ?? "(first)"}`);

  let configPath: string | null = global.config
    ? resolveUnderRoot(global.root, global.config)
    : null;
  if (!configPath) {
    configPath = await findConfig(global.root);
  }
  if (!configPath) {
    throw new CliError(
      "no config found (use --config to specify a path)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }

  const project = await loadConfig(configPath);
  const graph = synthesize(project);

  const pipeline = graph.project.pipelines[0];
  if (!pipeline) {
    throw new CliError("no pipelines in config", "SDK_ERROR", ExitCode.RuntimeError);
  }

  const entryId = args.entryId ?? pipeline.entries[0]?.id;
  if (!entryId) {
    throw new CliError("no entries in pipeline", "MISSING_ARG", ExitCode.UsageError);
  }

  const plan = bindRunPlan({ graph, entryId });

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "plan",
        data: {
          id: plan.id,
          graphId: plan.graphId,
          entry: plan.entry,
          steps: plan.steps.map((s) => s.id),
          inputs: plan.inputs,
        },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Run Plan: ${plan.id}`);
    output.writeLine(`  entry: ${plan.entry.id}`);
    output.writeLine(`  steps: ${plan.steps.length}`);
    for (const step of plan.steps) {
      const deps = step.dependencies.length > 0
        ? ` (depends: ${step.dependencies.map((d) => d.producer).join(", ")})`
        : "";
      output.writeLine(`    - ${step.id}${deps}`);
    }
  }

  return ExitCode.Success;
}
