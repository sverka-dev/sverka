import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compileGithub, compileGitlab } from "@sverka/compiler";
import type { CompilationResult } from "@sverka/compiler";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { loadProjectGraph } from "../internal/config.js";
import { detectCiSetup } from "../internal/ci-setup.js";

/** Args parsed for the compile command. */
export interface CompileArgs {
  target: string;
  output?: string | undefined;
  /**
   * Write each artifact to `<outputDir>/<artifact path>` instead of
   * gluing all artifacts into one stdout/file. Mutually exclusive with
   * `output`; required once a project defines more than one pipeline.
   */
  outputDir?: string | undefined;
  /** Pin GitHub action refs to commit SHAs (github target only). */
  pin?: boolean;
}

/** Compile the Definition Graph to a target CI YAML. */
export async function compileCommand(
  args: CompileArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const target = args.target;
  if (target !== "github" && target !== "gitlab") {
    throw new CliError(
      `invalid compile target: ${target} (expected github or gitlab)`,
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  if (args.output && args.outputDir) {
    throw new CliError(
      "--output and --output-dir are mutually exclusive",
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }

  output.debug(
    `compile: root=${global.root} target=${target} output=${args.output ?? "stdout"}`,
  );

  const { graph } = await loadProjectGraph(global);

  // GitHub runners start empty — inject detected toolchain setup (bun/npm/…
  // install) and submodule checkout so the generated YAML actually runs.
  const result: CompilationResult =
    target === "github"
      ? compileGithub(graph, {
          ...detectCiSetup(global.root),
          ...(args.pin ? { pinning: { mode: "strict" } } : {}),
        })
      : compileGitlab(graph);

  // Surface diagnostics on stderr — stdout must stay clean YAML for pipes
  // (e.g. `compile --pin | diff - workflow.yml`). Error-severity findings
  // (e.g. unpinned actions in --pin mode) fail the command.
  let hasError = false;
  for (const d of result.diagnostics) {
    output.errorLine(`[${d.severity}] ${d.capability}: ${d.message}`);
    if (d.severity === "error") hasError = true;
  }

  const yaml = result.artifacts.map((a) => a.content).join("\n---\n");

  if (args.outputDir) {
    const outDir = resolve(global.root, args.outputDir);
    const written: string[] = [];
    for (const a of result.artifacts) {
      const outPath = resolve(outDir, a.path);
      if (!outPath.startsWith(outDir + "/")) {
        throw new CliError(
          `artifact path escapes output dir: ${a.path}`,
          "INVALID_FLAG",
          ExitCode.UsageError,
        );
      }
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, a.content, "utf8");
      written.push(outPath);
    }

    if (global.format === "json") {
      output.writeLine(
        JSON.stringify({
          command: "compile",
          data: { target, paths: written },
          durationMs: Date.now() - start,
        }),
      );
    } else {
      for (const p of written) {
        output.writeLine(`Compiled ${target} workflow to ${p}`);
      }
    }
  } else if (args.output) {
    const outPath = resolve(global.root, args.output);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, yaml, "utf8");

    if (global.format === "json") {
      output.writeLine(
        JSON.stringify({
          command: "compile",
          data: { target, path: outPath },
          durationMs: Date.now() - start,
        }),
      );
    } else {
      output.writeLine(`Compiled ${target} workflow to ${outPath}`);
    }
  } else {
    if (global.format === "json") {
      output.writeLine(
        JSON.stringify({
          command: "compile",
          data: { target, yaml },
          durationMs: Date.now() - start,
        }),
      );
    } else {
      output.write(yaml);
    }
  }

  return hasError ? ExitCode.RuntimeError : ExitCode.Success;
}
