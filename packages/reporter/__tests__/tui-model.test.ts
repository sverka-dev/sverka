import { describe, it, expect } from "vitest";
import {
  stepGlyph,
  buildStepTree,
  filterFindings,
  searchFindings,
} from "../src/tui-model.js";
import { createInitialState } from "../src/reducer.js";
import type { StepState, UIState } from "../src/types.js";
import type { DefinitionGraph } from "@sverka/workflow";
import type { Finding } from "@sverka/verification";

function makeGraph(
  steps: { id: string; deps?: string[] }[],
): DefinitionGraph {
  return {
    project: {
      id: "proj",
      pipelines: [
        {
          id: "ci",
          inputs: {},
          entries: [],
          outputs: [],
          steps: steps.map((s) => ({
            id: s.id,
            runtime: { kind: "host" },
            operations: [{ kind: "shell", command: "echo" }],
            inputs: [],
            outputs: [],
            dependencies: (s.deps ?? []).map((producer) => ({
              kind: "control" as const,
              producer,
            })),
          })),
        },
      ],
    },
  };
}

function stateWith(stepIds: string[], state: StepState = "pending"): UIState {
  const steps = new Map(
    stepIds.map((id) => [id, { stepId: id, state }]),
  );
  return { ...createInitialState(), steps };
}

function makeFinding(
  overrides: Partial<Finding> & { severity: Finding["severity"] },
): Finding {
  return {
    id: `${overrides.checkId ?? "ci/lint"}:${overrides.fingerprint ?? "fp1"}`,
    fingerprint: overrides.fingerprint ?? "fp1",
    checkId: overrides.checkId ?? "ci/lint",
    confidence: 0.5,
    message: overrides.message ?? "test",
    rule: overrides.rule ?? "rule-1",
    file: overrides.file ?? "src/index.ts",
    startLine: 1,
    endLine: 1,
    source: {
      tool: "test",
      version: null,
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: overrides.source?.originalSeverity ?? null,
    },
    ...overrides,
  };
}

describe("stepGlyph", () => {
  it("1. maps every StepState to its spec glyph and color", () => {
    const expected: Record<StepState, [string, string]> = {
      pending: ["○", "gray"],
      ready: ["○", "gray"],
      running: ["●", "yellow"],
      succeeded: ["✓", "green"],
      failed: ["✗", "red"],
      skipped: ["○", "gray"],
      cancelled: ["○", "gray"],
      "cache-hit": ["✓", "green"],
      suspended: ["⏸", "cyan"],
      compensating: ["●", "yellow"],
      compensated: ["✓", "green"],
    };
    for (const [state, [glyph, color]] of Object.entries(expected)) {
      expect(stepGlyph(state as StepState)).toEqual({ glyph, color });
    }
  });
});

describe("buildStepTree", () => {
  it("2. empty state and no graph → empty rows", () => {
    expect(buildStepTree(null, createInitialState())).toEqual([]);
  });

  it("3. dependency nests child under parent with └─ prefix and depth 1", () => {
    const graph = makeGraph([
      { id: "a" },
      { id: "b", deps: ["a"] },
    ]);
    const rows = buildStepTree(graph, stateWith(["a", "b"]));
    expect(rows).toEqual([
      { stepId: "a", prefix: "", depth: 0 },
      { stepId: "b", prefix: "└─ ", depth: 1 },
    ]);
  });

  it("4. siblings sorted by id; ├─ for intermediate, └─ for last, │  continuation", () => {
    const graph = makeGraph([
      { id: "a" },
      { id: "b", deps: ["a"] },
      { id: "c", deps: ["a"] },
      { id: "d", deps: ["b"] },
      { id: "z" },
    ]);
    const rows = buildStepTree(graph, stateWith(["a", "b", "c", "d", "z"]));
    expect(rows).toEqual([
      { stepId: "a", prefix: "", depth: 0 },
      { stepId: "b", prefix: "├─ ", depth: 1 },
      { stepId: "d", prefix: "│  └─ ", depth: 2 },
      { stepId: "c", prefix: "└─ ", depth: 1 },
      { stepId: "z", prefix: "", depth: 0 },
    ]);
  });

  it("5. a step with two producers appears once", () => {
    const graph = makeGraph([
      { id: "a" },
      { id: "b" },
      { id: "c", deps: ["a", "b"] },
    ]);
    const rows = buildStepTree(graph, stateWith(["a", "b", "c"]));
    expect(rows.filter((r) => r.stepId === "c")).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });

  it("6. null graph → flat root rows sorted by step id", () => {
    const rows = buildStepTree(null, stateWith(["b", "a"]));
    expect(rows).toEqual([
      { stepId: "a", prefix: "", depth: 0 },
      { stepId: "b", prefix: "", depth: 0 },
    ]);
  });

  it("7. steps in state but absent from graph append as root rows", () => {
    const graph = makeGraph([{ id: "a" }]);
    const rows = buildStepTree(graph, stateWith(["a", "extra"]));
    expect(rows).toEqual([
      { stepId: "a", prefix: "", depth: 0 },
      { stepId: "extra", prefix: "", depth: 0 },
    ]);
  });
});

describe("filterFindings", () => {
  const findings = [
    makeFinding({ severity: "high", fingerprint: "f-high" }),
    makeFinding({ severity: "medium", fingerprint: "f-med" }),
    makeFinding({ severity: "low", fingerprint: "f-low" }),
    makeFinding({
      severity: "high",
      fingerprint: "f-err",
      source: {
        tool: "t", version: null, format: "sarif",
        originalRuleId: "r", originalSeverity: "error",
      },
    }),
  ];

  it("8. severity filters match exactly", () => {
    expect(filterFindings(findings, "high")).toHaveLength(2);
    expect(filterFindings(findings, "medium")).toHaveLength(1);
    expect(filterFindings(findings, "low")).toHaveLength(1);
  });

  it("9. new excludes baseline fingerprints; no baseline → all pass", () => {
    expect(filterFindings(findings, "new", ["f-high", "f-med"])).toHaveLength(2);
    expect(filterFindings(findings, "new")).toHaveLength(4);
    expect(filterFindings(findings, "new", [])).toHaveLength(4);
  });

  it("10. error matches originalSeverity === 'error'", () => {
    const result = filterFindings(findings, "error");
    expect(result).toHaveLength(1);
    expect(result[0]!.fingerprint).toBe("f-err");
  });

  it("11. all returns input unchanged", () => {
    expect(filterFindings(findings, "all")).toBe(findings);
  });
});

describe("searchFindings", () => {
  it("matches across message, checkId, file, and rule", () => {
    const f = [
      makeFinding({ severity: "high", message: "null deref", file: "a.ts" }),
      makeFinding({ severity: "low", checkId: "lint", file: "b.ts" }),
    ];
    expect(searchFindings(f, "deref")).toHaveLength(1);
    expect(searchFindings(f, "b.ts")).toHaveLength(1);
    expect(searchFindings(f, "")).toHaveLength(2);
    expect(searchFindings(f, "zzz")).toHaveLength(0);
  });
});
