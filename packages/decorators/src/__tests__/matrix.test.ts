import { describe, it, expect } from "vitest";
import { Project } from "@sverka/cdk";
import { synthesize } from "@sverka/core";
import {
  pipeline,
  step,
  entry,
  decoratePipeline,
} from "../index.js";
import { push } from "@sverka/cdk";

describe("Decorator @step with matrix", () => {
  it("stores matrix from @step(options) on field", () => {
    @pipeline
    class Ci {
      @step({ matrix: { dimensions: { node: [18, 20] } } })
      test = "make test";

      @entry(push())
      push = ["test"];
    }

    const proj = new Project("matrix-step-options");
    const p = decoratePipeline(Ci, proj, "ci");
    const graph = synthesize(proj);
    const stepDef = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/test");
    expect(stepDef?.matrix).toEqual({ dimensions: { node: [18, 20] } });
  });

  it("stores matrix from @step on field", () => {
    @pipeline
    class Ci {
      @step({ matrix: { dimensions: { os: ["ubuntu"] } } })
      lint = "make lint";

      @entry(push())
      push = ["lint"];
    }

    const proj = new Project("matrix-step-with-options");
    decoratePipeline(Ci, proj, "ci");
    const graph = synthesize(proj);
    const stepDef = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/lint");
    expect(stepDef?.matrix?.dimensions.os).toEqual(["ubuntu"]);
  });

  it("no matrix field when not specified", () => {
    @pipeline
    class Ci {
      @step
      build = "make build";

      @entry(push())
      push = ["build"];
    }

    const proj = new Project("matrix-no-spec");
    decoratePipeline(Ci, proj, "ci");
    const graph = synthesize(proj);
    const stepDef = graph.project.pipelines[0]!.steps.find((s) => s.id === "ci/build");
    expect(stepDef?.matrix).toBeUndefined();
  });
});
