import type {
  Finding,
  FindingSource,
  NormalizeContext,
  Severity,
} from "./types.js";
import { computeFingerprint } from "./fingerprint.js";
import { NormalizationError } from "./errors.js";

/**
 * Minimal SARIF 2.1.0 log structure (subset required for normalization).
 */
export interface SarifLog {
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version?: string;
      rules?: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration?: { level?: string };
}

export interface SarifResult {
  /** Rule ID. May be absent when `ruleIndex` is provided instead. */
  ruleId?: string;
  /** Index into `tool.driver.rules`. Used when `ruleId` is absent. */
  ruleIndex?: number;
  level?: "none" | "note" | "warning" | "error";
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  fingerprints?: Record<string, string>;
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId?: string };
    region?: {
      startLine: number;
      endLine?: number;
      startColumn?: number;
      endColumn?: number;
      snippet?: { text: string };
    };
  };
}

const LEVEL_TO_SEVERITY: Record<string, Severity> = {
  error: "high",
  warning: "medium",
  note: "low",
  none: "info",
};

/**
 * Normalize a parsed SARIF 2.1.0 log into Findings.
 *
 * Validates the SARIF structure at runtime (TypeScript types are erased).
 * Computes fingerprints and assigns ids (`{checkId}:{fingerprint}`).
 * Multi-location results produce one finding per location.
 *
 * @throws {NormalizationError} INVALID_SARIF — structure does not conform.
 * @throws {NormalizationError} MISSING_LOCATION — a result has no location.
 */
export function normalizeSarif(
  sarif: SarifLog,
  context: NormalizeContext,
): Finding[] {
  validateSarifLog(sarif);

  const findings: Finding[] = [];
  for (const run of sarif.runs) {
    findings.push(...normalizeRun(run, context));
  }
  return findings;
}

/**
 * Validate the top-level SARIF log structure.
 * @throws {NormalizationError} INVALID_SARIF
 */
function validateSarifLog(sarif: SarifLog): void {
  if (sarif.version !== "2.1.0") {
    throw new NormalizationError(
      `expected SARIF version "2.1.0", got "${String(sarif.version)}"`,
      "INVALID_SARIF",
      { version: sarif.version },
    );
  }
  if (!Array.isArray(sarif.runs)) {
    throw new NormalizationError(
      "SARIF log must have a runs array",
      "INVALID_SARIF",
    );
  }
}

/**
 * Normalize a single SARIF run into Findings.
 * @throws {NormalizationError} INVALID_SARIF — missing driver or results.
 */
function normalizeRun(
  run: SarifRun,
  context: NormalizeContext,
): Finding[] {
  const driver = run?.tool?.driver;
  if (!driver || typeof driver.name !== "string" || !driver.name) {
    throw new NormalizationError(
      "each SARIF run must have tool.driver.name",
      "INVALID_SARIF",
    );
  }
  if (!Array.isArray(run.results)) {
    throw new NormalizationError(
      "each SARIF run must have a results array",
      "INVALID_SARIF",
    );
  }

  const toolName = driver.name;
  const toolVersion = driver.version ?? null;
  const rules = driver.rules ?? [];

  const findings: Finding[] = [];
  for (const result of run.results) {
    findings.push(...normalizeResult(result, context, toolName, toolVersion, rules));
  }
  return findings;
}

/**
 * Normalize a single SARIF result into one Finding per location.
 * @throws {NormalizationError} MISSING_LOCATION — no locations.
 */
function normalizeResult(
  result: SarifResult,
  context: NormalizeContext,
  toolName: string,
  toolVersion: string | null,
  rules: readonly SarifRule[],
): Finding[] {
  const { ruleId, rule } = resolveRule(result, rules);
  const level = result.level ?? rule?.defaultConfiguration?.level;
  const severity = level ? (LEVEL_TO_SEVERITY[level] ?? "info") : "info";
  const helpUrl = rule?.helpUri;
  const originalSeverity = result.level ?? null;

  const locations = result.locations;
  if (!Array.isArray(locations) || locations.length === 0) {
    throw new NormalizationError(
      "SARIF result has no locations",
      "MISSING_LOCATION",
      { ruleId },
    );
  }

  const findings: Finding[] = [];
  for (const location of locations) {
    findings.push(
      buildFinding(location, result, context, ruleId, severity, helpUrl, originalSeverity, toolName, toolVersion),
    );
  }
  return findings;
}

/**
 * Build a single Finding from a SARIF location.
 */
function buildFinding(
  location: SarifLocation,
  result: SarifResult,
  context: NormalizeContext,
  ruleId: string,
  severity: Severity,
  helpUrl: string | undefined,
  originalSeverity: "none" | "note" | "warning" | "error" | null,
  toolName: string,
  toolVersion: string | null,
): Finding {
  const phys = location?.physicalLocation;
  const uri = phys?.artifactLocation?.uri ?? "";
  const region = phys?.region;
  const startLine = region?.startLine ?? 0;
  const endLine = region?.endLine ?? startLine;

  const checkId = context.checkIdPrefix
    ? `${context.checkIdPrefix}:${ruleId}`
    : ruleId;

  const source: FindingSource = {
    tool: toolName,
    version: toolVersion,
    format: "sarif",
    originalRuleId: ruleId,
    originalSeverity,
  };

  const fingerprint = computeFingerprint({
    rule: ruleId,
    file: uri,
    startLine,
    endLine,
    checkId,
  });

  return {
    id: `${checkId}:${fingerprint}`,
    fingerprint,
    checkId,
    severity,
    confidence: context.defaultConfidence,
    message: result.message?.text ?? "",
    rule: ruleId,
    file: uri,
    startLine,
    endLine,
    ...(region?.startColumn !== undefined
      ? { startColumn: region.startColumn }
      : {}),
    ...(region?.endColumn !== undefined
      ? { endColumn: region.endColumn }
      : {}),
    ...(helpUrl !== undefined ? { helpUrl } : {}),
    source,
    ...(region?.snippet?.text !== undefined
      ? { snippet: region.snippet.text }
      : {}),
  };
}

/**
 * Resolve the rule for a SARIF result. Returns the ruleId (string, possibly
 * empty) and the matching SarifRule (if any).
 */
function resolveRule(
  result: SarifResult,
  rules: readonly SarifRule[],
): { ruleId: string; rule: SarifRule | undefined } {
  if (result.ruleId !== undefined && result.ruleId !== "") {
    const rule = rules.find((r) => r.id === result.ruleId);
    return { ruleId: result.ruleId, rule };
  }
  if (result.ruleIndex !== undefined) {
    const rule = rules[result.ruleIndex];
    if (rule) {
      return { ruleId: rule.id, rule };
    }
  }
  return { ruleId: "", rule: undefined };
}
