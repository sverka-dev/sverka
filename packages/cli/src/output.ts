import type { GlobalFlags, OutputWriter } from "./types.js";

/** A sink that receives a string. */
export type WriteSink = (text: string) => void;

/**
 * OutputWriter that writes to caller-provided sinks (stdout/stderr).
 * In production, the sinks write to process.stdout/process.stderr.
 * In tests, the sinks capture into arrays.
 */
export class ConsoleOutputWriter implements OutputWriter {
  readonly #out: WriteSink;
  readonly #err: WriteSink;
  readonly #quiet: boolean;
  readonly #verbose: boolean;

  constructor(out: WriteSink, err: WriteSink, quiet = false, verbose = false) {
    this.#out = out;
    this.#err = err;
    this.#quiet = quiet;
    this.#verbose = verbose;
  }

  write(text: string): void {
    if (this.#quiet) return;
    this.#out(text);
  }

  writeLine(text: string): void {
    if (this.#quiet) return;
    this.#out(text + "\n");
  }

  error(text: string): void {
    this.#err(text);
  }

  errorLine(text: string): void {
    this.#err(text + "\n");
  }

  /** Write a debug line to stderr, only when --verbose is set. */
  debug(text: string): void {
    if (this.#verbose) {
      this.#err(text + "\n");
    }
  }
}

/**
 * Wrapper that applies --quiet / --verbose / --format semantics to any
 * underlying OutputWriter. Used to make injected test writers respect the
 * same suppression rules as the production writer.
 *
 * - `--quiet` (human format) suppresses stdout writes; JSON stdout is kept.
 * - `--verbose` routes `debug()` to the underlying `errorLine()`.
 * - stderr is never suppressed.
 */
export class FlagAwareWriter implements OutputWriter {
  readonly #base: OutputWriter;
  readonly #quiet: boolean;
  readonly #verbose: boolean;

  constructor(base: OutputWriter, quiet: boolean, verbose: boolean) {
    this.#base = base;
    this.#quiet = quiet;
    this.#verbose = verbose;
  }

  write(text: string): void {
    if (this.#quiet) return;
    this.#base.write(text);
  }

  writeLine(text: string): void {
    if (this.#quiet) return;
    this.#base.writeLine(text);
  }

  error(text: string): void {
    this.#base.error(text);
  }

  errorLine(text: string): void {
    this.#base.errorLine(text);
  }

  debug(text: string): void {
    if (this.#verbose) {
      this.#base.errorLine(text);
    }
  }
}

/**
 * Create an OutputWriter from global flags. In JSON format, stdout is NOT
 * suppressed by --quiet (the JSON result is the data and must be emitted).
 */
export function createOutputWriter(
  global: GlobalFlags,
  out: WriteSink,
  err: WriteSink,
): ConsoleOutputWriter {
  // In JSON format, quiet does not suppress the result stdout — only
  // human-format non-essential output. We model this by disabling quiet
  // suppression for json.
  const effectiveQuiet = global.quiet && global.format === "human";
  return new ConsoleOutputWriter(out, err, effectiveQuiet, global.verbose);
}

/**
 * Wrap any OutputWriter with --quiet / --verbose semantics from global flags.
 * Use for injected test writers so they respect the same suppression rules.
 */
export function wrapOutputWriter(
  global: GlobalFlags,
  base: OutputWriter,
): OutputWriter {
  const effectiveQuiet = global.quiet && global.format === "human";
  return new FlagAwareWriter(base, effectiveQuiet, global.verbose);
}
