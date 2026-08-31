import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "../constructs.js";
import { schedule } from "../model.js";
import type { ContinueOnError, RetryPolicy } from "../model.js";

describe("F-05: Schedule trigger", () => {
  it("creates a schedule trigger with cron", () => {
    const t = schedule("0 0 * * *");
    expect(t).toEqual({ kind: "schedule", cron: "0 0 * * *" });
  });

  it("creates a schedule trigger with timezone", () => {
    const t = schedule("0 0 * * *", "UTC");
    expect(t).toEqual({ kind: "schedule", cron: "0 0 * * *", timezone: "UTC" });
  });

  it("omits timezone when not provided (exactOptionalPropertyTypes)", () => {
    const t = schedule("0 0 * * *");
    expect("timezone" in t).toBe(false);
  });
});

describe("F-10: beforeScript/afterScript", () => {
  it("stores beforeScript on ShellStep", () => {
    const project = new Project("test-before");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      beforeScript: ["echo setup", "npm ci"],
    });
    expect(step.beforeScript).toEqual(["echo setup", "npm ci"]);
  });

  it("stores afterScript on ShellStep", () => {
    const project = new Project("test-after");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      afterScript: ["echo cleanup"],
    });
    expect(step.afterScript).toEqual(["echo cleanup"]);
  });

  it("beforeScript/afterScript undefined when not provided", () => {
    const project = new Project("test-none");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", { command: "make test" });
    expect(step.beforeScript).toBeUndefined();
    expect(step.afterScript).toBeUndefined();
  });
});

describe("F-12: continueOnError", () => {
  it("stores boolean continueOnError", () => {
    const project = new Project("test-coe-bool");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: true,
    });
    expect(step.continueOnError).toBe(true);
  });

  it("stores exitCodes continueOnError", () => {
    const project = new Project("test-coe-codes");
    const pipeline = new Pipeline(project, "ci");
    const coe: ContinueOnError = { exitCodes: [1, 2] };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      continueOnError: coe,
    });
    expect(step.continueOnError).toEqual({ exitCodes: [1, 2] });
  });

  it("continueOnError undefined when not provided", () => {
    const project = new Project("test-coe-none");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", { command: "make test" });
    expect(step.continueOnError).toBeUndefined();
  });
});

describe("F-14: retry policy", () => {
  it("stores retry policy with max", () => {
    const project = new Project("test-retry");
    const pipeline = new Pipeline(project, "ci");
    const retry: RetryPolicy = { max: 3 };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      retry,
    });
    expect(step.retry).toEqual({ max: 3 });
  });

  it("stores retry policy with when and exitCodes", () => {
    const project = new Project("test-retry-full");
    const pipeline = new Pipeline(project, "ci");
    const retry: RetryPolicy = {
      max: 2,
      when: ["timeout", "runner_system_failure"],
      exitCodes: [1, 137],
    };
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      retry,
    });
    expect(step.retry?.max).toBe(2);
    expect(step.retry?.when).toEqual(["timeout", "runner_system_failure"]);
    expect(step.retry?.exitCodes).toEqual([1, 137]);
  });

  it("retry undefined when not provided", () => {
    const project = new Project("test-retry-none");
    const pipeline = new Pipeline(project, "ci");
    const step = new ShellStep(pipeline, "test", { command: "make test" });
    expect(step.retry).toBeUndefined();
  });
});
