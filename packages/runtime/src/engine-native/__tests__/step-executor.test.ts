import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeStep } from "../step-executor.js";
import { createValueStore } from "../value-store.js";
import { createArtifactStore } from "../artifact-store.js";
import {
  createOutputWritingMockDriver,
  createMockDriver,
} from "./helpers/mock-driver.js";
import type { StepDefinition } from "@sverka/workflow";
import type { RunEvent } from "../types.js";

describe("StepExecutor", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-step-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("exportOutput captures scalar from $SVERKA_OUTPUT_DIR", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [
        { kind: "shell", command: 'echo "1.2.3" > $SVERKA_OUTPUT_DIR/version' },
        { kind: "exportOutput", name: "version", type: "string" },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step,
      driver,
      workspace: join(testDir, "ws"),
      artifactStore,
      valueStore,
      secrets: {},
      emit: (e) => events.push(e),
      isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    expect(valueStore.get("ci/build", "version")).toBe("1.2.3");
  });

  it("exportArtifact copies file to ArtifactStore", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    // Create a file in the workspace root — artifact paths are
    // project-relative, matching where shell commands run.
    const wsDir = join(testDir, "ws");
    await mkdir(wsDir, { recursive: true });
    await writeFile(join(wsDir, "dist.txt"), "artifact data");
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "exportArtifact", name: "dist", path: "dist.txt" }],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step,
      driver,
      workspace: join(testDir, "ws"),
      artifactStore,
      valueStore,
      secrets: {},
      emit: (e) => events.push(e),
      isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    // Verify artifact was stored.
    const dest = join(testDir, "retrieved.txt");
    await artifactStore.retrieve("ci/build", "dist", dest);
    expect(await readFile(dest, "utf-8")).toBe("artifact data");
  });

  it("importArtifact copies file from ArtifactStore to workspace", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    // Store an artifact first.
    const srcPath = join(testDir, "source.txt");
    await writeFile(srcPath, "imported data");
    await artifactStore.store("ci/build", "dist", srcPath);
    const step: StepDefinition = {
      id: "ci/test",
      runtime: {},
      operations: [
        {
          kind: "importArtifact",
          name: "dist",
          from: "ci/build",
          output: "dist",
        },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step,
      driver,
      workspace: join(testDir, "ws"),
      artifactStore,
      valueStore,
      secrets: {},
      emit: (e) => events.push(e),
      isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    // Verify artifact was imported into workspace root.
    const imported = await readFile(join(testDir, "ws", "dist"), "utf-8");
    expect(imported).toBe("imported data");
  });

  it("diagnostic operation emits diagnostic RunEvent", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [
        { kind: "diagnostic", message: "Building...", severity: "info" },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step,
      driver,
      workspace: join(testDir, "ws"),
      artifactStore,
      valueStore,
      secrets: {},
      emit: (e) => events.push(e),
      isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    const diag = events.find((e) => e.type === "diagnostic");
    expect(diag).toBeDefined();
  });
});

describe("StepExecutor — context ref resolution", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-ctx-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("resolves env.X from process.env", async () => {
    process.env.SVERKA_TEST_VAR = "test-value";
    try {
      let capturedCommand = "";
      const driver = createMockDriver({
        executeFn: async (req) => {
          capturedCommand = req.command;
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            durationMs: 1,
            timedOut: false,
          };
        },
      });
      const step: StepDefinition = {
        id: "ci/build",
        runtime: {},
        operations: [{ kind: "shell", command: "echo ${env.SVERKA_TEST_VAR}" }],
        inputs: [
          { kind: "context", namespace: "env", field: "SVERKA_TEST_VAR" },
        ],
        outputs: [],
        dependencies: [],
      };
      await executeStep({
        step,
        driver,
        workspace: testDir,
        artifactStore: createArtifactStore(join(testDir, "art")),
        valueStore: createValueStore(),
        secrets: {},
        emit: () => {},
        isCancelled: () => false,
      });
      expect(capturedCommand).toBe("echo test-value");
    } finally {
      delete process.env.SVERKA_TEST_VAR;
    }
  });

  it("prioritizes runtime.env over process.env for env.X", async () => {
    process.env.SVERKA_TEST_VAR = "from-process";
    try {
      let capturedCommand = "";
      const driver = createMockDriver({
        executeFn: async (req) => {
          capturedCommand = req.command;
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            durationMs: 1,
            timedOut: false,
          };
        },
      });
      const step: StepDefinition = {
        id: "ci/build",
        runtime: { env: { SVERKA_TEST_VAR: "from-runtime" } },
        operations: [{ kind: "shell", command: "echo ${env.SVERKA_TEST_VAR}" }],
        inputs: [
          { kind: "context", namespace: "env", field: "SVERKA_TEST_VAR" },
        ],
        outputs: [],
        dependencies: [],
      };
      await executeStep({
        step,
        driver,
        workspace: testDir,
        artifactStore: createArtifactStore(join(testDir, "art")),
        valueStore: createValueStore(),
        secrets: {},
        emit: () => {},
        isCancelled: () => false,
      });
      expect(capturedCommand).toBe("echo from-runtime");
    } finally {
      delete process.env.SVERKA_TEST_VAR;
    }
  });

  it("resolves secrets.X as env var reference, not raw value", async () => {
    let capturedCommand = "";
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCommand = req.command;
        capturedEnv = req.env;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: { secrets: ["TOKEN"] },
      operations: [{ kind: "shell", command: "echo ${secrets.TOKEN}" }],
      inputs: [{ kind: "context", namespace: "secrets", field: "TOKEN" }],
      outputs: [],
      dependencies: [],
      permissions: { write: [{ kind: "comment", target: "pr" }] },
    };
    await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: { TOKEN: "secret123" },
      emit: () => {},
      isCancelled: () => false,
    });
    // Secret value must NOT appear in the command — only the env var reference
    expect(capturedCommand).toBe("echo $TOKEN");
    expect(capturedEnv.TOKEN).toBe("secret123");
  });

  it("rejects undeclared secret references", async () => {
    const driver = createMockDriver({
      executeFn: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        timedOut: false,
      }),
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${secrets.TOKEN}" }],
      inputs: [{ kind: "context", namespace: "secrets", field: "TOKEN" }],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: { TOKEN: "secret123" },
      emit: () => {},
      isCancelled: () => false,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("undeclared secret");
  });

  it("resolves git.sha from git rev-parse HEAD", async () => {
    let capturedCommand = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCommand = req.command;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${git.sha}" }],
      inputs: [{ kind: "context", namespace: "git", field: "sha" }],
      outputs: [],
      dependencies: [],
    };
    // Use the repo root as workspace so git context resolves
    await executeStep({
      step,
      driver,
      workspace: process.cwd(),
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      emit: () => {},
      isCancelled: () => false,
    });
    // git.sha should be a non-empty hex string
    expect(capturedCommand).toMatch(/^echo [0-9a-f]{7,40}$/);
  });

  it("resolves git.branch from git rev-parse --abbrev-ref HEAD", async () => {
    let capturedCommand = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCommand = req.command;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${git.branch}" }],
      inputs: [{ kind: "context", namespace: "git", field: "branch" }],
      outputs: [],
      dependencies: [],
    };
    // Use the repo root as workspace so git context resolves
    await executeStep({
      step,
      driver,
      workspace: process.cwd(),
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      emit: () => {},
      isCancelled: () => false,
    });
    // git.branch should be a non-empty branch name
    expect(capturedCommand).not.toBe("echo ${git.branch}");
    expect(capturedCommand.length).toBeGreaterThan("echo ".length);
  });

  it("resolves inputs.X from pipeline inputs", async () => {
    let capturedCommand = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCommand = req.command;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${inputs.env}" }],
      inputs: [{ kind: "context", namespace: "inputs", field: "env" }],
      outputs: [],
      dependencies: [],
    };
    await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      inputs: { env: "staging" },
      emit: () => {},
      isCancelled: () => false,
    });
    expect(capturedCommand).toBe("echo staging");
  });
});

// F-20: Environment variables — runtime.env injected into process env
describe("StepExecutor — env var injection (F-20)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-env-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("injects runtime.env into shell environment", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: { env: { NODE_ENV: "production", CI: "true" } },
      operations: [{ kind: "shell", command: "echo $NODE_ENV" }],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      emit: () => {},
      isCancelled: () => false,
    });
    expect(capturedEnv.NODE_ENV).toBe("production");
    expect(capturedEnv.CI).toBe("true");
  });

  it("preserves SVERKA_OUTPUT_DIR and SVERKA_STEP_ID as reserved vars", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {
        env: { SVERKA_OUTPUT_DIR: "tampered", SVERKA_STEP_ID: "tampered" },
      },
      operations: [{ kind: "shell", command: "echo hi" }],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      emit: () => {},
      isCancelled: () => false,
    });
    expect(capturedEnv.SVERKA_OUTPUT_DIR).not.toBe("tampered");
    expect(capturedEnv.SVERKA_STEP_ID).toBe("ci/build");
  });
});

// F-21: Secrets — runtime.secrets injected from SecretProvider
describe("StepExecutor — secret injection (F-21)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-sec-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("injects runtime.secrets from secrets map into shell environment", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/deploy",
      runtime: { secrets: ["NPM_TOKEN", "GH_TOKEN"] },
      operations: [{ kind: "shell", command: "npm publish" }],
      inputs: [],
      outputs: [],
      dependencies: [],
      permissions: { write: [{ kind: "deploy", target: "production" }] },
    };
    await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: { NPM_TOKEN: "secret-npm-value", GH_TOKEN: "secret-gh-value" },
      emit: () => {},
      isCancelled: () => false,
    });
    expect(capturedEnv.NPM_TOKEN).toBe("secret-npm-value");
    expect(capturedEnv.GH_TOKEN).toBe("secret-gh-value");
  });

  it("does not inject unresolved secret names", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      id: "ci/deploy",
      runtime: { secrets: ["UNRESOLVED_TOKEN"] },
      operations: [{ kind: "shell", command: "echo hi" }],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    await executeStep({
      step,
      driver,
      workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      emit: () => {},
      isCancelled: () => false,
    });
    expect(capturedEnv.UNRESOLVED_TOKEN).toBeUndefined();
  });
});

describe("StepExecutor — shell output capture (stdout/stderr/exitCode)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-out-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function makeStep(operations: StepDefinition["operations"]): StepDefinition {
    return {
      id: "ci/build",
      runtime: {},
      operations,
      inputs: [],
      outputs: [],
      dependencies: [],
    };
  }

  function execOpts(
    step: StepDefinition,
    driver: ReturnType<typeof createMockDriver>,
    artifactDir?: string,
  ) {
    return {
      step,
      driver,
      workspace: testDir,
      ...(artifactDir !== undefined ? { artifactDir } : {}),
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: {},
      emit: () => {},
      isCancelled: () => false,
    };
  }

  it("succeeding step returns stdout/stderr/exitCode in result", async () => {
    const driver = createMockDriver({
      executeFn: async () => ({
        exitCode: 0,
        stdout: "build ok",
        stderr: "warn",
        durationMs: 5,
        timedOut: false,
      }),
    });
    const result = await executeStep(
      execOpts(makeStep([{ kind: "shell", command: "bun run build" }]), driver),
    );
    expect(result.status).toBe("succeeded");
    expect(result.stdout).toBe("build ok");
    expect(result.stderr).toBe("warn");
    expect(result.exitCode).toBe(0);
  });

  it("failing step returns stdout/stderr/exitCode in result", async () => {
    const driver = createMockDriver({
      executeFn: async () => ({
        exitCode: 2,
        stdout: "partial out",
        stderr: "lint error",
        durationMs: 5,
        timedOut: false,
      }),
    });
    const result = await executeStep(
      execOpts(makeStep([{ kind: "shell", command: "ruff check" }]), driver),
    );
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("partial out");
    expect(result.stderr).toBe("lint error");
  });

  it("truncates stdout/stderr beyond 10KB", async () => {
    const big = "x".repeat(12000);
    const driver = createMockDriver({
      executeFn: async () => ({
        exitCode: 0,
        stdout: big,
        stderr: "",
        durationMs: 5,
        timedOut: false,
      }),
    });
    const result = await executeStep(
      execOpts(makeStep([{ kind: "shell", command: "cat big" }]), driver),
    );
    expect(result.status).toBe("succeeded");
    expect(result.stdout).toContain("truncated 2000 bytes");
    expect(result.stdout!.length).toBeLessThan(big.length);
  });

  const SARIF_STEP = [
    { kind: "shell", command: "ruff check --output-format=sarif" },
    { kind: "exportStdout", name: "results.sarif" },
  ] as const;

  it("exportStdout writes captured stdout to artifact dir on success", async () => {
    const artifactDir = join(testDir, "artifacts");
    const driver = createMockDriver({
      executeFn: async () => ({
        exitCode: 0,
        stdout: '{"version":"2.1.0"}',
        stderr: "",
        durationMs: 5,
        timedOut: false,
      }),
    });
    const result = await executeStep(
      execOpts(makeStep([...SARIF_STEP]), driver, artifactDir),
    );
    expect(result.status).toBe("succeeded");
    const written = await readFile(
      join(artifactDir, "ci/build", "results.sarif"),
      "utf-8",
    );
    expect(written).toBe('{"version":"2.1.0"}');
  });

  it("exportStdout preserves stdout on step failure (findings present → non-zero exit)", async () => {
    const artifactDir = join(testDir, "artifacts");
    const driver = createMockDriver({
      executeFn: async () => ({
        exitCode: 1,
        stdout: '{"sarif":"with-findings"}',
        stderr: "",
        durationMs: 5,
        timedOut: false,
      }),
    });
    const result = await executeStep(
      execOpts(makeStep([...SARIF_STEP]), driver, artifactDir),
    );
    expect(result.status).toBe("failed");
    const written = await readFile(
      join(artifactDir, "ci/build", "results.sarif"),
      "utf-8",
    );
    expect(written).toBe('{"sarif":"with-findings"}');
  });

  it("shell commands run from the workspace (project root)", async () => {
    let capturedCwd = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCwd = req.cwd ?? "";
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    await executeStep(
      execOpts(makeStep([{ kind: "shell", command: "pwd" }]), driver),
    );
    expect(capturedCwd).toBe(testDir);
  });

  it("runtime.workingDir resolves relative to the workspace root", async () => {
    let capturedCwd = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCwd = req.cwd ?? "";
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const step: StepDefinition = {
      ...makeStep([{ kind: "shell", command: "pwd" }]),
      runtime: { workingDir: "packages/cli" },
    };
    await executeStep(execOpts(step, driver));
    expect(capturedCwd).toBe(join(testDir, "packages", "cli"));
  });

  it("exportStdout fails the step when no shell output was captured", async () => {
    const driver = createMockDriver();
    const result = await executeStep(
      execOpts(
        makeStep([{ kind: "exportStdout", name: "results.sarif" }]),
        driver,
        join(testDir, "artifacts"),
      ),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("no shell output");
  });
});
