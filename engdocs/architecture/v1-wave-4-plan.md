# v1 Wave 4 — Implementation Plan

**Status:** Active
**Date:** 2026-08-31
**Architect:** architect-1
**Wave epic:** sv-wthn.4
**Features:** sv-wthn.4.1 (Temporal), sv-wthn.4.2 (Dagger), sv-wthn.4.3 (Inngest), sv-wthn.4.4 (Drone)
**Base branch:** `feat/v1-w3-storage` (Wave 3 tip, commit 1cf1d8c)
**ADR:** ADR-016 — all four are code-generation Targets, not execution Engines.

## Design decision

All four integrations implement the existing `Target` contract
(`compile(graph: DefinitionGraph): CompilationResult`). They emit
platform-native code (TypeScript for Temporal/Dagger/Inngest, YAML for
Drone). No new packages, no new external dependencies. All live in
`@sverka/compiler` as sub-modules: `temporal/`, `dagger/`, `inngest/`,
`drone/`.

## Package layout (per sub-module)

Each sub-module follows the existing `gitlab/` pattern:

```
packages/compiler/src/<target>/
  types.ts        — config + IR types
  capabilities.ts — CapabilityManifest
  errors.ts       — <Target>Error with override cause
  lower.ts        — DefinitionGraph → <Target>Graph (IR)
  emit.ts         — <Target>Graph → GeneratedArtifact[] (code/YAML strings)
  target.ts       — <Target> class implements Target + compile<target>() fn
  index.ts        — public exports
  __tests__/
    compile.test.ts    — end-to-end compilation tests
    public-api.test.ts — export assertions
    helpers/fixtures.ts — test graph builders
```

## Shared patterns

- All reuse `Target`, `CompilationResult`, `CapabilityManifest`,
  `analyzeCapabilities` from `../plugin/index.js`.
- All use `yaml` library (already a dep) for Drone YAML emission.
- Temporal/Dagger/Inngest emit TypeScript code strings (no AST library —
  template literals with careful indentation).
- All declare capabilities matching their platform's native support.
- All are deterministic (same graph → byte-identical output).

## TDD steps

### Step 1: Drone target (simplest — YAML, same pattern as GitLab)

1. Write `drone/types.ts` — `DroneStep`, `DronePipeline`, `DroneTargetGraph`.
2. Write `drone/capabilities.ts` — manifest from spec 36.
3. Write `drone/errors.ts` — `DroneTargetError` + codes.
4. Write failing tests: `drone/__tests__/compile.test.ts` (items 1-14
   from spec 36 test plan).
5. Write `drone/lower.ts` — DG → DroneTargetGraph.
6. Write `drone/emit.ts` — DroneTargetGraph → YAML string.
7. Write `drone/target.ts` — `DroneTarget` class + `compileDrone()`.
8. Write `drone/index.ts` — exports.
9. Write `drone/__tests__/public-api.test.ts` — export assertions.
10. Run gates: `bun run test --filter @sverka/compiler`, typecheck, lint.

### Step 2: Temporal target (TypeScript code generation)

1. Write `temporal/types.ts` — `TemporalActivity`, `TemporalWorkflow`,
   `TemporalTargetGraph`.
2. Write `temporal/capabilities.ts` — manifest from spec 33.
3. Write `temporal/errors.ts` — `TemporalTargetError` + codes.
4. Write failing tests: `temporal/__tests__/compile.test.ts` (items 1-13
   from spec 33 test plan).
5. Write `temporal/lower.ts` — DG → TemporalTargetGraph (activities +
   workflow sequencing).
6. Write `temporal/emit.ts` — TemporalTargetGraph → .workflow.ts +
   .activities.ts code strings.
7. Write `temporal/target.ts` — `TemporalTarget` class +
   `compileTemporal()`.
8. Write `temporal/index.ts` — exports.
9. Write `temporal/__tests__/public-api.test.ts` — export assertions.
10. Run gates.

### Step 3: Dagger target (TypeScript code generation)

1. Write `dagger/types.ts` — `DaggerStep`, `DaggerFunction`,
   `DaggerTargetGraph`.
2. Write `dagger/capabilities.ts` — manifest from spec 34.
3. Write `dagger/errors.ts` — `DaggerTargetError` + codes.
4. Write failing tests: `dagger/__tests__/compile.test.ts` (items 1-13
   from spec 34 test plan).
5. Write `dagger/lower.ts` — DG → DaggerTargetGraph (Container chain).
6. Write `dagger/emit.ts` — DaggerTargetGraph → .ts module code string.
7. Write `dagger/target.ts` — `DaggerTarget` class + `compileDagger()`.
8. Write `dagger/index.ts` — exports.
9. Write `dagger/__tests__/public-api.test.ts` — export assertions.
10. Run gates.

### Step 4: Inngest target (TypeScript code generation)

1. Write `inngest/types.ts` — `InngestStep`, `InngestFunction`,
   `InngestTargetGraph`.
2. Write `inngest/capabilities.ts` — manifest from spec 35.
3. Write `inngest/errors.ts` — `InngestTargetError` + codes.
4. Write failing tests: `inngest/__tests__/compile.test.ts` (items 1-13
   from spec 35 test plan).
5. Write `inngest/lower.ts` — DG → InngestTargetGraph (step.run
   sequence).
6. Write `inngest/emit.ts` — InngestTargetGraph → .ts function code
   string.
7. Write `inngest/target.ts` — `InngestTarget` class +
   `compileInngest()`.
8. Write `inngest/index.ts` — exports.
9. Write `inngest/__tests__/public-api.test.ts` — export assertions.
10. Run gates.

### Step 5: Wire into compiler barrel + final gates

1. Add exports to `packages/compiler/src/index.ts`:
   - `compileTemporal`, `TemporalTarget`, `TemporalTargetConfig`
   - `compileDagger`, `DaggerTarget`, `DaggerTargetConfig`
   - `compileInngest`, `InngestTarget`, `InngestTargetConfig`
   - `compileDrone`, `DroneTarget`, `DroneTargetConfig`
2. Run full monorepo gates: `bun run test`, `bun run typecheck`, `bun run
   lint`, `bun run build`.
3. Verify no `any` types (grep).
4. Verify all error classes use `override` on `cause`.

## Implementation order

Drone first (simplest, YAML, follows GitLab pattern exactly). Then
Temporal, Dagger, Inngest (TypeScript code generation, slightly more
complex template logic). All four are independent — could be parallelized
across builders if available.

## Estimated size

- Drone: ~150 impl lines + ~200 test (similar to GitLab target).
- Temporal: ~200 impl lines + ~250 test (code generation templates).
- Dagger: ~180 impl lines + ~220 test.
- Inngest: ~180 impl lines + ~220 test.
- Total: ~710 impl + ~890 test = ~1600 lines.

## Commit hygiene

Stage ONLY:
- `packages/compiler/src/temporal/**`
- `packages/compiler/src/dagger/**`
- `packages/compiler/src/inngest/**`
- `packages/compiler/src/drone/**`
- `packages/compiler/src/index.ts` (modified — new exports)
- `specs/33-target-temporal/spec.md`
- `specs/34-target-dagger/spec.md`
- `specs/35-target-inngest/spec.md`
- `specs/36-target-drone/spec.md`
- `engdocs/adr/ADR-016-wave4-code-generation-targets.md`
- `engdocs/architecture/v1-wave-4-plan.md`

EXCLUDE: city.toml, agents/, .devin/, .gc/, .beads/, formulas/.
