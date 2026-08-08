# Spec 11 — Checks Package: Built-in Check Providers

## Overview

The `checks` package provides built-in check providers that discover,
propose, resolve, and normalize verification checks for a project. A check
provider is the bridge between an external tool (ESLint, Trivy, Gitleaks,
Semgrep, a build system, a test runner) and the Sverka plan IR. Providers
are pluggable: built-in providers ship in this package, and third-party
providers can be registered via a YAML plugin descriptor.

A provider does four things:

1. **Detect** whether its tool is applicable to a given project context.
2. **Propose** one or more check operations (canonical plan entries) when
   applicable.
3. **Resolve** configuration defaults, image references, and locked inputs
   for a proposed check.
4. **Normalize** tool-specific output into the canonical findings model.

Detection must be side-effect free. Proposal must not execute anything.
Resolution may read files but must not mutate the project. Normalization is
pure: it transforms raw output into findings.

## Goals

1. Provide a stable `CheckProvider` interface that all built-in and
   third-party providers implement.
2. Ship built-in providers for the most common verification categories:
   build, lint, test, security scan, typecheck, and dependency audit.
3. Ship specific providers for popular tools: ESLint, Trivy, Gitleaks,
   Semgrep.
4. Support a YAML plugin descriptor format so third-party providers can be
   declared without writing TypeScript.
5. Produce detection results and check proposals that the planner can merge
   into a canonical plan.
6. Normalize heterogeneous tool output into the canonical findings model
   defined by the `findings` package.
7. Keep detection and proposal deterministic and side-effect free so the
   planner can run them in parallel and cache results.

## Non-goals

- Executing checks. Execution is the responsibility of the runtime
  packages. Providers only describe checks.
- Implementing scanner logic inside Sverka. Providers wrap external tools.
- Supporting every possible tool. The plugin descriptor exists for the long
  tail.
- Owning the findings model. The `findings` package owns normalization
  rules; providers supply raw output and hints.
- Managing tool installation or version pinning on the host. Providers
  declare image references; the runtime pulls them.

## Interfaces

```typescript
/**
 * A check provider discovers, proposes, resolves, and normalizes a
 * category of verification checks.
 */
export interface CheckProvider {
  /** Stable unique identifier, e.g. "eslint". */
  readonly id: string;
  /** Schema version of this provider's proposal output. */
  readonly version: string;
  /** Human-readable category, e.g. "lint", "securityScan". */
  readonly category: CheckCategory;

  /**
   * Detect whether this provider applies to the given project context.
   * Must be side-effect free and deterministic.
   */
  detect(ctx: DetectionContext): Promise<DetectionResult>;

  /**
   * Propose one or more check operations for the project. Called only when
   * detect() returns applicable. Must not execute anything.
   */
  propose(ctx: DetectionContext, result: DetectionResult): Promise<CheckProposal[]>;

  /**
   * Resolve a proposed check into a fully-specified operation ready for the
   * plan IR. May read files but must not mutate the project.
   */
  resolve(proposal: CheckProposal, ctx: DetectionContext): Promise<ResolvedCheck>;

  /**
   * Normalize raw tool output into the canonical findings model.
   * Pure function: no I/O, no side effects.
   */
  normalize(raw: unknown, proposal: CheckProposal): NormalizationResult;
}

export type CheckCategory =
  | "build"
  | "lint"
  | "test"
  | "securityScan"
  | "typecheck"
  | "dependencyAudit";

export interface DetectionContext {
  /** Absolute path to the project root. */
  readonly projectRoot: string;
  /** Map of file path (relative to root) to file content for manifest files. */
  readonly manifests: ReadonlyMap<string, string>;
  /** List of file paths (relative to root) discovered by the planner. */
  readonly filePaths: readonly string[];
  /** Environment variables available to detection (read-only snapshot). */
  readonly env: Readonly<Record<string, string>>;
}

export interface DetectionResult {
  /** Whether the provider applies. */
  readonly applicable: boolean;
  /** Confidence score 0..1. */
  readonly confidence: number;
  /** Human-readable reason for the decision. */
  readonly reason: string;
  /** Evidence: file paths or manifest keys that triggered detection. */
  readonly evidence: readonly string[];
}

export interface CheckProposal {
  /** Provider id that produced this proposal. */
  readonly providerId: string;
  /** Proposal id, unique within a provider, e.g. "eslint:src". */
  readonly proposalId: string;
  /** Display name for the check. */
  readonly name: string;
  /** Category. */
  readonly category: CheckCategory;
  /** Tool command or entrypoint, unresolved. */
  readonly command: string;
  /** Arguments, may contain template placeholders. */
  readonly args: readonly string[];
  /** File globs this check should run against, if applicable. */
  readonly inputs?: readonly string[];
  /** Provider-specific hints for resolution. */
  readonly hints: Readonly<Record<string, string>>;
}

export interface ResolvedCheck {
  readonly providerId: string;
  readonly proposalId: string;
  readonly name: string;
  readonly category: CheckCategory;
  /** Container image reference (locked digest) or "host" for host execution. */
  readonly image: string;
  /** Resolved command with no remaining placeholders. */
  readonly command: string;
  readonly args: readonly string[];
  /** Environment variables to set. */
  readonly env: Readonly<Record<string, string>>;
  /** Working directory inside the container or on host. */
  readonly workdir: string;
  /** Output files the check produces (SARIF, JSON, JUnit). */
  readonly outputs: readonly CheckOutput[];
}

export interface CheckOutput {
  readonly path: string;
  readonly format: "sarif" | "json" | "junit" | "text";
  /** Findings parser id within the findings package. */
  readonly parser: string;
}

export interface NormalizationResult {
  readonly findings: readonly NormalizedFinding[];
  readonly errors: readonly NormalizationError[];
}

export interface NormalizedFinding {
  readonly ruleId: string;
  readonly severity: "info" | "low" | "medium" | "high" | "critical";
  readonly message: string;
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

export interface NormalizationError {
  readonly message: string;
  readonly raw?: unknown;
}

/**
 * Registry of all known providers, built-in and plugin-loaded.
 */
export interface CheckProviderRegistry {
  list(): readonly CheckProvider[];
  get(id: string): CheckProvider | undefined;
  register(provider: CheckProvider): void;
  /** Load providers from YAML plugin descriptors. */
  loadPlugins(descriptors: readonly PluginDescriptor[]): void;
}

/**
 * YAML plugin descriptor for third-party providers.
 */
export interface PluginDescriptor {
  readonly id: string;
  readonly version: string;
  readonly category: CheckCategory;
  readonly detect: PluginDetectRule;
  readonly propose: PluginProposeRule;
  readonly normalize?: PluginNormalizeRule;
}

export interface PluginDetectRule {
  /** File globs that, if present, make the provider applicable. */
  readonly matchFiles?: readonly string[];
  /** Manifest keys to check, e.g. "package.json:scripts.lint". */
  readonly matchManifestKeys?: readonly string[];
  /** Minimum confidence when matched. */
  readonly confidence?: number;
}

export interface PluginProposeRule {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly image?: string;
  readonly outputs?: readonly CheckOutput[];
}

export interface PluginNormalizeRule {
  readonly parser: string;
  readonly format: "sarif" | "json" | "junit" | "text";
}
```

### Built-in providers

```typescript
/** Built-in provider ids exported from the package. */
export const BUILTIN_PROVIDER_IDS = [
  "build",
  "lint",
  "test",
  "securityScan",
  "typecheck",
  "eslint",
  "trivy",
  "gitleaks",
  "semgrep",
  "dependencyAudit",
] as const;

export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

/** Factory that returns a registry pre-loaded with all built-in providers. */
export function createBuiltinRegistry(): CheckProviderRegistry;
```

## Data models

### Built-in provider mapping

| Provider id        | Category         | Tool / convention            | Detection signal                                   |
|--------------------|------------------|------------------------------|----------------------------------------------------|
| `build`            | build            | npm/yarn/bun build scripts    | `package.json` scripts.build, Makefile             |
| `lint`             | lint             | generic lint script           | `package.json` scripts.lint, `.eslintrc*`          |
| `test`             | test             | npm/yarn/bun test scripts     | `package.json` scripts.test, `*.test.*` files      |
| `securityScan`     | securityScan     | generic SAST/container scan   | Dockerfile present, security config files          |
| `typecheck`        | typecheck        | `tsc --noEmit`                | `tsconfig.json`                                    |
| `eslint`           | lint             | ESLint                        | `.eslintrc*`, `eslint.config.*`, eslint dependency |
| `trivy`            | securityScan     | Trivy                         | `.trivy*`, Dockerfile, image references            |
| `gitleaks`         | securityScan     | Gitleaks                      | `.gitleaks*`, git repository present               |
| `semgrep`          | securityScan     | Semgrep                       | `semgrep.yml`, `.semgrep*`                         |
| `dependencyAudit`  | dependencyAudit  | npm audit / bun audit         | lockfile present (`bun.lockb`, `package-lock.json`)|

### Plugin descriptor format (YAML)

```yaml
id: my-custom-scanner
version: "1.0.0"
category: securityScan

detect:
  matchFiles:
    - ".my-scanner.yml"
  matchManifestKeys:
    - "package.json:scripts.scan"
  confidence: 0.8

propose:
  name: "My Custom Scanner"
  command: "my-scanner"
  args: ["scan", "--output", "sarif"]
  image: "ghcr.io/my-org/my-scanner:1.0.0@sha256:abc..."
  outputs:
    - path: "results.sarif"
      format: "sarif"
      parser: "sarif"

normalize:
  parser: "sarif"
  format: "sarif"
```

### Detection result

```json
{
  "applicable": true,
  "confidence": 0.9,
  "reason": "Found eslint.config.js and eslint in devDependencies",
  "evidence": ["eslint.config.js", "package.json:devDependencies.eslint"]
}
```

### Check proposal

```json
{
  "providerId": "eslint",
  "proposalId": "eslint:src",
  "name": "ESLint (src)",
  "category": "lint",
  "command": "eslint",
  "args": ["src", "--format", "@sverka/sarif-formatter"],
  "inputs": ["src/**/*.ts"],
  "hints": { "configFile": "eslint.config.js" }
}
```

## Error handling

All errors extend a base `CheckProviderError`:

```typescript
export class CheckProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly code: CheckErrorCode,
  ) {
    super(message);
    this.name = "CheckProviderError";
  }
}

export type CheckErrorCode =
  | "DETECTION_FAILED"
  | "PROPOSAL_FAILED"
  | "RESOLUTION_FAILED"
  | "NORMALIZATION_FAILED"
  | "INVALID_PLUGIN_DESCRIPTOR"
  | "DUPLICATE_PROVIDER_ID";
```

- `detect()` failures throw `DETECTION_FAILED`. The planner treats a failed
  detection as "not applicable" and logs a warning.
- `propose()` failures throw `PROPOSAL_FAILED`. The planner skips the
  provider and continues with others.
- `resolve()` failures throw `RESOLUTION_FAILED`. The planner excludes the
  unresolved proposal from the final plan.
- `normalize()` never throws for malformed tool output. It returns
  `NormalizationError[]` entries instead, so partial findings are preserved.
- Invalid plugin descriptors throw `INVALID_PLUGIN_DESCRIPTOR` at load time.
- Registering a provider with a duplicate id throws
  `DUPLICATE_PROVIDER_ID`.

## Test plan

- Unit tests for each built-in provider's `detect()` using fixture projects
  in `src/__tests__/fixtures/`.
- Unit tests for `propose()` verifying the shape and fields of proposals.
- Unit tests for `resolve()` verifying image references, commands, and
  outputs are fully resolved.
- Unit tests for `normalize()` with sample SARIF, JSON, and JUnit payloads,
  asserting normalized findings match expected output.
- Unit tests for `createBuiltinRegistry()` asserting all built-in provider
  ids are present.
- Unit tests for plugin descriptor loading: valid YAML, missing fields,
  duplicate ids.
- Property tests: `detect()` is deterministic across repeated calls with
  the same context.
- Tests run via `bun test`.
- No `any` types; all test fixtures use concrete typed objects.
```