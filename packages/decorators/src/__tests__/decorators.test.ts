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
  type PlanningContext,
} from "../index.js";

describe("decorator API — @step string shorthand", () => {
  it("creates a ShellStep with the command", () => {
    @pipeline
    class TestPipeline {
      @step
      lint = "npm run lint";
    }

    const proj = new Project("step-string");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "lint");
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect((stepInstance as ShellStep).command).toBe("npm run lint");
  });
});

describe("decorator API — @step(options) factory", () => {
  it("creates a ShellStep with timeout", () => {
    @pipeline
    class TestPipeline {
      @step({ timeout: 120000 })
      build = "npm run build";
    }

    const proj = new Project("step-options");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.timeout).toBe(120000);
  });
});

describe("decorator API — @stepWithOptions(options)", () => {
  it("creates a ShellStep with timeout", () => {
    @pipeline
    class TestPipeline {
      @stepWithOptions({ timeout: 60000 })
      build = "npm run build";
    }

    const proj = new Project("step-with-options");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.timeout).toBe(60000);
  });
});

describe("decorator API — @step(options) overloaded form", () => {
  it("supports @step({ timeout }) factory form", () => {
    @pipeline
    class TestPipeline {
      @step({ timeout: 30000 })
      build = "npm run build";
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.timeout).toBe(30000);
  });

  it("supports @step and @step(options) in the same pipeline", () => {
    @pipeline
    class TestPipeline {
      @step
      lint = "npm run lint";

      @step({ timeout: 120000 })
      build = "npm run build";
    }

    const proj = new Project("test");
    const p = decoratePipeline(TestPipeline, proj, "ci");
    const lintStep = p.node.children.find((c) => c.node.id === "lint") as ShellStep;
    const buildStep = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(lintStep).toBeInstanceOf(ShellStep);
    expect(lintStep.command).toBe("npm run lint");
    expect(lintStep.timeout).toBeUndefined();
    expect(buildStep).toBeInstanceOf(ShellStep);
    expect(buildStep.command).toBe("npm run build");
    expect(buildStep.timeout).toBe(120000);
  });
});

describe("decorator API — @step with sh builder", () => {
  it("creates a ShellStep with outputs", () => {
    @pipeline
    class TestPipeline {
      @step
      build = sh`npm run build`.outputs({ dist: { type: "artifact", path: "./dist" } });
    }

    const proj = new Project("step-builder");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.outputs.get("dist")).toBeDefined();
    expect(stepInstance.outputs.get("dist")?.type).toBe("artifact");
  });
});

describe("decorator API — @step builder with options", () => {
  it("applies decorator options to a StepBuilder step", () => {
    @pipeline
    class TestPipeline {
      @step
      lint = "npm run lint";

      @stepWithOptions({ timeout: 60000, dependsOn: ["lint"] })
      build = sh`npm run build`.outputs({ dist: { type: "artifact", path: "./dist" } });
    }

    const proj = new Project("step-builder-options");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.timeout).toBe(60000);
    expect(stepInstance.dependsOn).toEqual(["lint"]);
    expect(stepInstance.outputs.get("dist")?.type).toBe("artifact");
  });
});

describe("decorator API — @step method", () => {
  it("creates a ShellStep from a method returning a StepBuilder", () => {
    @pipeline
    class TestPipeline {
      @step
      build() {
        return sh`npm run build`.outputs({ dist: { type: "artifact", path: "./dist" } });
      }
    }

    const proj = new Project("step-method-builder");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("npm run build");
    expect(stepInstance.outputs.get("dist")?.type).toBe("artifact");
  });

  it("creates a ShellStep from a method using this.sh multiple times", () => {
    @pipeline
    class TestPipeline implements PlanningContext {
      sh!: (strings: TemplateStringsArray, ...values: readonly unknown[]) => void;

      @step
      deploy(this: PlanningContext) {
        this.sh`echo prepare`;
        this.sh`echo deploy`;
      }
    }

    const proj = new Project("step-method-sh");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "deploy") as ShellStep;
    expect(stepInstance).toBeInstanceOf(ShellStep);
    expect(stepInstance.command).toBe("echo prepare && echo deploy");
  });

  it("applies decorator options to a method returning a StepBuilder", () => {
    @pipeline
    class TestPipeline {
      @step({ timeout: 120000 })
      build() {
        return sh`npm run build`;
      }
    }

    const proj = new Project("step-method-options");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
    const stepInstance = p.node.children.find((c) => c.node.id === "build") as ShellStep;
    expect(stepInstance.timeout).toBe(120000);
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

    const proj = new Project("entry");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
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

    const proj = new Project("input");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
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

    const proj = new Project("multiple");
    const p = decoratePipeline(TestPipeline, proj, "pipeline");
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

    const proj1 = new Project("graph");
    decoratePipeline(DecoratorPipeline, proj1, "pipeline");
    const graph1 = synthesize(proj1);

    // Equivalent Construct API
    const proj2 = new Project("graph");
    const p2 = new Pipeline(proj2, "pipeline");
    new ShellStep(p2, "lint", { command: "npm run lint" });
    new ShellStep(p2, "build", { command: "npm run build" });
    new Entry(p2, "onPush", { trigger: { kind: "push" }, roots: ["lint", "build"] });
    const graph2 = synthesize(proj2);

    expect(graph1).toEqual(graph2);
  });
});

describe("decorator API — errors", () => {
  it("throws NOT_A_PIPELINE for non-decorated class", () => {
    class NotAPipeline {
      lint = "npm run lint";
    }

    const proj = new Project("not-a-pipeline");
    expect(() => decoratePipeline(NotAPipeline as never, proj, "pipeline")).toThrow(
      new DecoratorError("class NotAPipeline is not a decorated pipeline (missing @pipeline)", "NOT_A_PIPELINE"),
    );
  });

  it("throws MISSING_INITIALIZER for @step without initializer", () => {
    @pipeline
    class TestPipeline {
      @step
      build!: string;
    }

    const proj = new Project("missing-initializer");
    expect(() => decoratePipeline(TestPipeline, proj, "pipeline")).toThrow(
      new DecoratorError("step field 'build' has no initializer", "MISSING_INITIALIZER"),
    );
  });

  it("throws INVALID_FIELD for invalid @input", () => {
    @pipeline
    class TestPipeline {
      @input
      bad = "not an input";

      @step
      lint = "npm run lint";
    }

    const proj = new Project("invalid-input");
    expect(() => decoratePipeline(TestPipeline, proj, "pipeline")).toThrow(
      new DecoratorError("input field 'bad' must be an object", "INVALID_FIELD"),
    );
  });
});
