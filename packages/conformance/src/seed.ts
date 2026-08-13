// Conformance seed pipeline — authored through all three surfaces.
// Spec 18 — §33.1, §34.1.

import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  type Reference,
} from "@sverka/constructs";
import { sh, pipelineV0 as sdkPipeline } from "@sverka/sdk";
import {
  pipeline as pipelineDecorator,
  step,
  stepWithOptions,
  entry,
  input,
  decoratePipeline,
} from "@sverka/decorators";

const SEED_INPUTS = {
  nodeVersion: { type: "string" as const, default: "22" },
};

const statusRef: Reference = {
  kind: "step",
  step: "lint",
  output: "status",
  type: "string",
};

const distRef: Reference = {
  kind: "step",
  step: "build",
  output: "dist",
  type: "artifact",
};

const nodeVersionContext: Reference = {
  kind: "context",
  namespace: "inputs",
  field: "nodeVersion",
};

const lintOutputs = { status: { type: "string" as const } };
const buildOutputs = {
  dist: { type: "artifact" as const, path: ".outputs/dist.txt" },
};

const lintCommand = `sh -c 'echo ok > "$SVERKA_OUTPUT_DIR/status"; echo lint'`;
const buildCommand = `sh -c 'echo "got status \${lint.status}"; echo artifact-data > "$SVERKA_OUTPUT_DIR/dist.txt"; echo build'`;
const testCommand = `sh -c 'echo test; echo "lint status was \${lint.status}"'`;

const onPushEntry = {
  trigger: { kind: "push" as const },
  roots: ["test"],
};

// --- Construct API ---

export function createSeedWithConstructs(): Project {
  const proj = new Project("conf");
  const p = new Pipeline(proj, "ci", { inputs: SEED_INPUTS });

  const lint = new ShellStep(p, "lint", {
    command: lintCommand,
    outputs: lintOutputs,
  });
  const build = new ShellStep(p, "build", {
    command: buildCommand,
    dependsOn: ["lint"],
    inputs: [statusRef],
    outputs: buildOutputs,
  });
  const test = new ShellStep(p, "test", {
    command: testCommand,
    dependsOn: ["build"],
    inputs: [distRef],
    condition: nodeVersionContext,
  });
  const entry = new Entry(p, "on-push", onPushEntry);
  void lint; void build; void test; void entry;

  return proj;
}

// --- SDK API ---

export function createSeedWithSDK(): Project {
  const proj = new Project("conf");

  sdkPipeline(proj, "ci", {
    inputs: SEED_INPUTS,
    steps: [
      (p) => sh`${lintCommand}`.outputs(lintOutputs).build(p, "lint"),
      (p) =>
        sh`${buildCommand}`
          .inputs([statusRef])
          .dependsOn(["lint"])
          .outputs(buildOutputs)
          .build(p, "build"),
      (p) =>
        sh`${testCommand}`
          .inputs([distRef])
          .dependsOn(["build"])
          .condition(nodeVersionContext)
          .build(p, "test"),
    ],
    entries: [
      (p) => new Entry(p, "on-push", onPushEntry),
    ],
  });

  return proj;
}

// --- Decorator API ---

@pipelineDecorator
class SeedPipeline {
  @input
  nodeVersion = { type: "string" as const, default: "22" };

  @step
  lint = sh`${lintCommand}`.outputs(lintOutputs);

  @stepWithOptions({ dependsOn: ["lint"] })
  build = sh`${buildCommand}`.inputs([statusRef]).outputs(buildOutputs);

  @stepWithOptions({ dependsOn: ["build"] })
  test = sh`${testCommand}`.inputs([distRef]).condition(nodeVersionContext);

  @entry({ kind: "push" })
  ["on-push"] = ["test"];
}

export function createSeedWithDecorators(): Project {
  const proj = new Project("conf");
  decoratePipeline(SeedPipeline, proj, "ci");
  return proj;
}
