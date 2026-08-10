# Wave 11 — Checks Implementation Plan

**Architect:** architect-1
**Spec:** `specs/11-checks/spec.md`
**Package:** `@sverka/checks` → `packages/checks`
**Depends on:** `@sverka/core`, `@sverka/planner`, `@sverka/findings`

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

The original spec (383 lines) was trimmed to 215 lines. Major cuts:

1. **`CheckProvider` interface cut** (detect/propose/resolve/normalize).
   The planner already detects and proposes; the findings package already
   normalizes. Replaced with a single-method `CheckResolver.resolve()`.
2. **`DetectionContext`/`DetectionResult`/`CheckProposal` cut.** Duplicates
   the planner's `ProjectContext` and `ProposedCheck`. The resolver takes
   `ProposedCheck` + `ProjectContext` directly.
3. **`NormalizationResult`/`NormalizedFinding`/`NormalizationError` cut.**
   Duplicates the findings package's `Finding` and `normalizeSarif`. The
   checks package calls `normalizeSarif`, does not redefine normalization.
4. **`ResolvedCheck` simplified.** The spec's version (image, command, args,
   env, workdir, outputs) overlapped with `OperationSpec`. Now wraps an
   `OperationSpec` + `CheckOutput[]`.
5. **`CheckProviderRegistry` + `loadPlugins` cut.** No registry needed —
   the SDK takes a `CheckResolver` (defaulting to builtin). Custom resolvers
   implement the interface.
6. **YAML plugin descriptor system cut** (`PluginDescriptor`,
   `PluginDetectRule`, `PluginProposeRule`, `PluginNormalizeRule`). No
   third-party providers exist. Pure YAGNI.
7. **10 built-in providers cut** (build, lint, test, securityScan,
   typecheck, eslint, trivy, gitleaks, semgrep, dependencyAudit). Replaced
   with a single built-in resolver covering the 6 checkIds the planner
   already proposes (typecheck, lint, test, clippy, vet, fmt-check) across
   Node/Python/Rust/Go.
8. **`CheckCategory` type cut.** No consumer uses it. The resolver sets
   `OperationSpec.kind = "check"` for all checks.
9. **`BUILTIN_PROVIDER_IDS`/`BuiltinProviderId` cut.** No provider ids;
   the resolver is a table lookup, not a collection of provider objects.
10. **`createBuiltinRegistry()` cut.** Replaced by `createBuiltinResolver()`.
11. **Error codes reduced** from 6 to 2: `RESOLUTION_FAILED`,
    `EXTRACTION_FAILED`. `DETECTION_FAILED`/`PROPOSAL_FAILED` cut (no
    detect/propose). `INVALID_PLUGIN_DESCRIPTOR`/`DUPLICATE_PROVIDER_ID`
    cut (no plugins, no registry).
12. **`CheckError` uses `override` on `cause`** per `noImplicitOverride`.
13. **Test command corrected:** `bun test` → `bun run test`.

## 2. Scope

Implement the `@sverka/checks` package:

- `CheckResolver` interface + `createBuiltinResolver()` — maps
  `(checkId, packageManager)` → `ResolvedCheck` (OperationSpec + outputs).
- `extractFindings()` — reads SARIF artifacts, normalizes via
  `@sverka/findings`.
- `CheckError` + `CheckErrorCode`.
- SDK integration: wire the resolver into `doPlan`/`doExecute` auto-discovery
  mode and re-export from `@sverka/sdk`.

## 3. File layout

```
packages/checks/src/
├── index.ts              # public exports
├── resolver.ts           # CheckResolver, ResolvedCheck, CheckOutput, createBuiltinResolver
├── extract.ts            # extractFindings
├── errors.ts             # CheckError, CheckErrorCode
└── __tests__/
    ├── resolver.test.ts      # tests 1-9
    ├── extract.test.ts       # tests 10-14
    ├── errors.test.ts        # test 15
    ├── public-api.test.ts    # test 16
    └── helpers/
        └── fixtures.ts       # makeProposedCheck, makeProjectContext, sampleSarif
```

## 4. Scaffolding fixes (before any code)

1. **`packages/checks/package.json`:**
   - `main`/`module`/`types`/`exports`: `.js`/`.d.ts` → `.mjs`/`.d.mts`.
   - Add `dependencies`: `"@sverka/core": "workspace:*"`,
     `"@sverka/planner": "workspace:*"`,
     `"@sverka/findings": "workspace:*"`.
2. **`packages/checks/project.json`:** lint target — remove `--ext .ts`
   (ESLint 9 flat config).
3. Run `bun install` to link workspace deps.

## 5. TDD steps

### Step 1 — errors.ts

Write `errors.test.ts` first (test 15):

```typescript
import { CheckError } from "../errors.js";
import { describe, it, expect } from "vitest";

describe("CheckError", () => {
  it("sets name, code, and override cause", () => {
    const cause = new Error("inner");
    const err = new CheckError("bad", "EXTRACTION_FAILED", cause);
    expect(err.name).toBe("CheckError");
    expect(err.code).toBe("EXTRACTION_FAILED");
    expect(err.cause).toBe(cause);
    expect(err instanceof Error).toBe(true);
  });
  it("cause is optional", () => {
    const err = new CheckError("bad", "RESOLUTION_FAILED");
    expect(err.cause).toBeUndefined();
  });
});
```

Then implement `errors.ts` per spec. `cause` MUST use `override readonly`.

### Step 2 — resolver.ts

Write `resolver.test.ts` (tests 1-9). Use helpers:

```typescript
// helpers/fixtures.ts
import type { ProposedCheck, ProjectContext } from "@sverka/planner";

export function makeCheck(checkId: string, reason = "test"): ProposedCheck {
  return { id: `prop-${checkId}`, checkId, reason, signalRef: null, priority: 2 };
}

export function makeContext(pms: string[]): ProjectContext {
  return {
    root: "/tmp/proj",
    commit: "abc123",
    dirty: false,
    changedFiles: [],
    languages: [],
    packageManagers: pms.map((name) => ({ name: name as any, version: null, lockfile: null, evidence: [] })),
    hasContainerBuild: false,
    hasCiDefinition: false,
    monorepo: null,
    localSignals: [],
    explanation: { summary: "test", signalCounts: { manifest: 0, lockfile: 0, dockerfile: 0, "docker-compose": 0, "ci-definition": 0, "monorepo-marker": 0, "git-metadata": 0 } },
  };
}
```

Test cases (one `it` per table row + edge cases):

- `typecheck` + bun → `{ command: "bun", args: ["run", "typecheck"] }`
- `typecheck` + npm → `{ command: "npm", args: ["run", "typecheck"] }`
- `lint` + bun → `{ command: "bun", args: ["run", "lint"] }`
- `lint` + poetry → `{ command: "ruff", args: ["check"] }`
- `test` + bun → `{ command: "bun", args: ["run", "test"] }`
- `test` + pytest → `{ command: "pytest", args: [] }`
- `test` + cargo → `{ command: "cargo", args: ["test"] }`
- `test` + go → `{ command: "go", args: ["test", "./..."] }`
- `clippy` + cargo → `{ command: "cargo", args: ["clippy"] }`
- `fmt-check` + cargo → `{ command: "cargo", args: ["fmt", "--check"] }`
- `vet` + go → `{ command: "go", args: ["vet", "./..."] }`
- Unknown checkId `foo` + bun → null
- `clippy` + bun → null (no mapping)
- Multiple PMs `[bun, cargo]` + `test` → bun wins (table order)
- All built-in checks have `outputs: []`
- `operation.id === check.id`, `operation.kind === "check"`,
  `operation.name === check.checkId`, `operation.description === check.reason`

Then implement `resolver.ts`:

```typescript
import type { OperationSpec } from "@sverka/core";
import type { ProposedCheck, ProjectContext, PackageManagerName } from "@sverka/planner";

export interface CheckResolver {
  resolve(check: ProposedCheck, ctx: ProjectContext): ResolvedCheck | null;
}
export interface ResolvedCheck {
  readonly checkId: string;
  readonly operation: OperationSpec;
  readonly outputs: readonly CheckOutput[];
}
export interface CheckOutput {
  readonly path: string;
  readonly format: "sarif" | "json" | "junit" | "text";
}

interface TableEntry {
  checkId: string;
  packageManagers: readonly PackageManagerName[];
  command: string;
  args: readonly string[];
}

const TABLE: readonly TableEntry[] = [
  { checkId: "typecheck", packageManagers: ["bun"], command: "bun", args: ["run", "typecheck"] },
  { checkId: "typecheck", packageManagers: ["npm", "yarn", "pnpm"], command: "npm", args: ["run", "typecheck"] },
  // ... full table per spec
];

export function createBuiltinResolver(): CheckResolver {
  return {
    resolve(check, ctx) {
      const pmNames = ctx.packageManagers.map((p) => p.name);
      for (const entry of TABLE) {
        if (entry.checkId !== check.checkId) continue;
        const pmMatch = entry.packageManagers.some((p) => pmNames.includes(p));
        if (!pmMatch) continue;
        return {
          checkId: check.checkId,
          operation: {
            id: check.id,
            kind: "check",
            name: check.checkId,
            description: check.reason,
            command: entry.command,
            args: entry.args,
          },
          outputs: [],
        };
      }
      return null;
    },
  };
}
```

**Note on npm/yarn/pnpm:** the table uses `npm` as the command for all three.
If the project uses yarn, the command is still `npm run typecheck` — this is
a v1 simplification. A follow-up can map the exact PM binary. Document this
in a code comment.

Actually — **correction:** map each PM to its own binary. The table entry
should store a function or the resolver should pick the binary from
`ctx.packageManagers`. Simpler: have separate entries per PM, or store the
PM-to-binary mapping. The cleanest: the table entry has `command` as a
function of the matched PM. But that adds complexity. v1: use `npm` for
npm/yarn/pnpm (they all support `npm run` compatibly... no, yarn uses
`yarn run`). Let me just have the resolver pick the binary from the matched
PM name directly:

```typescript
const NODE_PMS = ["bun", "npm", "yarn", "pnpm"] as const;
// For Node checks, command = pm binary, args = ["run", checkId]
```

So for Node checks, the resolver uses the PM name as the command directly.
For Python/Rust/Go, the command is fixed (ruff/pytest/cargo/go). This is
cleaner than a static table with duplicate rows.

Revised approach: two resolution strategies:
1. **Node checks** (typecheck, lint, test): if any PM in `NODE_PMS`, use
   that PM's name as command + `["run", checkId]`.
2. **Tool-specific checks**: fixed mapping (lint+ruff, test+pytest, cargo+clippy/fmt/test, go+vet/test).

This is simpler. The builder should implement it this way.

### Step 3 — extract.ts

Write `extract.test.ts` (tests 10-14). Use a temp dir with synthetic SARIF:

```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sampleSarif = {
  version: "2.1.0",
  runs: [{
    tool: { driver: { name: "test-tool" } },
    results: [{
      ruleId: "R1",
      level: "error",
      message: { text: "bad" },
      locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 1, endLine: 1 } } }],
    }],
  }],
};
```

Test cases:
- SARIF file exists → `Finding[]` with `checkId` prefix, correct severity.
- Missing file → `[]`.
- `format: "json"` → `[]`.
- Invalid SARIF (not an object / wrong version) → throws `CheckError(EXTRACTION_FAILED)`, cause is `NormalizationError`.
- Empty `outputs` → `[]`.

Then implement `extract.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSarif, type Finding, type NormalizeContext } from "@sverka/findings";
import type { SarifLog } from "@sverka/findings";
import { CheckError } from "./errors.js";
import type { CheckOutput } from "./resolver.js";

export async function extractFindings(
  outputs: readonly CheckOutput[],
  artifactDir: string,
  checkId: string,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  for (const output of outputs) {
    if (output.format !== "sarif") continue;
    const filePath = join(artifactDir, output.path);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new CheckError(`invalid JSON in ${output.path}`, "EXTRACTION_FAILED", e);
    }
    try {
      const ctx: NormalizeContext = { root: artifactDir, checkIdPrefix: checkId, defaultConfidence: 0.5 };
      const result = normalizeSarif(parsed as SarifLog, ctx);
      findings.push(...result);
    } catch (e) {
      throw new CheckError(`SARIF normalization failed for ${output.path}`, "EXTRACTION_FAILED", e);
    }
  }
  return findings;
}
```

### Step 4 — index.ts

```typescript
// @sverka/checks — public API
export type { CheckResolver, ResolvedCheck, CheckOutput } from "./resolver.js";
export { createBuiltinResolver } from "./resolver.js";
export { extractFindings } from "./extract.js";
export { CheckError, type CheckErrorCode } from "./errors.js";
```

Write `public-api.test.ts` (test 16): assert all exports are present, no extras.

### Step 5 — Run gates

```bash
cd packages/checks && bun run test      # vitest
cd packages/checks && bun run typecheck # tsc --noEmit
cd packages/checks && bun run lint      # eslint src
cd packages/checks && bun run build     # tsdown
# Full monorepo:
bun run test      # all 16+ projects
bun run typecheck
bun run lint
bun run build
```

All must pass with 0 errors. No `any` types.

### Step 6 — SDK integration

Modify `packages/sdk/src/sverka.ts`:

1. **`doPlan` auto-discovery** (after `planner.plan(context)`): resolve each
   `proposal.checks` via `createBuiltinResolver()`, collect `OperationSpec[]`
   into `operations` (filter nulls). Return both `operations` and `proposal`.

2. **`doExecute` auto-discovery** (replace `operations = []`): resolve
   `proposal.checks` → `OperationSpec[]`. If all resolve to null and no
   config, throw `CONFIG_NOT_FOUND`. After execution, call `extractFindings`
   for each resolved check's outputs against `artifactDir`. Combine findings.

3. **`packages/sdk/src/index.ts`:** re-export `createBuiltinResolver`,
   `extractFindings`, `CheckResolver`, `ResolvedCheck`, `CheckOutput` from
   `@sverka/checks`.

4. **`packages/sdk/package.json`:** add `"@sverka/checks": "workspace:*"` to
   dependencies. Run `bun install`.

5. Re-run SDK tests + full monorepo gates.

**SDK test additions:** the SDK's existing tests should still pass. If the
SDK test for auto-discovery asserts `operations: []`, update it to assert
the resolved operations. Add one test verifying `extractFindings` is called
when outputs are declared (mock the artifact dir).

## 6. Edge cases

- **Multiple package managers:** first Node PM in `ctx.packageManagers` wins
  for Node checks. If `[cargo, bun]`, `test` resolves to `cargo test` (cargo
  entry comes first in table order — actually, order by table, and the
  table lists Node entries before cargo). **Builder:** ensure table order
  matches spec (Node first, then Python, then Rust, then Go).
- **`ProposedCheck.id` empty:** the resolver uses `check.id` as
  `operation.id`. If `check.id` is empty, `convertToPlan` will throw later.
  The resolver does not validate — that's the IR layer's job.
- **`extractFindings` with non-existent `artifactDir`:** `existsSync` on the
  file path returns false → skipped → `[]`. No crash.
- **SARIF file is valid JSON but not SARIF:** `normalizeSarif` throws
  `INVALID_SARIF` → caught → `CheckError(EXTRACTION_FAILED)`.

## 7. Commit hygiene (for finalize)

Stage ONLY:
- `packages/checks/**`
- `packages/sdk/src/sverka.ts` (if SDK integration done)
- `packages/sdk/src/index.ts` (if re-exports added)
- `packages/sdk/package.json` (if dep added)
- `specs/11-checks/spec.md`
- `engdocs/architecture/wave-11-checks-plan.md`
- `bun.lock` (if deps changed)

EXCLUDE: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `.evidence/`,
`.opencode/`, `formulas/`.

## 8. Estimated size

- `errors.ts`: ~20 lines
- `resolver.ts`: ~80 lines (interface + table + factory)
- `extract.ts`: ~35 lines
- `index.ts`: ~6 lines
- Tests: ~250 lines across 4 files
- Total impl: ~140 lines, ~400 with tests

Appropriately sized for a resolution + extraction layer.
