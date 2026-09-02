// StorageError — error class for @sverka/storage.
// Spec 31 — Error handling.

export type StorageErrorCode = "STORE_IO_FAILED" | "CORRUPT_SNAPSHOT" | "INVALID_RUN_ID";

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
