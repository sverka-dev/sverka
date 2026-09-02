// Dagger capability manifest. Spec 34 — §24.
import type { CapabilityManifest } from "../plugin/index.js";

export const daggerCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "partial",
  "graph.matrix": "emulated",
  "operation.shell": "native",
  "output.scalar": "unsupported",
  "output.artifact": "unsupported",
  "policy.retry": "emulated",
  "policy.timeout": "native",
  "trigger.push": "unsupported",
  "trigger.changeRequest": "unsupported",
  "trigger.manual": "unsupported",
  "trigger.schedule": "unsupported",
  "runtime.host": "unsupported",
  "runtime.container": "native",
  "agent.step": "emulated",
};
