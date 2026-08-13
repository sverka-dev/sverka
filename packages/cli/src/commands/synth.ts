// synth command — STUB. Target compilation requires Waves H/I.
// Spec 17 — §30.

import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

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
    output.errorLine(`synth --target ${args.target}: not yet implemented (requires Waves H/I)`);
  }

  return ExitCode.UsageError;
}
