import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "@sverka/constructs";
import { synthesize, validateGraph, SynthesisError } from "../index.js";
import type { DefinitionGraph } from "../graph.js";

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
  it("detects unknown producer → SynthesisError(UNKNOWN_PRODUCER)", () => {
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
});

describe("synthesize — validation: output collision", () => {
  it("detects output collision → SynthesisError(OUTPUT_COLLISION)", () => {
    // The constructs API deduplicates output names by Record key, so a
    // collision can only arise from a deserialized graph with duplicate
    // export operations. Test validateGraph directly with a crafted graph.
    const graph: DefinitionGraph = {
      project: {
        id: "myproj",
        pipelines: [
          {
            id: "ci",
            inputs: [],
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
    // Reference version as artifact when it's declared as string.
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
    // Reference an output that doesn't exist on the producer.
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
