// Tests for AgentStep model + synthesis. Spec 27 — items 1, 11.
import { describe, it, expect } from "vitest";
import { Project, Pipeline, Entry, push } from "../index.js";
import { AgentStep, type AgentStepProps, type AgentToolRef, type AgentOperation } from "../index.js";
import { synthesize, type StepDefinition } from "../../core/index.js";

describe("AgentStep — exports (item 11)", () => {
  it("AgentOperation, AgentStep, AgentStepProps, AgentToolRef are exported", () => {
    // Type-level: if these don't compile, the test fails to typecheck.
    const op: AgentOperation = {
      kind: "agent",
      engine: "claude",
      prompt: "Build the project",
    };
    expect(op.kind).toBe("agent");
    expect(op.engine).toBe("claude");

    const ref: AgentToolRef = { plugin: "mcp", tool: "github.create-pr" };
    expect(ref.plugin).toBe("mcp");
    expect(ref.tool).toBe("github.create-pr");

    // AgentStepProps is constructable
    const props: AgentStepProps = {
      engine: "claude",
      prompt: "Review the code",
    };
    expect(props.engine).toBe("claude");
  });
});

describe("AgentStep — synthesis (item 1)", () => {
  it("AgentStep synthesizes to StepDefinition with an agent operation", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new AgentStep(pipeline, "review", {
      engine: "claude",
      prompt: "Review the PR",
    });
    new Entry(pipeline, "on-push", { trigger: push(), roots: ["review"] });

    const graph = synthesize(proj);
    const step: StepDefinition | undefined = graph.project.pipelines[0]?.steps[0];
    expect(step?.id).toBe("ci/review");
    expect(step?.operations).toHaveLength(1);
    expect(step?.operations[0]?.kind).toBe("agent");
    const agentOp = step?.operations[0] as Extract<StepDefinition["operations"][number], { kind: "agent" }>;
    expect(agentOp.engine).toBe("claude");
    expect(agentOp.prompt).toBe("Review the PR");
  });

  it("AgentStep with tools + model synthesizes correctly", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new AgentStep(pipeline, "agent", {
      engine: "claude",
      model: "claude-sonnet-4-5",
      prompt: "Fix the bug",
      tools: [{ plugin: "mcp", tool: "github.create-pr" }],
      maxTokens: 4096,
    });

    const graph = synthesize(proj);
    const step = graph.project.pipelines[0]?.steps[0];
    const op = step?.operations[0] as Extract<StepDefinition["operations"][number], { kind: "agent" }>;
    expect(op.model).toBe("claude-sonnet-4-5");
    expect(op.tools).toEqual([{ plugin: "mcp", tool: "github.create-pr" }]);
    expect(op.maxTokens).toBe(4096);
  });

  it("AgentStep runtime defaults to host", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new AgentStep(pipeline, "agent", { engine: "default", prompt: "test" });

    const graph = synthesize(proj);
    const step = graph.project.pipelines[0]?.steps[0];
    expect(step?.runtime.mode).toBeUndefined(); // default {} runtime
  });
});
