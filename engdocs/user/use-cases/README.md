# Use cases

Sverka is a framework for running local checks. CI compilation is one use
case — not the only one. Here are the concrete scenarios Sverka supports.

## 1. Local checks runner

Run lint, typecheck, and test locally with a single command. Get structured
findings back. No CI required.

```bash
# Define checks in sverka.config.ts
sverka run --evaluate

# Get SARIF output
sverka run --format sarif

# View findings in terminal
sverka view .sverka/findings.sarif

# Start web dashboard
sverka ui
```

**Why this matters:** You find problems at write time, not at push time.
No more "it worked on my machine but CI failed" — the same workflow runs
locally and in CI.

## 2. CI compilation

Compile the same workflow definition to GitHub Actions or GitLab CI YAML.

```bash
# Compile to GitHub Actions
sverka compile --target github

# Compile to GitLab CI
sverka compile --target gitlab
```

The generated YAML is a thin wrapper that runs `sverka run` in CI. Your
workflow definition stays in TypeScript — the YAML just bootstraps Sverka
and executes the same plan.

**Why this matters:** One definition, two execution modes. Local runs
for fast feedback. CI runs for enforcement. No duplication.

## 3. Agent orchestration

AI agents delegate check orchestration to Sverka instead of running tools
one by one.

```bash
# Agent runs this instead of 10 separate tool calls:
sverka run --format json
```

One command. The agent gets structured JSON with:
- Step status (success/failure/skipped)
- Findings count by severity
- Policy verdict (pass/fail)
- Duration

**Why this matters:** Fewer tool-call round-trips. Lower token cost.
More stable agent behavior. The agent delegates orchestration; Sverka
handles execution.

## 4. SARIF tooling

Sverka normalizes SARIF from any tool (ESLint, Semgrep, CodeQL, SonarCloud)
into a unified `Finding[]`. You can:

- **Serialize** findings back to SARIF: `serializeSarif(findings)`
- **View** in terminal: `sverka view findings.sarif`
- **Generate** HTML reports: `sverka view findings.sarif --format web`
- **Dashboard**: `sverka ui` serves a local web dashboard
- **Policy gate**: `evaluateGate({ findings })` enforces severity rules

**Why this matters:** SARIF is the industry standard for static analysis
results. Sverka makes it easy to collect, normalize, view, and enforce
findings from any tool.

## 5. Policy enforcement

Define severity policies and enforce them as a gate.

```ts
import { createPolicy, evaluatePolicy } from "@sverka/verification";

const policy = createPolicy({
  failOn: [
    { severity: "critical", onlyNew: false },
    { severity: "high", onlyNew: false },
  ],
});

const { verdict } = evaluatePolicy(findings, policy, []);
// verdict: "pass" | "fail"
```

**Why this matters:** Consistent quality bars. Local and CI enforce the
same rules. No more "CI is stricter than local" — the policy is code.

## 6. Multi-target compilation

The same workflow compiles to multiple CI targets:

| Target | Command | Status |
|--------|---------|--------|
| GitHub Actions | `sverka compile --target github` | Implemented |
| GitLab CI | `sverka compile --target gitlab` | Implemented |
| Temporal | `sverka compile --target temporal` | Planned |
| Dagger | `sverka compile --target dagger` | Planned |
| Inngest | `sverka compile --target inngest` | Planned |
| Drone | `sverka compile --target drone` | Planned |

**Why this matters:** No lock-in. Define once, compile to any target.
Switch CI providers without rewriting your checks.

## Next steps

- [Concepts](../concepts/README.md) — design principles and architecture.
- [SARIF pipeline](../findings/sarif-pipeline.md) — serialize, view, dashboard.
- [First workflow](../getting-started/first-plan.md) — hands-on tutorial.
- [Agent integration](../agent-integration/skill-cli.md) — skill + CLI for agents.
