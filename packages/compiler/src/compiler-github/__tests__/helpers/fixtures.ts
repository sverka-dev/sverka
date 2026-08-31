import type { Plan, PlanOperation, CredentialDeclaration } from "@sverka/workflow";

/**
 * Build a minimal PlanOperation with sensible defaults.
 */
export function makeOperation(
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  return {
    id: "op-test",
    kind: "check",
    name: "test",
    dependsOn: [],
    executor: { type: "host" },
    resources: { cpu: "1", memory: "512Mi" },
    network: "deny",
    credentials: [],
    artifacts: [],
    retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: [] },
    timeoutSeconds: 60,
    continueOnError: false,
    ...overrides,
  };
}

/**
 * Build a minimal Plan with one operation.
 */
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    apiVersion: "sverka.dev/v1",
    id: "plan-test",
    name: "test-plan",
    sourceContextHash: "abc123",
    operations: [makeOperation()],
    metadata: { sverkaVersion: "0.0.0", generatedBy: "manual" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build a Plan with operations declaring the given credential envVars.
 */
export function makePlanWithCredentials(
  envVars: string[],
): Plan {
  const operations = envVars.map((envVar, i) =>
    makeOperation({
      id: `op-${i}`,
      name: `check-${i}`,
      credentials: [
        { name: `cred-${i}`, envVar, required: true } satisfies CredentialDeclaration,
      ],
    })
  );
  return makePlan({ operations });
}
