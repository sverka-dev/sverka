import { describe, it, expect } from "vitest";

import {
  buildBoard,
  renderBoard,
  renderBoardHtml,
  sparkline,
} from "../src/board.js";
import type { ArenaResultV1 } from "../src/registry.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function doc(over: {
  runId: string;
  pack?: string;
  agent?: string;
  model?: string;
  plugins?: readonly string[];
  sverkaVersion?: string;
  startedAt?: string;
  task?: string;
  promptHash?: string;
  passed?: boolean;
  tokens?: number;
  durationMs?: number;
}): ArenaResultV1 {
  return {
    schema: "arena.result/v1",
    runId: over.runId,
    pack: over.pack ?? "node-ci",
    agent: over.agent ?? "devin",
    model: over.model ?? "m1",
    plugins: over.plugins ?? [],
    sverkaVersion: over.sverkaVersion ?? "0.9.0",
    startedAt: over.startedAt ?? "2026-10-01T00:00:00.000Z",
    tasks: [
      {
        task: over.task ?? "lint-fix",
        promptHash: over.promptHash ?? HASH_A,
        score: { passed: over.passed ?? true, findings: 0 },
        metrics: {
          ...(over.tokens !== undefined ? { tokens: over.tokens } : {}),
          durationMs: over.durationMs ?? 1000,
        },
      },
    ],
  };
}

describe("buildBoard", () => {
  it("aggregates success rate, medians, runs and a 30-day trend", () => {
    // 20 runs across 4 days for one (agent, model).
    const results: ArenaResultV1[] = [];
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
    for (let i = 0; i < 20; i++) {
      results.push(
        doc({
          runId: `r${i}`,
          startedAt: `${days[i % 4]}T00:00:00.000Z`,
          passed: i % 4 !== 3, // 15/20 pass
          tokens: 100 + i * 10,
          durationMs: 1000 + i * 100,
        }),
      );
    }
    const cohorts = buildBoard(results);
    expect(cohorts.length).toBe(1);
    const row = cohorts[0]!.rows[0]!;
    expect(row.agent).toBe("devin");
    expect(row.model).toBe("m1");
    expect(row.runs).toBe(20);
    expect(row.successRate).toBeCloseTo(0.75);
    // medians of 100..290 step 10 → 195; durations 1000..2900 → 1950
    expect(row.medianTokens).toBe(195);
    expect(row.medianDurationMs).toBe(1950);
    expect(row.trend.length).toBe(30);
    // Trend anchored at the latest sample day — last 4 days have data.
    const tail = row.trend.slice(-4);
    for (const v of tail) {
      expect(v).not.toBeNaN();
    }
  });

  it("never merges different sverka versions into one cohort", () => {
    const cohorts = buildBoard([
      doc({ runId: "a", sverkaVersion: "0.9.0" }),
      doc({ runId: "b", sverkaVersion: "0.10.0" }),
    ]);
    expect(cohorts.length).toBe(2);
    expect(cohorts.map((c) => c.sverkaVersion).sort()).toEqual([
      "0.10.0",
      "0.9.0",
    ]);
  });

  it("never merges different prompt hashes or tasks", () => {
    const cohorts = buildBoard([
      doc({ runId: "a", promptHash: HASH_A }),
      doc({ runId: "b", promptHash: HASH_B }),
      doc({ runId: "c", task: "other-task" }),
      doc({ runId: "d", pack: "other-pack" }),
    ]);
    expect(cohorts.length).toBe(4);
  });

  it("keeps cohorts distinct when key fields contain spaces", () => {
    // "a b" + "c" must not merge with "a" + "b c".
    const cohorts = buildBoard([
      doc({ runId: "x", pack: "a b", task: "c" }),
      doc({ runId: "y", pack: "a", task: "b c" }),
    ]);
    expect(cohorts.length).toBe(2);
    expect(cohorts.map((c) => `${c.pack}|${c.task}`).sort()).toEqual([
      "a b|c",
      "a|b c",
    ]);
  });

  it("keeps rows distinct when agent/model fields contain spaces", () => {
    const cohorts = buildBoard([
      doc({ runId: "x", agent: "a b", model: "c" }),
      doc({ runId: "y", agent: "a", model: "b c" }),
    ]);
    expect(cohorts.length).toBe(1);
    expect(cohorts[0]!.rows.length).toBe(2);
  });

  it("anchors every row's trend in a cohort to one shared date", () => {
    const cohorts = buildBoard(
      [
        doc({
          runId: "early",
          agent: "a1",
          startedAt: "2026-10-01T00:00:00.000Z",
        }),
        doc({
          runId: "late",
          agent: "a2",
          startedAt: "2026-10-05T00:00:00.000Z",
        }),
      ],
      { days: 5 },
    );
    const rows = cohorts[0]!.rows;
    const early = rows.find((r) => r.agent === "a1")!;
    const late = rows.find((r) => r.agent === "a2")!;
    // Shared anchor = the cohort's latest sample day (Oct 5): the early
    // row's sample lands on the first trend slot, the late row's on the last.
    expect(early.trend[0]).toBe(1);
    expect(Number.isNaN(early.trend[4])).toBe(true);
    expect(late.trend[4]).toBe(1);
  });

  it("groups one row per (agent, model) inside a cohort", () => {
    const cohorts = buildBoard([
      doc({ runId: "a", agent: "devin", model: "m1" }),
      doc({ runId: "b", agent: "devin", model: "m2" }),
      doc({ runId: "c", agent: "other", model: "m1" }),
      doc({ runId: "d", agent: "devin", model: "m1", passed: false }),
    ]);
    expect(cohorts.length).toBe(1);
    const rows = cohorts[0]!.rows;
    expect(rows.length).toBe(3);
    const devinM1 = rows.find((r) => r.agent === "devin" && r.model === "m1")!;
    expect(devinM1.runs).toBe(2);
    expect(devinM1.successRate).toBe(0.5);
    // Sorted by success rate desc.
    expect(rows[0]!.successRate).toBeGreaterThanOrEqual(
      rows[rows.length - 1]!.successRate,
    );
  });

  it("never merges same agent+model runs with different plugin sets", () => {
    const cohorts = buildBoard([
      doc({ runId: "a", plugins: ["sverka"], passed: true }),
      doc({ runId: "b", plugins: ["sverka"], passed: true }),
      doc({ runId: "c", plugins: [], passed: false }),
    ]);
    expect(cohorts.length).toBe(1);
    const rows = cohorts[0]!.rows;
    expect(rows.length).toBe(2);
    const withPlugin = rows.find((r) => r.plugins.join("+") === "sverka")!;
    const bare = rows.find((r) => r.plugins.length === 0)!;
    expect(withPlugin.runs).toBe(2);
    expect(withPlugin.successRate).toBe(1);
    expect(bare.runs).toBe(1);
    expect(bare.successRate).toBe(0);
  });

  it("canonicalizes plugin sets — order and duplicates do not split rows", () => {
    const cohorts = buildBoard([
      doc({ runId: "a", plugins: ["x", "y"] }),
      doc({ runId: "b", plugins: ["y", "x", "y"] }),
    ]);
    expect(cohorts.length).toBe(1);
    const rows = cohorts[0]!.rows;
    expect(rows.length).toBe(1);
    expect(rows[0]!.plugins).toEqual(["x", "y"]);
    expect(rows[0]!.runs).toBe(2);
  });
});

describe("render", () => {
  it("sparkline renders gaps for NaN days", () => {
    const s = sparkline([NaN, 0, 1]);
    expect(s.length).toBe(3);
    expect(s[0]).toBe("·");
    expect(s[1]).not.toBe(s[2]);
  });

  it("renderBoard shows a no-data state for empty registries", () => {
    expect(renderBoard([])).toContain("no arena results");
  });

  it("renderBoard prints cohorts and rows", () => {
    const text = renderBoard(
      buildBoard([doc({ runId: "a" }), doc({ runId: "b", passed: false })]),
    );
    expect(text).toContain("node-ci");
    expect(text).toContain("lint-fix");
    expect(text).toContain("devin");
    expect(text).toContain("50.0%");
  });

  it("renderBoard renders the plugin-set identity in each row", () => {
    const text = renderBoard(
      buildBoard([
        doc({ runId: "a", plugins: ["sverka", "mcp"] }),
        doc({ runId: "b" }),
      ]),
    );
    expect(text).toContain("PLUGINS");
    // Canonical (sorted) order — input was ["sverka", "mcp"].
    expect(text).toContain("mcp+sverka");
    expect(text).toContain("no plugins");
  });

  it("renders distinct labels for ambiguous plugin sets", () => {
    const text = renderBoard(
      buildBoard([
        doc({ runId: "a", plugins: ["a+b"] }),
        doc({ runId: "b", plugins: ["a", "b"] }),
        doc({ runId: "c", plugins: ["no plugins"] }),
        doc({ runId: "d", plugins: ["no-plugins"] }),
        doc({ runId: "e" }),
      ]),
    );
    // "+" inside a name is encoded — never mistaken for the separator.
    expect(text).toContain("a%2Bb");
    expect(text).toContain("a+b");
    // Plugin names can approach but never equal the reserved empty label.
    expect(text).toContain("no%20plugins");
    expect(text).toContain("no-plugins");
    expect(text).toContain("no plugins");
  });

  it("renderBoardHtml renders the plugin-set identity in each row", () => {
    const html = renderBoardHtml(
      buildBoard([
        doc({ runId: "a", plugins: ["sverka"] }),
        doc({ runId: "b" }),
      ]),
    );
    expect(html).toContain("<th>plugins</th>");
    expect(html).toContain("sverka");
    expect(html).toContain("no plugins");
  });

  it("renderBoardHtml emits a static page with cohort tables", () => {
    const html = renderBoardHtml(
      buildBoard([doc({ runId: "a" }), doc({ runId: "b", model: "m2" })]),
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("node-ci");
    expect(html).toContain("<table>");
    expect(html).toContain("m2");
    // no script — fully static
    expect(html).not.toContain("<script");
  });

  it("renderBoardHtml renders an empty state instead of crashing", () => {
    const html = renderBoardHtml([]);
    expect(html).toContain("no arena results");
  });
});
