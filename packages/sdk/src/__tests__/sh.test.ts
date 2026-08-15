import { describe, it, expect } from "vitest";
import { Project, Pipeline } from "@sverka/cdk";
import { sh, artifact } from "../index.js";
import { env } from "../context.js";

describe("sh tagged template", () => {
  it("creates a StepBuilder with the command string", () => {
    const builder = sh`npm run build`;
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = builder.build(pipeline, "build");
    expect(step.command).toBe("npm run build");
    expect(step.node.id).toBe("build");
  });

  it("interpolates string values literally", () => {
    const cmd = "test";
    const builder = sh`npm run ${cmd}`;
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = builder.build(pipeline, "test");
    expect(step.command).toBe("npm run test");
  });

  it("interpolates Reference values and collects them as inputs", () => {
    const ref = { kind: "step" as const, step: "build", output: "dist", type: "artifact" as const };
    const builder = sh`deploy ${ref}`;
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = builder.build(pipeline, "deploy");
    expect(step.command).toBe("deploy ${build.dist}");
    expect(step.inputs).toContainEqual(ref);
  });

  it("interpolates context references", () => {
    const ref = env.CI_TRACE!;
    const builder = sh`echo ${ref}`;
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = builder.build(pipeline, "echo-step");
    expect(step.command).toBe("echo ${env.CI_TRACE}");
    expect(step.inputs).toContainEqual({ kind: "context", namespace: "env", field: "CI_TRACE" });
  });

  it("rejects unsupported interpolation values", () => {
    expect(() => sh`echo ${{ foo: "bar" } as unknown as string}`).toThrowError(
      expect.objectContaining({ code: "INVALID_INTERPOLATION" }),
    );
  });
});

describe("StepBuilder", () => {
  it("outputs() adds output declarations", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm run build`.outputs({ dist: artifact("./dist") }).build(pipeline, "build");
    expect(step.outputs.get("dist")).toEqual({ type: "artifact", path: "./dist" });
  });

  it("dependsOn() adds control dependencies", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm test`.dependsOn(["build"]).build(pipeline, "test");
    expect(step.dependsOn).toEqual(["build"]);
  });

  it("timeout() sets the timeout", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm test`.timeout(5000).build(pipeline, "test");
    expect(step.timeout).toBe(5000);
  });

  it("runtime() sets the runtime", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm test`.runtime({ image: "node:22" }).build(pipeline, "test");
    expect(step.runtime.image).toBe("node:22");
  });

  it("interruptible() defaults to true", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm test`.interruptible().build(pipeline, "test");
    expect(step.interruptible).toBe(true);
  });

  it("interruptible(true) sets true explicitly", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm test`.interruptible(true).build(pipeline, "test");
    expect(step.interruptible).toBe(true);
  });

  it("interruptible(false) sets false", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const step = sh`npm run deploy`.interruptible(false).build(pipeline, "deploy");
    expect(step.interruptible).toBe(false);
  });

  it("preserves configuration when methods are called without reassignment", () => {
    const proj = new Project("test");
    const pipeline = new Pipeline(proj, "ci");
    const builder = sh`npm test`;
    builder.dependsOn(["build"]);
    builder.timeout(5000);
    const step = builder.build(pipeline, "test");
    expect(step.dependsOn).toEqual(["build"]);
    expect(step.timeout).toBe(5000);
  });
});
