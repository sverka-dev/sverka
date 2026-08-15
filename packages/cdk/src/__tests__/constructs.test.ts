import { describe, it, expect } from "vitest";
import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  push,
  ConstructError,
  type StepProps,
} from "../index.js";

describe("Project", () => {
  it("creates root construct with node.path === id", () => {
    const proj = new Project("myproj");
    expect(proj.node.path).toBe("myproj");
    expect(proj.node.scope).toBeUndefined();
  });
});

describe("Pipeline", () => {
  it("creates pipeline under Project with correct path", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    expect(pipeline.node.path).toBe("myproj/ci");
    expect(pipeline.inputs.size).toBe(0);
  });

  it("stores inputs from props", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      inputs: { version: { type: "string" } },
    });
    expect(pipeline.inputs.get("version")?.type).toBe("string");
  });
});

describe("ShellStep", () => {
  it("creates step under Pipeline holding command and props", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      runtime: { mode: "host" },
      outputs: { dist: { type: "artifact", path: "./dist" } },
      inputs: [],
      dependsOn: [],
      timeout: 60000,
    });
    expect(step.node.path).toBe("myproj/ci/build");
    expect(step.command).toBe("npm run build");
    expect(step.runtime.mode).toBe("host");
    expect(step.outputs.get("dist")?.type).toBe("artifact");
    expect(step.dependsOn).toEqual([]);
    expect(step.timeout).toBe(60000);
  });

  it("stores interruptible flag when set true", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      interruptible: true,
    });
    expect(step.interruptible).toBe(true);
  });

  it("stores interruptible flag when set false", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "deploy", {
      command: "npm run deploy",
      interruptible: false,
    });
    expect(step.interruptible).toBe(false);
  });

  it("leaves interruptible undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.interruptible).toBeUndefined();
  });
});

describe("Pipeline — permissions", () => {
  it("stores permissions when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      permissions: { contents: "read", "id-token": "write" },
    });
    expect(pipeline.permissions).toEqual({ contents: "read", "id-token": "write" });
  });

  it("leaves permissions undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    expect(pipeline.permissions).toBeUndefined();
  });
});

describe("Pipeline — defaults", () => {
  it("stores defaults when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      defaults: { shell: "bash", workdir: "./src", beforeScript: ["install-deps"] },
    });
    expect(pipeline.defaults).toEqual({
      shell: "bash",
      workdir: "./src",
      beforeScript: ["install-deps"],
    });
  });

  it("leaves defaults undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    expect(pipeline.defaults).toBeUndefined();
  });
});

describe("Pipeline — typed inputs", () => {
  it("stores choice input with options", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      inputs: {
        environment: {
          type: "choice",
          options: ["staging", "production"],
          required: true,
        },
      },
    });
    expect(pipeline.inputs.get("environment")).toEqual({
      type: "choice",
      options: ["staging", "production"],
      required: true,
    });
  });

  it("stores string input with pattern", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      inputs: {
        version: {
          type: "string",
          pattern: "^v\\d+\\.\\d+\\.\\d+$",
        },
      },
    });
    expect(pipeline.inputs.get("version")).toEqual({
      type: "string",
      pattern: "^v\\d+\\.\\d+\\.\\d+$",
    });
  });

  it("stores array input with default", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      inputs: {
        targets: {
          type: "array",
          default: ["build", "test"],
        },
      },
    });
    expect(pipeline.inputs.get("targets")).toEqual({
      type: "array",
      default: ["build", "test"],
    });
  });
});

describe("ShellStep — runner", () => {
  it("stores runner spec when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      runner: { labels: ["linux", "x64"] },
    });
    expect(step.runner).toEqual({ labels: ["linux", "x64"] });
  });

  it("stores runner with group", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      runner: { labels: ["self-hosted", "linux"], group: "my-group" },
    });
    expect(step.runner?.group).toBe("my-group");
  });

  it("leaves runner undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.runner).toBeUndefined();
  });
});

describe("ShellStep — identity", () => {
  it("stores identity spec when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "deploy", {
      command: "deploy",
      identity: { tokens: { AWS_TOKEN: { audience: "https://sts.amazonaws.com" } } },
    });
    expect(step.identity).toEqual({
      tokens: { AWS_TOKEN: { audience: "https://sts.amazonaws.com" } },
    });
  });

  it("leaves identity undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.identity).toBeUndefined();
  });
});

describe("ShellStep — rules", () => {
  it("stores rules when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      rules: [
        { if: "$BRANCH == main", changes: ["src/**"] },
        { when: "never" },
      ],
    });
    expect(step.rules).toEqual([
      { if: "$BRANCH == main", changes: ["src/**"] },
      { when: "never" },
    ]);
  });

  it("leaves rules undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.rules).toBeUndefined();
  });
});

describe("ShellStep — reports", () => {
  it("stores reports when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      reports: [
        { type: "junit", path: "test-results.xml" },
        { type: "coverage", path: "coverage.xml", format: "cobertura" },
      ],
    });
    expect(step.reports).toEqual([
      { type: "junit", path: "test-results.xml" },
      { type: "coverage", path: "coverage.xml", format: "cobertura" },
    ]);
  });

  it("leaves reports undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.reports).toBeUndefined();
  });
});

describe("ShellStep — services", () => {
  it("stores services when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "test", {
      command: "make test",
      services: [
        { name: "postgres", image: "postgres:16", env: { POSTGRES_PASSWORD: "secret" }, ports: [5432] },
        { name: "redis", image: "redis:7", ports: [6379] },
      ],
    });
    expect(step.services).toEqual([
      { name: "postgres", image: "postgres:16", env: { POSTGRES_PASSWORD: "secret" }, ports: [5432] },
      { name: "redis", image: "redis:7", ports: [6379] },
    ]);
  });

  it("leaves services undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.services).toBeUndefined();
  });
});

describe("ShellStep — environment", () => {
  it("stores environment spec when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "deploy", {
      command: "deploy",
      environment: { name: "production", url: "https://app.example.com", tier: "production" },
    });
    expect(step.environment).toEqual({
      name: "production",
      url: "https://app.example.com",
      tier: "production",
    });
  });

  it("leaves environment undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.environment).toBeUndefined();
  });
});

describe("ShellStep — cache", () => {
  it("stores cache spec when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      cache: {
        paths: ["node_modules", ".cache"],
        key: "node-${hashFiles('bun.lock')}",
        restoreKeys: ["node-"],
        policy: "pull-push",
      },
    });
    expect(step.cache).toEqual({
      paths: ["node_modules", ".cache"],
      key: "node-${hashFiles('bun.lock')}",
      restoreKeys: ["node-"],
      policy: "pull-push",
    });
  });

  it("leaves cache undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.cache).toBeUndefined();
  });
});

describe("ShellStep — concurrency", () => {
  it("stores concurrency spec when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "deploy", {
      command: "deploy",
      concurrency: { group: "production", cancelInProgress: true },
    });
    expect(step.concurrency).toEqual({ group: "production", cancelInProgress: true });
  });

  it("leaves concurrency undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", { command: "npm run build" });
    expect(step.concurrency).toBeUndefined();
  });
});

describe("Pipeline — concurrency", () => {
  it("stores pipeline-level concurrency when set", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci", {
      concurrency: { group: "deploy-${{ git.branch }}", cancelInProgress: true },
    });
    expect(pipeline.concurrency).toEqual({ group: "deploy-${{ git.branch }}", cancelInProgress: true });
  });

  it("leaves pipeline concurrency undefined when omitted", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    expect(pipeline.concurrency).toBeUndefined();
  });
});

describe("Entry", () => {
  it("creates entry under Pipeline holding trigger and roots", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const entry = new Entry(pipeline, "on-push", {
      trigger: push({ branches: ["main"] }),
      roots: ["build"],
    });
    expect(entry.node.path).toBe("myproj/ci/on-push");
    expect(entry.trigger.kind).toBe("push");
    expect(entry.roots).toEqual(["build"]);
  });
});

describe("Construct tree traversal", () => {
  it("project.node.children returns Pipelines; pipeline.node.children returns Steps and Entries", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    new ShellStep(pipeline, "build", { command: "npm run build" });
    new ShellStep(pipeline, "test", { command: "npm test" });
    new Entry(pipeline, "on-push", { trigger: push(), roots: ["build"] });

    expect(proj.node.children.length).toBe(1);
    expect(proj.node.children[0]).toBeInstanceOf(Pipeline);

    expect(pipeline.node.children.length).toBe(3);
    expect(pipeline.node.children.filter((c) => c instanceof ShellStep).length).toBe(2);
    expect(pipeline.node.children.filter((c) => c instanceof Entry).length).toBe(1);
  });
});

describe("Error handling", () => {
  it("duplicate child id throws ConstructError(DUPLICATE_ID)", () => {
    const proj = new Project("myproj");
    new Pipeline(proj, "ci");
    expect(() => new Pipeline(proj, "ci")).toThrow(ConstructError);
    try {
      new Pipeline(proj, "ci");
    } catch (err) {
      expect(err).toBeInstanceOf(ConstructError);
      expect((err as ConstructError).code).toBe("DUPLICATE_ID");
    }
  });

  it("Step under Project (wrong scope) throws ConstructError(INVALID_SCOPE)", () => {
    const proj = new Project("myproj");
    expect(() =>
      new ShellStep(proj as unknown as Pipeline, "build", { command: "echo hi" }),
    ).toThrow(ConstructError);
    try {
      new ShellStep(proj as unknown as Pipeline, "build", { command: "echo hi" });
    } catch (err) {
      expect((err as ConstructError).code).toBe("INVALID_SCOPE");
    }
  });

  it("Pipeline under non-Project throws ConstructError(INVALID_SCOPE)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    expect(() =>
      new Pipeline(pipeline as unknown as Project, "nested"),
    ).toThrow(ConstructError);
  });

  it("artifact output without path throws ConstructError(INVALID_OUTPUT)", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    expect(() =>
      new ShellStep(pipeline, "build", {
        command: "npm run build",
        outputs: { dist: { type: "artifact" } },
      }),
    ).toThrow(ConstructError);
    try {
      new ShellStep(pipeline, "build2", {
        command: "npm run build",
        outputs: { dist: { type: "artifact" } },
      });
    } catch (err) {
      expect((err as ConstructError).code).toBe("INVALID_OUTPUT");
    }
  });

  it("artifact output stores retention and access", () => {
    const proj = new Project("myproj");
    const pipeline = new Pipeline(proj, "ci");
    const step = new ShellStep(pipeline, "build", {
      command: "npm run build",
      outputs: { dist: { type: "artifact", path: "dist/", retention: "7d", access: "developer" } },
    });
    expect(step.outputs.get("dist")?.retention).toBe("7d");
    expect(step.outputs.get("dist")?.access).toBe("developer");
  });
});
