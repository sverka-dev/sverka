// Tests for agent tagged template SDK builder. Spec 27 — items 2-4, 12.
import { describe, it, expect } from "vitest";
import { Project, Pipeline, AgentStep } from "@sverka/workflow";
import { agent, type AgentStepBuilder } from "../index.js";

describe("agent tagged template — exports (item 12)", () => {
  it("agent and AgentStepBuilder are exported", () => {
    expect(typeof agent).toBe("function");
    // AgentStepBuilder is a type — verify the builder returned by agent() has the right shape.
    const builder = agent`test prompt`;
    expect(typeof builder.build).toBe("function");
    expect(typeof builder.tools).toBe("function");
    expect(typeof builder.model).toBe("function");
    expect(typeof builder.maxTokens).toBe("function");
  });
});

describe("agent tagged template — builder (items 2-4)", () => {
  it("agent`prompt` creates AgentStep with engine 'default' and no tools (item 2)", () => {
    const project = new Project("agent-default");
    const pipeline = new Pipeline(project, "ci");
    const step = agent`Build and test the project`.build(pipeline, "build");

    expect(step).toBeInstanceOf(AgentStep);
    expect(step.engine).toBe("default");
    expect(step.prompt).toBe("Build and test the project");
    expect(step.tools).toEqual([]);
  });

  it("agent`prompt`.tools(...) adds a tool ref to the step (item 3)", () => {
    const project = new Project("agent-tools");
    const pipeline = new Pipeline(project, "ci");
    const step = agent`Review the PR`
      .tools({ plugin: "mcp", tool: "github.create-pr" })
      .build(pipeline, "review");

    expect(step.tools).toEqual([{ plugin: "mcp", tool: "github.create-pr" }]);
  });

  it("agent`prompt`.engine(...).model(...) sets engine + model (item 4)", () => {
    const project = new Project("agent-engine");
    const pipeline = new Pipeline(project, "ci");
    const step = agent`Fix the bug`
      .engine("claude")
      .model("claude-sonnet-4-5")
      .build(pipeline, "fix");

    expect(step.engine).toBe("claude");
    expect(step.model).toBe("claude-sonnet-4-5");
  });

  it("agent`prompt`.maxTokens(...) sets maxTokens", () => {
    const project = new Project("agent-tokens");
    const pipeline = new Pipeline(project, "ci");
    const step = agent`Summarize`.maxTokens(4096).build(pipeline, "sum");

    expect(step.maxTokens).toBe(4096);
  });

  it("agent builder supports chaining outputs/inputs/dependsOn", () => {
    const project = new Project("agent-chain");
    const pipeline = new Pipeline(project, "ci");
    // Add a prior step so dependsOn has a target.
    agent`First`.build(pipeline, "first");
    const step = agent`Second`
      .dependsOn(["first"])
      .build(pipeline, "second");

    expect(step.dependsOn).toEqual(["first"]);
  });

  it("agent interpolates string values into the prompt", () => {
    const project = new Project("agent-interp");
    const pipeline = new Pipeline(project, "ci");
    const step = agent`Review ${"the code"}`.build(pipeline, "review");

    expect(step.prompt).toBe("Review the code");
  });
});
