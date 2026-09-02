// Inngest capability manifest. Spec 35 — §24.
import type { CapabilityManifest } from "../plugin/index.js";

export const inngestCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "partial",
  "graph.matrix": "emulated",
  "operation.shell": "emulated",
  "output.scalar": "unsupported",
  "output.artifact": "unsupported",
  "policy.retry": "native",
  "policy.timeout": "native",
  "trigger.push": "unsupported",
  "trigger.changeRequest": "unsupported",
  "trigger.manual": "native",
  "trigger.schedule": "native",
  "runtime.host": "emulated",
  "runtime.container": "emulated",
  "agent.step": "native",
};
