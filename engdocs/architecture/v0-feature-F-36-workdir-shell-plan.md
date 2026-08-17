# F-36: Working Directory & Shell Selection — Implementation Plan

**Spec:** `specs/features/F-36-workdir-shell.md`
**Bead:** sv-lfle.19 (P1)
**Blocks:** F-45 (defaults)

## Scope

M0 gap: `workingDir` not lowered to GitHub/GitLab targets. `shell` field
missing from model. Native engine already handles `workingDir`.

## Changes

### Model (constructs/src/model.ts)
- Add `shell?: string` to `Runtime` (alongside existing `workingDir`)

### GitHub target
- `types.ts`: add `workingDirectory?: string`, `shell?: string` to `GithubStep`
- `lower.ts`: attach `workingDirectory`/`shell` to run steps in `flushRun`
- `emit.ts`: emit `working-directory` and `shell` in YAML

### GitLab target
- `lower.ts`: prepend `cd <workdir>` to script entries when `workingDir` is set
- `shell`: unsupported — capability manifest says "unsupported", diagnostics
  emitted by capability analysis

### Capability detection (plugin/src/capabilities.ts)
- Detect `execution.workdir` and `execution.shell` from step runtime

### Capability manifests
- GitHub: `execution.workdir: native`, `execution.shell: native`
- GitLab: `execution.workdir: emulated`, `execution.shell: unsupported`

### Native engine
- `workingDir` already works (step-executor.ts:107-108). No changes.
- `shell` deferred — host driver allowlist security model needs review.

### SDK
- No changes needed. `sh().runtime({ workingDir, shell })` flows through.

## Test plan

1. GitHub: `workingDir` → `working-directory:` on run steps ✓
2. GitHub: `shell` → `shell:` on run steps ✓
3. GitHub: no `workingDir`/`shell` → no extra fields ✓
4. GitHub: `working-directory` not on checkout/upload steps ✓
5. GitLab: `workingDir` → `cd <workdir>` prepended to script ✓
6. GitLab: no `workingDir` → no `cd` prefix ✓
7. Capability manifests updated ✓
8. All existing tests pass (244 across 28 files) ✓

## Verification

- `npx vitest run` — 244 tests pass across 8 packages
- `npx tsc --noEmit` — 0 new errors (1 pre-existing in github public-api test)
- `npx oxlint` — 0 errors (4 pre-existing warnings)
