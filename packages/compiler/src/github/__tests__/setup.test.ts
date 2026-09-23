import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  Project,
  Pipeline,
  ShellStep,
  ComponentStep,
  Entry,
  synthesize,
} from "@sverka/workflow";
import { compileGithub } from "../index.js";

function makeGraph() {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "bun run build" });
  new ShellStep(p, "test", { command: "bun run test", dependsOn: ["build"] });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
  return synthesize(proj);
}

const SETUP = {
  setup: [
    { name: "Setup Bun", uses: "oven-sh/setup-bun@v2" },
    { name: "Install dependencies", run: "bun install --frozen-lockfile" },
  ],
  checkoutWith: { submodules: "recursive" },
};

interface YamlJob {
  steps: {
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
  }[];
}

describe("compileGithub — setup injection", () => {
  it("injects setup steps after Checkout in every job", () => {
    const result = compileGithub(makeGraph(), SETUP);
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, YamlJob>;
    };
    for (const job of Object.values(yaml.jobs)) {
      expect(job.steps[0]).toMatchObject({
        uses: "actions/checkout@v4",
        with: { submodules: "recursive" },
      });
      expect(job.steps[1]).toMatchObject({
        name: "Setup Bun",
        uses: "oven-sh/setup-bun@v2",
      });
      expect(job.steps[2]).toMatchObject({
        name: "Install dependencies",
        run: "bun install --frozen-lockfile",
      });
    }
  });

  it("emits no YAML anchors (GitHub Actions does not support them)", () => {
    const result = compileGithub(makeGraph(), SETUP);
    expect(result.artifacts[0]!.content).not.toMatch(/&a\d|\*a\d/);
  });

  it("setup runs before beforeScript and main ops", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "bun run build",
      beforeScript: ["bun run prepare"],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj), SETUP);
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, YamlJob>;
    };
    const runs = yaml.jobs["build"]!.steps.map((s) => s.run).filter(Boolean);
    expect(runs[0]).toBe("bun install --frozen-lockfile");
    expect(runs[1]).toBe("bun run prepare");
    expect(runs[2]).toBe("bun run build");
  });

  it("component jobs get setup too", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ComponentStep(p, "deploy", {
      component: { name: "org/deploy-action", version: "v1", inputs: {} },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj), SETUP);
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, YamlJob>;
    };
    const steps = yaml.jobs["deploy"]!.steps;
    expect(steps[0]).toMatchObject({ uses: "actions/checkout@v4" });
    expect(steps[1]).toMatchObject({ uses: "oven-sh/setup-bun@v2" });
    expect(steps[3]).toMatchObject({ uses: "org/deploy-action@v1" });
  });

  it("continueOnError does not leak into injected setup", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "bun run build",
      continueOnError: true,
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj), SETUP);
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<
        string,
        {
          steps: (YamlJob["steps"][number] & {
            "continue-on-error"?: boolean;
          })[];
        }
      >;
    };
    const steps = yaml.jobs["build"]!.steps;
    expect(steps[1]).toMatchObject({ uses: "oven-sh/setup-bun@v2" });
    expect(steps[2]).not.toHaveProperty("continue-on-error");
    expect(steps[3]).toMatchObject({
      run: "bun run build",
      "continue-on-error": true,
    });
  });

  it("delay sleeps after setup, not before", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "bun run build", delay: "30s" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj), SETUP);
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, YamlJob>;
    };
    const steps = yaml.jobs["build"]!.steps;
    expect(steps[1]).toMatchObject({ uses: "oven-sh/setup-bun@v2" });
    expect(steps[3]).toMatchObject({ run: "sleep 30" });
    expect(steps[4]).toMatchObject({ run: "bun run build" });
  });

  it("emits pinned refs unquoted with the tag as a trailing comment", () => {
    const result = compileGithub(makeGraph(), {
      ...SETUP,
      pinning: { mode: "strict" },
    });
    const content = result.artifacts[0]!.content;
    // GitHub resolves `uses:` literally — a quoted "…@sha # v4" would fail.
    expect(content).toContain(
      "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    );
    expect(content).not.toContain('"actions/checkout@');
    expect(content).toContain(
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2",
    );
  });

  it("omits setup when config not provided (backward compat)", () => {
    const result = compileGithub(makeGraph());
    const yaml = parse(result.artifacts[0]!.content) as {
      jobs: Record<string, YamlJob>;
    };
    for (const job of Object.values(yaml.jobs)) {
      expect(job.steps[0]).toMatchObject({ uses: "actions/checkout@v4" });
      expect(job.steps[0]).not.toHaveProperty("with");
      expect(job.steps).toHaveLength(2);
    }
  });
});
