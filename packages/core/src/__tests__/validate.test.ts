import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "@sverka/constructs";
import { synthesize, validateGraph, SynthesisError } from "../index.js";
import { validateOutputCollisions } from "../validate.js";
import type { StepDefinition, DefinitionGraph } from "../graph.js";

describe("synthesize — validation: cycles", () => {
  it("detects cycle → SynthesisError(CYCLE)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "a", {
      command: "echo a",
      dependsOn: ["b"],
    });
    new ShellStep(pipeline, "b", {
      command: "echo b",
      dependsOn: ["a"],
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("CYCLE");
    }
  });
});

describe("synthesize — validation: unknown producer", () => {
  it("detects unknown StepRef producer → SynthesisError(UNKNOWN_PRODUCER)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [{ kind: "step", step: "nonexistent", output: "dist", type: "artifact" }],
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("UNKNOWN_PRODUCER");
    }
  });

  it("detects unknown dependsOn target → SynthesisError(UNKNOWN_PRODUCER)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "test", {
      command: "npm test",
      dependsOn: ["missing"],
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("UNKNOWN_PRODUCER");
    }
  });
});

describe("synthesize — validation: output collision", () => {
  it("detects duplicate export output names → SynthesisError(OUTPUT_COLLISION)", () => {
    const steps: StepDefinition[] = [
      {
        id: "ci/build",
        runtime: {},
        operations: [
          { kind: "exportOutput", name: "dist", type: "string" },
          { kind: "exportArtifact", name: "dist", path: "./dist" },
        ],
        inputs: [],
        outputs: [],
        dependencies: [],
      },
    ];
    expect(() => validateOutputCollisions(steps)).toThrow(SynthesisError);
    try {
      validateOutputCollisions(steps);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("OUTPUT_COLLISION");
    }
  });

  it("detects importArtifact/exportArtifact name collision → SynthesisError(OUTPUT_COLLISION)", () => {
    const steps: StepDefinition[] = [
      {
        id: "ci/test",
        runtime: {},
        operations: [
          {
            kind: "importArtifact",
            name: "dist",
            from: "ci/build",
            output: "dist",
          },
          { kind: "exportArtifact", name: "dist", path: "./dist" },
        ],
        inputs: [],
        outputs: [],
        dependencies: [],
      },
    ];
    expect(() => validateOutputCollisions(steps)).toThrow(SynthesisError);
    try {
      validateOutputCollisions(steps);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("OUTPUT_COLLISION");
    }
  });

  it("detects output collision via validateGraph → SynthesisError(OUTPUT_COLLISION)", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "myproj",
        pipelines: [
          {
            id: "ci",
            inputs: {},
            entries: [],
            outputs: [],
            steps: [
              {
                id: "ci/build",
                runtime: {},
                operations: [
                  { kind: "shell", command: "npm run build" },
                  { kind: "exportOutput", name: "version", type: "string" },
                  { kind: "exportOutput", name: "version", type: "string" },
                ],
                inputs: [],
                outputs: [],
                dependencies: [],
              },
            ],
          },
        ],
      },
    };
    expect(() => validateGraph(graph)).toThrow(SynthesisError);
    try {
      validateGraph(graph);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("OUTPUT_COLLISION");
    }
  });

  it("passes when no duplicate export names exist", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    expect(() => synthesize(proj)).not.toThrow();
  });
});

describe("validateGraph", () => {
  it("validates a well-formed graph without throwing", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
    });
    const graph = synthesize(proj);
    expect(() => validateGraph(graph)).not.toThrow();
  });
});

describe("synthesize — validation: incompatible reference", () => {
  it("detects incompatible reference type → SynthesisError(INCOMPATIBLE_REFERENCE)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { version: { type: "string" } },
    });
    new ShellStep(pipeline, "deploy", {
      command: "deploy",
      inputs: [{ kind: "step", step: "build", output: "version", type: "artifact" }],
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("INCOMPATIBLE_REFERENCE");
    }
  });

  it("detects reference to non-existent output on producer", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "./dist" } },
    });
    new ShellStep(pipeline, "test", {
      command: "npm test",
      inputs: [{ kind: "step", step: "build", output: "nonexistent", type: "string" }],
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("INCOMPATIBLE_REFERENCE");
    }
  });
});

describe("validateGraph — entry roots", () => {
  it("rejects an entry whose root step does not exist → SynthesisError", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "myproj",
        pipelines: [
          {
            id: "ci",
            inputs: {},
            entries: [
              {
                id: "ci/on-push",
                trigger: { kind: "push" },
                roots: ["ci/missing"],
              },
            ],
            outputs: [],
            steps: [
              {
                id: "ci/build",
                runtime: {},
                operations: [{ kind: "shell", command: "npm run build" }],
                inputs: [],
                outputs: [],
                dependencies: [],
              },
            ],
          },
        ],
      },
    };
    expect(() => validateGraph(graph)).toThrow(SynthesisError);
    try {
      validateGraph(graph);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("UNKNOWN_PRODUCER");
    }
  });

  it("accepts an entry whose root step exists", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "myproj",
        pipelines: [
          {
            id: "ci",
            inputs: {},
            entries: [
              {
                id: "ci/on-push",
                trigger: { kind: "push" },
                roots: ["ci/build"],
              },
            ],
            outputs: [],
            steps: [
              {
                id: "ci/build",
                runtime: {},
                operations: [{ kind: "shell", command: "npm run build" }],
                inputs: [],
                outputs: [],
                dependencies: [],
              },
            ],
          },
        ],
      },
    };
    expect(() => validateGraph(graph)).not.toThrow();
  });
});
