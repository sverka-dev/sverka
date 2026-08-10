import { createSverka } from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { isBinaryAvailable } from "../internal/runtime-check.js";
import { resolveUnderRoot } from "../internal/paths.js";

/** Args parsed for the execute/run command. */
export interface ExecuteArgs {
  executor?: string | undefined;
  onlyNew?: boolean;
  baseline?: string | undefined;
}

/**
 * Execute the workflow and print results. Exit code reflects the verdict.
 */
export async function executeCommand(
  args: ExecuteArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const executor = args.executor === "docker" ? "docker" : "host";
  output.debug(`execute: root=${global.root} executor=${executor} onlyNew=${Boolean(args.onlyNew)}`);

  if (executor === "docker" && !isBinaryAvailable("docker")) {
    throw new CliError(
      "docker executor not available (docker not found on PATH)",
      "RUNTIME_NOT_AVAILABLE",
      ExitCode.RuntimeError,
    );
  }

  const sverka = createSverka({
    root: global.root,
    // Resolve relative --config / --baseline paths against --root so the
    // CLI's path semantics match the baseline subcommands (the SDK resolves
    // raw relative paths against the process cwd).
    ...(global.config
      ? { configPath: resolveUnderRoot(global.root, global.config) }
      : {}),
    executor,
    ...(args.baseline
      ? { baselinePath: resolveUnderRoot(global.root, args.baseline) }
      : {}),
    onlyNew: Boolean(args.onlyNew),
  });

  const result = await sverka.execute();

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "execute",
        verdict: result.verdict,
        // outcomes is a Map at runtime; JSON.stringify(Map) drops it to {}.
        // Materialize it as a plain object so machine consumers see every
        // operation's status, exit code, logs, artifacts, and error.
        data: { ...result, outcomes: Object.fromEntries(result.outcomes) },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Execution: ${result.status}`);
    output.writeLine(`  verdict: ${result.verdict}`);
    output.writeLine(`  findings: ${result.findings.length}`);
    output.writeLine(`  duration: ${result.durationMs}ms`);
  }

  return result.verdict === "pass" ? ExitCode.Success : ExitCode.PolicyFail;
}
