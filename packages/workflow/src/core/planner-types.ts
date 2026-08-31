// @sverka/workflow — planner types

export interface ProjectContext {
  root: string;
  commit: string;
  dirty: boolean;
  changedFiles: readonly ChangedFile[];
  languages: readonly DetectedLanguage[];
  packageManagers: readonly DetectedPackageManager[];
  hasContainerBuild: boolean;
  hasCiDefinition: boolean;
  monorepo: MonorepoMarker | null;
  localSignals: readonly LocalSignal[];
  explanation: DiscoveryExplanation;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface DetectedLanguage {
  name: string;
  confidence: number;
  evidence: string[];
  fileCount: number;
}

export type PackageManagerName =
  | "npm" | "yarn" | "pnpm" | "bun" | "pip" | "poetry" | "uv"
  | "pipenv" | "cargo" | "go" | "maven" | "gradle" | "composer" | "other";

export interface DetectedPackageManager {
  name: PackageManagerName;
  version: string | null;
  lockfile: string | null;
  evidence: string[];
}

export type MonorepoTool =
  | "nx" | "turborepo" | "lerna" | "pnpm-workspace" | "bun-workspace" | "custom";

export interface MonorepoMarker {
  tool: MonorepoTool;
  workspaces: readonly string[];
  evidence: string[];
}

export type LocalSignalType =
  | "manifest"
  | "lockfile"
  | "dockerfile"
  | "docker-compose"
  | "ci-definition"
  | "monorepo-marker"
  | "git-metadata";

export interface LocalSignal {
  type: LocalSignalType;
  path: string;
  detail: string | null;
  confidence: number;
}

export interface ProposedCheck {
  id: string;
  checkId: string;
  reason: string;
  signalRef: string | null;
  priority: number;
}

export interface DiscoveryExplanation {
  summary: string;
  signalCounts: Readonly<Record<LocalSignalType, number>>;
}
