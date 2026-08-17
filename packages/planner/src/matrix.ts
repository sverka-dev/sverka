// Matrix expansion — expands matrix steps into concrete step instances.
// F-15 — plan-time expansion for the native engine.

import type { StepDefinition, Dependency, MatrixSpec, MatrixValue } from "@sverka/core";
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
  return [...combinations, ...include.map((e) => ({ ...e }))];
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
  if (step.dependencies.length === 0) return step;

  const newDeps: Dependency[] = [];
  const seen = new Set<string>();

  for (const dep of step.dependencies) {
    const expanded = expansionMap.get(dep.producer);
    if (!expanded || expanded.length === 1) {
      addDep(newDeps, seen, dep);
      continue;
    }
    for (const expStep of expanded) {
      addDep(newDeps, seen, { ...dep, producer: expStep.id });
    }
  }

  return { ...step, dependencies: newDeps };
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
