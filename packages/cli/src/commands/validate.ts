// validate command — synthesize Definition Graph, run validators.
// Spec 17 — §30.

import { validateGraph } from "@sverka/workflow";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { loadProjectGraph } from "../internal/config.js";

/**
 * Validate a sverka config: synthesize the Definition Graph and run validators.
 * Exit 0 if valid, 2 if missing config, 3 if load/synthesis fails.
 */
export async function validateCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`validate: root=${global.root} config=${global.config ?? "(auto)"}`);

  const { configPath, graph } = await loadProjectGraph(global);
  validateGraph(graph);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "validate",
        data: { path: configPath, valid: true, pipelines: graph.project.pipelines.length },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Config valid: ${configPath}`);
    output.writeLine(`  pipelines: ${graph.project.pipelines.length}`);
    for (const pipeline of graph.project.pipelines) {
      output.writeLine(`    ${pipeline.id}: ${pipeline.steps.length} steps, ${pipeline.entries.length} entries`);
    }
  }

  return ExitCode.Success;
}
