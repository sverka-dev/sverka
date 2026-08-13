import { describe, it, expect } from "vitest";
import {
  pipeline,
  step,
  stepWithOptions,
  entry,
  input,
  output,
  decoratePipeline,
  DecoratorError,
  type StepOptions,
  type EntryTarget,
  type FieldMetadata,
  type FieldKind,
  type DecoratorErrorCode,
} from "../index.js";

describe("public API — exports", () => {
  it("exports all decorator functions", () => {
    expect(typeof pipeline).toBe("function");
    expect(typeof step).toBe("function");
    expect(typeof stepWithOptions).toBe("function");
    expect(typeof entry).toBe("function");
    expect(typeof input).toBe("function");
    expect(typeof output).toBe("function");
    expect(typeof decoratePipeline).toBe("function");
  });

  it("exports DecoratorError class", () => {
    const err = new DecoratorError("msg", "INVALID_FIELD");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DecoratorError");
    expect(err.code).toBe("INVALID_FIELD");
    expect(err.cause).toBeUndefined();
  });

  it("all types are importable (compile-time check)", () => {
    const _opts: StepOptions = { timeout: 1000 };
    const _target: EntryTarget = ["lint"];
    const _meta: FieldMetadata = { kind: "step" };
    const _kind: FieldKind = "step";
    const _code: DecoratorErrorCode = "INVALID_FIELD";
    expect(_opts.timeout).toBe(1000);
    expect(_target).toEqual(["lint"]);
    expect(_meta.kind).toBe("step");
    expect(_kind).toBe("step");
    expect(_code).toBe("INVALID_FIELD");
  });
});
