// Model types shared between the construct tree and the Definition Graph.
// Spec 01 — §12, §13, §14.

// ---------------------------------------------------------------------------
// Triggers (§13)
// ---------------------------------------------------------------------------

export interface TriggerFilter {
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly paths?: readonly string[];
}

export interface Push {
  readonly kind: "push";
  readonly filter?: TriggerFilter;
}

export interface ChangeRequest {
  readonly kind: "changeRequest";
  readonly filter?: TriggerFilter;
}

export interface Manual {
  readonly kind: "manual";
  readonly filter?: TriggerFilter;
}

// F-05: Schedule trigger
export interface Schedule {
  readonly kind: "schedule";
  readonly cron: string;
  readonly timezone?: string;
}

export type Trigger = Push | ChangeRequest | Manual | Schedule;

export function push(filter?: TriggerFilter): Push {
  return { kind: "push", ...(filter ? { filter } : {}) };
}

export function changeRequest(filter?: TriggerFilter): ChangeRequest {
  return { kind: "changeRequest", ...(filter ? { filter } : {}) };
}

export function manual(filter?: TriggerFilter): Manual {
  return { kind: "manual", ...(filter ? { filter } : {}) };
}

// F-05: Schedule trigger helper
export function schedule(cron: string, timezone?: string): Schedule {
  return { kind: "schedule", cron, ...(timezone ? { timezone } : {}) };
}

// ---------------------------------------------------------------------------
// References (§11.1, §12.3)
// ---------------------------------------------------------------------------

export type OutputType = "string" | "number" | "boolean" | "artifact";

export interface StepRef {
  readonly kind: "step";
  readonly step: string;
  readonly output: string;
  readonly type: OutputType;
}

export type ContextNamespace =
  | "env"
  | "secrets"
  | "git"
  | "change"
  | "event"
  | "run"
  | "inputs"
  | "matrix";

export interface ContextRef {
  readonly kind: "context";
  readonly namespace: ContextNamespace;
  readonly field: string;
}

export type Reference = StepRef | ContextRef;

// ---------------------------------------------------------------------------
// Expressions (F-35) — symbolic expressions with context references
// ---------------------------------------------------------------------------

export interface Expression {
  readonly kind: "expression";
  readonly template: string;
  readonly refs: readonly Reference[];
}

// ---------------------------------------------------------------------------
// Outputs (§12.2)
// ---------------------------------------------------------------------------

export type ArtifactAccess = "all" | "developer" | "maintainer" | "none";

export interface OutputDeclaration {
  readonly type: OutputType;
  readonly path?: string;
  readonly description?: string;
  readonly retention?: string;
  readonly access?: ArtifactAccess;
}

// ---------------------------------------------------------------------------
// Inputs (§12.1)
// ---------------------------------------------------------------------------

export type InputType = "string" | "number" | "boolean" | "choice" | "array";

export interface Input {
  readonly type: InputType;
  readonly required?: boolean;
  readonly default?: string | number | boolean | readonly string[];
  readonly description?: string;
  readonly secret?: boolean;
  readonly options?: readonly string[];
  readonly pattern?: string;
}

/** Literal value bindable to a callee pipeline input. */
export type InputLiteral = string | number | boolean | readonly string[];

// ---------------------------------------------------------------------------
// Components (F-32 — §25)
// ---------------------------------------------------------------------------

/** Reference to a versioned, distributable component with bound inputs. */
export interface ComponentRef {
  readonly name: string;
  readonly version: string;
  readonly inputs: Readonly<Record<string, Reference | InputLiteral>>;
}

// ---------------------------------------------------------------------------
// Child pipelines (F-33 — §25)
// ---------------------------------------------------------------------------

/** Dynamic child pipeline trigger: a generator step produces a YAML artifact
 * that becomes a new pipeline at runtime. */
export interface ChildPipelineTrigger {
  readonly generator: string;
  readonly artifact: string;
}

// ---------------------------------------------------------------------------
// Downstream projects (F-34 — §25)
// ---------------------------------------------------------------------------

/** Downstream project trigger: triggers a pipeline in another project/repo. */
export interface DownstreamTrigger {
  readonly project: string;
  readonly branch?: string;
  readonly inputs?: Readonly<Record<string, Reference | InputLiteral>>;
}

// ---------------------------------------------------------------------------
// Release (F-39 — §25)
// ---------------------------------------------------------------------------

/** Release specification for creating versioned releases. */
export interface ReleaseSpec {
  readonly tag: string;
  readonly name?: string;
  readonly description?: string;
  readonly assets?: readonly string[];
  readonly draft?: boolean;
  readonly prerelease?: boolean;
}

// ---------------------------------------------------------------------------
// Pages (F-40 — §25)
// ---------------------------------------------------------------------------

/** Pages deployment specification. */
export interface PagesSpec {
  readonly path: string;
  readonly prefix?: string;
}

// ---------------------------------------------------------------------------
// Workflow rules (F-42 — §25)
// ---------------------------------------------------------------------------

/** Pipeline-level rule controlling whether the pipeline runs. */
export interface PipelineRule {
  readonly if?: string;
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
  readonly when?: "always" | "never";
}

// ---------------------------------------------------------------------------
// Includes (F-44 — §25)
// ---------------------------------------------------------------------------

/** Include reference: merges another config fragment into the pipeline. */
export interface IncludeRef {
  readonly path: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Runtime (§14.1)
// ---------------------------------------------------------------------------

export interface Runtime {
  readonly mode?: "host" | "container";
  readonly image?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly workingDir?: string;
  readonly shell?: string;
}

// ---------------------------------------------------------------------------
// Matrix expansion (F-15, F-16)
// ---------------------------------------------------------------------------

export type MatrixValue = string | number;

export interface MatrixSpec {
  readonly dimensions: Readonly<Record<string, readonly MatrixValue[]>>;
  readonly include?: readonly Readonly<Record<string, MatrixValue>>[];
  readonly exclude?: readonly Readonly<Record<string, MatrixValue>>[];
  readonly failFast?: boolean;
  readonly maxParallel?: number;
}

// ---------------------------------------------------------------------------
// Step conditions (F-11)
// ---------------------------------------------------------------------------

export type StepStatus = "success" | "failure" | "always" | "never";

export interface StatusCondition {
  readonly kind: "status";
  readonly status: StepStatus;
}

export type Condition = Reference | Expression | StatusCondition;

// ---------------------------------------------------------------------------
// Before/after scripts (F-10)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Continue-on-error (F-12)
// ---------------------------------------------------------------------------

export type ContinueOnError = boolean | { readonly exitCodes: readonly number[] };

// ---------------------------------------------------------------------------
// Retry policy (F-14)
// ---------------------------------------------------------------------------

export type RetryWhen =
  | "always"
  | "script_failure"
  | "runner_system_failure"
  | "timeout"
  | "unknown_failure";

export interface RetryPolicy {
  readonly max: number;
  readonly when?: readonly RetryWhen[];
  readonly exitCodes?: readonly number[];
}

// ---------------------------------------------------------------------------
// Runner selection (§14.2 — F-37)
// ---------------------------------------------------------------------------

export interface RunnerSpec {
  readonly labels: readonly string[];
  readonly group?: string;
}

// ---------------------------------------------------------------------------
// OIDC identity (§14.3 — F-38)
// ---------------------------------------------------------------------------

export interface IdentityTokenSpec {
  readonly audience: string;
}

export interface IdentitySpec {
  readonly tokens: Readonly<Record<string, IdentityTokenSpec>>;
}

// ---------------------------------------------------------------------------
// Rules (§14.4 — F-41)
// ---------------------------------------------------------------------------

export type RuleWhen = "on_success" | "on_failure" | "always" | "never" | "manual";

export interface Rule {
  readonly if?: string;
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
  readonly when?: RuleWhen;
  readonly variables?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Defaults (§14.5 — F-45)
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  readonly max: number;
  readonly exitCodes?: readonly number[];
}

export interface PipelineDefaults {
  readonly shell?: string;
  readonly workdir?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly beforeScript?: readonly string[];
  readonly afterScript?: readonly string[];
  readonly timeout?: number;
  readonly retry?: RetryPolicy;
  readonly interruptible?: boolean;
}

// ---------------------------------------------------------------------------
// Artifact reports (§14.6 — F-46)
// ---------------------------------------------------------------------------

export type ReportType =
  | "junit"
  | "coverage"
  | "dotenv"
  | "sast"
  | "dast"
  | "dependencyScanning"
  | "containerScanning"
  | "licenseScanning"
  | "performance"
  | "metrics"
  | "terraform"
  | "quality"
  | "sarif";

export interface ReportSpec {
  readonly type: ReportType;
  readonly path: string;
  readonly format?: string;
}

// ---------------------------------------------------------------------------
// Service containers (§14.7 — F-19)
// ---------------------------------------------------------------------------

export interface ServiceContainer {
  readonly name: string;
  readonly image: string;
  readonly alias?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly ports?: readonly number[];
  readonly entrypoint?: readonly string[];
  readonly command?: readonly string[];
}

// ---------------------------------------------------------------------------
// Environments & deployments (§14.8 — F-22)
// ---------------------------------------------------------------------------

export type EnvironmentAction = "start" | "stop" | "verify";
export type EnvironmentTier = "production" | "staging" | "testing" | "development";

export interface EnvironmentSpec {
  readonly name: string;
  readonly url?: string;
  readonly action?: EnvironmentAction;
  readonly tier?: EnvironmentTier;
}

// ---------------------------------------------------------------------------
// Cache (§14.9 — F-27)
// ---------------------------------------------------------------------------

export type CachePolicy = "pull" | "push" | "pull-push";

export interface CacheSpec {
  readonly paths: readonly string[];
  readonly key: string;
  readonly restoreKeys?: readonly string[];
  readonly policy?: CachePolicy;
}

// ---------------------------------------------------------------------------
// Concurrency & resource groups (§14.10 — F-28)
// ---------------------------------------------------------------------------

export interface ConcurrencySpec {
  readonly group: string;
  readonly cancelInProgress?: boolean;
}
