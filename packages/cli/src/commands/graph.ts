// graph command — display Definition Graph structure.
// Spec 17 — §30.

import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";
import { loadProjectGraph } from "../internal/config.js";

/**
 * Display the Definition Graph: pipelines, entries, steps, and dependencies.
 */
export async function graphCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`graph: root=${global.root}`);

  const { graph } = await loadProjectGraph(global);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "graph",
        data: graph,
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Definition Graph: ${graph.project.id}`);
    for (const pipeline of graph.project.pipelines) {
      output.writeLine(`  Pipeline: ${pipeline.id}`);
      output.writeLine(`    entries:`);
      for (const entry of pipeline.entries) {
        output.writeLine(`      ${entry.id} (trigger: ${entry.trigger.kind}, roots: ${entry.roots.join(", ")})`);
      }
      output.writeLine(`    steps:`);
      for (const step of pipeline.steps) {
        const deps = step.dependencies.length > 0
          ? ` → [${step.dependencies.map((d) => `${d.kind}:${d.producer}`).join(", ")}]`
          : "";
        output.writeLine(`      ${step.id}${deps}`);
      }
    }
  }

  return ExitCode.Success;
}
