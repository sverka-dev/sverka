import {
  Project,
  Pipeline,
  ShellStep,
  Entry,
  push,
  manual,
  schedule,
} from "@sverka/workflow";

const proj = new Project("sverka");

// Least privilege for generated CI — same as hand-written ci.yml.
const ci = new Pipeline(proj, "ci", {
  permissions: { actions: "read", contents: "read" },
});

// Build first: package tests resolve workspace deps via dist/.
const build = new ShellStep(ci, "build", {
  command: "bun run build",
});
const typecheck = new ShellStep(ci, "typecheck", {
  command: "bun run typecheck",
  dependsOn: [build.node.id],
});
const lint = new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependsOn: [typecheck.node.id],
});
const test = new ShellStep(ci, "test", {
  command: "bun run test",
  dependsOn: [lint.node.id],
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
  beforeScript: ["bun run build"],
});

// Dependency vulnerabilities (bun audit exits non-zero on findings).
// GHSA-vfj7-8cjw-p6xm is unpatched upstream: braces@3.0.3 is the latest
// release and only reachable via markdownlint-cli2 (dev dep, docs lint).
// Re-check when a fixed braces ships.
const audit = new ShellStep(ci, "audit", {
  command: "bun audit --ignore GHSA-vfj7-8cjw-p6xm",
});

// Formatting gate — prettier version is pinned in devDependencies/lockfile.
const format = new ShellStep(ci, "format", { command: "bun run format:check" });

// Self-check: runs the CLI from source — needs built workspace deps.
// CI jobs are isolated runners, so beforeScript builds them in-job.
const doctor = new ShellStep(ci, "doctor", {
  command: "bun packages/cli/src/bin.ts doctor",
  beforeScript: ["bun run build"],
});

// Drift guard: .github/workflows/sverka.yml must equal `compile --pin`
// output — catches edits to the generated file (e.g. dependabot bumps
// that belong in the compiler's pinned-actions registry instead).
// compile exits non-zero on error diagnostics (e.g. unpinned actions),
// so its exit code is propagated explicitly — a bare `| diff` would
// mask a failed compile when the emitted YAML happens to match.
const drift = new ShellStep(ci, "workflow-drift", {
  command:
    'd=$(mktemp -d) && trap \'rm -rf "$d"\' EXIT && bun packages/cli/src/bin.ts compile --target github --pin --output-dir "$d" && diff "$d/.github/workflows/ci.yml" .github/workflows/sverka.yml && diff "$d/.github/workflows/repo-health.yml" .github/workflows/repo-health.yml',
  runtime: { shell: "sh" },
  beforeScript: ["bun run build"],
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
  beforeScript: ["bun run build"],
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
  beforeScript: ["bun run build"],
});

// Types-in-package gate — attw validates that published types actually
// resolve under the esm-only profile (all packages are "type": "module";
// the CJS matrix is deliberately out of scope). Rebuilds dist/ in-job.
const typelint = new ShellStep(ci, "typelint", {
  command: "bun run lint:attw",
  beforeScript: ["bun run build"],
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
  beforeScript: ["bun run build"],
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
    typelint.node.id,
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

// ---------------------------------------------------------------------------
// GitHub-side repo health — remote-state checks via the gh CLI. Unlike the
// ci pipeline (which verifies code), these verify project hygiene on GitHub
// itself: main CI green, no review debt, no merged-branch litter, no open
// dependabot alerts. The secret GITHUB_TOKEN input lands as a workflow-level
// env var in compiled output (gh reads GITHUB_TOKEN natively); locally it
// stays empty and gh falls back to stored auth.
// ---------------------------------------------------------------------------
const repoHealth = new Pipeline(proj, "repo-health", {
  permissions: {
    contents: "read",
    "pull-requests": "read",
    checks: "read",
    "security-events": "read",
  },
  inputs: {
    GITHUB_TOKEN: { type: "string", secret: true, default: "" },
  },
});

// Every GitHub Actions check-run on main's HEAD must be green — aggregated
// across all workflows, so a red box on any workflow reports main as not
// green. External app checks (SonarCloud etc.) are a different signal.
const mainGreen = new ShellStep(repoHealth, "main-green", {
  command:
    'out=$(gh api --paginate \'repos/{owner}/{repo}/commits/main/check-runs\' --jq \'.check_runs[] | select(.app.slug=="github-actions") | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral") | "\\(.name) (\\(.conclusion // .status))"\') || exit 1; [ -z "$out" ] || { echo "non-green or in-progress checks on main:"; echo "$out"; exit 1; }',
  runtime: { shell: "sh" },
});

// Zero unresolved review threads across the last 20 merged PRs.
// reviewThreads(first:100) may truncate — a truncated page counts as a
// failure (conservative: we cannot verify what we cannot see).
const reviewDebt = new ShellStep(repoHealth, "review-debt", {
  command:
    "# shellcheck disable=SC2016\n" +
    "count=$(gh api graphql -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:20,states:MERGED,orderBy:{field:CREATED_AT,direction:DESC}){nodes{reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved}}}}}}' -F owner='{owner}' -F name='{repo}' --jq '([.data.repository.pullRequests.nodes[].reviewThreads.nodes[]|select(.isResolved==false)]|length) + ([.data.repository.pullRequests.nodes[].reviewThreads.pageInfo.hasNextPage|select(.)]|length)') || exit 1; [ \"$count\" = \"0\" ] || { echo \"unresolved threads or truncated thread pages: $count\"; exit 1; }",
  runtime: { shell: "sh" },
});

// No remote branches left behind by merged PRs. Each remote head is
// checked against same-repo merged PRs — exact branch match, fork heads
// cannot collide, and there is no merged-PR pagination window.
const staleBranches = new ShellStep(repoHealth, "stale-branches", {
  command:
    'if ! heads=$(git ls-remote --heads origin); then echo "ls-remote failed"; exit 1; fi; if ! owner=$(gh repo view --json owner --jq \'.owner.login\'); then echo "repo query failed"; exit 1; fi; stale=""; for b in $(echo "$heads" | sed \'s|.*refs/heads/||\'); do if [ "$b" != "main" ]; then if ! n=$(gh pr list --head "$owner:$b" --state merged --json number --jq length); then echo "pr query failed for $b"; exit 1; fi; if [ "$n" -gt 0 ]; then stale="$stale $b"; fi; fi; done; [ -z "$stale" ] || { echo "stale branches:$stale"; exit 1; }',
  runtime: { shell: "sh" },
});

// Zero open dependabot alerts (--paginate covers all pages). The alerts
// endpoint needs the vulnerability-alerts token scope, which is not yet
// a stable GITHUB_TOKEN permission — a permission failure degrades to a
// warning instead of a hard error; other failures still fail the check.
const dependabotAlerts = new ShellStep(repoHealth, "dependabot-alerts", {
  command:
    'out=$(gh api --paginate \'repos/{owner}/{repo}/dependabot/alerts?state=open\' --jq \'.[].number\' 2>&1) || { if echo "$out" | grep -qi "not accessible\\|403"; then echo "::warning::GITHUB_TOKEN cannot read dependabot alerts (needs the vulnerability-alerts scope); check skipped"; exit 0; fi; echo "$out"; exit 1; }; [ -z "$out" ] || { echo "open dependabot alerts:"; echo "$out"; exit 1; }',
  runtime: { shell: "sh" },
});

// Informational: prints currently open PRs (always passes).
const openPrs = new ShellStep(repoHealth, "open-prs", {
  command:
    "gh pr list --state open --limit 100 --json number,title,author --jq '.[] | \"#\\(.number) \\(.title) (@\\(.author.login))\"' || true",
  runtime: { shell: "sh" },
});

const healthRoots = [
  mainGreen.node.id,
  reviewDebt.node.id,
  staleBranches.node.id,
  dependabotAlerts.node.id,
  openPrs.node.id,
];

// On-demand: `sverka run --entry repo-health/check`.
export const repoHealthCheck = new Entry(repoHealth, "check", {
  trigger: manual(),
  roots: healthRoots,
});

// Nightly sweep — compiles to `on: schedule` in the generated workflow.
export const repoHealthNightly = new Entry(repoHealth, "nightly", {
  trigger: schedule("17 6 * * *"),
  roots: healthRoots,
});

export default proj;
