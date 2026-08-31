// Emit: DroneTargetGraph → YAML artifacts.
// Spec 36 — §19.

import { stringify } from "yaml";
import { DroneTargetError } from "./errors.js";
import type { DroneTargetGraph, DroneStep, GeneratedArtifact } from "./types.js";

/**
 * Emit a DroneTargetGraph as a YAML artifact.
 * Produces one .drone.yml file.
 */
export function emitDrone(targetGraph: DroneTargetGraph): readonly GeneratedArtifact[] {
  try {
    const yaml = stringifyTargetGraph(targetGraph);
    return [{ path: ".drone.yml", content: yaml }];
  } catch (err) {
    throw new DroneTargetError(
      `failed to emit Drone YAML: ${err instanceof Error ? err.message : String(err)}`,
      "EMIT_FAILED",
      err,
    );
  }
}

/**
 * Convert a DroneTargetGraph to a YAML string.
 */
function stringifyTargetGraph(graph: DroneTargetGraph): string {
  const doc: Record<string, unknown> = {
    kind: "pipeline",
    type: graph.type,
    name: graph.name,
    steps: graph.steps.map(stepToYaml),
    trigger: triggerToYaml(graph.trigger),
  };
  return stringify(doc, { sortMapEntries: false });
}

/**
 * Convert a DroneStep to a YAML-friendly object.
 */
function stepToYaml(step: DroneStep): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: step.name,
    image: step.image,
    commands: step.commands,
  };
  if (step.dependsOn.length > 0) {
    obj.depends_on = step.dependsOn;
  }
  if (step.timeout !== undefined) {
    obj.timeout = step.timeout;
  }
  return obj;
}

/**
 * Convert a DroneTrigger to a YAML-friendly object.
 */
function triggerToYaml(trigger: DroneTargetGraph["trigger"]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (trigger.branch) obj.branch = trigger.branch;
  if (trigger.event) obj.event = trigger.event;
  if (trigger.cron) obj.cron = trigger.cron;
  if (trigger.custom) obj.custom = trigger.custom;
  return obj;
}
