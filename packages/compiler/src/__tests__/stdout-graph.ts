// Shared graph builders for exportStdout lowering tests.
// Not a test file — fixture module imported by the per-target suites.

import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  synthesize,
} from "@sverka/workflow";

export function makeStdoutArtifactGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint-sarif", {
    command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
    runtime: { shell: "sh" },
    outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
  });
  new Entry(p, "on-push", {
    trigger: { kind: "push" },
    roots: ["lint-sarif"],
  });
  return synthesize(proj);
}

export function makeDoubleStdoutArtifactGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint-sarif", {
    command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
    outputs: {
      "eslint.sarif": { type: "artifact", fromStdout: true },
      "eslint-copy.sarif": { type: "artifact", fromStdout: true },
    },
  });
  new Entry(p, "on-push", {
    trigger: { kind: "push" },
    roots: ["lint-sarif"],
  });
  return synthesize(proj);
}

export function makeWorkingDirStdoutGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint-sarif", {
    command: "bunx eslint . -f sarif",
    runtime: { workingDir: "packages/app" },
    outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
  });
  new Entry(p, "on-push", {
    trigger: { kind: "push" },
    roots: ["lint-sarif"],
  });
  return synthesize(proj);
}

export function makeBackgroundStdoutGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "server", {
    command: "npm start",
    background: true,
    outputs: { "server.log": { type: "artifact", fromStdout: true } },
  });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["server"] });
  return synthesize(proj);
}
