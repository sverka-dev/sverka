# Feature: Scalar outputs

**ID:** F-23
**Category:** outputs
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Scalar outputs are typed values (string, number, boolean) produced by a step
and consumed by downstream steps. GitHub uses `$GITHUB_OUTPUT`; GitLab uses
`artifacts:reports:dotenv`. Sverka models scalar outputs as
`OutputDeclaration` with a type, captured via `exportOutput` operations and
transferred in-memory by the native engine's `ValueStore`.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `$GITHUB_OUTPUT` file | `artifacts:reports:dotenv` | `OutputDeclaration` (type: string/number/boolean) |
| Semantics | step writes `key=value` to file, read by downstream jobs | job writes dotenv file, passed via artifacts | step writes to `$SVERKA_OUTPUT_DIR`, engine reads + stores |
| Value type | string (untyped) | string (dotenv) | typed: string/number/boolean |
| Limitations | no type info | dotenv format only | typed parsing in engine |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
jobs:
  build:
    outputs:
      version: ${{ steps.set-version.outputs.version }}
    steps:
      - id: set-version
        run: echo "version=1.2.3" >> "$GITHUB_OUTPUT"
  deploy:
    needs: build
    steps:
      - run: echo ${{ needs.build.outputs.version }}
```

Outputs are written to `$GITHUB_OUTPUT` and read via `needs.<job>.outputs.<key>`.

## GitLab CI

```yaml
build:
  script:
    - echo "version=1.2.3" >> sverka.env
  artifacts:
    reports:
      dotenv: sverka.env
deploy:
  needs: [build]
  script:
    - echo $version
```

Dotenv report artifacts pass variables between jobs. Downstream jobs access
them as env vars.

## Sverka proposal

### Portable model

`OutputDeclaration` (`cdk/model.ts:77-81`) with `type: "string" | "number" |
"boolean"`. Synthesis emits `{ kind: "exportOutput", name, type }` operations
(`core/graph.ts:65`). The native engine reads the output file from
`$SVERKA_OUTPUT_DIR/<name>`, parses it by type, and stores it in `ValueStore`.

**File format:** the output file contains only the raw scalar value (not
`name=value`). The parser trims whitespace and applies type conversion:
number→`Number()`, boolean→`=== "true"`, string→`trim()`. Examples:
`1.2.3` (string), `42` (number), `true` (boolean). The GitHub and GitLab
lowerings emit `echo "name=value" >> $GITHUB_OUTPUT` / `sverka.env` because
those providers use dotenv format, but the native engine's file format is
raw-value only.

### Authoring API

```ts
// SDK — sh builder with outputs
sh`echo "1.2.3" > $SVERKA_OUTPUT_DIR/version`
  .outputs({ version: { type: "string" } })
  .build(pipeline, "build");

// Consuming via StepRef
import { stepRef } from "@sverka/cdk";
sh`echo ${buildRef.version}`.build(pipeline, "deploy");
// where buildRef = { kind: "step", step: "build", output: "version", type: "string" }

// Construct
new ShellStep(pipeline, "build", {
  command: "echo 1.2.3 > $SVERKA_OUTPUT_DIR/version",
  outputs: { version: { type: "string" } },
});

// Decorator
@step({ outputs: { version: { type: "string" } } })
```

### Lowering

- **GitHub target:** `exportOutput` → `echo "name=${name}" >> "$GITHUB_OUTPUT"`
  (`github/lower.ts:370-373`). Combined with preceding shell ops into one
  `run:` step.
- **GitLab target:** `exportOutput` → `echo "name=${name}" >> sverka.env` +
  `artifacts:reports:dotenv: sverka.env` (`gitlab/lower.ts:494-500,526-528`).
- **Native engine:** `StepExecutor.executeExportOutputOperation`
  (`engine-native/step-executor.ts:134-154`) reads `$SVERKA_OUTPUT_DIR/<name>`,
  parses by type (number→`Number()`, boolean→`=== "true"`, string→trim),
  stores in `ValueStore`. `interpolateCommand` resolves `${step.output}` refs
  from the store.

### Capability manifest

```ts
"output.scalar": "lowered",  // GitHub: $GITHUB_OUTPUT; GitLab: dotenv report
```

### Portability & divergence

GitHub outputs are untyped strings; GitLab dotenv is also untyped. Sverka
adds type information in the portable model and parses values in the native
engine. In compiled output, types are lost (all values are strings) — this
is acceptable because provider shells treat everything as strings.

## Non-goals

- Cross-pipeline outputs (outputs are intra-pipeline only).
- Output schema validation beyond type parsing.

## Dependencies

- **Depends on:** F-09 (shell ops), F-07 (DAG deps — value deps carry outputs).
- **Blocks:** F-24 (artifact outputs — same `OutputDeclaration` type).

## Open questions

- Should the `sh` template auto-generate `exportOutput` ops from declared
  outputs, or require explicit file writes?
- Should outputs be declared on the step or inferred from the command?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idoutputs
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifactsreportsdotenv
- Architecture spec: §12.2, §15
- Source: `packages/cdk/src/model.ts:77-81`, `packages/core/src/graph.ts:65`, `packages/core/src/synthesize.ts:127-146`, `packages/github/src/lower.ts:370-373`, `packages/gitlab/src/lower.ts:494-500`, `packages/engine-native/src/step-executor.ts:134-154`, `packages/engine-native/src/value-store.ts:1-24`
