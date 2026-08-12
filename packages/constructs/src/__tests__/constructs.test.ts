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
});
