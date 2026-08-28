import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createSverka } from "@sverka/sdk";
import { compileGithubWorkflow } from "@sverka/compiler";
import { compileGitlabCi } from "@sverka/compiler";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";

/** Args parsed for the compile command. */
export interface CompileArgs {
  target: string;
  output?: string | undefined;
}

/** Compile the canonical Plan to a target CI YAML. */
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

  output.debug(
    `compile: root=${global.root} target=${target} output=${args.output ?? "stdout"}`,
  );

  const sverka = createSverka({
    root: global.root,
    ...(global.config
      ? { configPath: resolveUnderRoot(global.root, global.config) }
      : {}),
  });

  const plan = await sverka.toPlan();

  const yaml =
    target === "github"
      ? compileGithubWorkflow(plan)
      : compileGitlabCi(plan);

  if (args.output) {
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

  return ExitCode.Success;
}
