// Temporal capability manifest. Spec 33 — §24.
import type { CapabilityManifest } from "../plugin/index.js";

export const temporalCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "native",
  "graph.matrix": "emulated",
  "operation.shell": "emulated",
  "output.scalar": "native",
  "output.artifact": "partial",
  "policy.retry": "native",
  "policy.timeout": "native",
  "trigger.push": "unsupported",
  "trigger.changeRequest": "unsupported",
  "trigger.manual": "native",
  "trigger.schedule": "native",
  "runtime.host": "emulated",
  "runtime.container": "emulated",
  "agent.step": "emulated",
};
