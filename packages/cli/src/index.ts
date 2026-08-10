// @sverka/cli — public API

/**
 * Base error class for the CLI package. All CLI errors extend this so
 * callers can catch the full family with a single `instanceof CliError`.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CliError";
  }
}
