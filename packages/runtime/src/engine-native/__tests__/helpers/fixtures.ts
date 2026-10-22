// Test fixtures for engine tests.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunPlan, InputValue } from "@sverka/workflow";
import type { StepDefinition, Reference, Expression } from "@sverka/workflow";

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

export function makeConditionalPlan(
  condition: Reference | Expression,
  inputs: Readonly<Record<string, InputValue>>,
): RunPlan {
  const step: StepDefinition = {
    id: "ci/hello",
    runtime: {},
    operations: [{ kind: "shell", command: "echo hello" }],
    inputs: [],
    outputs: [],
    dependencies: [],
    condition,
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-cond-test",
    graphId: "graph-cond-test",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs,
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

/** A git repository with one commit, as the runtime sees it. */
export interface GitRepoFixture {
  /** The commit sha of HEAD. */
  readonly sha: string;
  /** The branch HEAD points at. */
  readonly branch: string;
}

/**
 * Turn `dir` into a git repository with a single commit.
 *
 * The engine resolves `git.*` context refs by running git *in the
 * workspace*, so a test that asserts on git context needs a workspace that
 * is a repository of its own. Using the repo under test would make the
 * assertion depend on that repo's git state (and would write the step's
 * scratch directory into it), so every caller builds its own throwaway
 * repository instead.
 */
export async function initGitRepo(dir: string): Promise<GitRepoFixture> {
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  git("init", "--quiet");
  // Identity and branch are set locally — the test must not depend on the
  // machine's global git config.
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(dir, "file.txt"), "content\n", "utf-8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "init");
  return {
    sha: git("rev-parse", "HEAD").trim(),
    branch: git("rev-parse", "--abbrev-ref", "HEAD").trim(),
  };
}
