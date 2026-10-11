/** Compiler configuration. All fields optional; sensible defaults apply. */
export interface GithubCompilerConfig {
  /** Workflow name. Defaults to "Sverka". */
  readonly name?: string;
  /** Trigger events. Defaults to push on main + pull_request. */
  readonly on?: GithubTriggers;
  /** Runner image label. Defaults to "ubuntu-latest". */
  readonly runner?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Node version for actions/setup-node. Defaults to "24". */
  readonly nodeVersion?: string;
  /** Permissions for the GITHUB_TOKEN. Defaults to { contents: "read" }. */
  readonly permissions?: GithubPermissions;
}

export interface GithubTriggers {
  readonly push?: readonly string[];
  readonly pullRequest?: readonly string[];
  readonly workflowDispatch?: boolean;
}

export interface GithubPermissions {
  readonly contents?: "read" | "write";
  readonly actions?: "read" | "write";
  readonly checks?: "read" | "write";
  readonly securityEvents?: "read" | "write";
  readonly idToken?: "read" | "write";
}
