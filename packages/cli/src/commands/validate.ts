import { loadWorkflow, findConfig, SdkError } from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";

/**
 * Validate a sverka.config.ts without executing.
 * Exit 0 if valid, 2 if invalid/missing config, 3 if load fails.
 */
export async function validateCommand(
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`validate: root=${global.root} config=${global.config ?? "(auto)"}`);
  // Resolve an explicit relative --config against --root so validation honors
  // the selected root, matching auto-discovery via findConfig(global.root).
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

  try {
    await loadWorkflow(configPath);
  } catch (e) {
    if (e instanceof SdkError) {
      if (e.code === "CONFIG_NOT_FOUND") {
        throw new CliError(e.message, "MISSING_ARG", ExitCode.UsageError, e);
      }
      if (e.code === "CONFIG_INVALID") {
        throw new CliError(e.message, "INVALID_FLAG", ExitCode.UsageError, e);
      }
      // CONFIG_LOAD_FAILED and others → runtime error.
      throw new CliError(e.message, "SDK_ERROR", ExitCode.RuntimeError, e);
    }
    throw e;
  }

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "validate",
        data: { path: configPath, valid: true },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Config valid: ${configPath}`);
  }

  return ExitCode.Success;
}
