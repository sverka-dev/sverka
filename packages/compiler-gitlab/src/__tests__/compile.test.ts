import { describe, it, expect } from "vitest";
import { compileGitlabCi } from "../compile.js";
import { makePlan } from "./helpers/fixtures.js";

describe("compileGitlabCi — default config", () => {
  it("produces YAML with expected default structure", () => {
    const yaml = compileGitlabCi(makePlan());
    expect(yaml).toContain("stages:");
    expect(yaml).toContain("- verify");
    expect(yaml).toContain("sverka:");
    expect(yaml).toContain("stage: verify");
    expect(yaml).toContain("image: oven/bun:latest");
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "push"');
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "merge_request_event"');
    expect(yaml).toContain("bun install -g sverka@latest");
    expect(yaml).toContain("sverka execute");
    expect(yaml).not.toContain("sverka execute .sverka/plan.json");
    expect(yaml).toContain("when: always");
    expect(yaml).toContain(".sverka/output/");
  });
});

describe("compileGitlabCi — custom config", () => {
  it("reflects custom image and sverkaVersion", () => {
    const yaml = compileGitlabCi(makePlan(), {
      image: "node:22",
      sverkaVersion: "0.1.0",
    });
    expect(yaml).toContain("image: node:22");
    expect(yaml).toContain("bun install -g sverka@0.1.0");
  });
});

describe("compileGitlabCi — custom rules", () => {
  it("reflects custom if conditions and when values", () => {
    const yaml = compileGitlabCi(makePlan(), {
      rules: [
        { if: '$CI_COMMIT_BRANCH == "main"', when: "on_success" },
        { if: '$CI_PIPELINE_SOURCE == "schedule"', when: "manual" },
      ],
    });
    expect(yaml).toContain('$CI_COMMIT_BRANCH == "main"');
    expect(yaml).toContain("when: on_success");
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "schedule"');
    expect(yaml).toContain("when: manual");
    // Default rules should NOT appear
    expect(yaml).not.toContain("merge_request_event");
  });
});

describe("compileGitlabCi — empty rules filtered", () => {
  it("filters out empty rule objects that would produce invalid GitLab YAML", () => {
    const yaml = compileGitlabCi(makePlan(), {
      rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }, {}, { when: "manual" }],
    });
    expect(yaml).toContain('$CI_COMMIT_BRANCH == "main"');
    expect(yaml).toContain("when: manual");
    // Empty rule should not produce a bare `-` entry
    const bareDash = /-\s*\n\s*-\s/;
    expect(yaml).not.toMatch(bareDash);
  });
});

describe("compileGitlabCi — determinism", () => {
  it("same plan + config → identical YAML", () => {
    const plan = makePlan();
    const a = compileGitlabCi(plan);
    const b = compileGitlabCi(plan);
    expect(a).toBe(b);
  });
});

describe("compileGitlabCi — empty operations", () => {
  it("produces valid YAML for empty plan", () => {
    const yaml = compileGitlabCi(makePlan({ operations: [] }));
    expect(yaml).toContain("sverka execute");
    expect(yaml).toContain("sverka:");
  });
});
