// graph command — display Definition Graph structure.
// Spec 17 — §30.

import { synthesize } from "@sverka/core";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";
import { findConfig, loadConfig } from "../internal/config.js";

/**
 * Display the Definition Graph: pipelines, entries, steps, and dependencies.
 */
export async function graphCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`graph: root=${global.root}`);

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
