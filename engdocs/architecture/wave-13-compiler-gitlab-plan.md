# Wave 13 — Compiler-GitLab Implementation Plan

**Architect:** architect-1
**Spec:** `specs/13-compiler-gitlab/spec.md`
**Package:** `@sverka/compiler-gitlab` → `packages/compiler-gitlab`
**Depends on:** `@sverka/ir` (type-only), `yaml` (runtime, already in lockfile)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

The original spec (285 lines) was trimmed to 125 lines. Major cuts:

1. **Native expansion mode cut entirely.** ADR-004 explicitly says thin
   wrapper first, native is "a later optimization." The `mode` config field,
   native expansion output, `--check` flag, per-check jobs, fallback logic,
   stage mapping table — all cut. v1 = thin wrapper only.
2. **`GitlabCompiler` interface + `createGitlabCompiler()` factory cut.**
   Single pure function `compileGitlabCi(plan, config?): string` replaces
   the interface+factory. Matches the codebase pattern (`compileGithubWorkflow`,
   `evaluatePolicy` — pure functions, not interface+factory for a single
   implementation).
3. **`GitlabCompileResult` wrapper cut.** Was `{ yaml, warnings, mode }`.
   With warnings and mode cut, it's a wrapper for one string. Return
   `string` directly.
4. **`CompilerWarning` / `GitlabCompilerWarningCode` cut.** All 4 warning
   codes were native-mode concerns (`UNSUPPORTED_CHECK_NATIVE`,
   `MISSING_ARTIFACT_REPORT`) or speculative (`RULE_FALLBACK`,
   `STAGE_COLLISION`). No warnings in thin wrapper mode.
5. **`GitlabCompilerError` / `GitlabCompilerErrorCode` cut.** All 4 error
   codes were either native-mode (`NATIVE_EXPANSION_UNAVAILABLE`),
   unreachable (`UNSUPPORTED_RULE` — all rules in the type are supported),
   or defensive (`YAML_GENERATION_FAILED` — let native Error propagate),
   or the compiler's job to trust (`INVALID_PLAN` — Plan IR is
   pre-validated). Pure function, no custom errors.
6. **Credential mapping cut.** GitLab CI/CD variables defined in project
   settings are auto-injected into jobs as `$VAR` — no YAML declaration
   needed. This is a real difference from GitHub Actions, which requires
   explicit `env:` mapping to expose secrets. The Plan's
   `CredentialDeclaration[].envVar` data is ignored by the GitLab compiler;
   credentials are available at runtime via GitLab's variable model.
7. **Stage mapping table cut.** Thin wrapper = single `verify` stage. No
   per-category stage derivation. `stages?` config field cut — always emit
   `stages: [verify]`.
8. **Artifact/report mapping table cut.** Thin wrapper, sverka handles
   artifacts internally. One `artifacts:` block for `.sverka/output/` with
   `when: always`. GitLab report types (codequality, junit,
   container_scanning) cut — `sverka execute` does not produce SARIF or
   GitLab-format reports in v1. Add when it does.
9. **`variables?` config field cut.** No concrete use case for the thin
   wrapper. The version is inlined in `before_script`. If users want global
   variables, they can edit the YAML.
10. **`rules` simplified.** `GitlabRule` cut to `if?` + `when?` only.
    `changes?` and `exists?` cut — speculative for a thin wrapper that runs
    all checks on every trigger. `on_failure` cut from `when` union — rare,
    YAGNI.
11. **Schema validation cut.** Output is valid by construction. YAGNI.
12. **`async compile()` cut.** Pure synchronous function — no I/O.

## 2. Scope

Implement the `@sverka/compiler-gitlab` package:

- `compileGitlabCi(plan, config?): string` — pure function that builds a
  pipeline object and serializes to YAML via the `yaml` library.
- `GitlabCompilerConfig`, `GitlabRule` types.
- Standalone package. No SDK integration, no CLI integration (CLI `compile`
  command was cut in Wave 10). Deps: `@sverka/ir` (type-only workspace),
  `yaml` (runtime).

## 3. File layout

```
packages/compiler-gitlab/src/
├── index.ts              # public exports
├── types.ts              # GitlabCompilerConfig, GitlabRule
├── compile.ts            # compileGitlabCi + pipeline object builder
└── __tests__/
    ├── compile.test.ts       # tests 1-5
    ├── public-api.test.ts    # test 6 (export checks)
    └── helpers/
        └── fixtures.ts       # makePlan, makeOperation
```

~50 impl lines (types ~15, compile ~30, index ~5) + ~180 test lines.
Even simpler than compiler-github (no credential mapping, no permissions,
no camelCase→kebab-case conversion).

## 4. Scaffolding fixes (before any code)

1. **`packages/compiler-gitlab/package.json`:**
   - `main`/`module`/`types`/`exports`: use `.mjs`/`.d.mts` (NOT `.js`/`.d.ts`
     — current scaffolding has this bug; use `compiler-github` as the
     template).
   - Add `dependencies`: `"@sverka/ir": "workspace:*"`, `"yaml": "^2.9.0"`.
   - `devDependencies`: `tsdown`, `typescript`, `vitest` (already present).
   - `scripts`: already correct (`build: tsdown`, `test: vitest run`, `lint:
     eslint src`, `typecheck: tsc --noEmit`).
2. **`packages/compiler-gitlab/project.json`:**
   - Lint target: remove `--ext .ts` (ESLint 9 flat config). Change to
     `"command": "bun run eslint src"`.
   - Test target: add `--passWithNoTests` to vitest command.
3. **`packages/compiler-gitlab/tsconfig.json`:** already correct (matches
   policy/compiler-github).
4. **`packages/compiler-gitlab/tsdown.config.ts`:** already correct (entry
   `src/index.ts`, format `esm`, dts true, clean true).
5. Run `bun install` to link workspace deps and resolve `yaml`.

## 5. TDD steps

### Step 1 — types.ts + fixtures.ts

Write `helpers/fixtures.ts` first. Import `Plan`, `PlanOperation` types from
`@sverka/ir`. Create `makeOperation(overrides?)` and `makePlan(overrides?)`
that return valid minimal objects. Copy from compiler-github's fixtures
(they're identical — same Plan IR).

```typescript
import type { Plan, PlanOperation } from "@sverka/ir";

export function makeOperation(overrides: Partial<PlanOperation> = {}): PlanOperation {
  return {
    id: "op-test",
    kind: "check",
    name: "test",
    dependsOn: [],
    executor: { type: "host" },
    resources: { cpu: "1", memory: "512Mi" },
    network: "deny",
    credentials: [],
    artifacts: [],
    retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: [] },
    timeoutSeconds: 60,
    continueOnError: false,
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    apiVersion: "sverka.dev/v1",
    id: "plan-test",
    name: "test-plan",
    sourceContextHash: "abc123",
    operations: [makeOperation()],
    metadata: { sverkaVersion: "0.0.0", generatedBy: "manual" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
```

Then write `types.ts` per spec (2 interfaces, no logic).

### Step 2 — compile.test.ts tests 1-2 (default config + custom config)

```typescript
import { describe, it, expect } from "vitest";
import { compileGitlabCi } from "../compile.js";
import { makePlan } from "./helpers/fixtures.js";

describe("compileGitlabCi — default config", () => {
  it("produces YAML with expected default structure", () => {
    const yaml = compileGitlabCi(makePlan());
    expect(yaml).toContain("stages:");
    expect(yaml).toContain("- verify");
    expect(yaml).toContain("sverka:");
    expect(yaml).toContain("stage: verify");
    expect(yaml).toContain("image: node:24");
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "push"');
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "merge_request_event"');
    expect(yaml).toContain("bun install -g sverka@latest");
    expect(yaml).toContain("sverka execute .sverka/plan.json");
    expect(yaml).toContain("when: always");
    expect(yaml).toContain(".sverka/output/");
  });
});

describe("compileGitlabCi — custom config", () => {
  it("reflects custom image and sverkaVersion", () => {
    const yaml = compileGitlabCi(makePlan(), {
      image: "node:22",
      sverkaVersion: "0.1.0",
    });
    expect(yaml).toContain("image: node:22");
    expect(yaml).toContain("bun install -g sverka@0.1.0");
  });
});
```

### Step 3 — implement compile.ts (core)

```typescript
import { stringify } from "yaml";
import type { Plan } from "@sverka/ir";
import type { GitlabCompilerConfig, GitlabRule } from "./types.js";

const DEFAULT_RULES: readonly GitlabRule[] = [
  { if: '$CI_PIPELINE_SOURCE == "push"' },
  { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
];

export function compileGitlabCi(
  plan: Plan,
  config?: GitlabCompilerConfig,
): string {
  const image = config?.image ?? "node:24";
  const sverkaVersion = config?.sverkaVersion ?? "latest";
  const rules = config?.rules ?? DEFAULT_RULES;

  const job: Record<string, unknown> = {
    stage: "verify",
    image,
    rules: rules.map((r) => {
      const entry: Record<string, unknown> = {};
      if (r.if !== undefined) entry.if = r.if;
      if (r.when !== undefined) entry.when = r.when;
      return entry;
    }),
    "before_script": [`bun install -g sverka@${sverkaVersion}`],
    script: ["sverka execute .sverka/plan.json"],
    artifacts: { when: "always", paths: [".sverka/output/"] },
  };

  const pipeline = {
    stages: ["verify"],
    sverka: job,
  };

  return stringify(pipeline);
}
```

Note: `plan` is accepted as a parameter for API consistency with
`compileGithubWorkflow` and future native expansion. In thin wrapper mode,
the plan's contents do not affect the output (the job runs `sverka execute`
which reads the plan at runtime). This is correct — the compiler's job is
to produce CI config that delegates execution to Sverka.

### Step 4 — compile.test.ts test 3 (custom rules)

```typescript
describe("compileGitlabCi — custom rules", () => {
  it("reflects custom if conditions and when values", () => {
    const yaml = compileGitlabCi(makePlan(), {
      rules: [
        { if: '$CI_COMMIT_BRANCH == "main"', when: "on_success" },
        { if: '$CI_PIPELINE_SOURCE == "schedule"', when: "manual" },
      ],
    });
    expect(yaml).toContain('$CI_COMMIT_BRANCH == "main"');
    expect(yaml).toContain("when: on_success");
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "schedule"');
    expect(yaml).toContain("when: manual");
    // Default rules should NOT appear
    expect(yaml).not.toContain("merge_request_event");
  });
});
```

### Step 5 — compile.test.ts tests 4-5 (determinism + empty operations)

```typescript
describe("compileGitlabCi — determinism", () => {
  it("same plan + config → identical YAML", () => {
    const plan = makePlan();
    const a = compileGitlabCi(plan);
    const b = compileGitlabCi(plan);
    expect(a).toBe(b);
  });
});

describe("compileGitlabCi — empty operations", () => {
  it("produces valid YAML for empty plan", () => {
    const yaml = compileGitlabCi(makePlan({ operations: [] }));
    expect(yaml).toContain("sverka execute .sverka/plan.json");
    expect(yaml).toContain("sverka:");
  });
});
```

### Step 6 — public-api.test.ts

```typescript
import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports compileGitlabCi", () => {
    expect(typeof api.compileGitlabCi).toBe("function");
  });
  it("exports config types (type-only, checked via import)", async () => {
    expect(api).toBeDefined();
  });
});
```

### Step 7 — index.ts

```typescript
// @sverka/compiler-gitlab — public API

export { compileGitlabCi } from "./compile.js";
export type {
  GitlabCompilerConfig,
  GitlabRule,
} from "./types.js";
```

## 6. Edge cases and conventions

- **No camelCase→kebab-case needed.** Unlike GitHub Actions (which uses
  `security-events`, `pull_request`), GitLab CI keys are already snake_case
  (`before_script`, `merge_request_event`). No conversion helper needed.
- **`$VAR` quoting in YAML:** GitLab CI `if:` expressions contain `$` and
  `==` and quotes. The `yaml` library will quote these strings as needed.
  Verify the output is valid GitLab CI syntax.
- **No `any`:** Use `Record<string, unknown>` for the job object structure.
- **`override` on cause:** Not applicable — no custom error class.
- **Determinism:** The pipeline object is constructed in a fixed order.
  `yaml.stringify` preserves insertion order. Same input → same output.
- **Rules with only `if`:** When `when` is omitted, GitLab defaults to
  `on_success`. The compiler should omit the `when` key from the YAML entry
  when undefined (don't emit `when: null`).

## 7. Verification gates

Before reporting complete, run ALL of these and confirm green:

```bash
# Package-level
cd packages/compiler-gitlab
bun run typecheck    # 0 errors
bun run lint         # 0 errors
bun run build        # dist/index.mjs + dist/index.d.mts emitted
bun run test         # all tests pass

# Monorepo-level (catches entangled breakage)
cd /home/pepl/projects/sverka
bun run test         # all 16+ projects green
bun run typecheck    # all green
bun run lint         # all green
bun run build        # all green
```

**CRITICAL:** Run `git status --short` and confirm every impl + test file
is at least staged before reporting complete. Re-run `bun run test` for the
WHOLE monorepo (not just this package) to catch entangled breakage. This
is a recurring drill finding.

## 8. Commit hygiene (for finalize)

Stage ONLY:
- `packages/compiler-gitlab/**`
- `specs/13-compiler-gitlab/spec.md`
- `engdocs/architecture/wave-13-compiler-gitlab-plan.md`
- `bun.lock` (if `yaml` dep changes the lockfile)

EXCLUDE:
- `city.toml` / `city.toml.bak.*`
- `agents/`
- `.devin/` / `.gc/` / `.beads/` / `.evidence/` / `.opencode/`
- `formulas/`
