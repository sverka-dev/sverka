import { describe, it, expect } from "vitest";
import { IRError, ValidationError, SerializationError } from "../errors.js";

describe("IRError", () => {
  it("is an Error subclass with name, code, and context", () => {
    const err = new IRError("boom", "BOOM", { key: "value" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IRError");
    expect(err.code).toBe("BOOM");
    expect(err.message).toBe("boom");
    expect(err.context).toEqual({ key: "value" });
  });

  it("context is optional", () => {
    const err = new IRError("boom", "BOOM");
    expect(err.context).toBeUndefined();
  });
});

describe("ValidationError", () => {
  it("extends IRError with code VALIDATION_ERROR", () => {
    const err = new ValidationError("bad plan", { field: "id" });
    expect(err).toBeInstanceOf(IRError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ValidationError");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.context).toEqual({ field: "id" });
  });

  it("context is optional", () => {
    const err = new ValidationError("bad plan");
    expect(err.context).toBeUndefined();
  });
});

describe("SerializationError", () => {
  it("extends IRError with code SERIALIZATION_ERROR", () => {
    const err = new SerializationError("bad json", { raw: "{" });
    expect(err).toBeInstanceOf(IRError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SerializationError");
    expect(err.code).toBe("SERIALIZATION_ERROR");
    expect(err.context).toEqual({ raw: "{" });
  });

  it("context is optional", () => {
    const err = new SerializationError("bad json");
    expect(err.context).toBeUndefined();
  });
});
