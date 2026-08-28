import { describe, it, expect } from "vitest";
import { importGitlab, importGitlabWithDiagnostics } from "../index.js";

describe("importGitlab", () => {
  it("imports a simple GitLab CI config with a shell job", () => {
    const yaml = `
build:
  stage: build
  script: make build
`;
    const graph = importGitlab(yaml);
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
build:
  script: make build
deploy:
  script: make deploy
  needs: [build]
`;
    const graph = importGitlab(yaml);
    const pipeline = graph.project.pipelines[0]!;
    const deployStep = pipeline.steps.find((s) => s.id === "ci/deploy");
    expect(deployStep).toBeDefined();
    expect(deployStep!.dependencies).toContainEqual({
      kind: "control",
      producer: "ci/build",
    });
  });

  it("imports workflow:rules as pipeline rules", () => {
    const yaml = `
workflow:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      variables:
        DEPLOY_TARGET: production
    - when: never
build:
  script: make build
`;
    const graph = importGitlab(yaml);
    const pipeline = graph.project.pipelines[0]!;
    expect(pipeline.rules).toBeDefined();
    expect(pipeline.rules).toHaveLength(2);
    expect(pipeline.rules![0]!.if).toBe('$CI_COMMIT_BRANCH == "main"');
    expect(pipeline.rules![1]!.when).toBe("never");
  });

  it("imports release keyword as release operation", () => {
    const yaml = `
release_job:
  release:
    tag_name: v1.0.0
    name: Release v1.0.0
    description: Release notes
  script: echo "Creating release"
`;
    const graph = importGitlab(yaml);
    const pipeline = graph.project.pipelines[0]!;
    const step = pipeline.steps.find((s) => s.id === "ci/release_job");
    const releaseOp = step!.operations.find((o) => o.kind === "release");
    expect(releaseOp).toBeDefined();
    if (releaseOp!.kind === "release") {
      expect(releaseOp!.tag).toBe("v1.0.0");
      expect(releaseOp!.name).toBe("Release v1.0.0");
    }
  });

  it("produces diagnostics for unmappable constructs", () => {
    const yaml = `
build:
  script: make build
  cache:
    paths: [node_modules/]
  services:
    - docker:dind
`;
    const result = importGitlabWithDiagnostics(yaml);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const cacheDiag = result.diagnostics.find((d) => d.message.includes("cache"));
    expect(cacheDiag).toBeDefined();
  });

  it("creates a default entry for imported jobs", () => {
    const yaml = `
build:
  script: make build
`;
    const graph = importGitlab(yaml);
    const pipeline = graph.project.pipelines[0]!;
    expect(pipeline.entries).toHaveLength(1);
    expect(pipeline.entries[0]!.trigger.kind).toBe("push");
  });
});
