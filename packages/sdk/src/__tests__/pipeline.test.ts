import { describe, it, expect } from "vitest";
import { Project, Entry, push } from "@sverka/constructs";
import { pipelineV0 as pipeline, sh, artifact } from "../index.js";

describe("pipeline factory", () => {
  it("creates a Pipeline and runs step functions", () => {
    const proj = new Project("test");
    const p = pipeline(proj, "ci", {
      steps: [
        (pip) => {
          sh`npm run build`.outputs({ dist: artifact("./dist") }).build(pip, "build");
        },
        (pip) => {
          sh`npm test`.dependsOn(["build"]).build(pip, "test");
        },
      ],
    });
    expect(p.node.id).toBe("ci");
    expect(p.node.children).toHaveLength(2);
  });

  it("forwards named inputs to the Pipeline", () => {
    const proj = new Project("test");
    const p = pipeline(proj, "ci", {
      inputs: { ref: { type: "string" } },
      steps: [(pip) => sh`npm run build`.build(pip, "build")],
    });
    expect(p.inputs.get("ref")).toEqual({ type: "string" });
  });

  it("runs entry functions", () => {
    const proj = new Project("test");
    const p = pipeline(proj, "ci", {
      steps: [
        (pip) => sh`npm run build`.build(pip, "build"),
      ],
      entries: [
        (pip) => new Entry(pip, "on-push", { trigger: push(), roots: ["build"] }),
      ],
    });
    expect(p.node.children).toHaveLength(2);
  });
});
