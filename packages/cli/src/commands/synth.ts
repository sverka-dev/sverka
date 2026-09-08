// synth command — alias for compile.
// Delegates to compileCommand for backwards compatibility.

import type { GlobalFlags, OutputWriter } from "../types.js";
import { compileCommand, type CompileArgs } from "./compile.js";

export type SynthArgs = CompileArgs;

/**
 * Alias for `compile`. Delegates to compileCommand.
 */
export async function synthCommand(
  args: SynthArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  return compileCommand(args, global, output, start);
}
