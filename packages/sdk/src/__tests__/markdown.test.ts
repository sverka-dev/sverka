// Specs 37 + 54 — .sverka.md authoring: frontmatter, trigger parity
// (including comment/issue), step sections, extends, and error paths.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize } from "@sverka/workflow";
import { parseMarkdown, loadMarkdownFile } from "../markdown.js";
import { MarkdownParseError } from "../markdown-errors.js";

// Resolve @sverka/workflow's dist URL so extends files in tmpdirs (no
// node_modules chain) can import the same copy the SDK uses.
const WORKFLOW_URL = import.meta.resolve("@sverka/workflow");

const HEADER = `---
pipeline: ci
---
`;

describe("parseMarkdown — frontmatter + steps (Spec 37)", () => {
  it("parses a pipeline with shell steps and synthesizes a graph", () => {
    const project = parseMarkdown(`${HEADER}
## build
- command: make build

## test
- command: make test
- dependsOn: [build]
`);
    const graph = synthesize(project);
    const pipeline = graph.project.pipelines.find((p) => p.id === "ci")!;
    expect(pipeline).toBeDefined();
    const ids = pipeline.steps.map((s) => s.id);
    expect(ids).toContain("ci/build");
    expect(ids).toContain("ci/test");
    const test = pipeline.steps.find((s) => s.id === "ci/test")!;
    expect(test.dependencies).toEqual([
      { kind: "control", producer: "ci/build" },
    ]);
  });

  it("step options: image → container runtime, timeout, outputs", () => {
    const project = parseMarkdown(`${HEADER}
## build
- command: make build
- image: node:22
- timeout: 60000
- outputs:
    report:
      kind: file
      path: out/report.json
`);
    const pipeline = synthesize(project).project.pipelines[0]!;
    const step = pipeline.steps.find((s) => s.id === "ci/build")!;
    expect(step.runtime.mode).toBe("container");
    expect(step.runtime.image).toBe("node:22");
    expect(step.timeout).toBe(60000);
  });

  it("pipeline inputs from frontmatter", () => {
    const project = parseMarkdown(`---
pipeline: ci
inputs:
  sha:
    kind: literal
    value: abc123
---
## build
- command: make
`);
    const pipeline = synthesize(project).project.pipelines[0]!;
    expect(pipeline.inputs["sha"]).toBeDefined();
  });
});

describe("parseMarkdown — triggers (Spec 37 + Spec 54 parity)", () => {
  function triggerOf(md: string) {
    const pipeline = synthesize(parseMarkdown(md)).project.pipelines[0]!;
    return pipeline.entries.map((e) => e.trigger);
  }

  it("triggers: array parses push/changeRequest/manual/schedule", () => {
    const triggers = triggerOf(`---
pipeline: ci
triggers:
  - kind: push
    branches: [main]
  - kind: changeRequest
  - kind: manual
  - kind: schedule
    cron: "0 9 * * *"
    timezone: UTC
---
## build
- command: make
`);
    expect(triggers).toEqual([
      { kind: "push", filter: { branches: ["main"] } },
      { kind: "changeRequest" },
      { kind: "manual" },
      { kind: "schedule", cron: "0 9 * * *", timezone: "UTC" },
    ]);
  });

  it("comment + issue triggers (Spec 54)", () => {
    const triggers = triggerOf(`---
pipeline: ci
triggers:
  - kind: comment
    mention: "@sverka"
    on: mergeRequest
  - kind: issue
    action: opened
    labels: [agent, triage]
---
## triage
- command: echo triage
`);
    expect(triggers).toEqual([
      { kind: "comment", mention: "@sverka", on: "mergeRequest" },
      { kind: "issue", action: "opened", labels: ["agent", "triage"] },
    ]);
  });

  it("gh-aw-style on: shorthand — string, list, and map forms", () => {
    expect(
      triggerOf(`---
pipeline: ci
on: push
---
## b
- command: x
`),
    ).toEqual([{ kind: "push" }]);

    expect(
      triggerOf(`---
pipeline: ci
on: [push, manual]
---
## b
- command: x
`),
    ).toEqual([{ kind: "push" }, { kind: "manual" }]);

    expect(
      triggerOf(`---
pipeline: ci
on:
  comment:
    mention: "@sverka"
    on: mergeRequest
  schedule:
    cron: "0 0 * * *"
---
## b
- command: x
`),
    ).toEqual([
      { kind: "comment", mention: "@sverka", on: "mergeRequest" },
      { kind: "schedule", cron: "0 0 * * *" },
    ]);
  });

  it("entries root all steps and get unique ids", () => {
    const pipeline = synthesize(
      parseMarkdown(`---
pipeline: ci
triggers:
  - kind: comment
    mention: "@sverka"
  - kind: comment
    mention: "@review"
---
## a
- command: x
## b
- command: y
`),
    ).project.pipelines[0]!;
    expect(pipeline.entries.map((e) => e.id)).toEqual([
      "ci/on-comment",
      "ci/on-comment-2",
    ]);
    for (const entry of pipeline.entries) {
      expect([...entry.roots].sort()).toEqual(["ci/a", "ci/b"]);
    }
  });

  it("markdown comment trigger produces the same IR trigger as the TS builder", async () => {
    const { Project, Pipeline, ShellStep, Entry, comment } =
      await import("@sverka/workflow");
    const md = parseMarkdown(`---
pipeline: ci
triggers:
  - kind: comment
    mention: "@sverka"
    on: mergeRequest
---
## triage
- command: echo hi
`);
    const ts = new Project("ci-ts");
    const p = new Pipeline(ts, "ci");
    new ShellStep(p, "triage", { command: "echo hi" });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
      roots: ["triage"],
    });
    const mdTrigger = synthesize(md).project.pipelines[0]!.entries[0]!.trigger;
    const tsTrigger = synthesize(ts).project.pipelines[0]!.entries[0]!.trigger;
    expect(mdTrigger).toEqual(tsTrigger);
  });
});

describe("parseMarkdown — errors", () => {
  it("missing frontmatter → INVALID_FRONTMATTER", () => {
    expect(() => parseMarkdown("## step\n- command: x\n")).toThrowError(
      MarkdownParseError,
    );
    try {
      parseMarkdown("## step\n- command: x\n");
    } catch (e) {
      expect((e as MarkdownParseError).code).toBe("INVALID_FRONTMATTER");
    }
  });

  it("missing pipeline field → INVALID_FRONTMATTER", () => {
    try {
      parseMarkdown("---\ntriggers: []\n---\n## s\n- command: x\n");
      expect.unreachable();
    } catch (e) {
      expect((e as MarkdownParseError).code).toBe("INVALID_FRONTMATTER");
    }
  });

  it("step without command → INVALID_STEP", () => {
    try {
      parseMarkdown(`${HEADER}## broken\n- timeout: 5\n`);
      expect.unreachable();
    } catch (e) {
      expect((e as MarkdownParseError).code).toBe("INVALID_STEP");
      expect((e as MarkdownParseError).message).toContain("broken");
    }
  });

  it("unknown trigger kind → INVALID_TRIGGER", () => {
    try {
      parseMarkdown(`---
pipeline: ci
triggers:
  - kind: teleport
---
## s
- command: x
`);
      expect.unreachable();
    } catch (e) {
      expect((e as MarkdownParseError).code).toBe("INVALID_TRIGGER");
    }
  });

  it("schedule without cron → INVALID_TRIGGER", () => {
    try {
      parseMarkdown(`---
pipeline: ci
triggers:
  - kind: schedule
---
## s
- command: x
`);
      expect.unreachable();
    } catch (e) {
      expect((e as MarkdownParseError).code).toBe("INVALID_TRIGGER");
    }
  });

  it("invalid comment 'on' value → INVALID_TRIGGER", () => {
    try {
      parseMarkdown(`---
pipeline: ci
triggers:
  - kind: comment
    on: wiki
---
## s
- command: x
`);
      expect.unreachable();
    } catch (e) {
      expect((e as MarkdownParseError).code).toBe("INVALID_TRIGGER");
    }
  });
});

describe("loadMarkdownFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sverka-md-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a .sverka.md file", async () => {
    const file = join(dir, "ci.sverka.md");
    await writeFile(file, `${HEADER}## build\n- command: make build\n`);
    const project = await loadMarkdownFile(file);
    const pipeline = synthesize(project).project.pipelines[0]!;
    expect(pipeline.steps.map((s) => s.id)).toEqual(["ci/build"]);
  });

  it("extends: merges markdown steps into a TS-authored Project", async () => {
    const configFile = join(dir, "base.mjs");
    await writeFile(
      configFile,
      `import { Project, Pipeline, ShellStep, Entry, push } from ${JSON.stringify(WORKFLOW_URL)};
const project = new Project("base");
const p = new Pipeline(project, "base");
new ShellStep(p, "lint", { command: "make lint" });
new Entry(p, "on-push", { trigger: push(), roots: ["lint"] });
export { project };
`,
    );
    const md = join(dir, "ci.sverka.md");
    await writeFile(
      md,
      `---
pipeline: extra
extends: ./base.mjs
---
## docs
- command: make docs
`,
    );
    const project = await loadMarkdownFile(md);
    const graph = synthesize(project);
    const ids = graph.project.pipelines.map((p) => p.id);
    expect(ids).toContain("base");
    expect(ids).toContain("extra");
    const extra = graph.project.pipelines.find((p) => p.id === "extra")!;
    expect(extra.steps.map((s) => s.id)).toEqual(["extra/docs"]);
  });

  it("extends to a missing file → EXTENDS_NOT_FOUND", async () => {
    const md = join(dir, "ci.sverka.md");
    await writeFile(
      md,
      `---
pipeline: ci
extends: ./nope.mjs
---
## s
- command: x
`,
    );
    await expect(loadMarkdownFile(md)).rejects.toMatchObject({
      code: "EXTENDS_NOT_FOUND",
    });
  });
});
