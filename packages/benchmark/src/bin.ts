#!/usr/bin/env node
import process from "node:process";
import { join } from "node:path";
import { runBenchmark, writeReport, BENCHMARK_TASKS, DEFAULT_AGENTS } from "./index.js";

async function main(): Promise<number> {
  const model = process.env.DEVIN_MODEL ?? "glm-5-2";
  const outputDir = process.argv[2] ?? process.cwd();

  process.stderr.write(`Sverka Benchmark Arena\n`);
  process.stderr.write(`Model: ${model}\n`);
  process.stderr.write(`Tasks: ${BENCHMARK_TASKS.length}\n`);
  process.stderr.write(`Agents: ${DEFAULT_AGENTS.length}\n\n`);

  const result = await runBenchmark({
    tasks: [...BENCHMARK_TASKS],
    agents: [...DEFAULT_AGENTS],
    model,
    outputDir,
  });

  const filename = `benchmark-${result.timestamp.replace(/[:.]/g, "-")}.json`;
  const outputPath = join(outputDir, filename);
  await writeReport(result, outputPath);

  process.stderr.write(`\nReport written to: ${outputPath}\n`);
  process.stderr.write(`\nSummary:\n`);
  process.stderr.write(`  raw-shell: ${result.summary["raw-shell"].successCount}/${result.summary["raw-shell"].totalTasks} pass, avg ${result.summary["raw-shell"].avgTotalTokens} tokens\n`);
  process.stderr.write(`  sverka:    ${result.summary.sverka.successCount}/${result.summary.sverka.totalTasks} pass, avg ${result.summary.sverka.avgTotalTokens} tokens\n`);

  return 0;
}

main().then(process.exit).catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
