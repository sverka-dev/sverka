// Drone capability manifest. Spec 36 — §24.
import type { CapabilityManifest } from "../plugin/index.js";

export const droneCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "unsupported",
  "graph.matrix": "unsupported",
  "operation.shell": "native",
  "output.scalar": "unsupported",
  "output.artifact": "partial",
  "policy.retry": "unsupported",
  "policy.timeout": "emulated",
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "trigger.schedule": "unsupported",
  "runtime.host": "emulated",
  "runtime.container": "native",
  "agent.step": "unsupported",
};
