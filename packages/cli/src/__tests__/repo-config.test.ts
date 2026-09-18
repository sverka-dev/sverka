// The repository's own sverka.config.ts is the canonical e2e fixture: it
// must load (the root package.json declares @sverka/workflow so the config's
// import resolves) and drive graph/plan/compile end-to-end.

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../index.js";
import { CaptureWriter } from "./helpers/fixtures.js";

const REPO_ROOT = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "..",
  "..",
);

async function run(args: string[]) {
  const out = new CaptureWriter();
  const code = await main(args, { output: out });
  return { code, out };
}

describe("repository sverka.config.ts (e2e fixture)", () => {
  it("loads and prints the definition graph", async () => {
    const { code, out } = await run(["graph", "--root", REPO_ROOT]);
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("Definition Graph");
    expect(out.stdoutText).toContain("ci/lint-sarif");
  });

  it("binds a run plan from the on-push entry", async () => {
    const { code, out } = await run(["plan", "--root", REPO_ROOT]);
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("ci/on-push");
    expect(out.stdoutText).toContain("ci/lint-sarif");
  });

  it("compiles both targets including the stdout artifact handling", async () => {
    const github = await run([
      "compile",
      "--target",
      "github",
      "--root",
      REPO_ROOT,
    ]);
    expect(github.code).toBe(0);
    expect(github.out.stdoutText).toContain("actions/upload-artifact@v4");
    expect(github.out.stdoutText).toContain("eslint.sarif");

    const gitlab = await run([
      "compile",
      "--target",
      "gitlab",
      "--root",
      REPO_ROOT,
    ]);
    expect(gitlab.code).toBe(0);
    expect(gitlab.out.stdoutText).toContain("eslint.sarif");
    expect(gitlab.out.stdoutText).toContain("when: always");
  });
});
