import type {
  ProposedCheck,
  ProjectContext,
  DetectedPackageManager,
  DiscoveryExplanation,
} from "@sverka/planner";

/**
 * Build a ProposedCheck with sensible defaults.
 */
export function makeCheck(checkId: string, reason = "test"): ProposedCheck {
  return {
    id: `prop-${checkId}`,
    checkId,
    reason,
    signalRef: null,
    priority: 2,
  };
}

const EMPTY_EXPLANATION: DiscoveryExplanation = {
  summary: "test",
  signalCounts: {
    manifest: 0,
    lockfile: 0,
    dockerfile: 0,
    "docker-compose": 0,
    "ci-definition": 0,
    "monorepo-marker": 0,
    "git-metadata": 0,
  },
};

/**
 * Build a ProjectContext with the given package manager names and
 * sensible defaults for all other fields.
 */
export function makeContext(
  pmNames: DetectedPackageManager["name"][],
): ProjectContext {
  return {
    root: "/tmp/proj",
    commit: "abc123",
    dirty: false,
    changedFiles: [],
    languages: [],
    packageManagers: pmNames.map((name) => ({
      name,
      version: null,
      lockfile: null,
      evidence: [],
    })),
    hasContainerBuild: false,
    hasCiDefinition: false,
    monorepo: null,
    localSignals: [],
    explanation: EMPTY_EXPLANATION,
  };
}

/**
 * A minimal valid SARIF 2.1.0 log with one result.
 */
export function sampleSarif(): unknown {
  return {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "test-tool", version: "1.0.0" } },
        results: [
          {
            ruleId: "R1",
            level: "error",
            message: { text: "bad code" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "src/a.ts" },
                  region: { startLine: 1, endLine: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
