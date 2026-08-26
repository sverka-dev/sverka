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

export function makeFailureConditionPlan(): RunPlan {
  const build: StepDefinition = {
    id: "ci/build",
    runtime: {},
    operations: [{ kind: "shell", command: "exit 1" }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
  const notify: StepDefinition = {
    id: "ci/notify",
    runtime: {},
    operations: [{ kind: "shell", command: "echo notify" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/build" }],
    condition: { kind: "status", status: "failure" },
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-fail-cond-test",
    graphId: "graph-fail-cond-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [build, notify],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

export function makeAlwaysConditionPlan(): RunPlan {
  const build: StepDefinition = {
    id: "ci/build",
    runtime: {},
    operations: [{ kind: "shell", command: "exit 1" }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
  const cleanup: StepDefinition = {
    id: "ci/cleanup",
    runtime: {},
    operations: [{ kind: "shell", command: "echo cleanup" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/build" }],
    condition: { kind: "status", status: "always" },
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-always-cond-test",
    graphId: "graph-always-cond-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [build, cleanup],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

export function makeNeverConditionPlan(): RunPlan {
  const step: StepDefinition = {
    id: "ci/skip",
    runtime: {},
    operations: [{ kind: "shell", command: "echo skip" }],
    inputs: [],
    outputs: [],
    dependencies: [],
    condition: { kind: "status", status: "never" },
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-never-cond-test",
    graphId: "graph-never-cond-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [step],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}
