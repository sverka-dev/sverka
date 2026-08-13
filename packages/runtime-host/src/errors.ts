/**
 * Base error class for the runtime-host package. All host executor errors
 * extend this so callers can catch the full family with a single
 * `instanceof HostDriverError`.
 */
export class HostDriverError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HostDriverError";
  }
}

/** Raised when a process exceeds its timeout. */
export class HostTimeoutError extends HostDriverError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "HOST_TIMEOUT", context);
    this.name = "HostTimeoutError";
  }
}

/** Raised when a command is not in the allowlist. */
export class CommandNotAllowedError extends HostDriverError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "COMMAND_NOT_ALLOWED", context);
    this.name = "CommandNotAllowedError";
  }
}
