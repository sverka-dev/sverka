// GitHub capability manifest. Spec 08 — §24.
import type { CapabilityManifest } from "@sverka/plugin";

export const githubCapabilities: CapabilityManifest = {
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "runtime.host": "native",
  "runtime.container": "native",
  "operation.shell": "native",
  "output.scalar": "lowered",
  "output.artifact": "native",
  "graph.dependencies": "native",
};
