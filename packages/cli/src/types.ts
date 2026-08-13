// @sverka/cli — public types

/** Global flags parsed from the command line. */
export interface GlobalFlags {
  /** Output format. Defaults to "human". */
  format: "human" | "json";
  /** Path to sverka.config.ts. */
  config: string | null;
  /** Root directory. Defaults to process.cwd(). */
  root: string;
  /** Suppress non-error output. */
  quiet: boolean;
  /** Enable verbose output with debug information. */
  verbose: boolean;
}

/** Output writer abstraction for testability. */
export interface OutputWriter {
  write(text: string): void;
  writeLine(text: string): void;
  error(text: string): void;
  errorLine(text: string): void;
  /** Write a debug line, only visible when --verbose is set. */
  debug(text: string): void;
}

/** Exit codes used by the CLI. */
export const ExitCode = {
  Success: 0,
  PolicyFail: 1,
  UsageError: 2,
  RuntimeError: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** CLI error codes. */
export type CliErrorCode =
  | "UNKNOWN_COMMAND"
  | "MISSING_ARG"
  | "INVALID_FLAG"
  | "CONFIG_EXISTS"
  | "RUNTIME_NOT_AVAILABLE"
  | "SDK_ERROR"
  | "PACKAGE_ERROR";

/** Error thrown when CLI argument parsing or command execution fails. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: ExitCode;
  override readonly cause: unknown;
  constructor(
    message: string,
    code: CliErrorCode,
    exitCode: ExitCode,
    cause?: unknown,
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.cause = cause;
  }
}
