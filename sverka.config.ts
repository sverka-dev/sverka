import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  push,
  manual,
} from "@sverka/workflow";

const proj = new Project("sverka");

// Least privilege for generated CI — same as hand-written ci.yml.
const ci = new Pipeline(proj, "ci", {
  permissions: { actions: "read", contents: "read" },
});

// nx loads vendored @nx-devkit/* plugins — they must be built after install
// (CI compiles this pipeline: setup-bun + bun install are injected, then
// beforeScript runs before the step command).
const nxPlugins = ["bun run build:nx-plugins"];

// Build first: package tests resolve workspace deps via dist/.
const build = new ShellStep(ci, "build", {
  command: "bun run build",
  beforeScript: nxPlugins,
});
const typecheck = new ShellStep(ci, "typecheck", {
  command: "bun run typecheck",
  dependsOn: [build.node.id],
  beforeScript: nxPlugins,
});
const lint = new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependsOn: [typecheck.node.id],
  beforeScript: nxPlugins,
});
const test = new ShellStep(ci, "test", {
  command: "bun run test",
  dependsOn: [lint.node.id],
  beforeScript: nxPlugins,
});

// Emits SARIF on stdout → collected as a finding artifact for the policy
// gate. Always exits 0: eslint exits 1 on findings, and a failed step would
// skip the artifact export — policy is the gate, not eslint's exit code.
const lintSarif = new ShellStep(ci, "lint-sarif", {
  command: "bun run lint:sarif || true",
  runtime: { shell: "sh" },
  outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
});

// Policy gate on the lint SARIF (Spec 16). DEFAULT_POLICY fails on any
// high-severity finding and on new medium-severity findings (no baseline).
// The artifact lands as a bare file locally and under <name>/<name> in CI
// (download-artifact treats `path` as a directory) — `find` resolves both.
const policy = new ShellStep(ci, "policy", {
  command:
    "bun packages/cli/src/bin.ts policy --findings \"$(find eslint.sarif -type f -name '*.sarif' | head -n1)\"",
  runtime: { shell: "sh" },
  inputs: [
    {
      kind: "step",
      step: lintSarif.node.id,
      output: "eslint.sarif",
      type: "artifact",
    },
  ],
  beforeScript: [...nxPlugins, "bun run build"],
});

// Dependency vulnerabilities (bun audit exits non-zero on findings).
const audit = new ShellStep(ci, "audit", { command: "bun audit" });

// Formatting gate — prettier version is pinned in devDependencies/lockfile.
const format = new ShellStep(ci, "format", { command: "bun run format:check" });

// Self-check: runs the CLI from source — needs built workspace deps.
// CI jobs are isolated runners, so beforeScript builds them in-job.
const doctor = new ShellStep(ci, "doctor", {
  command: "bun packages/cli/src/bin.ts doctor",
  beforeScript: [...nxPlugins, "bun run build"],
});

// Drift guard: .github/workflows/sverka.yml must equal `compile --pin`
// output — catches edits to the generated file (e.g. dependabot bumps
// that belong in the compiler's pinned-actions registry instead).
// compile exits non-zero on error diagnostics (e.g. unpinned actions),
// so its exit code is propagated explicitly — a bare `| diff` would
// mask a failed compile when the emitted YAML happens to match.
const drift = new ShellStep(ci, "workflow-drift", {
  command:
    'f=$(mktemp) && trap \'rm -f "$f"\' EXIT && bun packages/cli/src/bin.ts compile --target github --pin > "$f" && diff "$f" .github/workflows/sverka.yml',
  runtime: { shell: "sh" },
  beforeScript: [...nxPlugins, "bun run build"],
});

// Docs gate — markdownlint over engdocs/specs/website/root docs.
// markdownlint-cli2 and .markdownlint.json were already in the repo;
// this step is what makes them a gate instead of decoration.
const docs = new ShellStep(ci, "docs", {
  command: "bun run lint:md",
});

// CLI dogfood — every read-only command must work on this repo.
const cliSmoke = new ShellStep(ci, "cli-smoke", {
  command:
    "bun packages/cli/src/bin.ts validate && bun packages/cli/src/bin.ts plan --format json && bun packages/cli/src/bin.ts discover --format json && bun packages/cli/src/bin.ts graph && bun packages/cli/src/bin.ts check --format json",
  runtime: { shell: "sh" },
  beforeScript: [...nxPlugins, "bun run build"],
});

// Dependency boundary — UI frameworks (ink/react/web servers) must stay
// out of the core packages; reporter is the only place they may live.
const depBoundary = new ShellStep(ci, "dep-boundary", {
  command:
    "! grep -rE 'from \"(ink|react|react-dom|express|fastify|ws)\"' packages/cli/src packages/sdk/src packages/runtime/src packages/workflow/src packages/verification/src packages/compiler/src packages/storage/src && ! grep -E '\"(ink|react|react-dom|express|fastify)\":' packages/cli/package.json packages/sdk/package.json packages/runtime/package.json packages/workflow/package.json packages/verification/package.json packages/compiler/package.json packages/storage/package.json",
  runtime: { shell: "sh" },
});

// Spelling gate — cspell with the project dictionary in cspell.json
// (Sverka/SARIF domain vocabulary is whitelisted there, not disabled).
const spell = new ShellStep(ci, "spell", {
  command: "bun run lint:spell",
});

// Secret scanning — secretlint recommend preset; .secretlintignore scopes
// out vendor, lockfiles and generated output.
const secrets = new ShellStep(ci, "secrets", {
  command: "bun run lint:secrets",
});

// Dead code / dependency hygiene — knip.json scopes out vendor, generated
// output, fixtures and the intentional compat surface. Configuration
// hints are advisory; findings fail the gate.
const deps = new ShellStep(ci, "deps", {
  command: "bun run lint:deps",
});

// Package metadata gate — publint over every publishable package. CI jobs
// are isolated runners, so beforeScript rebuilds dist/ in-job. Suggestions
// (e.g. missing sideEffects) don't fail; errors do.
const packlint = new ShellStep(ci, "packlint", {
  command:
    'for d in packages/*/; do echo "== $d"; (cd "$d" && ../../node_modules/.bin/publint) || exit 1; done',
  runtime: { shell: "sh" },
  beforeScript: [...nxPlugins, "bun run build"],
});

// Workflow lint — actionlint checks the hand-written workflows AND the
// generated sverka.yml. Installed from source at a pinned tag; Go is
// preinstalled on GitHub runners and in the devenv image.
const actionlint = new ShellStep(ci, "actionlint", {
  command:
    'go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 && "$(go env GOPATH)/bin/actionlint" .github/workflows/*.yml',
  runtime: { shell: "sh" },
});

// Recursive dogfood — sverka runs itself inside CI. The inner run targets
// the manual self-demo entry below (never this step — no recursion) and
// exercises the whole local engine in one job: scheduling → step exec →
// artifact export → findings collection → policy verdict → HTML report.
// The report is uploaded as a CI artifact (outputs → upload-artifact).
const selfRun = new ShellStep(ci, "self-run", {
  command:
    "bun packages/cli/src/bin.ts run --entry ci/self-demo --format html --output .sverka/report.html",
  runtime: { shell: "sh" },
  outputs: {
    "sverka-report": { type: "artifact", path: ".sverka/report.html" },
  },
  beforeScript: [...nxPlugins, "bun run build"],
});

export const onPush = new Entry(ci, "on-push", {
  trigger: push(),
  roots: [
    test.node.id, // pulls build → typecheck → lint via dependsOn
    policy.node.id, // pulls lint-sarif via artifact input
    audit.node.id,
    format.node.id,
    doctor.node.id,
    drift.node.id,
    docs.node.id,
    cliSmoke.node.id,
    depBoundary.node.id,
    spell.node.id,
    secrets.node.id,
    deps.node.id,
    packlint.node.id,
    actionlint.node.id,
    selfRun.node.id,
  ],
});

// Manual entry — adds workflow_dispatch to the compiled workflow and is the
// inner target of the self-run step. Roots are cheap steps only: lint-sarif
// feeds the findings/policy path, dep-boundary exercises multi-step runs.
export const selfDemo = new Entry(ci, "self-demo", {
  trigger: manual(),
  roots: [lintSarif.node.id, depBoundary.node.id],
});

export default proj;
