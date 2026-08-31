// GithubTarget — implements the Target contract (§19).
// Spec 08 — §18.1, §19. Spec 22 — action SHA pinning.

import type { DefinitionGraph } from "@sverka/workflow";
import type { CapabilityManifest, Target } from "../plugin/index.js";
import { analyzeCapabilities } from "../plugin/index.js";
import { githubCapabilities } from "./capabilities.js";
import { lowerGithub } from "./lower.js";
import { emitGithub } from "./emit.js";
import { pinActionRef, loadBundledRegistry } from "./pinning.js";
import type { PinRegistry } from "./pinning.js";
import type {
  GithubTargetGraph,
  GithubTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
  GithubJob,
} from "./types.js";

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * GitHub Actions target — native lowering from Definition Graph.
 * Implements the Target contract: analyze → lower → emit.
 */
export class GithubTarget implements Target {
  readonly name = "github";
  readonly capabilities: CapabilityManifest = githubCapabilities;

  private readonly pinningMode: "strict" | "off";
  private readonly pinningRegistry: PinRegistry;

  constructor(config?: GithubTargetConfig) {
    const pinning = config?.pinning;
    this.pinningMode = pinning?.mode ?? "off";
    this.pinningRegistry = pinning?.registry ?? loadBundledRegistry();
  }

  /**
   * Analyze a Definition Graph against the GitHub capability manifest.
   * Returns diagnostics for unsupported or emulated capabilities, plus
   * `unpinned-action` diagnostics (spec 22) for third-party `uses:` refs
   * that are not pinned in the emitted output.
   */
  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    const capDiags = analyzeCapabilities(graph, [this.capabilities]) as readonly TargetDiagnostic[];
    const targetGraph = this.lower(graph);
    const pinDiags = this.pinningDiagnostics(targetGraph);
    return [...capDiags, ...pinDiags];
  }

  /**
   * Lower a Definition Graph to one or more GithubTargetGraphs.
   * Single-pipeline graphs return one target graph; multi-pipeline graphs
   * with reusable workflow calls return one per pipeline.
   */
  lower(graph: DefinitionGraph): GithubTargetGraph | readonly GithubTargetGraph[] {
    return lowerGithub(graph);
  }

  /**
   * Emit one or more GithubTargetGraphs as YAML artifacts.
   * Produces .github/workflows/<name>.yml files. When pinning is on (strict),
   * every `uses:` ref is routed through `pinActionRef`.
   */
  emit(
    targetGraph: GithubTargetGraph | readonly GithubTargetGraph[],
  ): readonly GeneratedArtifact[] {
    const options =
      this.pinningMode === "strict"
        ? { pinUses: (ref: string) => pinActionRef(ref, this.pinningRegistry) }
        : undefined;
    return emitGithub(targetGraph, options);
  }

  /**
   * Compile a Definition Graph to generated artifacts and diagnostics.
   */
  compile(graph: DefinitionGraph): CompilationResult {
    const targetGraph = this.lower(graph);
    const capDiags = analyzeCapabilities(graph, [this.capabilities]) as readonly TargetDiagnostic[];
    const pinDiags = this.pinningDiagnostics(targetGraph);
    const artifacts = this.emit(targetGraph);
    return { artifacts, diagnostics: [...capDiags, ...pinDiags] };
  }

  /**
   * Scan a lowered target graph for third-party `uses:` refs and emit
   * `unpinned-action` diagnostics (spec 22). A ref is "unpinned" when it
   * remains on a mutable version tag in the emitted output:
   * - strict mode + missing registry entry → error
   * - off mode + missing registry entry → warning
   * - malformed ref (no `@`) → warning (both modes)
   * Refs in the registry produce no diagnostic (they are pinnable; strict
   * pins them, off leaves them unchanged by choice).
   */
  private pinningDiagnostics(
    targetGraph: GithubTargetGraph | readonly GithubTargetGraph[],
  ): readonly TargetDiagnostic[] {
    const diags: TargetDiagnostic[] = [];
    const graphs = Array.isArray(targetGraph) ? targetGraph : [targetGraph];
    const seen = new Set<string>();
    for (const g of graphs) {
      for (const job of g.jobs) {
        for (const ref of collectUsesRefs(job)) {
          if (seen.has(ref)) continue;
          seen.add(ref);
          const diag = this.diagnosticFor(ref, job.id);
          if (diag) diags.push(diag);
        }
      }
    }
    return diags;
  }

  private diagnosticFor(ref: string, jobId: string): TargetDiagnostic | undefined {
    // Local actions and already-pinned refs are fine.
    if (ref.startsWith("./")) return undefined;
    const at = ref.lastIndexOf("@");
    if (at < 0) {
      return {
        capability: "unpinned-action",
        support: "unsupported",
        severity: "warning",
        message: `Action ref "${ref}" is malformed (no @version) and cannot be pinned.`,
        stepId: jobId,
      };
    }
    const tail = ref.slice(at + 1);
    if (SHA_RE.test(tail)) return undefined; // already pinned
    if (this.pinningRegistry[ref]) return undefined; // pinnable — no diagnostic
    const severity = this.pinningMode === "strict" ? "error" : "warning";
    return {
      capability: "unpinned-action",
      support: "unsupported",
      severity,
      message: `Action "${ref}" is not pinned to a commit SHA (no registry entry).`,
      stepId: jobId,
    };
  }
}

/** Collect every `uses:` ref from a job (step-level + reusable-job-level). */
function collectUsesRefs(job: GithubJob): readonly string[] {
  const refs: string[] = [];
  if (job.uses) refs.push(job.uses);
  for (const step of job.steps) {
    if (step.uses) refs.push(step.uses);
  }
  return refs;
}

/**
 * Convenience function: analyze → lower → emit in one call.
 */
export function compileGithub(graph: DefinitionGraph): CompilationResult {
  return new GithubTarget().compile(graph);
}
