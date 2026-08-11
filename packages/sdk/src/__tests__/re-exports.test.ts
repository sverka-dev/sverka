import { describe, it, expect } from "vitest";
import {
  // core composables
  pipeline,
  run,
  parallel,
  when,
  matrix,
  workflow,
  // core errors
  CoreError,
  PlanningError,
  CompositionError,
  // ir functions
  validatePlan,
  computePlanId,
  // planner
  createPlanner,
  // findings
  normalizeSarif,
  computeFingerprint,
  loadBaseline,
  saveBaseline,
  filterOnlyNew,
  // policy
  DEFAULT_POLICY,
  createPolicy,
  evaluatePolicy,
  // checks
  createBuiltinResolver,
  extractFindings,
  CheckError,
  // sdk
  task,
  defineWorkflow,
  findConfig,
  loadWorkflow,
  createSverka,
  plan,
  execute,
  SdkError,
} from "../index.js";

describe("re-exports — core composables", () => {
  it("exports pipeline, run, parallel, when, matrix, workflow as functions", () => {
    expect(typeof pipeline).toBe("function");
    expect(typeof run).toBe("function");
    expect(typeof parallel).toBe("function");
    expect(typeof when).toBe("function");
    expect(typeof matrix).toBe("function");
    expect(typeof workflow).toBe("function");
  });
});

describe("re-exports — core errors", () => {
  it("exports CoreError, PlanningError, CompositionError as classes", () => {
    expect(CoreError).toBeInstanceOf(Function);
    expect(PlanningError).toBeInstanceOf(Function);
    expect(CompositionError).toBeInstanceOf(Function);
  });
});

describe("re-exports — ir functions", () => {
  it("exports validatePlan and computePlanId as functions", () => {
    expect(typeof validatePlan).toBe("function");
    expect(typeof computePlanId).toBe("function");
  });
});

describe("re-exports — planner", () => {
  it("exports createPlanner as a function", () => {
    expect(typeof createPlanner).toBe("function");
  });
});

describe("re-exports — findings", () => {
  it("exports normalizeSarif, computeFingerprint, loadBaseline, saveBaseline, filterOnlyNew as functions", () => {
    expect(typeof normalizeSarif).toBe("function");
    expect(typeof computeFingerprint).toBe("function");
    expect(typeof loadBaseline).toBe("function");
    expect(typeof saveBaseline).toBe("function");
    expect(typeof filterOnlyNew).toBe("function");
  });
});

describe("re-exports — policy", () => {
  it("exports DEFAULT_POLICY, createPolicy, evaluatePolicy", () => {
    expect(DEFAULT_POLICY).toBeDefined();
    expect(typeof createPolicy).toBe("function");
    expect(typeof evaluatePolicy).toBe("function");
  });
});

describe("re-exports — checks", () => {
  it("exports createBuiltinResolver and extractFindings as functions", () => {
    expect(typeof createBuiltinResolver).toBe("function");
    expect(typeof extractFindings).toBe("function");
  });

  it("exports CheckError as a class", () => {
    expect(CheckError).toBeInstanceOf(Function);
    const err = new CheckError("msg", "RESOLUTION_FAILED");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CheckError");
  });
});

describe("re-exports — sdk-specific", () => {
  it("exports task, defineWorkflow, findConfig, loadWorkflow, createSverka, plan, execute as functions", () => {
    expect(typeof task).toBe("function");
    expect(typeof defineWorkflow).toBe("function");
    expect(typeof findConfig).toBe("function");
    expect(typeof loadWorkflow).toBe("function");
    expect(typeof createSverka).toBe("function");
    expect(typeof plan).toBe("function");
    expect(typeof execute).toBe("function");
  });

  it("exports SdkError as a class", () => {
    expect(SdkError).toBeInstanceOf(Function);
    const err = new SdkError("msg", "CONFIG_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SdkError");
    expect(err.code).toBe("CONFIG_NOT_FOUND");
  });
});
