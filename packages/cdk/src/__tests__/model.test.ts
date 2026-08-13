import { describe, it, expect } from "vitest";
import {
  push,
  changeRequest,
  manual,
  type Push,
  type ChangeRequest,
  type Manual,
  type StepRef,
  type ContextRef,
  type Input,
  type OutputDeclaration,
  type Runtime,
} from "../index.js";

describe("Trigger factories", () => {
  it("push() creates a push trigger with correct kind", () => {
    const t: Push = push();
    expect(t.kind).toBe("push");
    expect(t.filter).toBeUndefined();
  });

  it("push() with filter preserves branches, tags, paths", () => {
    const t = push({ branches: ["main", "dev"], tags: ["v*"], paths: ["src/**"] });
    expect(t.kind).toBe("push");
    expect(t.filter?.branches).toEqual(["main", "dev"]);
    expect(t.filter?.tags).toEqual(["v*"]);
    expect(t.filter?.paths).toEqual(["src/**"]);
  });

  it("changeRequest() creates a changeRequest trigger", () => {
    const t: ChangeRequest = changeRequest({ branches: ["main"] });
    expect(t.kind).toBe("changeRequest");
    expect(t.filter?.branches).toEqual(["main"]);
  });

  it("manual() creates a manual trigger", () => {
    const t: Manual = manual();
    expect(t.kind).toBe("manual");
    expect(t.filter).toBeUndefined();
  });
});

describe("Reference types", () => {
  it("StepRef has correct shape", () => {
    const ref: StepRef = {
      kind: "step",
      step: "build",
      output: "dist",
      type: "artifact",
    };
    expect(ref.kind).toBe("step");
    expect(ref.step).toBe("build");
    expect(ref.output).toBe("dist");
    expect(ref.type).toBe("artifact");
  });

  it("ContextRef has correct shape", () => {
    const ref: ContextRef = {
      kind: "context",
      namespace: "env",
      field: "NODE_VERSION",
    };
    expect(ref.kind).toBe("context");
    expect(ref.namespace).toBe("env");
    expect(ref.field).toBe("NODE_VERSION");
  });
});

describe("Input/Output/Runtime types", () => {
  it("Input constructs with type and optional fields", () => {
    const input: Input = {
      type: "string",
      required: true,
      description: "Version string",
      secret: false,
    };
    expect(input.type).toBe("string");
    expect(input.required).toBe(true);
  });

  it("OutputDeclaration for scalar type", () => {
    const out: OutputDeclaration = { type: "string" };
    expect(out.type).toBe("string");
    expect(out.path).toBeUndefined();
  });

  it("OutputDeclaration for artifact type with path", () => {
    const out: OutputDeclaration = { type: "artifact", path: "./dist" };
    expect(out.type).toBe("artifact");
    expect(out.path).toBe("./dist");
  });

  it("Runtime with container mode and image", () => {
    const rt: Runtime = {
      mode: "container",
      image: "node:24",
      env: { NODE_ENV: "production" },
    };
    expect(rt.mode).toBe("container");
    expect(rt.image).toBe("node:24");
    expect(rt.env?.NODE_ENV).toBe("production");
  });
});
