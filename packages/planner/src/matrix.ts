// Matrix expansion — expands matrix steps into concrete step instances.
// F-15 — plan-time expansion for the native engine.

import type { StepDefinition, Dependency, MatrixSpec, MatrixValue, Reference } from "@sverka/core";
import { PlannerError } from "./errors.js";

type MatrixCombination = Record<string, MatrixValue>;

/**
 * Expand all matrix steps in a step list into concrete step instances.
 * Non-matrix steps pass through unchanged.
 *
 * - Each matrix step becomes N steps, one per combination (cross-product of
 *   dimensions, minus exclude, plus include).
 * - Each expanded step gets `matrixValues` (the concrete bindings) and
 *   `matrix: undefined` (the spec is consumed).
 * - Expanded step IDs: `<originalId>[key=val,key=val]` (keys sorted alphabetically).
 * - Dependencies are rewired: a dependency on a matrix step maps to ALL
 *   expanded instances (all-to-all, no correlation matching in M1).
 */
export function expandMatrixSteps(
  steps: readonly StepDefinition[],
): readonly StepDefinition[] {
  const expansionMap = new Map<string, StepDefinition[]>();
  let hasMatrix = false;
  for (const step of steps) {
    if (step.matrix) {
      hasMatrix = true;
      expansionMap.set(step.id, expandStep(step));
    } else {
      expansionMap.set(step.id, [step]);
    }
  }

  if (!hasMatrix) {
    return steps;
  }

  const result: StepDefinition[] = [];
  for (const step of steps) {
    const expanded = expansionMap.get(step.id)!;
    for (const expStep of expanded) {
      result.push(rewireDependencies(expStep, expansionMap));
    }
  }
  return result;
}

function expandStep(step: StepDefinition): StepDefinition[] {
  const spec = step.matrix!;

  if (spec.maxParallel !== undefined) {
    if (!Number.isInteger(spec.maxParallel) || spec.maxParallel < 1) {
      throw new PlannerError(
        `matrix on step '${step.id}' has invalid maxParallel: must be a positive integer (got ${spec.maxParallel})`,
        "INVALID_MATRIX",
      );
    }
  }

  const combinations = computeCombinations(spec);

  if (combinations.length === 0) {
    throw new PlannerError(
      `matrix on step '${step.id}' produced no combinations (check exclude rules)`,
      "INVALID_MATRIX",
    );
  }

  return combinations.map((combo) => {
    const { matrix: _consumed, ...rest } = step;
    return {
      ...rest,
      id: formatExpandedId(step.id, combo),
      matrixValues: combo,
      dependencies: step.dependencies,
      ...(spec.failFast !== undefined ? { matrixFailFast: spec.failFast } : {}),
      ...(spec.maxParallel !== undefined ? { matrixMaxParallel: spec.maxParallel } : {}),
    };
  });
}

function computeCombinations(spec: MatrixSpec): readonly MatrixCombination[] {
  const keys = Object.keys(spec.dimensions);
  if (keys.length === 0) {
    return (spec.include ?? []).map((e) => ({ ...e }));
  }

  let combinations: MatrixCombination[] = [{}];
  for (const key of keys) {
    const values = spec.dimensions[key];
    if (!values || values.length === 0) {
      throw new PlannerError(
        `matrix dimension '${key}' has no values`,
        "INVALID_MATRIX",
      );
    }
    const next: MatrixCombination[] = [];
    for (const combo of combinations) {
      for (const v of values) {
        next.push({ ...combo, [key]: v });
      }
    }
    combinations = next;
  }

  const exclude = spec.exclude ?? [];
  if (exclude.length > 0) {
    combinations = combinations.filter((c) => !matchesAnyRule(c, exclude));
  }

  const include = spec.include ?? [];
  const includeEntries = include.map((e) => ({ ...e }));
  // Deduplicate: skip include entries that exactly match an existing combination.
  const existingKeys = new Set(combinations.map(comboKey));
  const uniqueIncludes = includeEntries.filter((e) => !existingKeys.has(comboKey(e)));
  return [...combinations, ...uniqueIncludes];
}

function matchesAnyRule(
  combo: MatrixCombination,
  rules: readonly Readonly<Record<string, MatrixValue>>[],
): boolean {
  for (const rule of rules) {
    const entries = Object.entries(rule);
    if (entries.length === 0) continue;
    if (entries.every(([k, v]) => combo[k] === v)) return true;
  }
  return false;
}

/** Produce a deterministic string key for a combination (sorted key=value pairs). */
function comboKey(combo: MatrixCombination): string {
  return Object.keys(combo)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${String(combo[k])}`)
    .join(",");
}

function formatExpandedId(id: string, combo: MatrixCombination): string {
  const parts = Object.keys(combo)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${combo[k]}`);
  return `${id}[${parts.join(",")}]`;
}

function rewireDependencies(
  step: StepDefinition,
  expansionMap: Map<string, StepDefinition[]>,
): StepDefinition {
  const hasDeps = step.dependencies.length > 0;
  const hasInputs = step.inputs.length > 0;
  if (!hasDeps && !hasInputs) return step;

  const newDeps = hasDeps ? rewireDeps(step.dependencies, expansionMap) : step.dependencies;
  const newInputs = hasInputs ? rewireInputs(step.inputs, expansionMap) : step.inputs;

  return { ...step, dependencies: newDeps, inputs: newInputs };
}

function rewireDeps(
  deps: readonly Dependency[],
  expansionMap: Map<string, StepDefinition[]>,
): Dependency[] {
  const newDeps: Dependency[] = [];
  const seen = new Set<string>();

  for (const dep of deps) {
    const expanded = expansionMap.get(dep.producer);
    if (!expanded) {
      addDep(newDeps, seen, dep);
      continue;
    }
    // Rewire to all expanded instances — even when there's only one,
    // because the expanded step has a new ID (e.g. "step[node=18]").
    for (const expStep of expanded) {
      addDep(newDeps, seen, { ...dep, producer: expStep.id });
    }
  }
  return newDeps;
}

function rewireInputs(
  inputs: readonly Reference[],
  expansionMap: Map<string, StepDefinition[]>,
): Reference[] {
  const newInputs: Reference[] = [];
  const seen = new Set<string>();

  for (const ref of inputs) {
    if (ref.kind !== "step") {
      newInputs.push(ref);
      continue;
    }
    const expanded = expansionMap.get(ref.step);
    if (!expanded) {
      newInputs.push(ref);
      continue;
    }
    // Rewire to all expanded instances — even when there's only one,
    // because the expanded step has a new ID (e.g. "step[node=18]").
    for (const expStep of expanded) {
      const rewired = { ...ref, step: expStep.id };
      const key = `${rewired.step}:${rewired.output}`;
      if (seen.has(key)) continue;
      seen.add(key);
      newInputs.push(rewired);
    }
  }
  return newInputs;
}

function addDep(deps: Dependency[], seen: Set<string>, dep: Dependency): void {
  const key =
    dep.kind === "control"
      ? `control:${dep.producer}`
      : `${dep.kind}:${dep.producer}:${dep.output}`;
  if (seen.has(key)) return;
  seen.add(key);
  deps.push(dep);
}
