import { describe, it, expect } from "vitest";
import {
  pipeline,
  step,
  stepWithOptions,
  entry,
  input,
  decoratePipeline,
  DecoratorError,
  type StepOptions,
  type EntryTarget,
  type FieldMetadata,
  type FieldKind,
  type DecoratorErrorCode,
  type PlanningContext,
} from "../index.js";

describe("public API — exports", () => {
  it("exports all decorator functions", () => {
    expect(typeof pipeline).toBe("function");
    expect(typeof step).toBe("function");
    expect(typeof stepWithOptions).toBe("function");
    expect(typeof entry).toBe("function");
    expect(typeof input).toBe("function");
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
    const opts: StepOptions = { timeout: 1000 };
    const target: EntryTarget = ["lint"];
    const meta: FieldMetadata = { kind: "step" };
    const kind: FieldKind = "step";
    const code: DecoratorErrorCode = "INVALID_FIELD";
    const ctx: PlanningContext = { $() {} };
    expect(opts.timeout).toBe(1000);
    expect(target).toEqual(["lint"]);
    expect(meta.kind).toBe("step");
    expect(kind).toBe("step");
    expect(code).toBe("INVALID_FIELD");
    expect(typeof ctx.$).toBe("function");
  });
});
