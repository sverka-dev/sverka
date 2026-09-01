// Spec 31 — StorageError tests (test plan item 15).
import { describe, it, expect } from "vitest";
import { StorageError } from "../errors.js";

describe("StorageError", () => {
  it("sets name === 'StorageError'", () => {
    const err = new StorageError("STORE_IO_FAILED", "disk full");
    expect(err.name).toBe("StorageError");
  });

  it("carries the code", () => {
    const err = new StorageError("CORRUPT_SNAPSHOT", "bad json");
    expect(err.code).toBe("CORRUPT_SNAPSHOT");
  });

  it("propagates cause", () => {
    const cause = new Error("original");
    const err = new StorageError("STORE_IO_FAILED", "wrapped", cause);
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new StorageError("STORE_IO_FAILED", "fail");
    expect(err).toBeInstanceOf(Error);
  });

  it("cause is optional", () => {
    const err = new StorageError("STORE_IO_FAILED", "no cause");
    expect(err.cause).toBeUndefined();
  });

  it("supports INVALID_RUN_ID code", () => {
    const err = new StorageError("INVALID_RUN_ID", "bad runId");
    expect(err.code).toBe("INVALID_RUN_ID");
  });
});
