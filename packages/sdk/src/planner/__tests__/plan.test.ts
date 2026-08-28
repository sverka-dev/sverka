import { describe, it, expect } from "vitest";
import { createPlanner } from "../planner.js";
import type { ProjectContext, DetectedLanguage, DetectedPackageManager, LocalSignal } from "../planner.js";

function makeContext(opts: {
  languages?: DetectedLanguage[];
  packageManagers?: DetectedPackageManager[];
  signals?: LocalSignal[];
}): ProjectContext {
  return {
    root: "/tmp/project",
    commit: "abc123",
    dirty: false,
    changedFiles: [],
    languages: opts.languages ?? [],
    packageManagers: opts.packageManagers ?? [],
    hasContainerBuild: false,
    hasCiDefinition: false,
    monorepo: null,
    localSignals: opts.signals ?? [],
    explanation: { summary: "test", signalCounts: {
      manifest: 0, lockfile: 0, dockerfile: 0, "docker-compose": 0,
      "ci-definition": 0, "monorepo-marker": 0, "git-metadata": 0,
    } },
  };
}

describe("plan — synthesis", () => {
  it("Node project proposes typecheck/lint/test", async () => {
    const ctx = makeContext({
      languages: [{ name: "TypeScript", confidence: 1.0, evidence: [".ts"], fileCount: 15 }],
      packageManagers: [{ name: "bun", version: "1.3.14", lockfile: "bun.lock", evidence: ["bun.lock"] }],
      signals: [
        { type: "manifest", path: "package.json", detail: null, confidence: 1.0 },
        { type: "lockfile", path: "bun.lock", detail: null, confidence: 1.0 },
      ],
    });
    const proposal = await createPlanner().plan(ctx);
    const checkIds = proposal.checks.map((c) => c.checkId).sort();
    expect(checkIds).toEqual(["lint", "test", "typecheck"]);
    expect(proposal.workflowPath).toBeNull();
  });

  it("Python project proposes lint/test", async () => {
    const ctx = makeContext({
      languages: [{ name: "Python", confidence: 0.5, evidence: [".py"], fileCount: 5 }],
      packageManagers: [{ name: "poetry", version: null, lockfile: "poetry.lock", evidence: ["poetry.lock"] }],
      signals: [
        { type: "manifest", path: "pyproject.toml", detail: null, confidence: 1.0 },
        { type: "lockfile", path: "poetry.lock", detail: null, confidence: 1.0 },
      ],
    });
    const proposal = await createPlanner().plan(ctx);
    const checkIds = proposal.checks.map((c) => c.checkId).sort();
    expect(checkIds).toEqual(["lint", "test"]);
  });

  it("Rust project proposes fmt-check/clippy/test", async () => {
    const ctx = makeContext({
      languages: [{ name: "Rust", confidence: 0.3, evidence: [".rs"], fileCount: 3 }],
      packageManagers: [{ name: "cargo", version: null, lockfile: "Cargo.lock", evidence: ["Cargo.lock"] }],
      signals: [
        { type: "manifest", path: "Cargo.toml", detail: null, confidence: 1.0 },
        { type: "lockfile", path: "Cargo.lock", detail: null, confidence: 1.0 },
      ],
    });
    const proposal = await createPlanner().plan(ctx);
    const checkIds = proposal.checks.map((c) => c.checkId).sort();
    expect(checkIds).toEqual(["clippy", "fmt-check", "test"]);
  });

  it("Go project proposes vet/test", async () => {
    const ctx = makeContext({
      languages: [{ name: "Go", confidence: 0.5, evidence: [".go"], fileCount: 5 }],
      packageManagers: [{ name: "go", version: null, lockfile: "go.sum", evidence: ["go.sum"] }],
      signals: [
        { type: "manifest", path: "go.mod", detail: null, confidence: 1.0 },
        { type: "lockfile", path: "go.sum", detail: null, confidence: 1.0 },
      ],
    });
    const proposal = await createPlanner().plan(ctx);
    const checkIds = proposal.checks.map((c) => c.checkId).sort();
    expect(checkIds).toEqual(["test", "vet"]);
  });

  it("empty context proposes no checks with explanatory note", async () => {
    const ctx = makeContext({});
    const proposal = await createPlanner().plan(ctx);
    expect(proposal.checks).toEqual([]);
    expect(proposal.notes.length).toBeGreaterThan(0);
    expect(proposal.notes[0]).toContain("No default checks");
  });

  it("proposed check ids are stable and deterministic", async () => {
    const ctx = makeContext({
      languages: [{ name: "TypeScript", confidence: 1.0, evidence: [".ts"], fileCount: 10 }],
      packageManagers: [{ name: "npm", version: null, lockfile: "package-lock.json", evidence: ["package-lock.json"] }],
      signals: [
        { type: "manifest", path: "package.json", detail: null, confidence: 1.0 },
      ],
    });
    const p1 = await createPlanner().plan(ctx);
    const p2 = await createPlanner().plan(ctx);
    expect(p1.checks.map((c) => c.id)).toEqual(p2.checks.map((c) => c.id));
    // id format: prop-<16 hex chars>
    for (const check of p1.checks) {
      expect(check.id).toMatch(/^prop-[0-9a-f]{16}$/);
    }
  });

  it("signalRef points at the triggering manifest/lockfile signal", async () => {
    const ctx = makeContext({
      languages: [{ name: "TypeScript", confidence: 1.0, evidence: [".ts"], fileCount: 10 }],
      packageManagers: [{ name: "bun", version: null, lockfile: "bun.lock", evidence: ["bun.lock"] }],
      signals: [
        { type: "manifest", path: "package.json", detail: null, confidence: 1.0 },
        { type: "lockfile", path: "bun.lock", detail: null, confidence: 1.0 },
      ],
    });
    const proposal = await createPlanner().plan(ctx);
    for (const check of proposal.checks) {
      expect(check.signalRef).not.toBeNull();
      expect(check.signalRef === "manifest:package.json" || check.signalRef === "lockfile:bun.lock").toBe(true);
    }
  });

  it("all proposed checks have priority 2", async () => {
    const ctx = makeContext({
      languages: [{ name: "Rust", confidence: 1.0, evidence: [".rs"], fileCount: 10 }],
      packageManagers: [{ name: "cargo", version: null, lockfile: "Cargo.lock", evidence: ["Cargo.lock"] }],
      signals: [{ type: "manifest", path: "Cargo.toml", detail: null, confidence: 1.0 }],
    });
    const proposal = await createPlanner().plan(ctx);
    for (const check of proposal.checks) {
      expect(check.priority).toBe(2);
    }
  });
});
