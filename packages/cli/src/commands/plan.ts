// plan command — bind Entry + inputs → Run Plan, display steps.
// Spec 17 — §30.

import { bindRunPlan } from "@sverka/planner";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { loadProjectGraph } from "../internal/config.js";
import { resolveDefaultEntryId, entryExists } from "../internal/graph.js";

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

  const { graph } = await loadProjectGraph(global);

  const entryId = args.entryId ?? resolveDefaultEntryId(graph);
  if (!entryId) {
    throw new CliError("no entries in graph", "MISSING_ARG", ExitCode.UsageError);
  }
  if (!entryExists(graph, entryId)) {
    throw new CliError(
      `entry "${entryId}" not found in graph`,
      "MISSING_ARG",
      ExitCode.UsageError,
    );
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
