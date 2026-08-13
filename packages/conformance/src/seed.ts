// Conformance seed pipeline — authored through all three surfaces.
// Spec 18 — §33.1, §34.1.

import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
import { sh, pipeline as sdkPipeline } from "@sverka/sdk";
import { pipeline as pipelineDecorator, step, stepWithOptions, entry, input, decoratePipeline } from "@sverka/decorators";

/**
 * The conformance seed pipeline definition:
 *
 * Project "conf"
 *   Pipeline "ci"
 *     Input: nodeVersion (string, default "22")
 *     Step "lint": shell "npm run lint"
 *     Step "build": shell "npm run build", depends on "lint"
 *     Step "test": shell "npm run test", depends on "build"
 *     Entry "on-push": trigger push, roots ["test"]
 */

// --- Construct API ---

export function createSeedWithConstructs(): Project {
  const proj = new Project("conf");
  const p = new Pipeline(proj, "ci", {
    inputs: { nodeVersion: { type: "string", default: "22" } },
  });
  new ShellStep(p, "lint", { command: "npm run lint" });
  new ShellStep(p, "build", { command: "npm run build", dependsOn: ["lint"] });
  new ShellStep(p, "test", { command: "npm run test", dependsOn: ["build"] });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
  return proj;
}

// --- SDK API ---

export function createSeedWithSDK(): Project {
  const proj = new Project("conf");
  const p = new Pipeline(proj, "ci", {
    inputs: { nodeVersion: { type: "string", default: "22" } },
  });

  // SDK sh builder creates ShellStep constructs. We add dependsOn via the builder.
  sh`npm run lint`.build(p, "lint");
  sh`npm run build`.dependsOn(["lint"]).build(p, "build");
  sh`npm run test`.dependsOn(["build"]).build(p, "test");
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
  return proj;
}

// --- Decorator API ---

@pipelineDecorator
class SeedPipeline {
  @input
  nodeVersion = { type: "string" as const, default: "22" };

  @step
  lint = "npm run lint";

  @stepWithOptions({ dependsOn: ["lint"] })
  build = "npm run build";

  @stepWithOptions({ dependsOn: ["build"] })
  test = "npm run test";

  @entry({ kind: "push" })
  ["on-push"] = ["test"];
}

export function createSeedWithDecorators(): Project {
  const proj = new Project("conf");
  decoratePipeline(SeedPipeline, proj, "ci");
  return proj;
}
