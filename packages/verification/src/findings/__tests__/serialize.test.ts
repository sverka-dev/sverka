import { describe, it, expect } from "vitest";
import { serializeSarif } from "../serialize.js";
import { normalizeSarif } from "../normalize.js";
import type { Finding } from "../types.js";
import type { SarifLog } from "../normalize.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const fingerprint = overrides.fingerprint ?? "fp1";
  const checkId = overrides.checkId ?? "ci/lint";
  return {
    id: overrides.id ?? `${checkId}:${fingerprint}`,
    fingerprint,
    checkId,
    severity: overrides.severity ?? "high",
    confidence: overrides.confidence ?? 0.5,
    message: overrides.message ?? "test finding",
    rule: overrides.rule ?? "rule-1",
    file: overrides.file ?? "src/index.ts",
    startLine: overrides.startLine ?? 10,
    endLine: overrides.endLine ?? 10,
    source: overrides.source ?? {
      tool: "test-tool",
      version: null,
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: null,
    },
    ...overrides,
  };
}

describe("serializeSarif", () => {
  it("produces valid SARIF 2.1.0 structure", () => {
    const log = serializeSarif([makeFinding()]);
    expect(log.version).toBe("2.1.0");
    expect(Array.isArray(log.runs)).toBe(true);
  });

  it("empty findings produce a valid SARIF run (2.1.0 requires at least one)", () => {
    const log = serializeSarif([]);
    expect(log.version).toBe("2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe("sverka");
    expect(log.runs[0].results).toEqual([]);
  });

  it("groups findings by tool into separate runs", () => {
    const findings = [
      makeFinding({ id: "a", source: { tool: "eslint", version: null, format: "sarif", originalRuleId: "r1", originalSeverity: null } }),
      makeFinding({ id: "b", source: { tool: "semgrep", version: null, format: "sarif", originalRuleId: "r2", originalSeverity: null } }),
    ];
    const log = serializeSarif(findings);
    expect(log.runs).toHaveLength(2);
    expect(log.runs[0].tool.driver.name).toBe("eslint");
    expect(log.runs[1].tool.driver.name).toBe("semgrep");
  });

  it("deduplicates rules within a run", () => {
    const findings = [
      makeFinding({ id: "a", rule: "no-unused-vars" }),
      makeFinding({ id: "b", rule: "no-unused-vars" }),
      makeFinding({ id: "c", rule: "no-console" }),
    ];
    const log = serializeSarif(findings);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.rules).toHaveLength(2);
    expect(log.runs[0].tool.driver.rules?.[0].id).toBe("no-unused-vars");
    expect(log.runs[0].tool.driver.rules?.[1].id).toBe("no-console");
  });

  it("maps severity to SARIF level correctly", () => {
    const findings = [
      makeFinding({ id: "c", severity: "critical" }),
      makeFinding({ id: "h", severity: "high" }),
      makeFinding({ id: "m", severity: "medium" }),
      makeFinding({ id: "l", severity: "low" }),
      makeFinding({ id: "i", severity: "info" }),
    ];
    const log = serializeSarif(findings);
    const results = log.runs[0].results;
    expect(results[0].level).toBe("error"); // critical
    expect(results[1].level).toBe("error"); // high
    expect(results[2].level).toBe("warning"); // medium
    expect(results[3].level).toBe("note"); // low
    expect(results[4].level).toBe("none"); // info
  });

  it("includes location with file, startLine, endLine", () => {
    const log = serializeSarif([makeFinding({ file: "src/foo.ts", startLine: 5, endLine: 8 })]);
    const loc = log.runs[0].results[0].locations[0];
    expect(loc.physicalLocation.artifactLocation.uri).toBe("src/foo.ts");
    expect(loc.physicalLocation.region?.startLine).toBe(5);
    expect(loc.physicalLocation.region?.endLine).toBe(8);
  });

  it("includes optional columns and snippet when present", () => {
    const log = serializeSarif([
      makeFinding({ startColumn: 3, endColumn: 10, snippet: "const x = 1;" }),
    ]);
    const region = log.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region?.startColumn).toBe(3);
    expect(region?.endColumn).toBe(10);
    expect(region?.snippet?.text).toBe("const x = 1;");
  });

  it("includes fingerprint in results", () => {
    const log = serializeSarif([makeFinding({ fingerprint: "abc123" })]);
    expect(log.runs[0].results[0].fingerprints?.primary).toBe("abc123");
  });

  it("includes helpUri in rules when helpUrl is present", () => {
    const log = serializeSarif([makeFinding({ helpUrl: "https://docs.example.com/rule" })]);
    expect(log.runs[0].tool.driver.rules?.[0].helpUri).toBe("https://docs.example.com/rule");
  });

  it("includes tool version when available", () => {
    const log = serializeSarif([
      makeFinding({ source: { tool: "eslint", version: "9.0.0", format: "sarif", originalRuleId: "r1", originalSeverity: null } }),
    ]);
    expect(log.runs[0].tool.driver.version).toBe("9.0.0");
  });

  it("round-trips: normalize → serialize → normalize produces same findings", () => {
    // This is a key property: serialize then normalize should be lossless
    // for the core fields.
    const original = [
      makeFinding({ id: "a", rule: "test-rule", file: "src/a.ts", startLine: 1, endLine: 1, message: "msg a" }),
      makeFinding({ id: "b", rule: "test-rule", file: "src/b.ts", startLine: 5, endLine: 7, message: "msg b" }),
    ];
    const sarif = serializeSarif(original);
    const sarifJson = JSON.stringify(sarif);
    const reparsed = JSON.parse(sarifJson) as SarifLog;
    const reFindings = normalizeSarif(reparsed, {
      root: "/",
      checkIdPrefix: "",
      defaultConfidence: 0.5,
    });
    expect(reFindings).toHaveLength(2);
    expect(reFindings[0].rule).toBe("test-rule");
    expect(reFindings[0].file).toBe("src/a.ts");
    expect(reFindings[0].startLine).toBe(1);
    expect(reFindings[0].message).toBe("msg a");
    expect(reFindings[1].file).toBe("src/b.ts");
    expect(reFindings[1].startLine).toBe(5);
    expect(reFindings[1].endLine).toBe(7);
  });
});
