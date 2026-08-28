import { describe, it, expect } from "vitest";
import { normalizeSarif } from "../normalize.js";
import { NormalizationError } from "../errors.js";
import {
  makeSarifLog,
  makeRun,
  makeResult,
  makeRule,
  defaultContext,
} from "./helpers/fixtures.js";
import type { SarifResult, SarifRule, SarifLog } from "../normalize.js";

describe("normalizeSarif — basic normalization", () => {
  it("produces one Finding from a minimal SARIF log with one result", () => {
    const findings = normalizeSarif(makeSarifLog(), defaultContext());
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.checkId).toBe("eslint:no-console");
    expect(f.rule).toBe("no-console");
    expect(f.file).toBe("src/index.ts");
    expect(f.startLine).toBe(10);
    expect(f.endLine).toBe(10);
    expect(f.message).toBe("Unexpected console statement.");
    expect(f.confidence).toBe(0.5);
  });

  it("constructs id as {checkId}:{fingerprint}", () => {
    const findings = normalizeSarif(makeSarifLog(), defaultContext());
    const f = findings[0]!;
    expect(f.id).toBe(`${f.checkId}:${f.fingerprint}`);
  });

  it("sets source.tool and source.originalSeverity", () => {
    const findings = normalizeSarif(makeSarifLog(), defaultContext());
    const f = findings[0]!;
    expect(f.source.tool).toBe("eslint");
    expect(f.source.version).toBe("9.0.0");
    expect(f.source.format).toBe("sarif");
    expect(f.source.originalRuleId).toBe("no-console");
    expect(f.source.originalSeverity).toBe("warning");
  });

  it("checkId is ruleId when prefix is empty", () => {
    const findings = normalizeSarif(
      makeSarifLog(),
      defaultContext({ checkIdPrefix: "" }),
    );
    expect(findings[0]!.checkId).toBe("no-console");
  });

  it("checkId is {prefix}:{ruleId} when prefix is non-empty", () => {
    const findings = normalizeSarif(
      makeSarifLog(),
      defaultContext({ checkIdPrefix: "semgrep" }),
    );
    expect(findings[0]!.checkId).toBe("semgrep:no-console");
  });
});

describe("normalizeSarif — level to severity mapping", () => {
  it("maps error to high", () => {
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ results: [makeResult({ level: "error" })] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.severity).toBe("high");
  });

  it("maps warning to medium", () => {
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ results: [makeResult({ level: "warning" })] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.severity).toBe("medium");
  });

  it("maps note to low", () => {
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ results: [makeResult({ level: "note" })] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.severity).toBe("low");
  });

  it("maps none to info", () => {
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ results: [makeResult({ level: "none" })] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.severity).toBe("info");
  });

  it("maps absent level to info", () => {
    const result = makeResult();
    delete (result as Partial<SarifResult>).level;
    const findings = normalizeSarif(
      makeSarifLog({ runs: [makeRun({ results: [result] })] }),
      defaultContext(),
    );
    expect(findings[0]!.severity).toBe("info");
  });

  it("uses rule defaultConfiguration.level when result has no level", () => {
    const rule: SarifRule = makeRule({
      defaultConfiguration: { level: "error" },
    });
    const result = makeResult();
    delete (result as Partial<SarifResult>).level;
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ tool: { driver: { name: "eslint", rules: [rule] } }, results: [result] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.severity).toBe("high");
  });
});

describe("normalizeSarif — rule resolution", () => {
  it("extracts helpUri from rule metadata", () => {
    const rule = makeRule({ helpUri: "https://example.com/no-console" });
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ tool: { driver: { name: "eslint", rules: [rule] } }, results: [makeResult()] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.helpUrl).toBe("https://example.com/no-console");
  });

  it("uses ruleIndex when ruleId is absent", () => {
    const result = makeResult();
    delete (result as Partial<SarifResult>).ruleId;
    result.ruleIndex = 0;
    const rule = makeRule({ id: "indexed-rule", helpUri: "https://example.com/indexed" });
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ tool: { driver: { name: "eslint", rules: [rule] } }, results: [result] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.rule).toBe("indexed-rule");
    expect(findings[0]!.helpUrl).toBe("https://example.com/indexed");
  });

  it("defaults ruleId to empty string when neither ruleId nor ruleIndex", () => {
    const result = makeResult();
    delete (result as Partial<SarifResult>).ruleId;
    const findings = normalizeSarif(
      makeSarifLog({
        runs: [makeRun({ tool: { driver: { name: "eslint" } }, results: [result] })],
      }),
      defaultContext(),
    );
    expect(findings[0]!.rule).toBe("");
    expect(findings[0]!.checkId).toBe("eslint:");
  });
});

describe("normalizeSarif — multi-location", () => {
  it("produces one finding per location", () => {
    const result = makeResult({
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/a.ts" },
            region: { startLine: 1, endLine: 1 },
          },
        },
        {
          physicalLocation: {
            artifactLocation: { uri: "src/b.ts" },
            region: { startLine: 2, endLine: 2 },
          },
        },
      ],
    });
    const findings = normalizeSarif(
      makeSarifLog({ runs: [makeRun({ results: [result] })] }),
      defaultContext(),
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]!.file).toBe("src/a.ts");
    expect(findings[1]!.file).toBe("src/b.ts");
    expect(findings[0]!.fingerprint).not.toBe(findings[1]!.fingerprint);
  });

  it("extracts snippet from region", () => {
    const result = makeResult({
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/index.ts" },
            region: { startLine: 10, endLine: 10, snippet: { text: "console.log(1)" } },
          },
        },
      ],
    });
    const findings = normalizeSarif(
      makeSarifLog({ runs: [makeRun({ results: [result] })] }),
      defaultContext(),
    );
    expect(findings[0]!.snippet).toBe("console.log(1)");
  });

  it("extracts startColumn and endColumn", () => {
    const result = makeResult({
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/index.ts" },
            region: { startLine: 10, endLine: 10, startColumn: 3, endColumn: 14 },
          },
        },
      ],
    });
    const findings = normalizeSarif(
      makeSarifLog({ runs: [makeRun({ results: [result] })] }),
      defaultContext(),
    );
    expect(findings[0]!.startColumn).toBe(3);
    expect(findings[0]!.endColumn).toBe(14);
  });
});

describe("normalizeSarif — empty inputs", () => {
  it("returns [] for empty runs array", () => {
    expect(normalizeSarif(makeSarifLog({ runs: [] }), defaultContext())).toEqual(
      [],
    );
  });

  it("returns [] for empty results array", () => {
    const findings = normalizeSarif(
      makeSarifLog({ runs: [makeRun({ results: [] })] }),
      defaultContext(),
    );
    expect(findings).toEqual([]);
  });
});

describe("normalizeSarif — determinism", () => {
  it("identical SARIF + context produce identical Finding[]", () => {
    const sarif = makeSarifLog();
    const ctx = defaultContext();
    const a = normalizeSarif(sarif, ctx);
    const b = normalizeSarif(sarif, ctx);
    expect(a).toEqual(b);
    expect(a[0]!.fingerprint).toBe(b[0]!.fingerprint);
    expect(a[0]!.id).toBe(b[0]!.id);
  });
});

describe("normalizeSarif — error cases", () => {
  it("throws INVALID_SARIF for wrong version", () => {
    const badSarif = { version: "2.0.0", runs: [] } as unknown as SarifLog;
    expect(() => normalizeSarif(badSarif, defaultContext())).toThrow(
      NormalizationError,
    );
    try {
      normalizeSarif(badSarif, defaultContext());
    } catch (e) {
      expect((e as NormalizationError).code).toBe("INVALID_SARIF");
    }
  });

  it("throws INVALID_SARIF for missing runs", () => {
    expect(() =>
      normalizeSarif(
        { version: "2.1.0", runs: undefined as unknown as never[] },
        defaultContext(),
      ),
    ).toThrow(NormalizationError);
  });

  it("throws INVALID_SARIF when run has no tool.driver.name", () => {
    expect(() =>
      normalizeSarif(
        makeSarifLog({
          runs: [
            {
              tool: { driver: { name: "" } },
              results: [],
            } as never,
          ],
        }),
        defaultContext(),
      ),
    ).toThrow(NormalizationError);
  });

  it("throws MISSING_LOCATION for result without locations", () => {
    const result = makeResult();
    delete (result as Partial<SarifResult>).locations;
    expect(() =>
      normalizeSarif(
        makeSarifLog({ runs: [makeRun({ results: [result] })] }),
        defaultContext(),
      ),
    ).toThrow(NormalizationError);
    try {
      normalizeSarif(
        makeSarifLog({ runs: [makeRun({ results: [result] })] }),
        defaultContext(),
      );
    } catch (e) {
      expect((e as NormalizationError).code).toBe("MISSING_LOCATION");
    }
  });

  it("throws MISSING_LOCATION for result with empty locations array", () => {
    const result = makeResult({ locations: [] });
    expect(() =>
      normalizeSarif(
        makeSarifLog({ runs: [makeRun({ results: [result] })] }),
        defaultContext(),
      ),
    ).toThrow(NormalizationError);
  });
});
