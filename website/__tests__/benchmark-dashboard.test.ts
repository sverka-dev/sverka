import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const benchDir = join(import.meta.dirname, "..", "public", "benchmark");

describe("benchmark dashboard files", () => {
  it("index.html exists", () => {
    expect(existsSync(join(benchDir, "index.html"))).toBe(true);
  });

  it("sample-result.json exists and is valid BenchmarkResult", () => {
    const path = join(benchDir, "sample-result.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data.timestamp).toBeTruthy();
    expect(data.model).toBeTruthy();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.summary["raw-shell"]).toBeDefined();
    expect(data.summary.sverka).toBeDefined();
  });

  it("index.html is valid HTML with title and script", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>");
    expect(html).toContain("</html>");
    expect(html).toContain("<script>");
  });

  it("index.html contains comparison table structure", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain('id="results-table"');
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="header-meta"');
  });

  it("index.html has no external CSS/JS dependencies", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    // No <link> to external stylesheets, no <script src="http...">
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]*src=["']https?:/);
  });

  it("index.html uses dark theme", () => {
    const html = readFileSync(join(benchDir, "index.html"), "utf-8");
    expect(html).toContain("data-theme=\"dark\"");
    expect(html).toMatch(/--bg:\s*#0d1117/);
  });

  it("sample-result.json has paired results for each task", () => {
    const data = JSON.parse(
      readFileSync(join(benchDir, "sample-result.json"), "utf-8"),
    );
    const taskIds = new Set(data.results.map((r: any) => r.taskId));
    for (const taskId of taskIds) {
      const runs = data.results.filter((r: any) => r.taskId === taskId);
      expect(runs.length).toBe(2);
      const types = runs.map((r: any) => r.agentType).sort();
      expect(types).toEqual(["raw-shell", "sverka"]);
    }
  });

  it("sample-result.json summary averages match results", () => {
    const data = JSON.parse(
      readFileSync(join(benchDir, "sample-result.json"), "utf-8"),
    );
    const rawResults = data.results.filter((r: any) => r.agentType === "raw-shell");
    const rawSummary = data.summary["raw-shell"];
    expect(rawSummary.totalTasks).toBe(rawResults.length);
    expect(rawSummary.successCount).toBe(
      rawResults.filter((r: any) => r.success).length,
    );
    const avgTokens = rawResults.reduce(
      (sum: number, r: any) => sum + r.metrics.totalTokens, 0,
    ) / rawResults.length;
    expect(rawSummary.avgTotalTokens).toBe(Math.round(avgTokens));
  });
});
