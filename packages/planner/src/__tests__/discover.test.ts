import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlanner } from "../planner.js";
import {
  makeFixtureDir,
  cleanup,
  listFiles,
  makeMockGit,
  type MockGitConfig,
} from "./helpers/fixtures.js";

// Mock the git seam so no real git is needed.
vi.mock("../internal/git-cli.js", () => ({
  createGitCli: vi.fn(),
}));

import { createGitCli } from "../internal/git-cli.js";

const mockedCreateGitCli = vi.mocked(createGitCli);

/** Install a mock git CLI with the given config. */
function installMockGit(cfg: MockGitConfig): void {
  mockedCreateGitCli.mockReturnValue(makeMockGit(cfg));
}

beforeEach(() => {
  mockedCreateGitCli.mockReset();
});

// --- Test plan 1: local signal detection ---

describe("discover — local signal detection", () => {
  it("detects manifest, lockfile, dockerfile, docker-compose, ci-definition, monorepo-marker signals", async () => {
    const files: Record<string, string> = {
      "package.json": "{}",
      "bun.lock": "{}",
      "Dockerfile": "FROM node:24",
      "docker-compose.yml": "services: {}",
      ".github/workflows/ci.yml": "on: [push]",
      "nx.json": "{}",
      "src/index.ts": "export {}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({
      root,
      trackedFiles: Object.keys(files),
    });
    try {
      const planner = createPlanner();
      const ctx = await planner.discover({ root });
      const types = ctx.localSignals.map((s) => s.type);
      expect(types).toContain("manifest");
      expect(types).toContain("lockfile");
      expect(types).toContain("dockerfile");
      expect(types).toContain("docker-compose");
      expect(types).toContain("ci-definition");
      expect(types).toContain("monorepo-marker");
      expect(types).toContain("git-metadata");
      // All local (non-git) signals have confidence 1.0
      for (const sig of ctx.localSignals) {
        expect(sig.confidence).toBe(1.0);
      }
    } finally {
      await cleanup(root);
    }
  });

  it("detects *.Dockerfile variant", async () => {
    const files: Record<string, string> = {
      "dev.Dockerfile": "FROM node:24",
      "src/index.ts": "export {}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.localSignals.some((s) => s.type === "dockerfile")).toBe(true);
      expect(ctx.hasContainerBuild).toBe(true);
    } finally {
      await cleanup(root);
    }
  });

  it("detects docker-compose.yaml variant", async () => {
    const files: Record<string, string> = {
      "docker-compose.yaml": "services: {}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.localSignals.some((s) => s.type === "docker-compose")).toBe(true);
    } finally {
      await cleanup(root);
    }
  });

  it("detects .gitlab-ci.yml, Jenkinsfile, azure-pipelines.yml, .circleci/", async () => {
    const files: Record<string, string> = {
      ".gitlab-ci.yml": "stages: []",
      "Jenkinsfile": "pipeline {}",
      "azure-pipelines.yml": "steps: []",
      ".circleci/config.yml": "version: 2",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const ciSignals = ctx.localSignals.filter((s) => s.type === "ci-definition");
      expect(ciSignals).toHaveLength(4);
      expect(ctx.hasCiDefinition).toBe(true);
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 2: language detection ---

describe("discover — language detection", () => {
  it("maps extensions to languages with correct fileCount and confidence", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      files[`src/file${i}.ts`] = "export {}";
    }
    files["src/app.py"] = "pass";
    files["src/main.rs"] = "fn main() {}";
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const ts = ctx.languages.find((l) => l.name === "TypeScript");
      expect(ts).toBeDefined();
      expect(ts!.fileCount).toBe(12);
      expect(ts!.confidence).toBe(1.0); // min(1, 12/10) = 1.0
      expect(ts!.evidence).toContain(".ts");

      const py = ctx.languages.find((l) => l.name === "Python");
      expect(py).toBeDefined();
      expect(py!.fileCount).toBe(1);
      expect(py!.confidence).toBeCloseTo(0.1, 5); // min(1, 1/10) = 0.1

      const rs = ctx.languages.find((l) => l.name === "Rust");
      expect(rs).toBeDefined();
      expect(rs!.fileCount).toBe(1);
      expect(rs!.confidence).toBeCloseTo(0.1, 5);
    } finally {
      await cleanup(root);
    }
  });

  it("confidence is min(1, fileCount/10)", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[`f${i}.go`] = "package main";
    }
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const go = ctx.languages.find((l) => l.name === "Go");
      expect(go!.fileCount).toBe(5);
      expect(go!.confidence).toBeCloseTo(0.5, 5);
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 3: package manager detection ---

describe("discover — package manager detection", () => {
  it("maps each lockfile to the correct package manager", async () => {
    const files: Record<string, string> = {
      "package-lock.json": "{}",
      "yarn.lock": "",
      "pnpm-lock.yaml": "",
      "bun.lock": "{}",
      "poetry.lock": "",
      "Cargo.lock": "",
      "go.sum": "",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const names = ctx.packageManagers.map((p) => p.name).sort();
      expect(names).toEqual(["bun", "cargo", "go", "npm", "pnpm", "poetry", "yarn"]);
    } finally {
      await cleanup(root);
    }
  });

  it("packageManager field overrides lockfile inference and sets version", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ packageManager: "bun@1.3.14" }),
      "bun.lock": "{}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const bun = ctx.packageManagers.find((p) => p.name === "bun");
      expect(bun).toBeDefined();
      expect(bun!.version).toBe("1.3.14");
      expect(bun!.evidence).toContain("package.json#packageManager");
      expect(bun!.evidence).toContain("bun.lock");
    } finally {
      await cleanup(root);
    }
  });

  it("version is null when packageManager has no version or lockfile only", async () => {
    const files: Record<string, string> = {
      "package-lock.json": "{}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const npm = ctx.packageManagers.find((p) => p.name === "npm");
      expect(npm!.version).toBeNull();
    } finally {
      await cleanup(root);
    }
  });

  it("packageManager field adds a PM even without a lockfile", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ packageManager: "pnpm@9.12.0" }),
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const pnpm = ctx.packageManagers.find((p) => p.name === "pnpm");
      expect(pnpm).toBeDefined();
      expect(pnpm!.version).toBe("9.12.0");
      expect(pnpm!.lockfile).toBeNull();
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 4: monorepo detection ---

describe("discover — monorepo detection", () => {
  it("nx.json → nx", async () => {
    const root = await makeFixtureDir({ "nx.json": "{}", "package.json": "{}" });
    installMockGit({ root, trackedFiles: ["nx.json", "package.json"] });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.monorepo).not.toBeNull();
      expect(ctx.monorepo!.tool).toBe("nx");
      expect(ctx.monorepo!.evidence).toContain("nx.json");
    } finally {
      await cleanup(root);
    }
  });

  it("pnpm-workspace.yaml → pnpm-workspace", async () => {
    const root = await makeFixtureDir({ "pnpm-workspace.yaml": "packages: []" });
    installMockGit({ root, trackedFiles: ["pnpm-workspace.yaml"] });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.monorepo!.tool).toBe("pnpm-workspace");
    } finally {
      await cleanup(root);
    }
  });

  it("root package.json workspaces with no other marker → custom", async () => {
    const root = await makeFixtureDir({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    });
    installMockGit({ root, trackedFiles: ["package.json"] });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.monorepo!.tool).toBe("custom");
      expect(ctx.monorepo!.workspaces).toEqual(["packages/*"]);
    } finally {
      await cleanup(root);
    }
  });

  it("root package.json workspaces + packageManager bun → bun-workspace", async () => {
    const root = await makeFixtureDir({
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        packageManager: "bun@1.3.14",
      }),
    });
    installMockGit({ root, trackedFiles: ["package.json"] });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.monorepo!.tool).toBe("bun-workspace");
    } finally {
      await cleanup(root);
    }
  });

  it("no monorepo markers → null", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    installMockGit({ root, trackedFiles: ["src/index.ts"] });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.monorepo).toBeNull();
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 5: git metadata ---

describe("discover — git metadata", () => {
  it("collects commit SHA, dirty state, and changed files when baseRef provided", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    installMockGit({
      root,
      trackedFiles: ["src/index.ts"],
      headSha: "abcdef1234567890abcdef1234567890abcdef12",
      diffNameStatus: "M\tsrc/index.ts\nA\tsrc/new.ts",
    });
    try {
      const ctx = await createPlanner().discover({ root, baseRef: "main" });
      expect(ctx.commit).toBe("abcdef1234567890abcdef1234567890abcdef12");
      expect(ctx.dirty).toBe(false);
      expect(ctx.changedFiles).toHaveLength(2);
      expect(ctx.changedFiles[0]).toEqual({ path: "src/index.ts", status: "modified" });
      expect(ctx.changedFiles[1]).toEqual({ path: "src/new.ts", status: "added" });
    } finally {
      await cleanup(root);
    }
  });

  it("changedFiles is empty when baseRef omitted; explanation notes it", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    installMockGit({ root, trackedFiles: ["src/index.ts"] });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.changedFiles).toEqual([]);
      expect(ctx.explanation.summary).toContain("no baseRef provided");
    } finally {
      await cleanup(root);
    }
  });

  it("dirty is true when porcelain has entries", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    installMockGit({
      root,
      trackedFiles: ["src/index.ts"],
      porcelainLines: [" M src/index.ts"],
    });
    try {
      const ctx = await createPlanner().discover({ root });
      expect(ctx.dirty).toBe(true);
      expect(ctx.explanation.summary).toContain("dirty");
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 6: explainability ---

describe("discover — explainability", () => {
  it("every signal increments signalCounts; summary is non-empty", async () => {
    const files: Record<string, string> = {
      "package.json": "{}",
      "bun.lock": "{}",
      "Dockerfile": "FROM node:24",
      "nx.json": "{}",
      ".github/workflows/ci.yml": "on: [push]",
      "src/index.ts": "export {}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const ctx = await createPlanner().discover({ root });
      const counts = ctx.explanation.signalCounts;
      expect(counts.manifest).toBe(1);
      expect(counts.lockfile).toBe(1);
      expect(counts.dockerfile).toBe(1);
      expect(counts["docker-compose"]).toBe(0);
      expect(counts["ci-definition"]).toBe(1);
      expect(counts["monorepo-marker"]).toBe(1);
      expect(counts["git-metadata"]).toBe(1);
      expect(ctx.explanation.summary.length).toBeGreaterThan(0);
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 7: determinism ---

describe("discover — determinism", () => {
  it("identical fixture + identical git mock → byte-identical ProjectContext", async () => {
    const files: Record<string, string> = {
      "package.json": "{}",
      "bun.lock": "{}",
      "src/index.ts": "export {}",
      "src/util.ts": "export {}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({
      root,
      trackedFiles: Object.keys(files),
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    try {
      const planner = createPlanner();
      const ctx1 = await planner.discover({ root });
      const ctx2 = await planner.discover({ root });
      expect(JSON.stringify(ctx1)).toBe(JSON.stringify(ctx2));
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 9: error cases ---

describe("discover — error cases", () => {
  it("ROOT_NOT_FOUND when root does not exist", async () => {
    installMockGit({ root: "/nonexistent" });
    await expect(
      createPlanner().discover({ root: "/nonexistent/path/that/does/not/exist" }),
    ).rejects.toMatchObject({ name: "DiscoveryError", code: "ROOT_NOT_FOUND" });
  });

  it("GIT_UNAVAILABLE when git --version throws ENOENT", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    installMockGit({ root, trackedFiles: ["src/index.ts"], gitUnavailable: true });
    try {
      await expect(createPlanner().discover({ root })).rejects.toMatchObject({
        name: "DiscoveryError",
        code: "GIT_UNAVAILABLE",
      });
    } finally {
      await cleanup(root);
    }
  });

  it("GIT_NOT_A_REPO when rev-parse --show-toplevel fails", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    installMockGit({ root, trackedFiles: ["src/index.ts"], notARepo: true });
    try {
      await expect(createPlanner().discover({ root })).rejects.toMatchObject({
        name: "DiscoveryError",
        code: "GIT_NOT_A_REPO",
      });
    } finally {
      await cleanup(root);
    }
  });

  it("TRAVERSAL_FAILED when baseRef does not resolve", async () => {
    const root = await makeFixtureDir({ "src/index.ts": "export {}" });
    // Custom mock: diff command rejects.
    mockedCreateGitCli.mockReturnValue({
      run(args) {
        const j = args.join(" ");
        if (j === "--version") return Promise.resolve("git version 2.43.0\n");
        if (j === "rev-parse --show-toplevel") return Promise.resolve(`${root}\n`);
        if (j === "ls-files") return Promise.resolve("src/index.ts\n");
        if (j === "status --porcelain") return Promise.resolve("");
        if (j === "rev-parse HEAD") return Promise.resolve("abc\n");
        if (args[0] === "diff") return Promise.reject(new Error("bad ref", { cause: "fatal: bad revision" }));
        return Promise.reject(new Error(`unhandled: ${j}`));
      },
    });
    try {
      await expect(
        createPlanner().discover({ root, baseRef: "nonexistent-ref" }),
      ).rejects.toMatchObject({ name: "DiscoveryError", code: "TRAVERSAL_FAILED" });
    } finally {
      await cleanup(root);
    }
  });
});

// --- Test plan 10: side-effect freedom ---

describe("discover — side-effect freedom", () => {
  it("does not write any file under root", async () => {
    const files: Record<string, string> = {
      "package.json": "{}",
      "bun.lock": "{}",
      "src/index.ts": "export {}",
    };
    const root = await makeFixtureDir(files);
    installMockGit({ root, trackedFiles: Object.keys(files) });
    try {
      const before = await listFiles(root);
      await createPlanner().discover({ root });
      const after = await listFiles(root);
      expect(after).toEqual(before);
    } finally {
      await cleanup(root);
    }
  });
});
