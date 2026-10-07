// Implicit zero-config pipeline (Spec 53): `sverka run` on a repo with no
// sverka.config.* bootstraps the same detection `sverka check` uses into a
// `default` pipeline — one host ShellStep per detected check, all rooted
// under a single `run` entry. Zero detections is a usage error pointing at
// `sverka init`.

import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  manual,
  synthesize,
  collectConstructWarnings,
} from "@sverka/workflow";
import type { DefinitionGraph, ShellStepProps } from "@sverka/workflow";
import { CliError, ExitCode } from "../types.js";
import { findConfig, loadProjectGraph } from "./config.js";
import { detectProjectChecks } from "./detect.js";
import type { DetectedCheck } from "./detect.js";

export interface RunGraph {
  readonly graph: DefinitionGraph;
  readonly warnings: string[];
  /** Check ids when the graph was auto-detected (no config on disk). */
  readonly detected?: readonly string[];
}

/** Load the graph `sverka run` should execute: the real config when one
 *  exists on disk (or --config names one), else the implicit detected
 *  pipeline. */
export async function loadRunGraph(global: {
  root: string;
  config: string | null;
}): Promise<RunGraph> {
  if (global.config === null && (await findConfig(global.root)) === null) {
    return implicitGraph(global.root);
  }
  const { graph, warnings } = await loadProjectGraph(global);
  return { graph, warnings };
}

async function implicitGraph(root: string): Promise<RunGraph> {
  const checks = await detectProjectChecks(root);
  if (checks.length === 0) {
    throw new CliError(
      "no config found and no checks detected (run `sverka init` to create one)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }

  const project = new Project("default");
  const pipeline = new Pipeline(project, "default");
  // Constructs self-register into their scope on `new` — the handles are
  // the wiring: the entry's roots are the detected step ids.
  const steps = checks.map(
    (check) => new ShellStep(pipeline, check.checkId, shellStepProps(check)),
  );
  const entry = new Entry(pipeline, "run", {
    trigger: manual(),
    roots: steps.map((step) => step.node.id),
  });
  return {
    graph: synthesize(project),
    warnings: collectConstructWarnings(project),
    detected: entry.roots,
  };
}

/** Detected check → ShellStep props. A SARIF-on-stdout check keeps the
 *  `fromStdout` artifact declaration `init --detect` generates, so the
 *  implicit run feeds findings collection the same way. */
function shellStepProps(check: DetectedCheck): ShellStepProps {
  return {
    command: check.command,
    runtime: { mode: "host" },
    ...(check.sarifOutput !== undefined
      ? {
          outputs: {
            [check.sarifOutput]: {
              type: "artifact" as const,
              fromStdout: true,
            },
          },
        }
      : {}),
  };
}
