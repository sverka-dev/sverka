# Sverka Architecture Specification

**Status:** Draft for review  
**Version:** 0.1  
**Date:** 2026-08-12

### Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used to distinguish required behavior from recommendations and optional extensions.

## 1. Summary

Sverka is a provider-neutral TypeScript framework and execution platform for defining pipelines once, compiling them to CI targets, and running the same execution model through native or delegated engines.

Sverka has one semantic core and three authoring surfaces:

1. **Construct API** — low-level, CDK-style composition based on constructs.
2. **SDK API** — higher-level composables and typed helpers built on the Construct API.
3. **Decorator API** — compact TypeScript-native syntax built on the SDK and Construct API.

These are authoring layers, not separate execution modes. Every authoring surface MUST synthesize the same provider-neutral Definition Graph.

Execution is a separate concern. Sverka supports:

- compilation to target-native configuration, such as GitHub Actions or GitLab CI;
- execution through the Sverka native engine;
- execution through delegated engines such as `act` or `gitlab-ci-local`;
- future import and translation of existing provider-specific pipeline definitions.

## 2. Product Statement

> Sverka is a provider-neutral TypeScript framework and execution platform for defining pipelines once, compiling them to multiple CI targets, and running the same execution plan through native or delegated engines.

The core promise is:

- one semantic model;
- multiple authoring APIs;
- multiple compilation targets;
- multiple execution engines;
- explicit portability diagnostics;
- no silent loss of provider-specific behavior.

## 3. Goals

Sverka MUST:

1. provide a provider-neutral pipeline model;
2. support TypeScript-native authoring;
3. support low-level constructs, high-level SDK composables, and decorators;
4. infer dependencies from typed references where possible;
5. compile the same definition to GitHub Actions and GitLab CI;
6. execute the same definition with a native local engine;
7. expose a stable plugin contract for targets, engines, importers, connectors, validators, and model extensions;
8. report portability and capability gaps before execution;
9. support provider-specific escape hatches without corrupting the portable core;
10. make future cross-provider translation an extension problem rather than an architectural rewrite.

## 4. Non-goals for the Initial Release

The initial release is not intended to:

- reproduce every GitHub Actions feature;
- reproduce every GitLab CI feature;
- parse arbitrary existing GitHub or GitLab configuration;
- provide lossless GitHub-to-GitLab or GitLab-to-GitHub translation;
- implement a distributed execution platform;
- replace Docker, Podman, containerd, or another OCI runtime;
- provide a hosted CI control plane;
- guarantee identical provider UI behavior;
- hide unsupported features or silently drop semantics.

## 5. Architectural Principles

### 5.1 One semantic model

Constructs, SDK composables, and decorators MUST synthesize the same Definition Graph. There MUST NOT be separate decorator, SDK, or construct compilers with different semantics.

### 5.2 Authoring and execution are independent

Authoring APIs describe a pipeline. Targets compile it. Engines execute it. Connectors communicate with remote systems.

No target or engine owns the semantic model.

### 5.3 Construct tree and execution graph are different structures

The construct tree describes ownership, composition, identity, and source location.

The execution graph describes scheduling, dependencies, data transfer, and failure propagation.

A construct may contain many Steps. A Step may depend on another Step located elsewhere in the construct tree.

### 5.4 Portability is explicit

Each feature MUST declare a capability identifier. Each target and engine MUST declare how it supports that capability:

- `native` — direct support;
- `lowered` — translated into equivalent target primitives;
- `emulated` — provided by a Sverka runtime or shim;
- `connector` — requires provider API integration;
- `partial` — supported with documented restrictions;
- `unsupported` — compilation or execution MUST fail with a diagnostic.

### 5.5 Synthesis is deterministic

Given the same source, configuration, plugin versions, and inputs, synthesis MUST produce the same Definition Graph and target artifacts.

Network access MUST NOT occur during pure target compilation.

### 5.6 Provider-specific semantics are preserved, never ignored

Provider-specific nodes MUST be tagged with their owning plugin. They may be preserved for same-provider round trips, lowered by another plugin, emulated by an engine, or rejected. They MUST NOT be silently removed.

## 6. Terminology

The following terms are normative.

| Term | Definition |
|---|---|
| **Project** | Root of the Sverka construct tree. A Project may contain multiple Pipelines. |
| **Pipeline** | Static provider-neutral definition of an automated process. |
| **Composite** | Reusable construct subtree with typed inputs, outputs, and child Steps. |
| **Entry** | A binding between a Trigger and one or more root Steps. |
| **Trigger** | External event that may create a Run. |
| **Step** | Independently schedulable execution unit in a Pipeline. |
| **Operation** | Ordered executable operation inside a Step. |
| **Runtime** | Execution environment required by a Step. |
| **Image** | OCI container image used by a Runtime. |
| **Source** | Repository or source revision made available to a Run. |
| **Workspace** | Filesystem view used by a Step. |
| **Input** | Typed external value accepted by a Pipeline or Entry. |
| **Output** | Typed value produced by a Step or Pipeline. |
| **Reference** | Symbolic typed reference to an Input, Output, context value, or resource. |
| **Artifact** | File or directory payload transferred between Steps or exported from a Run. |
| **Dependency** | Directed edge between Steps. |
| **Condition** | Symbolic expression controlling inclusion or execution. |
| **Definition Graph** | Static provider-neutral graph produced by synthesis. |
| **Run Plan** | Concrete execution graph produced after binding a Trigger, Inputs, context, and expansions. |
| **Run** | One execution instance of a Run Plan. |
| **Target** | Deterministic compiler from a Definition Graph to provider artifacts. |
| **Importer** | Parser from provider configuration into a Definition Graph. |
| **Engine** | Executor of a Run Plan or emitted provider configuration. |
| **Connector** | Integration with an external platform API. |
| **Plugin** | Package that contributes targets, engines, importers, connectors, validators, transforms, capabilities, or model extensions. |

### 6.1 Provider mapping

| Sverka | GitHub Actions | GitLab CI |
|---|---|---|
| Pipeline | Workflow | Pipeline configuration |
| Entry and Trigger | `on` and reachable jobs | pipeline source, workflow rules, and reachable jobs |
| Step | Job | Job |
| Operation | Workflow step | script or run item |
| Runtime | `runs-on` and container | image and tags |
| Dependency | `needs` | `needs` |
| Scalar Output | Job output | dotenv value or equivalent lowering |
| Artifact | Uploaded/downloaded artifact | Job artifact |
| ChangeRequest | Pull request | Merge request |

The terms `workflow`, `job`, `stage`, `runner`, `action`, `uses`, `pull_request`, `merge_request`, and `resource_group` are provider terms and MUST NOT appear in the core Definition Graph.

## 7. High-level Architecture

```text
                         AUTHORING

                 Decorator API
                       |
                       v
                    SDK API
                       |
                       v
                Construct API
                       |
                       v
                  Synthesis
                       |
                       v
               Definition Graph
                       |
          +------------+-------------+
          |                          |
          v                          v
    Target pipeline               Planner
          |                          |
    +-----+------+                   v
    |            |                Run Plan
    v            v                   |
 GitHub        GitLab      +----------+-----------+
 Target        Target      |          |           |
    |            |         v          v           v
 Artifacts     Artifacts  Native     act     gitlab-ci-local
                         Engine    Adapter        Adapter
```

Future import path:

```text
GitHub or GitLab configuration
             |
             v
          Importer
             |
             v
      Definition Graph
             |
     capability analysis
             |
      target or engine
```

## 8. Construct Tree

### 8.1 Decision

Sverka SHOULD use the `constructs` package directly for the initial implementation.

The Construct API MUST wrap it with Sverka-specific types so the public model does not depend on arbitrary implementation details.

### 8.2 Responsibilities of the construct tree

The construct tree owns:

- scoped identity;
- stable paths;
- parent-child ownership;
- composition;
- discovery;
- metadata;
- source locations;
- validation registration;
- context propagation.

### 8.3 Responsibilities excluded from the construct tree

The construct tree MUST NOT be the canonical execution graph.

Sverka MUST maintain a separate graph containing typed dependencies:

- control dependencies;
- value dependencies;
- artifact dependencies;
- resource dependencies.

### 8.4 Rationale

Using `constructs` avoids rebuilding identity, traversal, composition, metadata, and validation infrastructure. Keeping a separate execution graph avoids conflating ownership with scheduling.

## 9. Authoring Surfaces

### 9.1 Construct API

The Construct API is the lowest public layer. It is intended for:

- plugin authors;
- library authors;
- reusable components;
- advanced users;
- code generation;
- cases requiring explicit control.

Conceptual example:

```ts
const pipeline = new Pipeline(project, "ci");

const build = new ShellStep(pipeline, "build", {
  command: "npm run build",
  runtime: {
    image: images.node[22],
  },
  outputs: {
    dist: artifact("./dist"),
  },
});
```

### 9.2 SDK API

The SDK API is a convenience layer over the Construct API. SDK helpers MUST create the same construct types or equivalent normalized definitions.

The SDK is intended for:

- typed step factories;
- reusable composables;
- standard operations;
- typed inputs and outputs;
- artifacts;
- conditions;
- matrices;
- integrations;
- provider-neutral libraries.

Conceptual example:

```ts
const build = sh`npm run build`.outputs({
  dist: artifact("./dist"),
});
```

### 9.3 Decorator API

The Decorator API is a compact TypeScript-native layer over the SDK and Construct API.

The Decorator API MUST use standard ECMAScript decorators supported by current TypeScript. It MUST NOT require legacy `experimentalDecorators`, emitted design-type metadata, or `reflect-metadata` for its core behavior. Sverka-owned metadata SHOULD be stored through explicit registries, symbols, initializers, or equivalent framework-controlled mechanisms.

Canonical v0 forms:

```ts
@step
lint = "npm run lint";
```

```ts
@step({
  image: images.node[22],
  timeout: minutes(10),
})
build = sh`npm run build`.outputs({
  dist: artifact("./dist"),
});
```

```ts
@step
deploy = sh`deploy ${this.build.dist}`;
```

A reference such as `this.build.dist` creates a typed data or artifact dependency.

### 9.4 Canonical decorator metadata syntax

The initial release MUST support:

- `@step`;
- `@step(options)`;
- `@entry(trigger)`;
- `@input` or an equivalent typed input declaration;
- `@output` for pipeline-level exported outputs, if required.

The initial release SHOULD NOT require stacked decorator namespaces such as:

```ts
@step
@step.image(...)
@step.timeout(...)
```

Namespace decorators may be added later as optional syntax sugar.

### 9.5 Decorator typing constraint

A TypeScript decorator does not change the static type inferred from a field initializer.

Therefore:

```ts
@step
build = "npm run build";
```

is a compact leaf-step shorthand, but it cannot expose typed properties such as `this.build.dist` without a typed initializer.

Output-bearing and composable Steps MUST use a typed SDK value:

```ts
@step
build = sh`npm run build`.outputs({
  dist: artifact("./dist"),
});
```

The decorator provides identity, registration, and metadata. The SDK value provides the static TypeScript type.

### 9.6 Method-based Steps

In v0, a method decorated with `@step` is a planning method.

Its body is evaluated in a Step planning context and MUST:

- be deterministic;
- avoid arbitrary side effects;
- use Sverka operations and symbolic control flow;
- produce an Operation list;
- not depend on runtime-only values through normal JavaScript branching.

Example:

```ts
@step({ image: images.node[22] })
build() {
  sh`npm ci`;
  sh`npm run build`;
}
```

The operations are recorded during synthesis and executed later by a target or engine. No `await` is required for recorded operations.

A future `@step.native` form MAY represent a real TypeScript function bundled and executed at runtime. This is explicitly outside v0 because it requires asset bundling, dependency packaging, a runtime shim, and target support.

### 9.7 Mixing authoring surfaces

All authoring surfaces MAY be mixed in one Project.

A decorated Pipeline may instantiate SDK composables. An SDK composable may instantiate low-level constructs. A plugin may consume the normalized construct tree and Definition Graph without knowing which authoring surface created them.

### 9.8 Decorator initialization and identity

The default Step identifier is derived from its construct path and decorated member name. An explicit stable identifier MAY be supported for refactoring-sensitive pipelines.

In v0, decorated field initializers are evaluated in normal JavaScript source order. Therefore:

- a field initializer MAY directly reference only an already initialized Step field;
- Entry fields SHOULD be declared after the Steps they reference;
- forward references MUST use an explicit lazy reference helper or the SDK/Construct API;
- decorated initializers MUST avoid arbitrary side effects;
- private fields and symbol-named members are outside v0 unless explicitly supported by the implementation.

Source order is an authoring constraint only. It MUST NOT imply an execution dependency unless a Reference or explicit dependency creates one.

## 10. Definition Graph

The Definition Graph is the canonical provider-neutral source of truth.

Conceptual shape:

```ts
interface ProjectDefinition {
  pipelines: PipelineDefinition[];
}

interface PipelineDefinition {
  id: PipelineId;
  inputs: InputDefinition[];
  entries: EntryDefinition[];
  steps: StepDefinition[];
  outputs: OutputDefinition[];
  extensions: ExtensionNode[];
}

interface EntryDefinition {
  id: EntryId;
  trigger: TriggerDefinition;
  roots: StepId[];
}

interface StepDefinition {
  id: StepId;
  runtime: RuntimeDefinition;
  operations: OperationDefinition[];
  inputs: Reference[];
  outputs: StepOutputDefinition[];
  dependencies: Dependency[];
  timeout?: Duration;
  condition?: Expression<boolean>;
}
```

The exact TypeScript representation is implementation-defined. The semantics are normative.

## 11. References and Dependency Inference

### 11.1 Reference types

The core MUST support symbolic typed references for:

- pipeline inputs;
- step outputs;
- artifacts;
- environment values;
- secrets;
- source metadata;
- event metadata;
- run metadata;
- plugin-provided contexts.

### 11.2 Dependency types

The initial release MUST support:

1. **Control dependency** — one Step must complete before another may start.
2. **Value dependency** — a Step consumes a scalar Output from another Step.
3. **Artifact dependency** — a Step consumes an Artifact from another Step.

A future release MAY add resource and service dependencies.

### 11.3 Inference rule

When a Step definition contains a Reference produced by another Step, Sverka MUST add the appropriate dependency edge automatically.

Example:

```ts
@step
build = sh`npm run build`.outputs({
  dist: artifact("./dist"),
});

@step
deploy = sh`deploy ${this.build.dist}`;
```

The Definition Graph contains:

```text
build --artifact:dist--> deploy
```

### 11.4 Validation

Sverka MUST detect:

- dependency cycles;
- references to unknown producers;
- incompatible reference types;
- output name collisions;
- unavailable context references;
- trigger domains that cannot reach required dependencies;
- target or engine capability gaps.

## 12. Inputs, Outputs, and Context

### 12.1 Inputs

Inputs are typed symbolic values accepted by a Pipeline or Entry.

The initial scalar types are:

- string;
- number;
- boolean.

Inputs MAY have:

- a default value;
- a required flag;
- a description;
- a validation constraint;
- a secret classification.

### 12.2 Outputs

The initial output types are:

- string;
- number;
- boolean;
- artifact.

Outputs MUST be addressable through TypeScript properties when declared through typed SDK values.

### 12.3 Context namespaces

The provider-neutral SDK SHOULD expose property-based namespaces:

```ts
env.CI_TRACE
secrets.NPM_TOKEN

git.sha
git.branch
git.tag

change.id
change.source
change.target
change.draft

event.type
run.id
run.attempt

inputs.environment
```

The guiding rule is:

> Strings are values; identifiers are TypeScript properties.

String-based lookup MAY exist as a dynamic escape hatch but SHOULD NOT be the primary API.

### 12.4 Provider-specific context

Provider plugins MAY expose namespaced context:

```ts
github.event
gitlab.pipeline
```

Using a provider-specific reference marks the containing Step or Pipeline as requiring that provider capability.

## 13. Triggers and Entries

A Trigger describes an external event. An Entry binds a Trigger to one or more root Steps.

The v0 Trigger set is:

- `Push`;
- `ChangeRequest`;
- `Manual`.

The v0 filter set is:

- branch;
- tag;
- path.

Conceptual decorator form:

```ts
@entry(trigger.changeRequest())
verify = this.test;

@entry(trigger.push({ branches: [branches.main] }))
release = this.deploy;
```

`Schedule` is deferred because provider semantics differ and one target requires API-side configuration rather than only file emission.

A Pipeline MAY contain multiple Entries that reach different subsets of the execution graph.

### 13.1 Trigger scope

External Triggers bind only to Entries. A Step or Operation MUST NOT create a nested external Trigger during execution.

Runtime branching inside a Pipeline uses Conditions, gates, or event-waiting Operations rather than nested Triggers. This keeps subscription semantics separate from execution control flow.

### 13.2 Composite and include semantics

Provider-neutral reuse is represented by a Composite, not by a textual provider include. A Composite may contain child Steps and expose typed inputs and outputs.

In v0, Composites are normalized into the Definition Graph while preserving ownership and source provenance. Targets MAY inline them.

In later milestones, a target MAY lower a Composite to a provider-native reusable unit, include, component, or child pipeline when the capability manifest permits it. This lowering MUST preserve declared inputs, outputs, and dependency semantics.

## 14. Runtime, Source, and Workspace

### 14.1 Runtime

A Step Runtime describes its execution requirements.

The v0 Runtime model contains:

- execution mode: host or container;
- OCI image;
- architecture;
- abstract agent selectors;
- environment variables;
- secret references;
- working directory;
- timeout.

Decorator shorthand:

```ts
@step({ image: images.ubuntu.latest })
build = "npm run build";
```

The Definition Graph normalizes this to `step.runtime.image`.

### 14.2 Image values

Images SHOULD be represented by typed values where possible:

```ts
images.ubuntu.latest
images.node[22]
```

A raw OCI reference string remains a valid low-level value:

```ts
image("ghcr.io/acme/build:2026-08")
```

### 14.3 Source

The current repository source is an implicit Pipeline resource in v0.

Targets and engines lower it differently:

- GitHub target emits or references a checkout operation;
- GitLab target uses the provider checkout model where valid;
- native engine uses the current worktree or a cloned revision.

The user MUST NOT be required to reference provider-specific checkout actions in portable pipelines.

### 14.4 Workspace

Each Step receives a Workspace.

The native engine MUST define whether Workspaces are:

- isolated per Step;
- copied from Source;
- shared explicitly;
- populated by Artifact dependencies.

The v0 default is isolated Step Workspaces with explicit Artifact transfer.

## 15. Operations

The v0 operation set is deliberately small:

- shell command;
- shell command sequence;
- export scalar output;
- export artifact;
- import artifact;
- write diagnostic or log annotation.

Provider-specific actions, components, and custom operations are extension nodes and are not part of the v0 portable core.

Operations inside one Step are ordered. Steps are scheduled by the execution graph.

## 16. Synthesis Lifecycle

The synthesis lifecycle is:

```text
discover
   |
   v
instantiate constructs
   |
   v
collect metadata
   |
   v
normalize
   |
   v
build Definition Graph
   |
   v
validate
   |
   v
capability analysis
   |
   +-------------------+
   |                   |
   v                   v
lower to target      build Run Plan
   |                   |
   v                   v
emit artifacts       execute with engine
```

All phases before connector or engine execution MUST be deterministic.

## 17. Plugin Architecture

### 17.1 Plugin model

Sverka uses one typed plugin factory inspired by unified plugin systems, but with domain-specific facets rather than generic event hooks.

Conceptual contract:

```ts
interface SverkaPlugin {
  name: string;
  apiVersion: string;
  capabilities?: CapabilityManifest;
  model?: ModelContribution[];
  transforms?: GraphTransform[];
  validators?: GraphValidator[];
  targets?: Target[];
  importers?: Importer[];
  engines?: Engine[];
  connectors?: ConnectorFactory[];
  extensions?: NativeExtension[];
}
```

Factory:

```ts
const plugin = defineSverkaPlugin((options, meta) => ({
  name: "example",
  capabilities: {},
  targets: [],
  validators: [],
}));
```

### 17.2 Plugin facets

#### Model contribution

Adds provider-neutral or plugin-owned node kinds, expressions, references, or operations.

#### Transform

Performs deterministic graph normalization or lowering.

#### Validator

Adds semantic, security, compatibility, or policy diagnostics.

#### Target

Compiles a Definition Graph into provider artifacts.

#### Importer

Parses provider artifacts into a Definition Graph.

#### Engine

Executes a Run Plan or delegated target artifact.

#### Connector

Communicates with a remote provider API.

#### Native extension

Represents provider-specific semantics that do not belong in the portable core.

### 17.3 Typed phases

Plugins MUST register typed contributions for defined phases. Sverka SHOULD avoid an unstructured event bus such as arbitrary `beforeAnything` hooks.

Preferred phases are:

- normalize;
- validate;
- analyze capabilities;
- lower;
- emit;
- import;
- plan;
- execute.

### 17.4 Determinism

Targets, validators, and deterministic graph transforms MUST NOT perform network access.

Connectors are the only facet intended for provider API access.

## 18. First-party Provider Plugins

The initial provider plugins are:

- `sverka/github`;
- `sverka/gitlab`.

These are deterministic target plugins and MUST NOT require network access for compilation.

### 18.1 `sverka/github`

Responsibilities:

- capability manifest;
- GitHub target compiler;
- GitHub-specific lowering;
- GitHub-native extension nodes;
- generated assets required by lowering;
- future GitHub importer.

### 18.2 `sverka/gitlab`

Responsibilities:

- capability manifest;
- GitLab target compiler;
- GitLab-specific lowering;
- GitLab-native extension nodes;
- generated assets required by lowering;
- future GitLab importer.

### 18.3 Connectors

Remote API behavior is separated into connector packages or plugin facets:

- GitHub connector;
- GitLab connector;
- run dispatch;
- schedule management;
- status reporting;
- artifact transport;
- remote metadata discovery.

A pure target compiler MUST remain usable without credentials.

## 19. Target Contract

Conceptual contract:

```ts
interface Target {
  id: TargetId;
  capabilities: CapabilityManifest;

  analyze(graph: DefinitionGraph): Diagnostic[];
  lower(graph: DefinitionGraph): TargetGraph;
  emit(graph: TargetGraph): GeneratedArtifact[];
}
```

A Target MUST:

- declare capabilities;
- reject unsupported required semantics;
- preserve stable identifiers where possible;
- produce deterministic artifacts;
- emit source mappings for diagnostics;
- report every emulation or partial lowering;
- never silently discard nodes.

## 20. Importer Contract

Importers are outside v0 but the architecture MUST reserve the concept.

Conceptual contract:

```ts
interface Importer {
  id: ImporterId;
  sourceFormat: string;

  detect(input: ImportInput): DetectionResult;
  parse(input: ImportInput): ImportedDefinition;
  normalize(imported: ImportedDefinition): DefinitionGraph;
}
```

An Importer MUST preserve unknown provider-specific nodes as native extension nodes when possible.

Importer quality levels are:

- structural import;
- semantic import;
- same-provider round trip;
- cross-provider portable subset.

Lossless cross-provider translation is not assumed.

## 21. Engine Contract

Conceptual contract:

```ts
interface Engine {
  id: EngineId;
  input: "run-plan" | TargetId;
  capabilities: CapabilityManifest;

  run(request: RunRequest): AsyncIterable<RunEvent>;
  cancel(runId: RunId): Promise<void>;
}
```

An Engine MUST:

- declare capabilities;
- provide structured run events;
- support cancellation where feasible;
- expose Step-level status;
- preserve output and artifact semantics;
- report unsupported runtime requirements.

## 22. Native Engine

The Sverka native engine is the reference implementation of Sverka execution semantics.

It consumes a Run Plan directly, not GitHub or GitLab configuration.

### 22.1 Components

The v0 native engine contains:

1. **Planner** — binds Entry, Trigger, Inputs, and context into a Run Plan.
2. **Scheduler** — schedules the Step DAG.
3. **Step Executor** — executes ordered Operations inside one Step.
4. **Runtime Driver** — executes on the host or through an OCI runtime.
5. **Source Manager** — prepares the source revision.
6. **Workspace Manager** — creates and cleans Step Workspaces.
7. **Value Store** — transfers scalar Outputs.
8. **Artifact Store** — transfers file and directory Outputs.
9. **Secret Provider** — resolves secret references.
10. **Run Event Stream** — emits structured logs and state changes.
11. **Cancellation Controller** — stops pending and running work.

### 22.2 Step states

The engine SHOULD expose at least:

- pending;
- blocked;
- ready;
- running;
- succeeded;
- failed;
- skipped;
- cancelled.

### 22.3 Scheduling semantics

A Step becomes ready when:

- all required dependencies have completed successfully;
- required Outputs and Artifacts are available;
- its Condition is true;
- its Runtime requirements can be satisfied.

The engine MUST implement deterministic failure propagation.

### 22.4 Runtime drivers

The initial drivers are:

- host process driver;
- OCI container driver.

Sverka does not implement a container runtime. It integrates with Docker, Podman, containerd, or an equivalent backend.

### 22.5 Native engine non-goals for v0

The v0 engine does not include:

- distributed workers;
- remote scheduling;
- autoscaling;
- a persistent hosted control plane;
- multi-tenant isolation;
- advanced cache distribution;
- service meshes;
- provider UI emulation.

## 23. Delegated Engines

Delegated engines consume emitted provider configuration rather than the Definition Graph directly.

### 23.1 `act` adapter

Execution path:

```text
Definition Graph
      |
      v
GitHub Target
      |
      v
GitHub workflow artifacts
      |
      v
act adapter
```

### 23.2 `gitlab-ci-local` adapter

Execution path:

```text
Definition Graph
      |
      v
GitLab Target
      |
      v
GitLab CI artifacts
      |
      v
gitlab-ci-local adapter
```

Delegated engines are compatibility backends, not the source of Sverka semantics.

They are useful for:

- validating generated provider configuration;
- comparing behavior against the native engine;
- compatibility testing;
- temporary fallback for unsupported native features.

## 24. Capability Model

Capability identifiers are stable strings with namespaces.

Examples:

```text
trigger.push
trigger.change-request
trigger.manual
trigger.schedule

graph.dependencies
graph.conditions
graph.matrix

runtime.host
runtime.container
runtime.services

operation.shell
operation.provider-native

output.scalar
output.artifact

policy.timeout
policy.retry
policy.concurrency

composition.reusable
composition.dynamic-child
```

Capability manifest example:

```ts
const capabilities = {
  "trigger.push": "native",
  "graph.dependencies": "native",
  "output.scalar": {
    support: "lowered",
    via: "dotenv",
  },
  "policy.retry": "emulated",
  "composition.dynamic-child": "unsupported",
} satisfies CapabilityManifest;
```

The capability system MUST drive:

- compiler diagnostics;
- engine diagnostics;
- portability reports;
- documentation tables;
- conformance tests;
- cross-provider translation checks.

## 25. Feature Matrix and Roadmap

Legend:

- **N** — native target or engine support;
- **L** — compiler lowering;
- **E** — emulation through Sverka runtime or helper;
- **C** — connector required;
- **P** — partial support or semantic restrictions;
- **U** — unsupported.

| Capability | Milestone | GitHub | GitLab | Native engine |
|---|---:|---:|---:|---:|
| Push Trigger | M0 | N | N | N |
| ChangeRequest Trigger | M0 | N | N | N/P |
| Manual Trigger | M0 | N | N/C | N |
| Branch, tag, path filters | M0 | N | L/N | N |
| Step DAG | M0 | N | N | N |
| Shell Operations | M0 | N | N | N |
| Source Workspace | M0 | L | N/L | N |
| Host Runtime | M0 | N | N/P | N |
| Container Image | M0 | N | N | N |
| Environment References | M0 | N | N | N |
| Secret References | M0 | N/C | N/C | N |
| Scalar Outputs | M0 | N | L | N |
| Artifact Outputs | M0 | L | N | N |
| Working Directory | M0 | N | L/N | N |
| Timeout | M0 | N | N | N |
| Step Conditions | M1 | N | L/P | N |
| Matrix Expansion | M1 | N | N/P | N |
| Cache | M1 | L | N | N |
| Services | M1 | N | N | N |
| Schedule Trigger | M1 | N | C | N/C |
| Retry Policy | M1 | E/P | N | N |
| Concurrency Group | M1 | N | P | N |
| Deployment Environment | M1 | N/C | N/C | P/plugin |
| Provider-native Operation | M1 | N | N | E/plugin |
| `act` delegated engine | M1 | N | U | U |
| `gitlab-ci-local` delegated engine | M1 | U | N | U |
| Reusable Pipeline | M2 | N/P | N/P | N |
| Dynamic Child Graph | M2 | E/P | N | N |
| GitHub Importer | M2 | N | — | imported subset |
| GitLab Importer | M2 | — | N | imported subset |
| Cross-provider Compilation | M2 | target | target | direct |
| Same-provider Round Trip | M2 | P | P | — |
| Hosted Native Engine | M3 | C/E | C/E | N |
| Distributed Execution | M3 | C/agents | C/agents | N |

This matrix describes the intended architecture and roadmap. It is not a promise of identical semantics across providers.

## 26. Provider-specific Extensions

Provider-specific behavior is represented by plugin-owned extension nodes.

Conceptual API:

```ts
github.native({
  // GitHub-specific semantics
});
```

```ts
gitlab.native({
  // GitLab-specific semantics
});
```

An extension node MUST contain:

- owning plugin identifier;
- schema version;
- capability requirements;
- source location;
- optional portable fallback;
- optional translators;
- serialization support.

Cross-target compilation MUST fail when an extension has no valid lowering or fallback.

## 27. Cross-provider Execution

Sverka defines three levels of portability.

### Level 1: Sverka definition to any supported target

```text
Sverka TypeScript
      |
      v
Definition Graph
   +--+--+
   |     |
   v     v
GitHub GitLab
```

This is the primary product goal.

### Level 2: Sverka definition to any supported engine

```text
Definition Graph
   |      |       |
   v      v       v
Native   act   gitlab-ci-local
```

Delegated engines require target emission first.

### Level 3: Existing provider configuration to another provider

```text
.gitlab-ci.yml
      |
      v
GitLab Importer
      |
      v
Definition Graph
      |
      v
Capability Analysis
      |
      v
GitHub Target or Native Engine
```

And the reverse direction:

```text
GitHub workflow
      |
      v
GitHub Importer
      |
      v
Definition Graph
      |
      v
GitLab Target or Native Engine
```

Level 3 is expected to be partial because providers have different event, security, expression, composition, approval, identity, and reporting semantics.

The architecture MUST make every loss, emulation, restriction, or unsupported feature explicit.

## 28. Hosted Native Engine

A future provider integration MAY launch the Sverka native engine inside provider-managed compute.

Two execution strategies then exist:

1. **Target-native lowering** — emit provider-native jobs and operations for best UI integration.
2. **Hosted engine mode** — emit a bootstrap job that starts the Sverka engine and executes a Run Plan.

Hosted engine mode may support semantics that do not map cleanly to the provider, but may provide less granular provider UI and limited parallelism unless remote workers are available.

## 29. Public Package Surface

The recommended user-facing imports are:

```text
sverka
sverka/constructs
sverka/sdk
sverka/decorators
sverka/github
sverka/gitlab
sverka/engine/native
sverka/engine/act
sverka/engine/gitlab-ci-local
```

The repository MAY implement these as separate workspace packages while exposing stable subpath exports.

Suggested internal packages:

```text
packages/core
packages/constructs
packages/sdk
packages/decorators
packages/plugin
packages/target-github
packages/target-gitlab
packages/engine-native
packages/engine-act
packages/engine-gitlab-ci-local
packages/connector-github
packages/connector-gitlab
packages/cli
```

Target plugins SHOULD remain lightweight and deterministic. Optional connectors and delegated engines SHOULD not become mandatory dependencies of the core package.

## 30. CLI

The v0 CLI contains:

```text
sverka validate
sverka synth --target github
sverka synth --target gitlab
sverka plan
sverka graph
sverka run
```

Expected behavior:

### `validate`

- synthesize the Definition Graph;
- run core and plugin validators;
- detect graph errors;
- report capability gaps for selected targets or engines.

### `synth`

- compile to one target;
- emit generated artifacts;
- emit source maps and diagnostics;
- perform no network access.

### `plan`

- bind an Entry and Inputs;
- produce a Run Plan;
- show expanded dependencies and required capabilities.

### `graph`

- display construct ownership and execution DAG separately;
- show control, value, and artifact edges.

### `run`

- execute through the native engine by default;
- allow selecting a delegated engine when installed.

## 31. Minimal v0 Scope

The v0 release is complete only when all of the following work through one semantic model.

### 31.1 Authoring

- Construct API;
- SDK API;
- Decorator API;
- the same sample Pipeline expressed through each API synthesizes an equivalent Definition Graph.

### 31.2 Core model

- Project;
- Pipeline;
- Entry;
- Push, ChangeRequest, and Manual Triggers;
- Step;
- shell Operations;
- Runtime;
- Source and Workspace;
- typed Inputs;
- scalar and Artifact Outputs;
- typed References;
- control, value, and artifact dependencies.

### 31.3 Targets

- GitHub target;
- GitLab target;
- deterministic output;
- capability manifests;
- source-mapped diagnostics.

### 31.4 Native engine

- host execution;
- OCI container execution;
- DAG scheduling;
- Step Workspaces;
- scalar Output transfer;
- Artifact transfer;
- secret resolution;
- timeout;
- failure propagation;
- cancellation;
- structured logs.

### 31.5 Tooling

- validate;
- synthesize;
- plan;
- graph;
- run;
- conformance tests.

## 32. Explicitly Deferred from v0

The following are deferred:

- matrix expansion;
- cache;
- services;
- schedule Triggers;
- retry policy;
- concurrency groups;
- deployment environments and approvals;
- reusable Pipelines;
- dynamic child Pipelines;
- provider-native actions and components in the portable core;
- arbitrary TypeScript runtime Steps;
- GitHub and GitLab importers;
- delegated engine adapters;
- hosted native engine;
- distributed execution.

## 33. Conformance Testing

Sverka MUST include a conformance suite shared by all authoring APIs, targets, and engines.

### 33.1 Authoring conformance

Equivalent Construct, SDK, and Decorator definitions MUST synthesize equivalent normalized graphs.

### 33.2 Target conformance

Each target MUST pass fixtures for:

- triggers;
- dependencies;
- shell operations;
- runtime images;
- environment and secret references;
- scalar outputs;
- artifacts;
- timeouts;
- source workspace behavior;
- diagnostics for unsupported capabilities.

### 33.3 Engine conformance

The native engine MUST pass semantic fixtures for:

- topological scheduling;
- parallel Steps;
- failure propagation;
- output transfer;
- artifact transfer;
- cancellation;
- timeout;
- workspace isolation;
- secret injection.

### 33.4 Capability conformance

Capability documentation SHOULD be generated from plugin manifests. Tests MUST verify that declared support matches implementation behavior.

### 33.5 Future importer conformance

Importers SHOULD have:

- parse fixtures;
- same-provider round-trip fixtures;
- unsupported-node preservation tests;
- cross-provider portability diagnostics.

## 34. Acceptance Criteria for v0

v0 is accepted when:

1. a representative Pipeline can be authored through Constructs, SDK, and Decorators;
2. all three forms synthesize the same normalized Definition Graph;
3. the graph compiles to valid GitHub and GitLab artifacts;
4. the same graph executes successfully through the native engine;
5. a scalar Output can flow between Steps;
6. an Artifact can flow between Steps;
7. a container image can be selected provider-neutrally;
8. `env`, `secrets`, `git`, `change`, `event`, `run`, and `inputs` are available as typed symbolic contexts where applicable;
9. cycles and unsupported capabilities produce actionable diagnostics;
10. target compilation performs no network access;
11. no provider-specific term is required in the portable definition;
12. generated feature documentation is derived from capability manifests.

## 35. Decision Summary

The initial architecture makes the following decisions:

1. Sverka has one provider-neutral Definition Graph.
2. Construct, SDK, and Decorator APIs are layers over the same model.
3. Sverka uses `constructs` for ownership and composition.
4. Execution dependencies are stored in a separate typed DAG.
5. `Step` is the independently schedulable unit.
6. `Operation` is the ordered executable unit inside a Step.
7. `@step` and `@step(options)` are the canonical v0 decorator forms.
8. Typed outputs require typed SDK initializers; decorators alone do not change static field types.
9. Method-based `@step` bodies are planning methods in v0.
10. The native engine consumes Run Plans directly and defines reference semantics.
11. GitHub and GitLab are deterministic target plugins.
12. Connectors and delegated engines are separate from target compilation.
13. Existing provider configuration import is deferred to M2.
14. Provider-specific nodes are preserved or rejected, never silently dropped.
15. Capability manifests drive diagnostics, documentation, and portability analysis.

## 36. Final Vision

The long-term Sverka architecture supports both provider-native compilation and provider-independent execution:

```text
Author once
    |
    v
Provider-neutral Definition Graph
    |
    +------------------------------+
    |              |               |
    v              v               v
GitHub Target   GitLab Target   Native Engine
    |              |               |
    v              v               v
GitHub         GitLab          Local, hosted,
Actions        CI              or distributed
```

Future importers extend this model:

```text
GitHub or GitLab configuration
             |
             v
          Importer
             |
             v
      Definition Graph
             |
             v
another target or the native engine
```

This does not make every provider feature automatically portable. It makes portability a measurable, diagnosable, and extensible capability problem rather than a redesign of the system.
