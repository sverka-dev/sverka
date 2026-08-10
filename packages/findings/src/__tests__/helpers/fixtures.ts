import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SarifLog,
  SarifRun,
  SarifResult,
  SarifRule,
} from "../../normalize.js";
import type { NormalizeContext } from "../../types.js";

/**
 * Build a minimal SARIF rule.
 */
export function makeRule(overrides: Partial<SarifRule> = {}): SarifRule {
  return {
    id: "no-console",
    name: "no-console",
    ...overrides,
  };
}

/**
 * Build a minimal SARIF result with one location.
 */
export function makeResult(overrides: Partial<SarifResult> = {}): SarifResult {
  return {
    ruleId: "no-console",
    level: "warning",
    message: { text: "Unexpected console statement." },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: "src/index.ts" },
          region: { startLine: 10, endLine: 10 },
        },
      },
    ],
    ...overrides,
  };
}

/**
 * Build a minimal SARIF run with one driver and results.
 */
export function makeRun(overrides: Partial<SarifRun> = {}): SarifRun {
  return {
    tool: {
      driver: {
        name: "eslint",
        version: "9.0.0",
        rules: [makeRule()],
      },
    },
    results: [makeResult()],
    ...overrides,
  };
}

/**
 * Build a minimal valid SARIF 2.1.0 log.
 */
export function makeSarifLog(overrides: Partial<SarifLog> = {}): SarifLog {
  return {
    version: "2.1.0",
    runs: [makeRun()],
    ...overrides,
  };
}

/**
 * A default NormalizeContext.
 */
export function defaultContext(
  overrides: Partial<NormalizeContext> = {},
): NormalizeContext {
  return {
    root: "/project",
    checkIdPrefix: "eslint",
    defaultConfidence: 0.5,
    ...overrides,
  };
}

/**
 * Create a temp directory and return its path. Caller is responsible for
 * cleanup via `cleanupTempDir`.
 */
export async function makeTempDir(
  prefix = "sverka-findings-",
): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Remove a temp directory recursively.
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Write content to a file inside a temp directory and return the full path.
 */
export async function writeTempFile(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}
