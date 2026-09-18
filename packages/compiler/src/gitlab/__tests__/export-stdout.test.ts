// exportStdout lowering — a `fromStdout` artifact output must compile to a
// stdout capture on the preceding shell command plus an artifacts:paths
// entry, matching the runtime's writeStdoutArtifact semantics (the file is
// written even when the shell command exits non-zero).

import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { compileGitlab } from "../index.js";
import {
  makeStdoutArtifactGraph,
  makeDoubleStdoutArtifactGraph,
  makeWorkingDirStdoutGraph,
  makeBackgroundStdoutGraph,
} from "../../__tests__/stdout-graph.js";

describe("compileGitlab — exportStdout", () => {
  it("captures the shell command's stdout into the artifact file", () => {
    const result = compileGitlab(makeStdoutArtifactGraph());
    const yaml = parse(result.artifacts[0]!.content) as Record<
      string,
      { script?: string[] }
    >;
    const job = yaml["lint-sarif"];
    expect(job).toBeDefined();
    const script = job!.script!.join("\n");
    // stdout is redirected into the artifact file, replayed to the log, and
    // the original exit code is preserved even under POSIX sh (no pipefail).
    expect(script).toContain(
      "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
    );
    expect(script).toContain("> 'eslint.sarif'");
    expect(script).toContain("cat 'eslint.sarif'");
    expect(script).toContain('exit "$sverka_rc"');
  });

  it("exposes the captured stdout as a job artifact uploaded unconditionally", () => {
    const result = compileGitlab(makeStdoutArtifactGraph());
    const yaml = parse(result.artifacts[0]!.content) as Record<
      string,
      { artifacts?: { paths?: string[]; when?: string } }
    >;
    const job = yaml["lint-sarif"]!;
    // The runtime writes the stdout artifact even on step failure, so the
    // upload must not be limited to on_success.
    expect(job.artifacts?.paths).toContain("eslint.sarif");
    expect(job.artifacts?.when).toBe("always");
  });

  it("writes one stdout capture when several fromStdout outputs share a command", () => {
    const result = compileGitlab(makeDoubleStdoutArtifactGraph());
    const yaml = parse(result.artifacts[0]!.content) as Record<
      string,
      { script?: string[]; artifacts?: { paths?: string[] } }
    >;
    const job = yaml["lint-sarif"]!;
    const script = job.script!.join("\n");
    expect(script).toContain("> 'eslint.sarif'");
    expect(script).toContain("tee 'eslint-copy.sarif'");
    expect(job.artifacts?.paths).toEqual(
      expect.arrayContaining(["eslint.sarif", "eslint-copy.sarif"]),
    );
  });

  it("resolves the artifact path inside the step working directory", () => {
    const yaml = parse(
      compileGitlab(makeWorkingDirStdoutGraph()).artifacts[0]!.content,
    ) as Record<
      string,
      { script?: string[]; artifacts?: { paths?: string[] } }
    >;
    const job = yaml["lint-sarif"]!;
    // The script cds into the working directory first, so the file lands at
    // packages/app/eslint.sarif — artifacts:paths must point there.
    expect(job.script![0]).toContain("cd 'packages/app'");
    expect(job.artifacts?.paths).toContain("packages/app/eslint.sarif");
  });

  it("emits an empty artifact for a background shell (runtime records empty stdout)", () => {
    const yaml = parse(
      compileGitlab(makeBackgroundStdoutGraph()).artifacts[0]!.content,
    ) as Record<string, { script?: string[] }>;
    const script = yaml["server"]!.script!.join("\n");
    expect(script).toContain("npm start &");
    expect(script).toContain("touch 'server.log'");
    expect(script).not.toContain("sverka_rc");
  });

  it("throws when a fromStdout output has no preceding shell operation", () => {
    const graph = makeStdoutArtifactGraph();
    const step = graph.project.pipelines[0]!.steps.find(
      (s) => s.id === "ci/lint-sarif",
    )!;
    const ops = [...step.operations];
    (step.operations as unknown[]).splice(0, ops.length, ...ops.reverse());
    expect(() => compileGitlab(graph)).toThrowError(
      /no shell output was captured|no preceding shell/i,
    );
  });
});
