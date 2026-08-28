// Context namespaces — typed references to context values.
// Spec 03 — §12.3. Architecture spec §12.3.

import type { ContextRef, ContextNamespace } from "@sverka/workflow";
import { createDynamicProxy } from "./internal/proxy-props.js";

/** Create a ContextRef for a namespace + field. */
function ctx(namespace: ContextNamespace, field: string): ContextRef {
  return { kind: "context", namespace, field };
}

/** Dynamic namespace proxy — any property access returns a ContextRef. */
function dynamicNamespace(namespace: ContextNamespace): Record<string, ContextRef> {
  return createDynamicProxy((prop) => ctx(namespace, prop));
}

/** Environment variable references: env.CI_TRACE, env.MY_VAR. */
export const env: Record<string, ContextRef> = dynamicNamespace("env");

/** Secret references: secrets.NPM_TOKEN. */
export const secrets: Record<string, ContextRef> = dynamicNamespace("secrets");

/** Git metadata references: git.sha, git.branch, git.tag. */
export const git = {
  sha: ctx("git", "sha"),
  branch: ctx("git", "branch"),
  tag: ctx("git", "tag"),
};

/** Change request metadata: change.id, change.source, change.target, change.draft. */
export const change = {
  id: ctx("change", "id"),
  source: ctx("change", "source"),
  target: ctx("change", "target"),
  draft: ctx("change", "draft"),
};

/** Event metadata: event.type. */
export const event = {
  type: ctx("event", "type"),
};

/** Run metadata: run.id, run.attempt. */
export const run = {
  id: ctx("run", "id"),
  attempt: ctx("run", "attempt"),
};

/** Pipeline input references: inputs.environment. */
export const inputs: Record<string, ContextRef> = dynamicNamespace("inputs");

/** Matrix variable references: matrix.node, matrix.os. */
export const matrix: Record<string, ContextRef> = dynamicNamespace("matrix");
