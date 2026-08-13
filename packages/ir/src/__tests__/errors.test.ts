import { describe, it, expect } from "vitest";
import { IRError, ValidationError, SerializationError } from "../errors.js";

describe("IRError", () => {
  it("extends Error", () => {
    const err = new IRError("test", "VALIDATION_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test");
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("stores cause when provided", () => {
    const cause = new Error("root");
    const err = new IRError("test", "SERIALIZATION_ERROR", cause);
    expect(err.cause).toBe(cause);
  });

  it("has undefined cause when not provided", () => {
    const err = new IRError("test", "VALIDATION_ERROR");
    expect(err.cause).toBeUndefined();
  });
});

describe("ValidationError", () => {
  it("extends IRError with code VALIDATION_ERROR", () => {
    const err = new ValidationError("bad schema");
    expect(err).toBeInstanceOf(IRError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("ValidationError");
  });

  it("passes cause through", () => {
    const cause = new Error("root");
    const err = new ValidationError("bad schema", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("SerializationError", () => {
  it("extends IRError with code SERIALIZATION_ERROR", () => {
    const err = new SerializationError("bad json");
    expect(err).toBeInstanceOf(IRError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("SERIALIZATION_ERROR");
    expect(err.name).toBe("SerializationError");
  });

  it("passes cause through", () => {
    const cause = new Error("root");
    const err = new SerializationError("bad json", cause);
    expect(err.cause).toBe(cause);
  });
});
