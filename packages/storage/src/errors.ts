// StorageError — error class for @sverka/storage.
// Spec 31 — Error handling.

export type StorageErrorCode =
  "STORE_IO_FAILED" | "CORRUPT_SNAPSHOT" | "INVALID_RUN_ID";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  override readonly cause: unknown;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Error codes for hub/remote failures. Spec 55. */
export type HubErrorCode = "REMOTE_UNAVAILABLE" | "REMOTE_REJECTED";

/**
 * Hub remote-operation failure. Wraps fetch/network failures
 * (REMOTE_UNAVAILABLE) and non-2xx hub responses (REMOTE_REJECTED).
 * Remote operations degrade to local behaviour — this error is caught at
 * the engine/CLI boundary and surfaces as a warn diagnostic, never a run
 * failure.
 */
export class HubError extends Error {
  readonly code: HubErrorCode;
  /** HTTP status for REMOTE_REJECTED, when known. */
  readonly status?: number;
  override readonly cause: unknown;

  constructor(
    code: HubErrorCode,
    message: string,
    cause?: unknown,
    status?: number,
  ) {
    super(message);
    this.name = "HubError";
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
