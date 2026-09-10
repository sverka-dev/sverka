// @sverka/verification — SARIF serialization (Finding[] → SarifLog).

import type { Finding, Severity } from "./types.js";
import type { SarifLog, SarifRun, SarifResult, SarifRule, SarifLocation } from "./normalize.js";

/** Map Sverka severity to SARIF level. */
const SEVERITY_TO_LEVEL: Record<Severity, "error" | "warning" | "note" | "none"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "none",
};

/**
 * Serialize a list of Findings into a SARIF 2.1.0 log.
 *
 * Groups findings by source tool, deduplicates rules, and produces
 * one run per tool. The output is valid SARIF 2.1.0 that can be
 * consumed by any SARIF viewer (VS Code, GitHub, etc.).
 *
 * Pure — no I/O.
 */
export function serializeSarif(findings: readonly Finding[]): SarifLog {
  if (findings.length === 0) {
    // SARIF 2.1.0 requires at least one run. Emit an empty run for "sverka"
    // so strict consumers don't reject the log.
    return {
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "sverka",
              rules: [],
            },
          },
          results: [],
        },
      ],
    };
  }

  // Group findings by tool name + version (same tool with different
  // versions produces separate SARIF runs).
  const byTool = new Map<string, { tool: string; version: string | null; findings: Finding[] }>();
  for (const f of findings) {
    const tool = f.source.tool;
    const version = f.source.version ?? null;
    const key = `${tool}\0${version ?? ""}`;
    let group = byTool.get(key);
    if (!group) {
      group = { tool, version, findings: [] };
      byTool.set(key, group);
    }
    group.findings.push(f);
  }

  const runs: SarifRun[] = [];
  for (const { tool, version, findings: toolFindings } of byTool) {
    runs.push(buildRun(tool, version, toolFindings));
  }

  return {
    version: "2.1.0",
    runs,
  };
}

/** Build a single SARIF run for one tool's findings. */
function buildRun(toolName: string, toolVersion: string | null, findings: readonly Finding[]): SarifRun {
  // Deduplicate rules by rule ID.
  const ruleMap = new Map<string, SarifRule>();
  for (const f of findings) {
    if (!ruleMap.has(f.rule)) {
      ruleMap.set(f.rule, {
        id: f.rule,
        ...(f.helpUrl ? { helpUri: f.helpUrl } : {}),
      });
    }
  }

  const rules = [...ruleMap.values()];
  const results: SarifResult[] = findings.map((f) => buildResult(f));

  return {
    tool: {
      driver: {
        name: toolName,
        ...(toolVersion ? { version: toolVersion } : {}),
        rules,
      },
    },
    results,
  };
}

/** Build a single SARIF result from a Finding. */
function buildResult(f: Finding): SarifResult {
  const location: SarifLocation = {
    physicalLocation: {
      artifactLocation: { uri: f.file },
      region: {
        startLine: f.startLine,
        endLine: f.endLine,
        ...(f.startColumn !== undefined ? { startColumn: f.startColumn } : {}),
        ...(f.endColumn !== undefined ? { endColumn: f.endColumn } : {}),
        ...(f.snippet ? { snippet: { text: f.snippet } } : {}),
      },
    },
  };

  return {
    ruleId: f.rule,
    level: SEVERITY_TO_LEVEL[f.severity],
    message: { text: f.message },
    locations: [location],
    fingerprints: { primary: f.fingerprint },
    // Preserve the original Sverka severity in properties, since SARIF
    // levels are lossy (critical and high both map to "error").
    properties: { sverkaSeverity: f.severity },
  };
}
