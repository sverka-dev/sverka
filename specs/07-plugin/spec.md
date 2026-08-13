# Spec 07 — Plugin + Capability Model

**Status:** Active
**Source:** specs/architecture-spec.md §17, §24, §26
**Package:** `@sverka/plugin` (new)

## Overview

The plugin package provides the extensibility model for Sverika. Plugins
are typed factories with domain-specific facets (targets, importers,
engines, connectors, validators, transforms). The capability model
declares support levels for features across plugins, driving diagnostics,
portability reports, and conformance tests.

## Goals

- `SverkaPlugin` interface with typed facets
- `defineSverkaPlugin` factory function
- `CapabilityManifest` type with support levels
- Capability support levels: native, lowered, emulated, connector, partial, unsupported
- `analyzeCapabilities(graph, manifests)` → diagnostics
- `CapabilityDiagnostic` type with severity and message
- Plugin registry for collecting plugins
- No network access in targets/validators/transforms (§17.4)

## Non-goals

- First-party provider plugins (Waves H/I)
- Connector implementations (future)
- Native extension node serialization (future)
- Plugin loading from npm packages (future — v0 uses explicit registration)
- Unstructured event bus (§17.3 — explicitly avoided)

## Interfaces

```ts
// Plugin factory
function defineSverkaPlugin(
  factory: (options?: PluginOptions, meta?: PluginMeta) => SverkaPlugin,
  options?: PluginOptions,
): SverkaPlugin;

// Capability analysis
function analyzeCapabilities(
  graph: DefinitionGraph,
  manifests: readonly CapabilityManifest[],
): readonly CapabilityDiagnostic[];

// Plugin registry
function createPluginRegistry(): PluginRegistry;
```

### Plugin interface

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

### Capability manifest

```ts
type CapabilitySupport =
  | "native"
  | "lowered"
  | "emulated"
  | "connector"
  | "partial"
  | "unsupported";

interface CapabilityDetail {
  support: CapabilitySupport;
  via?: string;
  notes?: string;
}

type CapabilityManifest = Record<string, CapabilitySupport | CapabilityDetail>;
```

### Capability diagnostic

```ts
interface CapabilityDiagnostic {
  readonly capability: string;
  readonly support: CapabilitySupport;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly stepId?: string;
}
```

### Exports

```ts
export { defineSverkaPlugin, analyzeCapabilities, detectCapabilities, createPluginRegistry };
export type {
  SverkaPlugin, PluginOptions, PluginMeta,
  CapabilityManifest, CapabilitySupport, CapabilityDetail,
  CapabilityDiagnostic,
  ModelContribution, GraphTransform, GraphValidator,
  Target, CompilationResult, Importer, Engine, ConnectorFactory, NativeExtension,
  PluginRegistry,
};
export { PluginError, type PluginErrorCode } from "./errors.js";
```

## Data models

### Capability analysis

`analyzeCapabilities` inspects a Definition Graph to determine which
capabilities it uses (e.g., `trigger.push`, `runtime.host`, `operation.shell`).
For each capability, it checks the provided manifests to find the support
level. If no manifest declares the capability, it produces an "unsupported"
diagnostic. If a manifest declares it as "native" or "lowered", no
diagnostic is produced. "emulated" and "partial" produce warnings.

### Capability detection

The analyzer detects capabilities from the graph:
- `trigger.<kind>` for each entry trigger kind
- `runtime.<mode>` for each step runtime mode
- `operation.shell` for shell operations
- `output.scalar` for scalar outputs
- `output.artifact` for artifact outputs
- `graph.dependencies` when any step has dependencies

### Plugin registry

A simple registry that collects plugins and provides access to their
facets:

```ts
interface PluginRegistry {
  register(plugin: SverkaPlugin): void;
  plugins: readonly SverkaPlugin[];
  getCapabilities(): CapabilityManifest[];
}
```

## Error handling

Custom error class `PluginError` with codes:
- `INVALID_PLUGIN`: plugin is missing required fields
- `DUPLICATE_PLUGIN`: plugin name already registered
- `INVALID_CAPABILITY`: invalid capability manifest

```ts
class PluginError extends Error {
  readonly code: PluginErrorCode;
  override readonly cause: unknown;
}
```

## Test plan

1. `defineSverkaPlugin` creates a plugin with name and apiVersion
2. Plugin with capabilities manifest → manifest accessible
3. `analyzeCapabilities` with native support → no diagnostics
4. `analyzeCapabilities` with unsupported capability → error diagnostic
5. `analyzeCapabilities` with emulated capability → warning diagnostic
6. `analyzeCapabilities` with no manifests → all unsupported
7. `analyzeCapabilities` detects trigger.push from graph entries
8. `analyzeCapabilities` detects runtime.host from step runtime
9. `analyzeCapabilities` detects operation.shell from shell operations
10. `analyzeCapabilities` detects graph.dependencies from step deps
11. `createPluginRegistry` → register and retrieve plugins
12. `createPluginRegistry` → duplicate name throws DUPLICATE_PLUGIN
13. `createPluginRegistry` → getCapabilities collects from all plugins
14. Public API: all exports present, no any types
