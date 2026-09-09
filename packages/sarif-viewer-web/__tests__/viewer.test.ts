import { describe, it, expect } from "vitest";
import { generateSarifHtml } from "../src/viewer.js";
import { makeFinding } from "./helpers/fixtures.js";

describe("generateSarifHtml", () => {
  it("generates valid HTML from Finding[]", () => {
    const html = generateSarifHtml([makeFinding()]);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<table");
    expect(html).toContain("</table>");
  });

  it("contains all findings with severity badges", () => {
    const findings = [
      makeFinding({ id: "a", severity: "critical", message: "critical issue" }),
      makeFinding({ id: "b", severity: "low", message: "low issue" }),
    ];
    const html = generateSarifHtml(findings);
    expect(html).toContain('class="severity-critical"');
    expect(html).toContain("critical issue");
    expect(html).toContain('class="severity-low"');
    expect(html).toContain("low issue");
  });

  it("summary header shows total count, severity breakdown, and tool name", () => {
    const findings = [
      makeFinding({ id: "a", severity: "critical", source: { tool: "semgrep", version: null, format: "sarif", originalRuleId: "r1", originalSeverity: null } }),
      makeFinding({ id: "b", severity: "high" }),
      makeFinding({ id: "c", severity: "high" }),
      makeFinding({ id: "d", severity: "medium" }),
    ];
    const html = generateSarifHtml(findings);
    expect(html).toContain(">4<");
    expect(html).toContain("semgrep");
    expect(html).toContain("1 critical");
    expect(html).toContain("2 high");
    expect(html).toContain("1 medium");
  });

  it("empty findings show 'No findings' message", () => {
    const html = generateSarifHtml([]);
    expect(html).toContain("No findings");
    expect(html).toContain(">0<");
    expect(html).toContain("unknown");
  });

  it("is self-contained — no external script or style tags", () => {
    const html = generateSarifHtml([makeFinding()]);
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link href=");
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("cdn");
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
  });

  it("XSS safety — script tags in finding messages are escaped", () => {
    const findings = [
      makeFinding({ id: "xss", message: '<script>alert("xss")</script>' }),
    ];
    const html = generateSarifHtml(findings);
    // The raw message should not appear as executable HTML
    expect(html).not.toContain('<script>alert("xss")</script>');
    // It should be escaped in the table rows
    expect(html).toContain("<script>");
  });

  it("XSS safety — script tags in finding JSON data are escaped", () => {
    const findings = [
      makeFinding({ id: "xss2", message: '</script><script>alert(1)' }),
    ];
    const html = generateSarifHtml(findings);
    // The JSON data should have < replaced with \u003c
    expect(html).toContain("\\u003c");
    expect(html).not.toContain("__FINDINGS_DATA__ </script>");
  });

  it("has filter buttons for all 6 severity levels", () => {
    const html = generateSarifHtml([makeFinding()]);
    expect(html).toContain('data-severity="all"');
    expect(html).toContain('data-severity="critical"');
    expect(html).toContain('data-severity="high"');
    expect(html).toContain('data-severity="medium"');
    expect(html).toContain('data-severity="low"');
    expect(html).toContain('data-severity="info"');
  });

  it("has sortable column headers", () => {
    const html = generateSarifHtml([makeFinding()]);
    expect(html).toContain('data-sort="severity"');
    expect(html).toContain('data-sort="checkId"');
    expect(html).toContain('data-sort="file"');
    expect(html).toContain('data-sort="rule"');
    expect(html).toContain('data-sort="message"');
  });

  it("has search input", () => {
    const html = generateSarifHtml([makeFinding()]);
    expect(html).toContain('id="findings-search"');
    expect(html).toContain("Search findings");
  });
});
