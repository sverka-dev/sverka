// GitLab capability manifest. Spec 09 — §24.
import type { CapabilityManifest } from "@sverka/plugin";

export const gitlabCapabilities: CapabilityManifest = {
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
  "matrix.include": "lowered",
  "matrix.exclude": "emulated",
  "matrix.failFast": "unsupported",
  "matrix.maxParallel": "unsupported",
  "trigger.schedule": "native",
  "step.beforeScript": "native",
  "step.afterScript": "native",
  "step.continueOnError": "native",
  "policy.retry": "native",
  "execution.workdir": "emulated",
  "execution.shell": "unsupported",
  "environment.variables": "native",
  "secrets.runtime": "native",
  // Secret pipeline inputs are not emitted in the generated .gitlab-ci.yml;
  // the user must configure a masked CI/CD variable in the project settings.
  "secrets.pipeline-input": "emulated",
};
