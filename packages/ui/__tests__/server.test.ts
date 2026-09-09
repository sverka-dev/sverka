import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUiServer } from "../src/server.js";
import { renderDashboard } from "../src/dashboard.js";

const VALID_SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "test-tool" } },
      results: [
        {
          ruleId: "test-rule",
          level: "error",
          message: { text: "test message" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "test.ts" },
                region: { startLine: 1 },
              },
            },
          ],
        },
      ],
    },
  ],
});

describe("startUiServer", () => {
  let dir: string;
  let server: { close: () => void; url: string; port: number } | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sverka-ui-"));
  });

  afterEach(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts and responds to health check", async () => {
    server = await startUiServer({ artifactsDir: dir, port: 13456 });
    expect(server.port).toBe(13456);
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("dashboard lists SARIF files", async () => {
    writeFileSync(join(dir, "report1.sarif"), VALID_SARIF);
    writeFileSync(join(dir, "report2.sarif.json"), VALID_SARIF);
    server = await startUiServer({ artifactsDir: dir, port: 13457 });
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("report1.sarif");
    expect(html).toContain("report2.sarif.json");
    expect(html).toContain("Sverka Dashboard");
  });

  it("dashboard shows empty message when no SARIF files", async () => {
    server = await startUiServer({ artifactsDir: dir, port: 13458 });
    const res = await fetch(`${server.url}/`);
    const html = await res.text();
    expect(html).toContain("No SARIF files found");
  });

  it("report endpoint renders findings HTML", async () => {
    writeFileSync(join(dir, "test.sarif"), VALID_SARIF);
    server = await startUiServer({ artifactsDir: dir, port: 13459 });
    const res = await fetch(`${server.url}/report/test.sarif`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("test-rule");
    expect(html).toContain("test message");
  });

  it("report endpoint returns 404 for nonexistent file", async () => {
    server = await startUiServer({ artifactsDir: dir, port: 13460 });
    const res = await fetch(`${server.url}/report/nonexistent.sarif`);
    expect(res.status).toBe(404);
  });

  it("report endpoint rejects path traversal", async () => {
    server = await startUiServer({ artifactsDir: dir, port: 13461 });
    const res = await fetch(`${server.url}/report/..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });

  it("unknown path returns 404", async () => {
    server = await startUiServer({ artifactsDir: dir, port: 13462 });
    const res = await fetch(`${server.url}/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("renderDashboard", () => {
  it("renders dashboard HTML with file list", () => {
    const html = renderDashboard("/tmp/artifacts", ["a.sarif", "b.sarif"]);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Sverka Dashboard");
    expect(html).toContain("a.sarif");
    expect(html).toContain("b.sarif");
    expect(html).toContain("/report/a.sarif");
  });

  it("renders empty message when no files", () => {
    const html = renderDashboard("/tmp/artifacts", []);
    expect(html).toContain("No SARIF files found");
  });
});
