// Shared I/O helpers for snapshot store implementations.
// Spec 31 — Error handling.

import { StorageError } from "../errors.js";

/**
 * Check if an error is an ENOENT (file not found) error.
 */
export function isENOENT(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Wrap an async I/O operation, throwing StorageError(STORE_IO_FAILED) on failure.
 */
export async function wrapIO<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new StorageError("STORE_IO_FAILED", `failed to ${label}`, e);
  }
}
