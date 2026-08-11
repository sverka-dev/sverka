# Wave 12 — Compiler-GitHub Implementation Plan

**Architect:** architect-1
**Spec:** `specs/12-compiler-github/spec.md`
**Package:** `@sverka/compiler-github` → `packages/compiler-github`
**Depends on:** `@sverka/ir` (type-only), `yaml` (runtime, already in lockfile)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

The original spec (259 lines) was trimmed to 159 lines. Major cuts:

1. **Native expansion mode cut entirely.** ADR-004 explicitly says thin
   wrapper first, native is "a later optimization." The `mode` config field,
   native expansion output, `--check` flag, per-check jobs, fallback logic —
   all cut. v1 = thin wrapper only.
2. **`GithubCompiler` interface + `createGithubCompiler()` factory cut.**
   Single pure function `compileGithubWorkflow(plan, config?): string`
   replaces the interface+factory. Matches the codebase pattern
   (`evaluatePolicy`, `createBuiltinResolver` — pure functions, not
   interface+factory for a single implementation).
3. **`GithubCompileResult` wrapper cut.** Was `{ yaml, warnings, mode }`.
   With warnings and mode cut, it's a wrapper for one string. Return
   `string` directly.
4. **`CompilerWarning` / `GithubCompilerWarningCode` cut.** All 4 warning
   codes were native-mode concerns (`UNSUPPORTED_CHECK_NATIVE`,
   `MISSING_SARIF_OUTPUT`) or speculative (`PERMISSION_DOWNGRADED`,
   `SECRET_NOT_DECLARED`). No warnings in thin wrapper mode.
5. **`GithubCompilerError` / `GithubCompilerErrorCode` cut.** All 4 error
   codes were either native-mode (`NATIVE_EXPANSION_UNAVAILABLE`),
   unreachable (`UNSUPPORTED_TRIGGER` — all triggers in the type are
   supported), or defensive (`YAML_GENERATION_FAILED` — let native Error
   propagate), or the compiler's job to trust (`INVALID_PLAN` — Plan IR is
   pre-validated). Pure function, no custom errors.
6. **`secrets` config field cut.** Credentials come from the Plan's
   `CredentialDeclaration[]`, not from config. The compiler collects
   `envVar` values from all operations and emits the `env:` block.
7. **`schedule` trigger cut.** No concrete use case. Keep `push`,
   `pullRequest`, `workflowDispatch`.
8. **Permission mapping table cut.** The Plan IR has no `permissions`
   field (verified: `Plan` in `packages/ir/src/plan.ts` has no permissions).
   The spec was mapping from data that doesn't exist. Permissions come from
   config, default `{ contents: "read" }`.
9. **SARIF upload step cut.** `sverka execute` does not produce SARIF in v1
   (verified: CLI execute prints verdict/findings, no SARIF file; SDK uses
   temp dir for artifacts). The `github/codeql-action/upload-sarif@v3` step
   would reference a non-existent file. Add when sverka produces SARIF.
10. **Artifact mapping table simplified.** One `actions/upload-artifact@v4`
    step for `.sverka/output/` with `if: always()`. Per-operation
    `ArtifactDeclaration` is handled by sverka internally; the workflow
    uploads the output directory.
11. **Schema validation cut.** Output is valid by construction. YAGNI.
12. **`async compile()` cut.** Pure synchronous function — no I/O.

## 2. Scope

Implement the `@sverka/compiler-github` package:

- `compileGithubWorkflow(plan, config?): string` — pure function that
  builds a workflow object and serializes to YAML via the `yaml` library.
- `GithubCompilerConfig`, `GithubTriggers`, `GithubPermissions` types.
- Credential mapping: collect unique `envVar` from
  `plan.operations[].credentials[]` → job-level `env:` block.
- Standalone package. No SDK integration, no CLI integration (CLI `compile`
  command was cut in Wave 10). Deps: `@sverka/ir` (type-only workspace),
  `yaml` (runtime).

## 3. File layout

```text
packages/compiler-github/src/
├── index.ts              # public exports
├── types.ts              # GithubCompilerConfig, GithubTriggers, GithubPermissions
├── compile.ts            # compileGithubWorkflow + workflow object builder
└── __tests__/
    ├── compile.test.ts       # tests 1-8
    ├── public-api.test.ts    # test 9 (export checks)
    └── helpers/
        └── fixtures.ts       # makePlan, makePlanWithCredentials
```

~90 impl lines (types ~30, compile ~55, index ~5) + ~250 test lines.

## 4. Scaffolding fixes (before any code)

1. **`packages/compiler-github/package.json`:**
   - `main`/`module`/`types`/`exports`: use `.mjs`/`.d.mts` (NOT `.js`/`.d.ts`
     — the `checks` package has this bug; use `policy` as the template).
   - Add `dependencies`: `"@sverka/ir": "workspace:*"`, `"yaml": "^2.9.0"`.
   - `devDependencies`: `tsdown`, `typescript`, `vitest` (match other packages).
   - `scripts`: `build: tsdown`, `test: vitest run`, `lint: eslint src`,
     `typecheck: tsc --noEmit`.
2. **`packages/compiler-github/project.json`:** copy from `packages/policy`,
   change `--ext .ts` removed (ESLint 9 flat config). Lint target:
   `"lint": { "executor": "nx:run-commands", "commands": ["eslint src"] }`.
3. **`packages/compiler-github/tsconfig.json`:** copy from `packages/policy`.
4. **`packages/compiler-github/tsdown.config.ts`:** copy from
   `packages/policy` (entry `src/index.ts`, format `esm`, dts true, clean true).
5. Run `bun install` to link workspace deps and resolve `yaml`.

## 5. TDD steps

### Step 1 — types.ts + fixtures.ts

Write `helpers/fixtures.ts` first. Import `Plan`, `PlanOperation`,
`PlanMetadata` types from `@sverka/ir`. Create `makePlan(overrides?)` that
returns a valid minimal `Plan` and `makePlanWithCredentials(envVars)` that
returns a plan with operations declaring credentials.

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

Then write `types.ts` per spec (3 interfaces, no logic).

### Step 2 — compile.test.ts tests 1-2 (default config + custom config)

Write tests first:

```typescript
import { describe, it, expect } from "vitest";
import { compileGithubWorkflow } from "../compile.js";
import { makePlan } from "./helpers/fixtures.js";

describe("compileGithubWorkflow — default config", () => {
  it("produces YAML with expected default structure", () => {
    const yaml = compileGithubWorkflow(makePlan());
    expect(yaml).toContain("name: Sverka");
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain("node-version: \"24\"");
    expect(yaml).toContain("bun install -g sverka@latest");
    expect(yaml).toContain("sverka execute .sverka/plan.json");
    expect(yaml).toContain("actions/checkout@v4");
    expect(yaml).toContain("actions/setup-node@v4");
    expect(yaml).toContain("actions/upload-artifact@v4");
    expect(yaml).toContain("if: always()");
    expect(yaml).toContain("contents: read");
  });
});

describe("compileGithubWorkflow — custom config", () => {
  it("reflects custom name, runner, versions", () => {
    const yaml = compileGithubWorkflow(makePlan(), {
      name: "My CI",
      runner: "ubuntu-24.04",
      sverkaVersion: "0.1.0",
      nodeVersion: "22",
    });
    expect(yaml).toContain("name: My CI");
    expect(yaml).toContain("runs-on: ubuntu-24.04");
    expect(yaml).toContain("node-version: \"22\"");
    expect(yaml).toContain("bun install -g sverka@0.1.0");
  });
});
```

### Step 3 — implement compile.ts (core)

Implement `compileGithubWorkflow`. Structure:

```typescript
import { stringify } from "yaml";
import type { Plan } from "@sverka/ir";
import type { GithubCompilerConfig, GithubPermissions } from "./types.js";

export function compileGithubWorkflow(
  plan: Plan,
  config?: GithubCompilerConfig,
): string {
  const name = config?.name ?? "Sverka";
  const runner = config?.runner ?? "ubuntu-latest";
  const sverkaVersion = config?.sverkaVersion ?? "latest";
  const nodeVersion = config?.nodeVersion ?? "24";
  const triggers = buildTriggers(config?.on);
  const permissions = buildPermissions(config?.permissions);
  const env = buildCredentialEnv(plan);

  const job: Record<string, unknown> = {
    "runs-on": runner,
    steps: [
      { uses: "actions/checkout@v4" },
      { uses: "actions/setup-node@v4", with: { "node-version": nodeVersion } },
      { run: `bun install -g sverka@${sverkaVersion}` },
      { run: "sverka execute .sverka/plan.json" },
      {
        uses: "actions/upload-artifact@v4",
        if: "always()",
        with: { name: "sverka-output", path: ".sverka/output/" },
      },
    ],
  };
  if (Object.keys(env).length > 0) job.env = env;

  const workflow = {
    name,
    on: triggers,
    permissions,
    jobs: { sverka: job },
  };
  return stringify(workflow);
}
```

Helper functions `buildTriggers`, `buildPermissions`, `buildCredentialEnv`
are pure. `buildCredentialEnv` collects unique `envVar` from
`plan.operations.flatMap(o => o.credentials)` and maps to
`${{ secrets.<ENV_VAR> }}`.

**CRITICAL:** The `yaml` library (YAML 1.2) emits `on:` correctly (not as
boolean `true`). GitHub Actions parses `on:` correctly in workflow files.
Do not add quoting workarounds for `on` — this is the standard behavior.

### Step 4 — compile.test.ts tests 3-6 (triggers, credentials, permissions)

```typescript
describe("compileGithubWorkflow — triggers", () => {
  it("emits workflow_dispatch and custom branches", () => {
    const yaml = compileGithubWorkflow(makePlan(), {
      on: { push: ["main", "develop"], pullRequest: ["main"], workflowDispatch: true },
    });
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain("develop");
  });
});

describe("compileGithubWorkflow — credentials", () => {
  it("emits env block for declared credentials", () => {
    const plan = makePlan({
      operations: [
        makeOperation({ credentials: [{ name: "token", envVar: "API_TOKEN", required: true }] }),
        makeOperation({ id: "op-2", name: "lint", credentials: [{ name: "key", envVar: "SECRET_KEY", required: true }] }),
      ],
    });
    const yaml = compileGithubWorkflow(plan);
    expect(yaml).toContain("API_TOKEN: ${{ secrets.API_TOKEN }}");
    expect(yaml).toContain("SECRET_KEY: ${{ secrets.SECRET_KEY }}");
  });
  it("omits env block when no credentials", () => {
    const yaml = compileGithubWorkflow(makePlan());
    expect(yaml).not.toContain("env:");
  });
  it("deduplicates envVars across operations", () => {
    const plan = makePlan({
      operations: [
        makeOperation({ credentials: [{ name: "t", envVar: "TOKEN", required: true }] }),
        makeOperation({ id: "op-2", name: "lint", credentials: [{ name: "t2", envVar: "TOKEN", required: true }] }),
      ],
    });
    const yaml = compileGithubWorkflow(plan);
    const matches = yaml.match(/TOKEN:/g);
    expect(matches).toHaveLength(1);
  });
});

describe("compileGithubWorkflow — permissions", () => {
  it("reflects custom permissions", () => {
    const yaml = compileGithubWorkflow(makePlan(), {
      permissions: { contents: "write", securityEvents: "write" },
    });
    expect(yaml).toContain("contents: write");
    expect(yaml).toContain("security-events: write");
  });
});
```

Note: `GithubPermissions` uses camelCase (`securityEvents`) but GitHub
Actions YAML uses kebab-case (`security-events`). The `buildPermissions`
helper must convert camelCase → kebab-case for the YAML keys.

### Step 5 — compile.test.ts tests 7-8 (determinism + empty operations)

```typescript
describe("compileGithubWorkflow — determinism", () => {
  it("same plan + config → identical YAML", () => {
    const plan = makePlan();
    const a = compileGithubWorkflow(plan);
    const b = compileGithubWorkflow(plan);
    expect(a).toBe(b);
  });
});

describe("compileGithubWorkflow — empty operations", () => {
  it("produces valid YAML for empty plan", () => {
    const yaml = compileGithubWorkflow(makePlan({ operations: [] }));
    expect(yaml).toContain("sverka execute .sverka/plan.json");
    expect(yaml).toContain("jobs:");
  });
});
```

### Step 6 — public-api.test.ts

```typescript
import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports compileGithubWorkflow", () => {
    expect(typeof api.compileGithubWorkflow).toBe("function");
  });
  it("exports config types (type-only, checked via import)", async () => {
    // Type-only exports are erased at runtime; verify the module loads.
    expect(api).toBeDefined();
  });
});
```

### Step 7 — index.ts

```typescript
// @sverka/compiler-github — public API

export { compileGithubWorkflow } from "./compile.js";
export type {
  GithubCompilerConfig,
  GithubTriggers,
  GithubPermissions,
} from "./types.js";
```

## 6. Edge cases and conventions

- **camelCase → kebab-case for permissions:** `GithubPermissions` uses
  `securityEvents` (TypeScript convention) but GitHub Actions YAML uses
  `security-events`. `buildPermissions` must convert. Same for
  `pullRequest` → `pull_request` in triggers.
- **`on` key in YAML:** The `yaml` library (YAML 1.2) emits `on:` as a
  plain string key. GitHub Actions parses this correctly. No workaround
  needed.
- **No `any`:** Use `Record<string, unknown>` for the workflow object
  structure if needed, but prefer typed construction.
- **`override` on cause:** Not applicable — no custom error class.
- **Determinism:** The workflow object is constructed in a fixed order.
  `yaml.stringify` preserves insertion order. Same input → same output.
- **`pullRequest: []` default:** When `config.on` is undefined, the default
  triggers include `pull_request:` with no branch filter (triggers on all
  branches). Emit `pull_request:` as an empty mapping or `null`. The `yaml`
  library emits `pull_request:\n` for `null` — verify this is valid GitHub
  Actions YAML (it is — `on: pull_request:` triggers on all branches).

## 7. Verification gates

Before reporting complete, run ALL of these and confirm green:

```bash
# Package-level
cd packages/compiler-github
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
- `packages/compiler-github/**`
- `specs/12-compiler-github/spec.md`
- `engdocs/architecture/wave-12-compiler-github-plan.md`
- `bun.lock` (if `yaml` dep changes the lockfile)

EXCLUDE:
- `city.toml` / `city.toml.bak.*`
- `agents/`
- `.devin/` / `.gc/` / `.beads/` / `.evidence/` / `.opencode/`
- `formulas/`
