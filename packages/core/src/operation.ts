/**
 * The kind of work an Operation represents. Determines how executors and
 * compilers interpret the spec.
 */
export type OperationKind =
  | "run" // execute a command in a container or host process
  | "check" // run a verification tool and produce findings
  | "build" // produce a build artifact
  | "analyze" // static or dynamic analysis without a pass/fail verdict
  | "fetch" // retrieve an external resource (cache, dependency)
  | "publish" // emit an artifact or report
  | "custom"; // user-defined operation kind

/**
 * A fully-resolved, serializable description of a single unit of work.
 * Produced during Plan mode and consumed during Execution or Compile mode.
 */
export interface OperationSpec {
  readonly id: string;
  readonly kind: OperationKind;
  readonly name: string;
  readonly description?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly workingDir?: string;
  readonly image?: string;
  readonly imageDigest?: string;
  readonly dependsOn?: readonly string[];
  readonly condition?: string;
  readonly matrix?: Readonly<Record<string, readonly unknown[]>>;
  readonly cpuLimit?: string;
  readonly memoryLimit?: string;
  readonly timeoutSeconds?: number;
  readonly retries?: number;
  readonly continueOnError?: boolean;
  readonly cache?: CacheDeclaration;
  readonly artifacts?: readonly ArtifactDeclaration[];
  readonly network?: NetworkPolicy;
  readonly credentials?: readonly CredentialDeclaration[];
  readonly tags?: readonly string[];
}

export interface CacheDeclaration {
  readonly inputs: readonly string[];
  readonly outputs?: readonly string[];
  readonly key?: string;
}

export interface ArtifactDeclaration {
  readonly path: string;
  readonly name?: string;
  readonly retain?: boolean;
}

export type NetworkPolicy = "deny" | "allow-host" | "allow-egress";

export interface CredentialDeclaration {
  readonly name: string;
  readonly envVar: string;
  readonly required: boolean;
}

/**
 * An Operation is a lazy, composable node in the workflow graph. It carries
 * a partial spec that is merged as it is composed. It is never executed at
 * definition time.
 */
export interface Operation {
  readonly kind: OperationKind;
  readonly spec: Readonly<Partial<OperationSpec>>;
  /** Compose this operation into a sequence after the given predecessor. */
  readonly after: (...predecessors: Operation[]) => Operation;
  /** Compose this operation to run in parallel with siblings. */
  readonly with: (...siblings: Operation[]) => Operation;
  /** Attach a human-readable name. */
  readonly named: (name: string) => Operation;
  /** Attach tags for filtering and grouping. */
  readonly tagged: (...tags: string[]) => Operation;
  /** Internal stable id assigned during planning. */
  readonly _id?: string;
}
