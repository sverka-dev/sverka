import { describe, it, expect } from "vitest";
import { compileGithubWorkflow } from "../compile.js";
import { makePlan, makeOperation } from "./helpers/fixtures.js";

describe("compileGithubWorkflow — default config", () => {
  it("produces YAML with expected default structure", () => {
    const yaml = compileGithubWorkflow(makePlan());
    expect(yaml).toContain("name: Sverka");
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain('node-version: "24"');
    expect(yaml).toContain("bun install -g sverka@latest");
    expect(yaml).toContain("sverka execute");
    expect(yaml).not.toContain("sverka execute .sverka/plan.json");
    expect(yaml).toContain("actions/checkout@v4");
    expect(yaml).toContain("actions/setup-node@v4");
    expect(yaml).toContain("oven-sh/setup-bun@v2");
    expect(yaml).toContain("actions/upload-artifact@v4");
    expect(yaml).toContain("if: always()");
    expect(yaml).toContain("contents: read");
  });

  it("emits push on main and pull_request by default", () => {
    const yaml = compileGithubWorkflow(makePlan());
    expect(yaml).toContain("push:");
    expect(yaml).toContain("main");
    expect(yaml).toContain("pull_request");
  });
});

describe("compileGithubWorkflow — custom config", () => {
  it("reflects custom name, runner, versions", () => {
    const yaml = compileGithubWorkflow(makePlan(), {
      name: "My CI",
      runner: "ubuntu-24.04",
      sverkaVersion: "0.1.0",
      nodeVersion: "22",
    });
    expect(yaml).toContain("name: My CI");
    expect(yaml).toContain("runs-on: ubuntu-24.04");
    expect(yaml).toContain('node-version: "22"');
    expect(yaml).toContain("bun install -g sverka@0.1.0");
  });
});

describe("compileGithubWorkflow — triggers", () => {
  it("emits workflow_dispatch and custom branches", () => {
    const yaml = compileGithubWorkflow(makePlan(), {
      on: {
        push: ["main", "develop"],
        pullRequest: ["main"],
        workflowDispatch: true,
      },
    });
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain("develop");
    expect(yaml).toContain("pull_request:");
  });
});

describe("compileGithubWorkflow — credentials", () => {
  it("emits env block for declared credentials", () => {
    const plan = makePlan({
      operations: [
        makeOperation({
          credentials: [{ name: "token", envVar: "API_TOKEN", required: true }],
        }),
        makeOperation({
          id: "op-2",
          name: "lint",
          credentials: [{ name: "key", envVar: "SECRET_KEY", required: true }],
        }),
      ],
    });
    const yaml = compileGithubWorkflow(plan);
    expect(yaml).toContain("API_TOKEN: ${{ secrets.API_TOKEN }}");
    expect(yaml).toContain("SECRET_KEY: ${{ secrets.SECRET_KEY }}");
  });

  it("omits env block when no credentials", () => {
    const yaml = compileGithubWorkflow(makePlan());
    expect(yaml).not.toContain("env:");
  });

  it("deduplicates envVars across operations", () => {
    const plan = makePlan({
      operations: [
        makeOperation({
          credentials: [{ name: "t", envVar: "TOKEN", required: true }],
        }),
        makeOperation({
          id: "op-2",
          name: "lint",
          credentials: [{ name: "t2", envVar: "TOKEN", required: true }],
        }),
      ],
    });
    const yaml = compileGithubWorkflow(plan);
    const matches = yaml.match(/TOKEN:/g);
    expect(matches).toHaveLength(1);
  });
});

describe("compileGithubWorkflow — permissions", () => {
  it("reflects custom permissions", () => {
    const yaml = compileGithubWorkflow(makePlan(), {
      permissions: { contents: "write", securityEvents: "write" },
    });
    expect(yaml).toContain("contents: write");
    expect(yaml).toContain("security-events: write");
  });
});

describe("compileGithubWorkflow — determinism", () => {
  it("same plan + config → identical YAML", () => {
    const plan = makePlan();
    const a = compileGithubWorkflow(plan);
    const b = compileGithubWorkflow(plan);
    expect(a).toBe(b);
  });
});

describe("compileGithubWorkflow — empty operations", () => {
  it("produces valid YAML for empty plan", () => {
    const yaml = compileGithubWorkflow(makePlan({ operations: [] }));
    expect(yaml).toContain("sverka execute");
    expect(yaml).toContain("jobs:");
  });
});
