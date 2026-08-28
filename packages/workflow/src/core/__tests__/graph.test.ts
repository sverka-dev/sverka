import { describe, it, expect } from "vitest";
import type {
  DefinitionGraph,
  ProjectDefinition,
  PipelineDefinition,
  Input,
  EntryDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
} from "../index.js";
import type { Trigger, Runtime, Reference } from "../../cdk/index.js";

describe("DefinitionGraph structure", () => {
  it("Project → Pipelines → Steps/Entries", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "myproj",
        pipelines: [
          {
            id: "ci",
            inputs: {},
            entries: [],
            steps: [],
            outputs: [],
          },
        ],
      },
    };
    expect(graph.project.id).toBe("myproj");
    expect(graph.project.pipelines.length).toBe(1);
    expect(graph.project.pipelines[0]?.id).toBe("ci");
  });
});

describe("StepDefinition", () => {
  it("holds operations, inputs, outputs, dependencies, runtime", () => {
    const runtime: Runtime = { mode: "host" };
    const step: StepDefinition = {
      id: "ci/build",
      runtime,
      operations: [{ kind: "shell", command: "npm run build" }],
      inputs: [],
      outputs: [{ name: "dist", type: "artifact", path: "./dist" }],
      dependencies: [],
    };
    expect(step.id).toBe("ci/build");
    expect(step.operations[0]?.kind).toBe("shell");
    expect(step.outputs[0]?.type).toBe("artifact");
    expect(step.dependencies.length).toBe(0);
  });
});

describe("OperationDefinition variants", () => {
  it("shell operation", () => {
    const op: OperationDefinition = { kind: "shell", command: "echo hi" };
    expect(op.kind).toBe("shell");
  });

  it("exportOutput operation", () => {
    const op: OperationDefinition = { kind: "exportOutput", name: "version", type: "string" };
    expect(op.kind).toBe("exportOutput");
  });

  it("exportArtifact operation", () => {
    const op: OperationDefinition = { kind: "exportArtifact", name: "dist", path: "./dist" };
    expect(op.kind).toBe("exportArtifact");
  });

  it("importArtifact operation", () => {
    const op: OperationDefinition = {
      kind: "importArtifact",
      name: "dist",
      from: "ci/build",
      output: "dist",
    };
    expect(op.kind).toBe("importArtifact");
  });

  it("diagnostic operation", () => {
    const op: OperationDefinition = { kind: "diagnostic", message: "hello", severity: "info" };
    expect(op.kind).toBe("diagnostic");
  });
});

describe("Dependency variants", () => {
  it("control dependency (no output)", () => {
    const dep: Dependency = { kind: "control", producer: "ci/build" };
    expect(dep.kind).toBe("control");
    expect("output" in dep).toBe(false);
  });

  it("value dependency (output + scalar type)", () => {
    const dep: Dependency = { kind: "value", producer: "ci/build", output: "version" };
    expect(dep.kind).toBe("value");
    expect(dep.output).toBe("version");
  });

  it("artifact dependency (output + artifact type)", () => {
    const dep: Dependency = { kind: "artifact", producer: "ci/build", output: "dist" };
    expect(dep.kind).toBe("artifact");
    expect(dep.output).toBe("dist");
  });
});

describe("EntryDefinition", () => {
  it("holds trigger and root step ids", () => {
    const trigger: Trigger = { kind: "push" };
    const entry: EntryDefinition = {
      id: "ci/on-push",
      trigger,
      roots: ["ci/build"],
    };
    expect(entry.trigger.kind).toBe("push");
    expect(entry.roots).toEqual(["ci/build"]);
  });
});

describe("StepDefinition optional fields", () => {
  it("with timeout and condition", () => {
    const condition: Reference = {
      kind: "context",
      namespace: "env",
      field: "DEPLOY",
    };
    const step: StepDefinition = {
      id: "ci/deploy",
      runtime: {},
      operations: [{ kind: "shell", command: "deploy" }],
      inputs: [],
      outputs: [],
      dependencies: [],
      timeout: 30000,
      condition,
    };
    expect(step.timeout).toBe(30000);
    expect(step.condition?.kind).toBe("context");
  });
});

describe("PipelineDefinition", () => {
  it("with inputs and outputs", () => {
    const input: Input = { type: "string", required: true };
    const pipeline: PipelineDefinition = {
      id: "ci",
      inputs: { env: input },
      entries: [],
      steps: [],
      outputs: [{ name: "version", type: "string", stepId: "ci/build" }],
    };
    expect(pipeline.inputs.env?.type).toBe("string");
    expect(pipeline.inputs.env?.required).toBe(true);
    expect(Object.keys(pipeline.inputs).length).toBe(1);
    expect(pipeline.outputs.length).toBe(1);
  });
});
