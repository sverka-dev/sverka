// Hub dashboard pages — run list, run detail, flaky view, projects index.

import { describe, it, expect } from "vitest";
import {
  renderHubIndex,
  renderHubRunList,
  renderHubRunDetail,
  renderHubFlaky,
} from "../src/hub-pages.js";
import type { HubRunView } from "../src/hub-pages.js";

const ROW = {
  runId: "run-1",
  project: "acme/app",
  entry: "ci/on-push",
  status: "success",
  startedAt: 1_760_000_000_000,
  durationMs: 4200,
  findingCounts: { total: 3, bySeverity: { high: 1, medium: 2 } },
};

const RUN: HubRunView = {
  ...ROW,
  report: {
    schema: "sverka.run/v1",
    data: {
      planId: "rp-1",
      status: "success",
      steps: [
        { stepId: "ci/build", status: "succeeded", durationMs: 1200 },
        { stepId: "ci/test", status: "failed", error: "boom", durationMs: 30 },
      ],
      findings: 3,
      verdict: "fail",
    },
    durationMs: 4200,
  },
  findings: [{ id: "f1" }],
  uploadedAt: 1_760_000_100_000,
};

describe("hub pages", () => {
  it("run list renders rows with links and severity badges", () => {
    const html = renderHubRunList({ project: "acme/app", runs: [ROW] });
    expect(html).toContain('href="/runs/acme%2Fapp/run-1"');
    expect(html).toContain("ci/on-push");
    expect(html).toContain("high:1");
    expect(html).toContain("medium:2");
    expect(html).toContain("/flaky/acme%2Fapp");
  });

  it("run list empty state", () => {
    const html = renderHubRunList({ project: "acme/app", runs: [] });
    expect(html).toContain("No runs recorded");
  });

  it("run detail renders steps table + findings iframe", () => {
    const html = renderHubRunDetail({ run: RUN });
    expect(html).toContain("Run run-1");
    expect(html).toContain("ci/build");
    expect(html).toContain("boom");
    expect(html).toContain('src="/runs/acme%2Fapp/run-1/findings"');
  });

  it("run detail with zero findings shows the empty state", () => {
    const html = renderHubRunDetail({ run: { ...RUN, findings: [] } });
    expect(html).toContain("No findings in this run");
    expect(html).not.toContain("<iframe");
  });

  it("flaky page renders worst-first rows", () => {
    const html = renderHubFlaky({
      project: "acme/app",
      rows: [
        { stepId: "ci/flaky", successRate: 0.7, runs: 10 },
        { stepId: "ci/stable", successRate: 1, runs: 10 },
      ],
      window: 10,
    });
    expect(html).toContain("ci/flaky");
    expect(html).toContain("70.0%");
    expect(html).toContain("100.0%");
    expect(html.indexOf("ci/flaky")).toBeLessThan(html.indexOf("ci/stable"));
  });

  it("index lists projects", () => {
    const html = renderHubIndex({ projects: ["a/b", "c/d"] });
    expect(html).toContain('href="/?project=a%2Fb"');
    expect(html).toContain("c/d");
  });

  it("escapes user data (XSS)", () => {
    const evil = { ...ROW, entry: '"><script>alert(1)</script>' };
    const html = renderHubRunList({ project: "acme/app", runs: [evil] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
