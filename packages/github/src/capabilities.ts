// GitHub capability manifest. Spec 08 — §24.
import type { CapabilityManifest } from "@sverka/plugin";

export const githubCapabilities: CapabilityManifest = {
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "runtime.host": "native",
  "runtime.container": "native",
  "operation.shell": "native",
  "operation.import": "lowered",
  "output.scalar": "lowered",
  "output.artifact": "native",
  "graph.dependencies": "native",
  "graph.matrix": "native",
  "matrix.include": "native",
  "matrix.exclude": "native",
  "matrix.failFast": "native",
  "matrix.maxParallel": "native",
  "trigger.schedule": "native",
  "step.beforeScript": "native",
  "step.afterScript": "native",
  "step.continueOnError": "native",
  "policy.retry": "unsupported",
};
