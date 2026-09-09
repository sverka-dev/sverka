// @sverka/reporter — pure TUI view-model helpers. Spec 45.

import type { Finding } from "@sverka/verification";
import type { DefinitionGraph } from "@sverka/workflow";
import type {
  FindingFilter,
  StepGlyph,
  StepState,
  StepTreeRow,
  UIState,
} from "./types.js";

/** Ordered list of filters cycled by the `f` key. */
export const FINDING_FILTERS: readonly FindingFilter[] = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
  "new",
  "error",
];

const GLYPHS: Record<StepState, StepGlyph> = {
  pending: { glyph: "○", color: "gray" },
  ready: { glyph: "○", color: "gray" },
  running: { glyph: "●", color: "yellow" },
  succeeded: { glyph: "✓", color: "green" },
  failed: { glyph: "✗", color: "red" },
  skipped: { glyph: "○", color: "gray" },
  cancelled: { glyph: "○", color: "gray" },
  "cache-hit": { glyph: "✓", color: "green" },
  suspended: { glyph: "⏸", color: "cyan" },
  compensating: { glyph: "●", color: "yellow" },
  compensated: { glyph: "✓", color: "green" },
};

/** Map a StepState to its glyph and color. Pure. */
export function stepGlyph(state: StepState): StepGlyph {
  return GLYPHS[state];
}

/** Build the tree connector prefix for a node. */
function buildConnector(isRoot: boolean, prefix: string, isLast: boolean): string {
  if (isRoot) return "";
  return prefix + (isLast ? "└─ " : "├─ ");
}

/** Build the child prefix for children of a node. */
function buildChildPrefix(isRoot: boolean, prefix: string, isLast: boolean): string {
  if (isRoot) return "";
  return prefix + (isLast ? "   " : "│  ");
}

/** Build children map and hasParent set from graph steps. */
function buildChildrenMap(
  steps: readonly { id: string; dependencies: readonly { producer: string }[] }[],
  stepIds: Set<string>,
): { children: Map<string, string[]>; hasParent: Set<string> } {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep.producer)) continue;
      let list = children.get(dep.producer);
      if (!list) {
        list = [];
        children.set(dep.producer, list);
      }
      if (!list.includes(step.id)) {
        list.push(step.id);
      }
      hasParent.add(step.id);
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.localeCompare(b, "en"));
  return { children, hasParent };
}

/**
 * Flatten a DefinitionGraph into tree rows, roots first.
 * Pure: deterministic ordering — siblings sorted by step id.
 * A step reachable via multiple paths appears once (first DFS visit).
 * When `graph` is null, every step in `state.steps` renders as a flat
 * root row sorted by step id.
 */
export function buildStepTree(
  graph: DefinitionGraph | null,
  state: UIState,
): readonly StepTreeRow[] {
  const rows: StepTreeRow[] = [];
  const visited = new Set<string>();

  if (!graph) {
    const ids = [...state.steps.keys()].sort((a, b) => a.localeCompare(b, "en"));
    for (const id of ids) {
      rows.push({ stepId: id, prefix: "", depth: 0 });
    }
    return rows;
  }

  const steps = graph.project.pipelines.flatMap((p) => p.steps);
  const stepIds = new Set(steps.map((s) => s.id));
  const { children, hasParent } = buildChildrenMap(steps, stepIds);

  const roots = steps
    .map((s) => s.id)
    .filter((id) => !hasParent.has(id))
    .sort((a, b) => a.localeCompare(b, "en"));

  const visit = (id: string, prefix: string, depth: number, isLast: boolean, isRoot: boolean): void => {
    if (visited.has(id)) return;
    visited.add(id);
    rows.push({ stepId: id, prefix: buildConnector(isRoot, prefix, isLast), depth });
    const kids = children.get(id) ?? [];
    const childPrefix = buildChildPrefix(isRoot, prefix, isLast);
    kids.forEach((kid, i) => {
      visit(kid, childPrefix, depth + 1, i === kids.length - 1, false);
    });
  };

  for (const id of roots) visit(id, "", 0, true, true);

  // Steps in state but not reachable from the graph (defensive).
  const remaining = [...state.steps.keys()]
    .filter((id) => !visited.has(id))
    .sort((a, b) => a.localeCompare(b, "en"));
  for (const id of remaining) {
    rows.push({ stepId: id, prefix: "", depth: 0 });
  }

  return rows;
}

/**
 * Apply a FindingFilter to findings. Pure.
 * "new" compares `finding.fingerprint` against `baselineFingerprints`;
 * when the baseline is absent or empty, all findings are new.
 */
export function filterFindings(
  findings: readonly Finding[],
  filter: FindingFilter,
  baselineFingerprints?: readonly string[],
): readonly Finding[] {
  switch (filter) {
    case "all":
      return findings;
    case "critical":
    case "high":
    case "medium":
    case "low":
      return findings.filter((f) => f.severity === filter);
    case "new": {
      if (!baselineFingerprints || baselineFingerprints.length === 0) {
        return findings;
      }
      const baseline = new Set(baselineFingerprints);
      return findings.filter((f) => !baseline.has(f.fingerprint));
    }
    case "error":
      return findings.filter((f) => f.source.originalSeverity === "error");
  }
}

/** Substring match across message, checkId, file, and rule. */
export function searchFindings(
  findings: readonly Finding[],
  query: string,
): readonly Finding[] {
  if (query === "") return findings;
  const q = query.toLowerCase();
  return findings.filter(
    (f) =>
      f.message.toLowerCase().includes(q) ||
      f.checkId.toLowerCase().includes(q) ||
      f.file.toLowerCase().includes(q) ||
      f.rule.toLowerCase().includes(q),
  );
}
