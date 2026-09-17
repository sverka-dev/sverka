// exportStdout lowering — a `fromStdout` artifact output must compile to a
// stdout capture on the preceding shell command plus an upload-artifact
// step, matching the runtime's writeStdoutArtifact semantics (the file is
// written even when the shell command exits non-zero).

import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  synthesize,
} from "@sverka/workflow";
import { compileGithub } from "../index.js";

function makeStdoutArtifactGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint-sarif", {
    command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
    runtime: { shell: "sh" },
    outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
  });
  new Entry(p, "on-push", {
    trigger: { kind: "push" },
    roots: ["lint-sarif"],
  });
  return synthesize(proj);
}

function makeDoubleStdoutArtifactGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint-sarif", {
    command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
    outputs: {
      "eslint.sarif": { type: "artifact", fromStdout: true },
      "eslint-copy.sarif": { type: "artifact", fromStdout: true },
    },
  });
  new Entry(p, "on-push", {
    trigger: { kind: "push" },
    roots: ["lint-sarif"],
  });
  return synthesize(proj);
}

describe("compileGithub — exportStdout", () => {
  it("captures the shell command's stdout into the artifact file", () => {
    const result = compileGithub(makeStdoutArtifactGraph());
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, { steps: { run?: string; uses?: string }[] }>;
    };
    const job = yaml.jobs["lint-sarif"];
    expect(job).toBeDefined();
    const runStep = job!.steps.find(
      (s) =>
        s.run?.includes(
          "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
        ),
    );
    expect(runStep).toBeDefined();
    // stdout is redirected into the artifact file, replayed to the log, and
    // the original exit code is preserved even under POSIX sh (no pipefail).
    expect(runStep!.run).toContain("> 'eslint.sarif'");
    expect(runStep!.run).toContain("cat 'eslint.sarif'");
    expect(runStep!.run).toContain('exit "$sverka_rc"');
  });

  it("uploads the captured stdout as a job artifact with if: always()", () => {
    const result = compileGithub(makeStdoutArtifactGraph());
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<
        string,
        {
          steps: {
            uses?: string;
            if?: string;
            with?: { name?: string; path?: string };
          }[];
        }
      >;
    };
    const job = yaml.jobs["lint-sarif"]!;
    const upload = job.steps.find(
      (s) => s.uses === "actions/upload-artifact@v4",
    );
    expect(upload).toBeDefined();
    // The runtime writes the stdout artifact even on step failure, so the
    // upload must run unconditionally.
    expect(upload!.if).toBe("always()");
    expect(upload!.with?.name).toBe("lint-sarif-eslint.sarif");
    expect(upload!.with?.path).toBe("eslint.sarif");
  });

  it("writes one stdout capture when several fromStdout outputs share a command", () => {
    const result = compileGithub(makeDoubleStdoutArtifactGraph());
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, { steps: { run?: string; uses?: string }[] }>;
    };
    const job = yaml.jobs["lint-sarif"]!;
    const runStep = job.steps.find((s) => s.run?.includes("bunx eslint"));
    expect(runStep).toBeDefined();
    expect(runStep!.run).toContain("> 'eslint.sarif'");
    expect(runStep!.run).toContain("tee 'eslint-copy.sarif'");
    const uploads = job.steps.filter(
      (s) => s.uses === "actions/upload-artifact@v4",
    );
    expect(uploads).toHaveLength(2);
  });

  it("throws when a fromStdout output has no preceding shell operation", () => {
    const graph = makeStdoutArtifactGraph();
    const step = graph.project.pipelines[0]!.steps.find(
      (s) => s.id === "ci/lint-sarif",
    )!;
    const ops = [...step.operations];
    (step.operations as unknown[]).splice(0, ops.length, ...ops.reverse());
    expect(() => compileGithub(graph)).toThrowError(
      /no shell output was captured|no preceding shell/i,
    );
  });
});
