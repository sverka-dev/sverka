import { describe, it, expect } from "vitest";
import { importGithub, importGithubWithDiagnostics } from "../index.js";

describe("importGithub", () => {
  it("imports a simple GitHub workflow with a shell step", () => {
    const yaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: make build
`;
    const graph = importGithub(yaml);
    expect(graph.project.pipelines).toHaveLength(1);
    const pipeline = graph.project.pipelines[0]!;
    expect(pipeline.steps).toHaveLength(1);
    const step = pipeline.steps[0]!;
    expect(step.id).toBe("ci/build");
    const shellOp = step.operations.find((o) => o.kind === "shell");
    expect(shellOp).toBeDefined();
    if (shellOp!.kind === "shell") {
      expect(shellOp!.command).toBe("make build");
    }
  });

  it("imports job dependencies from needs", () => {
    const yaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: make build
  deploy:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - run: make deploy
`;
    const graph = importGithub(yaml);
    const pipeline = graph.project.pipelines[0]!;
    const deployStep = pipeline.steps.find((s) => s.id === "ci/deploy");
    expect(deployStep).toBeDefined();
    expect(deployStep!.dependencies).toContainEqual({
      kind: "control",
      producer: "ci/build",
    });
  });

  it("imports pull_request trigger as changeRequest", () => {
    const yaml = `
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: make build
`;
    const graph = importGithub(yaml);
    const pipeline = graph.project.pipelines[0]!;
    expect(pipeline.entries[0]!.trigger.kind).toBe("changeRequest");
  });

  it("imports release action as release operation", () => {
    const yaml = `
on: push
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: v1.0.0
          name: Release v1.0.0
          body: Release notes
`;
    const graph = importGithub(yaml);
    const pipeline = graph.project.pipelines[0]!;
    const step = pipeline.steps.find((s) => s.id === "ci/release");
    const releaseOp = step!.operations.find((o) => o.kind === "release");
    expect(releaseOp).toBeDefined();
    if (releaseOp!.kind === "release") {
      expect(releaseOp!.tag).toBe("v1.0.0");
      expect(releaseOp!.name).toBe("Release v1.0.0");
      expect(releaseOp!.description).toBe("Release notes");
    }
  });

  it("skips actions/checkout step", () => {
    const yaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build
`;
    const graph = importGithub(yaml);
    const pipeline = graph.project.pipelines[0]!;
    const step = pipeline.steps[0]!;
    const shellOps = step.operations.filter((o) => o.kind === "shell");
    expect(shellOps).toHaveLength(1);
  });

  it("produces diagnostics for unmapped actions", () => {
    const yaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: some/unknown-action@v1
      - run: make build
`;
    const result = importGithubWithDiagnostics(yaml);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const unmapped = result.diagnostics.find((d) => d.message.includes("unmapped"));
    expect(unmapped).toBeDefined();
  });
});
