import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
import { sh } from "@sverka/sdk";
import { synthesize } from "@sverka/core";
import {
  pipeline,
  step,
  stepWithOptions,
  entry,
  input,
  decoratePipeline,
  DecoratorError,
} from "../index.js";

describe("decorator API — @step string shorthand", () => {
  it("creates a ShellStep with the command", () => {
    @pipeline
    class TestPipeline {
      @step
      lint = "npm run lint";
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const stepInstance = p.node.children.find((c) => c.node.id === "lint");
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect((stepInstance as ShellStep).command).toBe("npm run lint");
  });
});

describe("decorator API — @stepWithOptions(options)", () => {
  it("creates a ShellStep with timeout", () => {
    @pipeline
    class TestPipeline {
      @stepWithOptions({ timeout: 60000 })
      build = "npm run build";
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.timeout).toBe(60000);
  });
});

describe("decorator API — @step with sh builder", () => {
  it("creates a ShellStep with outputs", () => {
    @pipeline
    class TestPipeline {
      @step
      build = sh`npm run build`.outputs({ dist: { type: "artifact", path: "./dist" } });
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.outputs.get("dist")).toBeDefined();
    expect(stepInstance.outputs.get("dist")?.type).toBe("artifact");
  });
});

describe("decorator API — @entry", () => {
  it("creates an Entry with trigger and roots", () => {
    @pipeline
    class TestPipeline {
      @step
      lint = "npm run lint";

      @entry({ kind: "push" })
      onPush = ["lint"];
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const entryInstance = p.node.children.find((c) => c.node.id === "onPush");
    expect(entryInstance).toBeInstanceOf(Entry);
    expect((entryInstance as Entry).trigger.kind).toBe("push");
    expect((entryInstance as Entry).roots).toEqual(["lint"]);
  });
});

describe("decorator API — @input", () => {
  it("registers pipeline inputs", () => {
    @pipeline
    class TestPipeline {
      @input
      nodeVersion = { type: "string" as const, default: "22" };

      @step
      lint = "npm run lint";
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    expect(p.inputs.get("nodeVersion")).toBeDefined();
    expect(p.inputs.get("nodeVersion")?.type).toBe("string");
    expect(p.inputs.get("nodeVersion")?.default).toBe("22");
  });
});

describe("decorator API — multiple steps in source order", () => {
  it("creates all steps in order", () => {
    @pipeline
    class TestPipeline {
      @step
      lint = "npm run lint";

      @step
      test = "npm run test";

      @step
      build = "npm run build";
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const steps = p.node.children.filter((c) => c instanceof ShellStep);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.node.id).toBe("lint");
    expect(steps[1]?.node.id).toBe("test");
    expect(steps[2]?.node.id).toBe("build");
  });
});

describe("decorator API — synthesize to Definition Graph", () => {
  it("produces same graph as Construct API", () => {
    @pipeline
    class DecoratorPipeline {
      @step
      lint = "npm run lint";

      @step
      build = "npm run build";

      @entry({ kind: "push" })
      onPush = ["lint", "build"];
    }

    const proj1 = new Project("test");
    decoratePipeline(DecoratorPipeline, proj1, "ci");
    const graph1 = synthesize(proj1);

    // Equivalent Construct API
    const proj2 = new Project("test");
    const p2 = new Pipeline(proj2, "ci");
    new ShellStep(p2, "lint", { command: "npm run lint" });
    new ShellStep(p2, "build", { command: "npm run build" });
    new Entry(p2, "onPush", { trigger: { kind: "push" }, roots: ["lint", "build"] });
    const graph2 = synthesize(proj2);

    expect(graph1.project.pipelines.length).toBe(graph2.project.pipelines.length);
    expect(graph1.project.pipelines[0]?.steps.length).toBe(graph2.project.pipelines[0]?.steps.length);
    expect(graph1.project.pipelines[0]?.entries.length).toBe(graph2.project.pipelines[0]?.entries.length);

    const steps1 = graph1.project.pipelines[0]?.steps.map((s) => s.id) ?? [];
    const steps2 = graph2.project.pipelines[0]?.steps.map((s) => s.id) ?? [];
    expect(steps1).toEqual(steps2);

    const entries1 = graph1.project.pipelines[0]?.entries.map((e) => e.id) ?? [];
    const entries2 = graph2.project.pipelines[0]?.entries.map((e) => e.id) ?? [];
    expect(entries1).toEqual(entries2);
  });
});

describe("decorator API — errors", () => {
  it("throws NOT_A_PIPELINE for non-decorated class", () => {
    class NotAPipeline {
      lint = "npm run lint";
    }

    const proj = new Project("test");
    expect(() => decoratePipeline(NotAPipeline as never, proj, "ci")).toThrow(DecoratorError);
    expect(() => decoratePipeline(NotAPipeline as never, proj, "ci")).toThrow(/not a decorated pipeline/);
  });
});
