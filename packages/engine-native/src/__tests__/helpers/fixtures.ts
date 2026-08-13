// Test fixtures for engine tests.
import type { RunPlan } from "@sverka/ir";
import type { StepDefinition } from "@sverka/core";

export function makeSingleStepPlan(command: string = "echo hello"): RunPlan {
  const step: StepDefinition = {
    id: "ci/hello",
    runtime: {},
    operations: [{ kind: "shell", command }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-test",
    graphId: "graph-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [step],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

export function makeDependencyPlan(): RunPlan {
  const build: StepDefinition = {
    id: "ci/build",
    runtime: {},
    operations: [
      { kind: "shell", command: 'echo "1.0.0" > $SVERKA_OUTPUT_DIR/version' },
      { kind: "exportOutput", name: "version", type: "string" },
    ],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
  const test: StepDefinition = {
    id: "ci/test",
    runtime: {},
    operations: [{ kind: "shell", command: "echo testing" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/build" }],
  };
  const deploy: StepDefinition = {
    id: "ci/deploy",
    runtime: {},
    operations: [{ kind: "shell", command: "echo deploying" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/test" }],
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-dep-test",
    graphId: "graph-dep-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [build, test, deploy],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

export function makeFailingPlan(): RunPlan {
  const build: StepDefinition = {
    id: "ci/build",
    runtime: {},
    operations: [{ kind: "shell", command: "exit 1" }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
  const test: StepDefinition = {
    id: "ci/test",
    runtime: {},
    operations: [{ kind: "shell", command: "echo testing" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/build" }],
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-fail-test",
    graphId: "graph-fail-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [build, test],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}
