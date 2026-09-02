import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileDrone, DroneTarget, DroneTargetError } from "../index.js";
import {
  makeGraph,
  makeSimpleGraph,
  makeGraphWithDeps,
  makeDiamondGraph,
} from "../../__tests__/helpers/graphs.js";

interface DroneYamlStep {
  readonly name: string;
  readonly image: string;
  readonly commands: readonly string[];
  readonly depends_on?: readonly string[];
  readonly timeout?: number;
}

interface DroneYamlTrigger {
  readonly branch?: readonly string[];
  readonly event?: readonly string[];
  readonly cron?: readonly string[];
}

interface DroneYaml {
  readonly kind: string;
  readonly type: string;
  readonly name: string;
  readonly steps: readonly DroneYamlStep[];
  readonly trigger: DroneYamlTrigger;
}

function parseDroneYaml(text: string): DroneYaml {
  const parsed = parse(text) as DroneYaml;
  if (typeof parsed.kind !== "string") throw new Error("invalid YAML: missing kind");
  return parsed;
}

describe("compileDrone — basic", () => {
  it("produces one YAML artifact", () => {
    const result = compileDrone(makeSimpleGraph({ kind: "push" }));
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".drone.yml");
  });

  it("produces valid YAML", () => {
    const result = compileDrone(makeSimpleGraph({ kind: "push" }));
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.kind).toBe("pipeline");
    expect(yaml.type).toBe("docker");
    expect(yaml.steps).toBeDefined();
  });
});

describe("compileDrone — shell operations", () => {
  it("maps shell operation to commands array", () => {
    const result = compileDrone(makeSimpleGraph({ kind: "push" }));
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.steps[0]?.commands).toEqual(["bun run build"]);
  });
});

describe("compileDrone — dependencies", () => {
  it("maps step dependencies to depends_on", () => {
    const result = compileDrone(makeGraphWithDeps({ kind: "push" }));
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    const buildStep = yaml.steps.find((s) => s.name === "build");
    expect(buildStep?.depends_on).toEqual(["lint"]);
  });

  it("maps diamond dependencies correctly", () => {
    const result = compileDrone(makeDiamondGraph({ kind: "push" }));
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    const buildStep = yaml.steps.find((s) => s.name === "build");
    expect(buildStep?.depends_on).toEqual(["lint", "test"]);
  });
});

describe("compileDrone — trigger mapping", () => {
  it("maps push trigger to branch trigger", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "push", filter: { branches: ["main"] } },
        steps: [{ id: "build", command: "echo hi" }],
      }),
    );
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("push");
    expect(yaml.trigger.branch).toContain("main");
  });

  it("maps changeRequest trigger to pull_request event", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "changeRequest" },
        steps: [{ id: "build", command: "echo hi" }],
      }),
    );
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("pull_request");
  });

  it("maps manual trigger to custom event", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "manual" },
        steps: [{ id: "build", command: "echo hi" }],
      }),
    );
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("custom");
  });

  it("maps schedule trigger to cron", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "schedule", cron: "0 * * * *" },
        steps: [{ id: "build", command: "echo hi" }],
      }),
    );
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.trigger.event).toContain("cron");
    expect(yaml.trigger.cron).toContain("0 * * * *");
  });
});

describe("compileDrone — runtime", () => {
  it("maps container runtime to image field", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "push" },
        steps: [
          {
            id: "build",
            command: "echo hi",
            runtime: { mode: "container", image: "golang:1.24" },
          },
        ],
      }),
    );
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.steps[0]?.image).toBe("golang:1.24");
  });

  it("emulates host runtime with default image", () => {
    const result = compileDrone(makeSimpleGraph({ kind: "push" }));
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.steps[0]?.image).toBe("node:24");
  });

  it("honors custom default image via config", () => {
    const result = compileDrone(makeSimpleGraph({ kind: "push" }), { image: "bun:latest" });
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.steps[0]?.image).toBe("bun:latest");
  });
});

describe("compileDrone — timeout", () => {
  it("does not emit per-step timeout (Drone Docker/K8s do not support it)", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "push" },
        steps: [{ id: "build", command: "echo hi", timeout: 60000 }],
      }),
    );
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.steps[0]?.timeout).toBeUndefined();
  });
});

describe("compileDrone — unsupported features (diagnostics)", () => {
  it("emits diagnostic for conditions (unsupported)", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "push" },
        steps: [
          {
            id: "build",
            command: "echo hi",
            condition: { kind: "status", status: "failure" },
          },
        ],
      }),
    );
    expect(result.diagnostics.some((d) => d.capability === "graph.conditions")).toBe(true);
  });

  it("emits diagnostic for matrix (unsupported)", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "push" },
        steps: [
          {
            id: "build",
            command: "echo hi",
            matrix: { dimensions: { node: ["18", "20"] } },
          },
        ],
      }),
    );
    expect(result.diagnostics.some((d) => d.capability === "graph.matrix")).toBe(true);
  });

  it("emits diagnostic for scalar output (unsupported)", () => {
    const result = compileDrone(
      makeGraph({
        trigger: { kind: "push" },
        steps: [
          {
            id: "build",
            command: "echo hi",
            outputs: { version: { type: "string" } },
          },
        ],
      }),
    );
    expect(result.diagnostics.some((d) => d.capability === "output.scalar")).toBe(true);
  });
});

describe("compileDrone — errors", () => {
  it("throws INVALID_GRAPH for empty graph", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    // No steps, no entries
    synthesize(proj);
    expect(() => compileDrone(synthesize(proj))).toThrow(DroneTargetError);
    expect(() => compileDrone(synthesize(proj))).toThrow(/no root pipelines/);
  });
});

describe("compileDrone — determinism", () => {
  it("same graph → identical output", () => {
    const g1 = makeSimpleGraph({ kind: "push" });
    const g2 = makeSimpleGraph({ kind: "push" });
    const r1 = compileDrone(g1);
    const r2 = compileDrone(g2);
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("compileDrone — DroneTarget class", () => {
  it("exposes name and capabilities", () => {
    const target = new DroneTarget();
    expect(target.name).toBe("drone");
    expect(target.capabilities["trigger.push"]).toBe("native");
  });

  it("honors type config (kubernetes)", () => {
    const result = compileDrone(makeSimpleGraph({ kind: "push" }), { type: "kubernetes" });
    const yaml = parseDroneYaml(result.artifacts[0]!.content);
    expect(yaml.type).toBe("kubernetes");
  });
});
