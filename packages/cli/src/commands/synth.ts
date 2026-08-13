// synth command — STUB. Target compilation requires Waves H/I.
// Spec 17 — §30.

import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";

export interface SynthArgs {
  target: "github" | "gitlab";
}

/**
 * Stub: target compilation is not yet implemented.
 * Will be replaced in Waves H/I (GitHub/GitLab targets).
 */
export async function synthCommand(
  args: SynthArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  output.debug(`synth: target=${args.target}`);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "synth",
        data: { target: args.target, implemented: false },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`synth --target ${args.target}: not yet implemented (requires Waves H/I)`);
  }

  throw new CliError(
    `synth --target ${args.target} is not yet implemented`,
    "INVALID_FLAG",
    ExitCode.UsageError,
  );
}
