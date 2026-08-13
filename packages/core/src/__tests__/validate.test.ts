import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "@sverka/constructs";
import { synthesize, SynthesisError } from "../index.js";
import { validateOutputCollisions } from "../validate.js";
import type { StepDefinition } from "../index.js";

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
